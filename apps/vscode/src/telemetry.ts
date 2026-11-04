import * as vscode from "vscode";

import {
  createZimiDeviceId,
  ZIMI_CODE_PROVIDER_NAME,
  ZIMI_REGION_PROFILES,
} from "@zimi-ai/zimi-code-oauth";
import {
  ZimiAuthFacade,
  loadRuntimeConfigSafe,
  resolveConfigPath,
  resolveZimiHome,
  type ZimiConfig,
} from "@zimi-ai/zimi-code-sdk";
import {
  initializeTelemetry,
  setTelemetryEnabled,
  shouldEnableTelemetry,
  shutdownTelemetry,
  track,
} from "@zimi-ai/zimi-telemetry";

import { resolveExtensionRegion } from "./utils/region";

const SHUTDOWN_TIMEOUT_MS = 2000;

export interface ExtensionTelemetryOptions {
  readonly version: string;
  readonly log: (message: string) => void;
}

export function activateExtensionTelemetry(options: ExtensionTelemetryOptions): vscode.Disposable {
  const homeDir = resolveZimiHome();
  let firstLaunch = false;
  const deviceId = createZimiDeviceId(homeDir, {
    onFirstLaunch: () => {
      firstLaunch = true;
    },
  });
  const configPath = resolveConfigPath({ homeDir });
  const config = readTelemetryConfig(configPath);
  const auth = new ZimiAuthFacade({ homeDir, configPath });
  const resolveRegion = () => resolveExtensionRegion({ homeDir });
  const resolution = resolveRegion();

  initializeTelemetry({
    homeDir,
    deviceId,
    enabled: config.telemetry !== false,
    initiallyEnabled: vscode.env.isTelemetryEnabled,
    appName: "zimi-code-vscode",
    version: options.version,
    uiMode: "vscode",
    model: config.defaultModel,
    region: resolution.region,
    regionSource: resolution.source,
    resolveRegion,
    endpoint: () => ZIMI_REGION_PROFILES[resolveRegion().region].telemetryEndpoint,
    getAccessToken: async () => (await auth.getCachedAccessToken(ZIMI_CODE_PROVIDER_NAME)) ?? null,
    onUnexpectedError: (error) => options.log(`Telemetry dropped a property: ${error.message}`),
  });

  const staticallyEnabled = shouldEnableTelemetry({ enabled: config.telemetry !== false });
  if (firstLaunch) track("first_launch");

  return vscode.env.onDidChangeTelemetryEnabled((enabled) => {
    if (staticallyEnabled) setTelemetryEnabled(enabled);
  });
}

export async function deactivateExtensionTelemetry(): Promise<void> {
  await shutdownTelemetry({ timeoutMs: SHUTDOWN_TIMEOUT_MS });
}

function readTelemetryConfig(
  configPath: string,
): Pick<ZimiConfig, "telemetry" | "defaultModel"> {
  try {
    const { config, fileError } = loadRuntimeConfigSafe(configPath);
    if (fileError !== undefined) return {};
    return config;
  } catch {
    return {};
  }
}
