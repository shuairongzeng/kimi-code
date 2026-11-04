/**
 * Tests for the CLI telemetry bootstrap helpers, focusing on the
 * `zimi web` / `zimi server run` host wiring added in `cli/telemetry.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetZimiRegionCache } from '#/utils/region';

const mocks = vi.hoisted(() => ({
  initializeTelemetry: vi.fn(),
  createZimiDeviceId: vi.fn(() => 'device-123'),
  resolveZimiHome: vi.fn(() => '/home/.zimi-code'),
  resolveConfigPath: vi.fn(() => '/home/.zimi-code/config.toml'),
  loadRuntimeConfigSafe: vi.fn(
    (): {
      config: { defaultModel?: string; telemetry?: boolean };
      fileError: Error | undefined;
    } => ({
      config: { defaultModel: 'kimi-k2', telemetry: true },
      fileError: undefined,
    }),
  ),
  getCachedAccessToken: vi.fn(async () => 'tok'),
}));

vi.mock('@zimi-ai/zimi-telemetry', () => ({
  initializeTelemetry: mocks.initializeTelemetry,
  setTelemetryContext: vi.fn(),
  track: vi.fn(),
  withTelemetryContext: vi.fn(),
}));

vi.mock('@zimi-ai/zimi-code-oauth', async (importOriginal) => {
  // Spread the real module: the SDK's v2 client pulls agent-core-v2 into the
  // import graph, which subclasses ZimiOAuthToolkit from this package.
  const actual = await importOriginal<typeof import('@zimi-ai/zimi-code-oauth')>();
  return {
    ...actual,
    createZimiDeviceId: mocks.createZimiDeviceId,
    ZIMI_CODE_PROVIDER_NAME: 'managed:zimi-code',
  };
});

vi.mock('@zimi-ai/zimi-code-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zimi-ai/zimi-code-sdk')>();
  return {
    ...actual,
    resolveZimiHome: mocks.resolveZimiHome,
    resolveConfigPath: mocks.resolveConfigPath,
    loadRuntimeConfigSafe: mocks.loadRuntimeConfigSafe,
    ZimiAuthFacade: vi.fn(function () {
      return { getCachedAccessToken: mocks.getCachedAccessToken };
    }),
  };
});

describe('initializeServerTelemetry', () => {
  beforeEach(() => {
    vi.stubEnv('ZIMI_CODE_OAUTH_HOST', 'https://auth.kimi.com');
    resetZimiRegionCache();
    mocks.initializeTelemetry.mockClear();
    mocks.loadRuntimeConfigSafe.mockClear();
    mocks.loadRuntimeConfigSafe.mockReturnValue({
      config: { defaultModel: 'kimi-k2', telemetry: true },
      fileError: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetZimiRegionCache();
  });

  it('configures the sink with ui_mode="web" and the CLI product identity', async () => {
    const { initializeServerTelemetry } = await import('#/cli/telemetry');
    const client = initializeServerTelemetry({ version: '1.2.3' });
    expect(mocks.initializeTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: 'zimi-code-cli',
        version: '1.2.3',
        uiMode: 'web',
        model: 'kimi-k2',
        enabled: true,
        deviceId: 'device-123',
        homeDir: '/home/.zimi-code',
      }),
    );
    // The returned client wraps the module functions so core + the host share
    // the same underlying client.
    expect(client).toEqual(
      expect.objectContaining({
        track: expect.any(Function),
        withContext: expect.any(Function),
        setContext: expect.any(Function),
      }),
    );
    // The first dynamic import pulls in the whole SDK/oauth chain (~3s idle,
    // more under full-suite transform contention) — give it headroom past the
    // 5s default timeout.
  }, 20000);

  it('disables telemetry when config.toml sets telemetry = false', async () => {
    mocks.loadRuntimeConfigSafe.mockReturnValue({
      config: { defaultModel: 'kimi-k2', telemetry: false },
      fileError: undefined,
    });
    const { initializeServerTelemetry } = await import('#/cli/telemetry');
    initializeServerTelemetry({ version: '1.2.3' });

    expect(mocks.initializeTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('degrades to enabled with no model when config is unreadable', async () => {
    mocks.loadRuntimeConfigSafe.mockReturnValue({
      config: {},
      fileError: new Error('bad toml'),
    });
    const { initializeServerTelemetry } = await import('#/cli/telemetry');
    initializeServerTelemetry({ version: '1.2.3' });

    expect(mocks.initializeTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, model: undefined }),
    );
  });
});
