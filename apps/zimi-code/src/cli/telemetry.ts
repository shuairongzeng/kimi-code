import {
  createZimiDeviceId,
  ZIMI_CODE_PROVIDER_NAME,
} from '@zimi-ai/zimi-code-oauth';
import {
  ZimiAuthFacade,
  loadRuntimeConfigSafe,
  log,
  resolveConfigPath,
  resolveZimiHome,
  type ZimiConfig,
  type TelemetryClient,
} from '@zimi-ai/zimi-code-sdk';

import type { PromptHarness } from './prompt-session';
import {
  initializeTelemetry,
  setTelemetryContext,
  track,
  withTelemetryContext,
} from '@zimi-ai/zimi-telemetry';

import { CLI_USER_AGENT_PRODUCT, WEB_UI_MODE } from '#/constant/app';
import {
  currentZimiProfile,
  currentZimiRegionResolution,
  freshZimiProfile,
  resolveZimiRegionFresh,
} from '#/utils/region';

import { createZimiCodeHostIdentity } from './host-identity';

export interface CliTelemetryBootstrap {
  readonly homeDir: string;
  readonly deviceId: string;
  readonly firstLaunch: boolean;
}

export interface InitializeCliTelemetryOptions {
  readonly harness: PromptHarness;
  readonly bootstrap: CliTelemetryBootstrap;
  readonly config: Pick<ZimiConfig, 'defaultModel' | 'telemetry'>;
  readonly version: string;
  readonly uiMode: string;
  readonly model?: string;
  readonly sessionId?: string;
}

export function createCliTelemetryBootstrap(): CliTelemetryBootstrap {
  let firstLaunch = false;
  const homeDir = resolveZimiHome();
  const deviceId = createZimiDeviceId(homeDir, {
    onFirstLaunch: () => {
      firstLaunch = true;
    },
  });
  return { homeDir, deviceId, firstLaunch };
}

export function initializeCliTelemetry(options: InitializeCliTelemetryOptions): void {
  const resolution = currentZimiRegionResolution();
  initializeTelemetry({
    homeDir: options.harness.homeDir,
    deviceId: options.bootstrap.deviceId,
    enabled: options.config.telemetry !== false,
    appName: CLI_USER_AGENT_PRODUCT,
    version: options.version,
    uiMode: options.uiMode,
    model: options.model ?? options.config.defaultModel,
    sessionId: options.sessionId,
    region: resolution.region,
    regionSource: resolution.source,
    resolveRegion: () => currentZimiRegionResolution(),
    endpoint: () => currentZimiProfile().telemetryEndpoint,
    getAccessToken: async () =>
      (await options.harness.auth.getCachedAccessToken(ZIMI_CODE_PROVIDER_NAME)) ?? null,
    onUnexpectedError: (error) => log.warn('telemetry property dropped', { error: String(error) }),
  });
  if (options.bootstrap.firstLaunch) {
    options.harness.track('first_launch');
  }
}

export interface InitializeServerTelemetryOptions {
  readonly version: string;
}

/**
 * Bootstrap telemetry for the `zimi web` host.
 *
 * Mirrors {@link initializeCliTelemetry}: mints the device id, reads config to
 * honor the `telemetry` toggle and pick up the default model, and attaches the
 * sink with `ui_mode = "web"`.
 *
 * The returned client wraps the `@zimi-ai/zimi-telemetry` module
 * functions, so the module-level `track` / `withTelemetryContext` (used to
 * fire the startup event) share the same underlying client + sink.
 */
export function initializeServerTelemetry(
  options: InitializeServerTelemetryOptions,
): TelemetryClient {
  const bootstrap = createCliTelemetryBootstrap();
  const configPath = resolveConfigPath({ homeDir: bootstrap.homeDir });
  const config = readServerTelemetryConfig(configPath);
  const auth = new ZimiAuthFacade({
    homeDir: bootstrap.homeDir,
    configPath,
    identity: createZimiCodeHostIdentity(options.version),
  });

  const resolution = resolveZimiRegionFresh();
  initializeTelemetry({
    homeDir: bootstrap.homeDir,
    deviceId: bootstrap.deviceId,
    enabled: config.telemetry !== false,
    appName: CLI_USER_AGENT_PRODUCT,
    version: options.version,
    uiMode: WEB_UI_MODE,
    model: config.defaultModel,
    region: resolution.region,
    regionSource: resolution.source,
    resolveRegion: () => currentZimiRegionResolution(),
    endpoint: () => freshZimiProfile().telemetryEndpoint,
    getAccessToken: async () => (await auth.getCachedAccessToken(ZIMI_CODE_PROVIDER_NAME)) ?? null,
    onUnexpectedError: (error) => log.warn('telemetry property dropped', { error: String(error) }),
  });

  return {
    track,
    withContext: withTelemetryContext,
    setContext: setTelemetryContext,
  };
}

function readServerTelemetryConfig(
  configPath: string,
): Pick<ZimiConfig, 'telemetry' | 'defaultModel'> {
  try {
    const { config, fileError } = loadRuntimeConfigSafe(configPath);
    // A broken config fails the server on its own inside ZimiCore; for
    // telemetry just degrade to "enabled, no model" so we never block startup.
    if (fileError !== undefined) return {};
    return config;
  } catch {
    return {};
  }
}
