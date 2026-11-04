import { describe, expect, it, vi } from 'vitest';

import {
  applyManagedApiKeyProviderModels,
  applyManagedZimiCodeLogoutConfig,
  applyManagedZimiCodeConfig,
  clearManagedZimiCodeConfig,
  fetchManagedZimiCodeModels,
  ZIMI_CODE_OAUTH_KEY,
  ZIMI_CODE_PROVIDER_NAME,
  ManagedZimiCodeModelsAuthError,
  provisionManagedZimiCodeConfig,
  resolveZimiCodeLoginAuth,
  resolveZimiCodeOAuthKey,
  resolveZimiCodeOAuthRef,
  resolveZimiCodeRuntimeAuth,
  type ManagedZimiCodeModelInfo,
  type ManagedZimiConfigShape,
} from '../src/managed-zimi-code';
import { OAuthUnauthorizedError } from '../src/errors';

function makeModelsResponse(): Response {
  return new Response(
    JSON.stringify({
      data: [
        {
          id: 'kimi-for-coding',
          limit: { context: 262144 },
          modalities: { input: ['text', 'image', 'video'], output: ['text'] },
          reasoning: { type: 'both' },
          display_name: 'Zimi for Coding',
        },
        {
          id: 'kimi-k2.5',
          limit: { context: 250000 },
          supports_tool_use: false,
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('provisionManagedZimiCodeConfig', () => {
  it('keeps the legacy credential key for the default production environment', () => {
    expect(
      resolveZimiCodeOAuthKey({
        oauthHost: 'https://auth.kimi.com/',
        baseUrl: 'https://api.kimi.com/coding/v1/',
      }),
    ).toBe(ZIMI_CODE_OAUTH_KEY);
  });

  it('scopes credential keys for non-default OAuth hosts and API base URLs', () => {
    const devKey = resolveZimiCodeOAuthKey({
      oauthHost: 'https://auth.dev.example.test',
      baseUrl: 'https://api.dev.example.test/coding/v1',
    });

    expect(devKey).not.toBe(ZIMI_CODE_OAUTH_KEY);
    expect(devKey).toMatch(/^oauth\/zimi-code-env-[a-f0-9]{16}$/);
    expect(
      resolveZimiCodeOAuthKey({
        oauthHost: 'https://auth.dev.example.test/',
        baseUrl: 'https://api.dev.example.test/coding/v1/',
      }),
    ).toBe(devKey);
  });

  it('derives a full OAuth ref whose key and persisted host stay in sync', () => {
    // Default environment collapses to the legacy ref (no persisted host), so
    // existing production credentials keep resolving to `zimi-code.json`.
    expect(
      resolveZimiCodeOAuthRef({
        oauthHost: 'https://auth.kimi.com/',
        baseUrl: 'https://api.kimi.com/coding/v1/',
      }),
    ).toEqual({ storage: 'file', key: ZIMI_CODE_OAUTH_KEY, oauthHost: undefined });

    const defaultAuthCustomApiRef = resolveZimiCodeOAuthRef({
      baseUrl: 'https://api.example.test/coding/v1',
    });
    expect(defaultAuthCustomApiRef).toEqual({
      storage: 'file',
      key: resolveZimiCodeOAuthKey({
        oauthHost: 'https://auth.kimi.com',
        baseUrl: 'https://api.example.test/coding/v1',
      }),
      oauthHost: 'https://auth.kimi.com',
    });

    // A non-default environment yields a scoped key AND the normalized host,
    // both derived from the same input — login and runtime cannot drift apart.
    const devRef = resolveZimiCodeOAuthRef({
      oauthHost: 'https://auth.dev.example.test/',
      baseUrl: 'https://api.dev.example.test/coding/v1',
    });
    expect(devRef).toEqual({
      storage: 'file',
      key: resolveZimiCodeOAuthKey({
        oauthHost: 'https://auth.dev.example.test',
        baseUrl: 'https://api.dev.example.test/coding/v1',
      }),
      oauthHost: 'https://auth.dev.example.test',
    });
  });

  it('resolves runtime auth from environment overrides over persisted config', () => {
    const configuredBaseUrl = 'https://api.configured.example.test/coding/v1';
    const envBaseUrl = 'https://api.env.example.test/coding/v1/';
    const envOauthHost = 'https://auth.env.example.test/';
    const configuredOAuthRef = resolveZimiCodeOAuthRef({
      baseUrl: configuredBaseUrl,
    });

    const auth = resolveZimiCodeRuntimeAuth({
      configuredBaseUrl,
      configuredOAuthRef,
      env: {
        ZIMI_CODE_BASE_URL: envBaseUrl,
        ZIMI_CODE_OAUTH_HOST: envOauthHost,
      },
    });

    expect(auth.baseUrl).toBe('https://api.env.example.test/coding/v1');
    expect(auth.oauthRef).toEqual({
      storage: 'file',
      key: resolveZimiCodeOAuthKey({
        oauthHost: 'https://auth.env.example.test',
        baseUrl: 'https://api.env.example.test/coding/v1',
      }),
      oauthHost: 'https://auth.env.example.test',
    });
  });

  it('preserves a matching configured runtime OAuth ref when env is not overridden', () => {
    const baseUrl = 'https://api.dev.example.test/coding/v1';
    const configuredOAuthRef = {
      storage: 'keyring' as const,
      key: resolveZimiCodeOAuthKey({
        oauthHost: 'https://auth.dev.example.test',
        baseUrl,
      }),
      oauthHost: 'https://auth.dev.example.test',
    };

    expect(
      resolveZimiCodeRuntimeAuth({
        configuredBaseUrl: baseUrl,
        configuredOAuthRef,
        env: {},
      }),
    ).toEqual({
      baseUrl,
      oauthRef: configuredOAuthRef,
    });
  });

  it('resolves login auth without reusing persisted refs under explicit or env overrides', () => {
    const configuredBaseUrl = 'https://api.configured.example.test/coding/v1';
    const configuredOAuthRef = resolveZimiCodeOAuthRef({ baseUrl: configuredBaseUrl });

    expect(
      resolveZimiCodeLoginAuth({
        configuredBaseUrl,
        configuredOAuthRef,
        requestedBaseUrl: 'https://api.requested.example.test/coding/v1/',
        env: {},
      }),
    ).toEqual({
      baseUrl: 'https://api.requested.example.test/coding/v1',
      oauthHost: undefined,
    });

    expect(
      resolveZimiCodeLoginAuth({
        configuredBaseUrl,
        configuredOAuthRef,
        env: {},
      }),
    ).toEqual({
      baseUrl: configuredBaseUrl,
      oauthHost: undefined,
      oauthRef: configuredOAuthRef,
    });
  });

  it('writes the managed provider, models, services, and default model through an adapter', async () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        custom: {
          type: 'zimi',
          apiKey: 'sk-existing',
          baseUrl: 'https://example.test/v1',
        },
      },
      models: {
        'zimi-code/stale': {
          provider: ZIMI_CODE_PROVIDER_NAME,
          model: 'stale',
        },
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
        },
      },
    };
    const write = vi.fn();
    const fetchMock = vi.fn(async () => makeModelsResponse());

    const result = await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
      adapter: {
        configPath: '/tmp/config.toml',
        read: () => config,
        write,
        apply: applyManagedZimiCodeConfig,
      },
    });

    expect(result).toMatchObject({
      providerName: ZIMI_CODE_PROVIDER_NAME,
      defaultModel: 'zimi-code/kimi-for-coding',
      defaultThinking: true,
      configPath: '/tmp/config.toml',
    });
    expect(result.models[0]?.supportsToolUse).toBe(true);
    expect(result.models[1]?.supportsToolUse).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.kimi.com/coding/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer oauth-access-token',
          Accept: 'application/json',
        }),
      }),
    );
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit?][];
    const init = calls[0]?.[1] ?? {};
    const headers = new Headers((init.headers ?? {}) as Record<string, string>);
    expect(headers.get('user-agent')).toBeNull();
    expect(headers.get('x-msh-platform')).toBeNull();
    expect(write).toHaveBeenCalledWith(config);

    expect(config.providers['custom']).toMatchObject({
      apiKey: 'sk-existing',
    });
    expect(config.models?.['custom-default']?.provider).toBe('custom');
    expect(config.models?.['zimi-code/stale']).toBeUndefined();
    expect(config.providers[ZIMI_CODE_PROVIDER_NAME]).toMatchObject({
      type: 'zimi',
      baseUrl: 'https://api.kimi.com/coding/v1',
      apiKey: '',
      oauth: { storage: 'file', key: 'oauth/zimi-code' },
    });
    expect(config.models?.['zimi-code/kimi-for-coding']).toMatchObject({
      provider: ZIMI_CODE_PROVIDER_NAME,
      model: 'kimi-for-coding',
      maxContextSize: 262144,
      capabilities: ['thinking', 'image_in', 'video_in', 'tool_use'],
      displayName: 'Zimi for Coding',
    });
    expect(config.models?.['zimi-code/kimi-k2.5']?.capabilities).toBeUndefined();
    expect(config.services?.zimiSearch).toMatchObject({
      baseUrl: 'https://api.kimi.com/coding/v1/search',
      apiKey: '',
      oauth: { storage: 'file', key: 'oauth/zimi-code' },
    });
    expect(Object.keys(config.services ?? {})).toEqual(['zimiSearch', 'zimiFetch']);
  });

  it('writes scoped OAuth refs when provisioning against a non-default environment', async () => {
    const config: ManagedZimiConfigShape = {
      providers: {},
    };
    const oauthKey = resolveZimiCodeOAuthKey({
      oauthHost: 'https://auth.dev.example.test',
      baseUrl: 'https://api.dev.example.test/coding/v1',
    });

    await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      baseUrl: 'https://api.dev.example.test/coding/v1',
      oauthKey,
      oauthHost: 'https://auth.dev.example.test',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    expect(config.providers[ZIMI_CODE_PROVIDER_NAME]).toMatchObject({
      baseUrl: 'https://api.dev.example.test/coding/v1',
      oauth: {
        storage: 'file',
        key: oauthKey,
        oauthHost: 'https://auth.dev.example.test',
      },
    });
    expect(config.services?.zimiSearch?.oauth).toEqual({
      storage: 'file',
      key: oauthKey,
      oauthHost: 'https://auth.dev.example.test',
    });
    expect(config.services?.zimiFetch?.oauth).toEqual({
      storage: 'file',
      key: oauthKey,
      oauthHost: 'https://auth.dev.example.test',
    });
  });

  it('persists the default OAuth host when only the API base URL is scoped', async () => {
    const config: ManagedZimiConfigShape = {
      providers: {},
    };
    const baseUrl = 'https://api.example.test/coding/v1';
    const oauthKey = resolveZimiCodeOAuthKey({ baseUrl });

    await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      baseUrl,
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    expect(config.providers[ZIMI_CODE_PROVIDER_NAME]).toMatchObject({
      baseUrl,
      oauth: {
        storage: 'file',
        key: oauthKey,
        oauthHost: 'https://auth.kimi.com',
      },
    });
  });

  it('preserves an existing valid default model during refresh', async () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        custom: {
          type: 'zimi',
          apiKey: 'sk-existing',
          baseUrl: 'https://example.test/v1',
        },
        [ZIMI_CODE_PROVIDER_NAME]: {
          type: 'zimi',
          apiKey: '',
        },
      },
      defaultModel: 'custom-default',
      thinking: { enabled: false },
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
        'zimi-code/stale': {
          provider: ZIMI_CODE_PROVIDER_NAME,
          model: 'stale',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.defaultModel).toBe('custom-default');
    expect(config.thinking?.enabled).toBe(false);
    expect(config.models?.['zimi-code/stale']).toBeUndefined();
    expect(config.models?.['zimi-code/kimi-for-coding']?.displayName).toBe('Zimi for Coding');
  });

  it('infers default_thinking from fresh managed model capabilities', async () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        [ZIMI_CODE_PROVIDER_NAME]: {
          type: 'zimi',
          apiKey: '',
        },
      },
      defaultModel: 'zimi-code/kimi-for-coding',
      models: {
        'zimi-code/kimi-for-coding': {
          provider: ZIMI_CODE_PROVIDER_NAME,
          model: 'kimi-for-coding',
          maxContextSize: 1000,
          capabilities: [],
        },
      },
    };

    const result = await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('zimi-code/kimi-for-coding');
    expect(result.defaultThinking).toBe(true);
    expect(config.thinking?.enabled).toBe(true);
  });

  it('preserves explicit default_thinking when preserving a custom default without capabilities', async () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        custom: {
          type: 'zimi',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      thinking: { enabled: true },
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(true);
    expect(config.thinking?.enabled).toBe(true);
  });

  it('defaults default_thinking to false when a preserved custom default has no signal', async () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        custom: {
          type: 'zimi',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.thinking?.enabled).toBe(false);
  });

  it('does not infer default_thinking from preserved custom default capabilities', async () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        custom: {
          type: 'zimi',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
          capabilities: [],
        },
      },
    };

    const result = await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.thinking?.enabled).toBe(false);
  });

  it('keeps default_thinking off even when preserved custom default has thinking capability', async () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        custom: {
          type: 'zimi',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
          capabilities: ['thinking'],
        },
      },
    };

    const result = await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.thinking?.enabled).toBe(false);
  });

  it('falls back to the first fetched model when the preserved default was removed', async () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        [ZIMI_CODE_PROVIDER_NAME]: {
          type: 'zimi',
          apiKey: '',
        },
      },
      defaultModel: 'zimi-code/stale',
      thinking: { enabled: false },
      models: {
        'zimi-code/stale': {
          provider: ZIMI_CODE_PROVIDER_NAME,
          model: 'stale',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('zimi-code/kimi-for-coding');
    expect(result.defaultThinking).toBe(false);
    expect(config.defaultModel).toBe('zimi-code/kimi-for-coding');
    expect(config.thinking?.enabled).toBe(false);
  });

  it('removes managed provider, models, services, and default model on logout', () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        [ZIMI_CODE_PROVIDER_NAME]: {
          type: 'zimi',
          apiKey: '',
        },
        custom: {
          type: 'zimi',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'zimi-code/kimi-for-coding',
      thinking: { enabled: true },
      models: {
        'zimi-code/kimi-for-coding': {
          provider: ZIMI_CODE_PROVIDER_NAME,
          model: 'kimi-for-coding',
          maxContextSize: 262144,
        },
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
      },
      services: {
        zimiSearch: { baseUrl: 'https://api.kimi.com/coding/v1/search' },
        zimiFetch: { baseUrl: 'https://api.kimi.com/coding/v1/fetch' },
        customService: { baseUrl: 'https://service.example.test' },
      },
      raw: {
        default_model: 'zimi-code/kimi-for-coding',
        providers: {
          [ZIMI_CODE_PROVIDER_NAME]: { type: 'zimi' },
          custom: { type: 'zimi' },
        },
        models: {
          'zimi-code/kimi-for-coding': {
            provider: ZIMI_CODE_PROVIDER_NAME,
            model: 'kimi-for-coding',
          },
          'custom-default': {
            provider: 'custom',
            model: 'custom-model',
          },
        },
        services: {
          zimi_search: { base_url: 'https://api.kimi.com/coding/v1/search' },
          zimi_fetch: { base_url: 'https://api.kimi.com/coding/v1/fetch' },
        },
      },
    };

    applyManagedZimiCodeLogoutConfig(config);

    expect(config.defaultModel).toBeUndefined();
    expect(config.providers[ZIMI_CODE_PROVIDER_NAME]).toBeUndefined();
    expect(config.providers['custom']).toBeDefined();
    expect(config.models?.['zimi-code/kimi-for-coding']).toBeUndefined();
    expect(config.models?.['custom-default']).toBeDefined();
    expect(config.services?.zimiSearch).toBeUndefined();
    expect(config.services?.zimiFetch).toBeUndefined();
    expect(config.services?.['customService']).toEqual({
      baseUrl: 'https://service.example.test',
    });
  });

  it('rejects managed models that do not include a positive limit.context', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 'kimi-for-coding', reasoning: { type: 'only' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;

    await expect(
      fetchManagedZimiCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toThrow(/positive limit\.context/);
  });

  it('surfaces API error messages from model listing failures', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    await expect(
      fetchManagedZimiCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toThrow('quota exceeded');
  });

  it('classifies model listing 401 responses as OAuth unauthorized', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: 'The API Key appears to be invalid or may have expired.' },
          }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    ) as unknown as typeof fetch;

    await expect(
      fetchManagedZimiCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(OAuthUnauthorizedError);
  });

  it('classifies membership-check 402 responses as OAuth unauthorized', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                "We're unable to verify your membership benefits at this time. Please ensure your membership is active.",
            },
          }),
          {
            status: 402,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    ) as unknown as typeof fetch;

    const promise = fetchManagedZimiCodeModels({
      accessToken: 'oauth-access-token',
      baseUrl: 'https://api.dev.example.test/coding/v1',
      fetchImpl,
    });

    await expect(promise).rejects.toThrow(
      "Zimi Code models endpoint https://api.dev.example.test/coding/v1 rejected OAuth credentials: We're unable to verify your membership benefits at this time. Please ensure your membership is active.",
    );
    await expect(
      fetchManagedZimiCodeModels({
        accessToken: 'oauth-access-token',
        baseUrl: 'https://api.dev.example.test/coding/v1',
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      status: 402,
      baseUrl: 'https://api.dev.example.test/coding/v1',
    });
    await expect(
      fetchManagedZimiCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(OAuthUnauthorizedError);
    await expect(
      fetchManagedZimiCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(ManagedZimiCodeModelsAuthError);
  });

  it('clears managed provider, models, default model, and services on logout', () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        [ZIMI_CODE_PROVIDER_NAME]: {
          type: 'zimi',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/zimi-code' },
        },
        custom: {
          type: 'zimi',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'zimi-code/kimi-for-coding',
      models: {
        'zimi-code/kimi-for-coding': {
          provider: ZIMI_CODE_PROVIDER_NAME,
          model: 'kimi-for-coding',
          maxContextSize: 262144,
        },
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 128000,
        },
      },
      services: {
        zimiSearch: {
          baseUrl: 'https://api.kimi.com/coding/v1/search',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/zimi-code' },
        },
        zimiFetch: {
          baseUrl: 'https://api.kimi.com/coding/v1/fetch',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/zimi-code' },
        },
        otherService: { baseUrl: 'https://service.example.test' },
      },
    };

    const result = clearManagedZimiCodeConfig(config);

    expect(result).toMatchObject({
      providerName: ZIMI_CODE_PROVIDER_NAME,
      removedProvider: true,
      removedModels: ['zimi-code/kimi-for-coding'],
      defaultModelCleared: true,
      removedServices: ['zimiSearch', 'zimiFetch'],
    });
    expect(config.providers[ZIMI_CODE_PROVIDER_NAME]).toBeUndefined();
    expect(config.providers['custom']).toMatchObject({ apiKey: 'sk-existing' });
    expect(config.defaultModel).toBeUndefined();
    expect(config.models?.['zimi-code/kimi-for-coding']).toBeUndefined();
    expect(config.models?.['custom-default']).toMatchObject({ provider: 'custom' });
    expect(config.services?.zimiSearch).toBeUndefined();
    expect(config.services?.zimiFetch).toBeUndefined();
    expect(config.services?.['otherService']).toMatchObject({
      baseUrl: 'https://service.example.test',
    });
  });
});

describe('reasoning', () => {
  function makeReasoningModelsResponse(): Response {
    return new Response(
      JSON.stringify({
        data: [
          {
            id: 'kimi-for-coding',
            limit: { context: 262144 },
            modalities: { input: ['text', 'image', 'video'], output: ['text'] },
            reasoning: { type: 'only' },
            tools: { dynamic_load: true },
            display_name: 'Zimi For Coding',
          },
          {
            id: 'zimi-plain',
            limit: { context: 128000 },
            reasoning: { type: 'none' },
          },
          {
            id: 'zimi-toggle',
            limit: { context: 128000 },
            reasoning: { type: 'both' },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('parses reasoning.type and tools.dynamic_load from the models endpoint', async () => {
    const models = await fetchManagedZimiCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeReasoningModelsResponse()) as unknown as typeof fetch,
    });

    expect(models[0]?.supportsThinkingType).toBe('only');
    expect(models[0]?.supportsReasoning).toBe(true);
    expect(models[1]?.supportsThinkingType).toBe('no');
    expect(models[1]?.supportsReasoning).toBe(false);
    expect(models[2]?.supportsThinkingType).toBe('both');
    expect(models[0]?.supportsDynamicTools).toBe(true);
    expect(models[1]?.supportsDynamicTools).toBe(false);
  });

  it('maps absent reasoning to no and leaves unknown reasoning types undefined', async () => {
    const absent = await fetchManagedZimiCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
    });
    expect(absent[1]?.supportsThinkingType).toBe('no');
    expect(absent[1]?.supportsReasoning).toBe(false);

    const invalid = await fetchManagedZimiCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 'kimi-for-coding',
                  limit: { context: 262144 },
                  reasoning: { type: 'maybe' },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ) as unknown as typeof fetch,
    });
    expect(invalid[0]?.supportsThinkingType).toBeUndefined();
  });

  it('maps the three states onto capabilities', async () => {
    const config: ManagedZimiConfigShape = { providers: {} };

    await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeReasoningModelsResponse()) as unknown as typeof fetch,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    // 'only' → thinking locked on; tools.dynamic_load adds dynamically_loaded_tools.
    expect(config.models?.['zimi-code/kimi-for-coding']?.capabilities).toEqual([
      'thinking',
      'always_thinking',
      'image_in',
      'video_in',
      'tool_use',
      'dynamically_loaded_tools',
    ]);
    // 'none' → no thinking capability.
    expect(config.models?.['zimi-code/zimi-plain']?.capabilities).toEqual(['tool_use']);
    // 'both' → plain toggleable thinking.
    expect(config.models?.['zimi-code/zimi-toggle']?.capabilities).toEqual([
      'thinking',
      'tool_use',
    ]);
  });

  it('forces default thinking on when the selected default model is thinking-only', async () => {
    const config: ManagedZimiConfigShape = { providers: {}, thinking: { enabled: false } };

    const result = await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeReasoningModelsResponse()) as unknown as typeof fetch,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('zimi-code/kimi-for-coding');
    expect(result.defaultThinking).toBe(true);
    expect(config.thinking?.enabled).toBe(true);
  });

  it('forces default thinking on when preserving a thinking-only managed default', async () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        [ZIMI_CODE_PROVIDER_NAME]: {
          type: 'zimi',
          apiKey: '',
        },
      },
      defaultModel: 'zimi-code/kimi-for-coding',
      thinking: { enabled: false },
      models: {
        'zimi-code/kimi-for-coding': {
          provider: ZIMI_CODE_PROVIDER_NAME,
          model: 'kimi-for-coding',
          maxContextSize: 262144,
          capabilities: ['thinking'],
        },
      },
    };

    const result = await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeReasoningModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('zimi-code/kimi-for-coding');
    expect(result.defaultThinking).toBe(true);
    expect(config.thinking?.enabled).toBe(true);
  });

  it('forces default thinking off when preserving a no-thinking managed default', async () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        [ZIMI_CODE_PROVIDER_NAME]: {
          type: 'zimi',
          apiKey: '',
        },
      },
      defaultModel: 'zimi-code/zimi-plain',
      thinking: { enabled: true },
      models: {
        'zimi-code/zimi-plain': {
          provider: ZIMI_CODE_PROVIDER_NAME,
          model: 'zimi-plain',
          maxContextSize: 128000,
          capabilities: ['thinking'],
        },
      },
    };

    const result = await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeReasoningModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('zimi-code/zimi-plain');
    expect(result.defaultThinking).toBe(false);
    expect(config.thinking?.enabled).toBe(false);
  });

  it('forces default thinking off when the preserved default omits reasoning', async () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        [ZIMI_CODE_PROVIDER_NAME]: {
          type: 'zimi',
          apiKey: '',
        },
      },
      defaultModel: 'zimi-code/kimi-k2.5',
      thinking: { enabled: true },
      models: {
        'zimi-code/kimi-k2.5': {
          provider: ZIMI_CODE_PROVIDER_NAME,
          model: 'kimi-k2.5',
          maxContextSize: 250000,
          capabilities: ['thinking'],
        },
      },
    };

    const result = await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    // kimi-k2.5 has no reasoning object in the response — the stale
    // thinking.enabled must not survive the refresh.
    expect(result.defaultModel).toBe('zimi-code/kimi-k2.5');
    expect(result.defaultThinking).toBe(false);
    expect(config.thinking?.enabled).toBe(false);
  });

  it('keeps a preserved non-managed default thinking selection untouched', async () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        custom: {
          type: 'zimi',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      thinking: { enabled: false },
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeReasoningModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.thinking?.enabled).toBe(false);
  });
});

describe('reasoning.effort', () => {
  function makeEffortModelsResponse(): Response {
    return new Response(
      JSON.stringify({
        data: [
          {
            id: 'kimi-for-coding',
            limit: { context: 262144 },
            reasoning: {
              type: 'both',
              effort: { valid: ['low', 'high', 'max'], default: 'high' },
            },
            display_name: 'Zimi For Coding',
          },
          {
            // Empty / non-string entries are filtered; absent fields stay undefined.
            id: 'zimi-plain',
            limit: { context: 128000 },
            reasoning: { type: 'only', effort: { valid: ['low', '', 42] } },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('parses reasoning.effort from the models endpoint', async () => {
    const models = await fetchManagedZimiCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeEffortModelsResponse()) as unknown as typeof fetch,
    });

    expect(models[0]?.supportEfforts).toEqual(['low', 'high', 'max']);
    expect(models[0]?.defaultEffort).toBe('high');
    // The empty string and number are filtered out of effort.valid.
    expect(models[1]?.supportEfforts).toEqual(['low']);
    expect(models[1]?.defaultEffort).toBeUndefined();
  });

  it('drops effort.default when it is not listed in effort.valid', async () => {
    const models = await fetchManagedZimiCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'zimi-bad-default',
                limit: { context: 128000 },
                reasoning: {
                  type: 'only',
                  effort: { valid: ['low', 'high'], default: 'max' },
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });

    expect(models[0]?.supportEfforts).toEqual(['low', 'high']);
    expect(models[0]?.defaultEffort).toBeUndefined();
  });

  it('ignores legacy effort fields even when reasoning.effort is absent', async () => {
    // The legacy think_efforts / support_efforts / default_effort fields are no
    // longer read; only the nested reasoning.effort object is honored.
    const models = await fetchManagedZimiCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'kimi-k2',
                limit: { context: 128000 },
                reasoning: { type: 'both' },
                think_efforts: {
                  support: true,
                  valid_efforts: ['low', 'high'],
                  default_effort: 'high',
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });

    expect(models[0]?.supportEfforts).toBeUndefined();
    expect(models[0]?.defaultEffort).toBeUndefined();
  });

  it('writes supportEfforts and defaultEffort onto the provisioned model entry', async () => {
    const config: ManagedZimiConfigShape = { providers: {} };

    await provisionManagedZimiCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeEffortModelsResponse()) as unknown as typeof fetch,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedZimiCodeConfig,
      },
    });

    const alias = config.models?.['zimi-code/kimi-for-coding'];
    expect(alias?.['supportEfforts']).toEqual(['low', 'high', 'max']);
    expect(alias?.['defaultEffort']).toBe('high');
  });
});

describe('selective merge', () => {
  const baseOptions = {
    baseUrl: 'https://api.example.test/coding/v1',
    oauthKey: 'test-key',
  };

  it('preserves non-managed user fields but drops stale managed fields', () => {
    const config: ManagedZimiConfigShape = {
      providers: {},
      models: {
        'zimi-code/kimi-k2': {
          provider: 'zimi-code',
          model: 'kimi-k2',
          maxContextSize: 262144,
          capabilities: ['thinking'],
          maxOutputSize: 4096,
          supportEfforts: ['low', 'high', 'max'],
        } as Record<string, unknown>,
      },
    };

    applyManagedZimiCodeConfig(config, {
      ...baseOptions,
      models: [
        {
          id: 'kimi-k2',
          contextLength: 262144,
          supportsReasoning: true,
          supportsImageIn: false,
          supportsVideoIn: false,
          supportsThinkingType: 'both',
        },
      ],
    });

    const alias = config.models?.['zimi-code/kimi-k2'];
    expect(alias?.['maxOutputSize']).toBe(4096);
    expect(alias?.['supportEfforts']).toBeUndefined();
    expect(alias?.['maxContextSize']).toBe(262144);
  });

  it('preserves overrides when upstream declares managed fields', () => {
    const config: ManagedZimiConfigShape = {
      providers: {},
      models: {
        'zimi-code/kimi-k2': {
          provider: 'zimi-code',
          model: 'kimi-k2',
          maxContextSize: 262144,
          overrides: { supportEfforts: ['low'] },
        } as Record<string, unknown>,
      },
    };

    applyManagedZimiCodeConfig(config, {
      ...baseOptions,
      models: [
        {
          id: 'kimi-k2',
          contextLength: 262144,
          supportsReasoning: true,
          supportsImageIn: false,
          supportsVideoIn: false,
          supportEfforts: ['low', 'high', 'max'],
          defaultEffort: 'high',
        },
      ],
    });

    const alias = config.models?.['zimi-code/kimi-k2'];
    expect(alias?.['supportEfforts']).toEqual(['low', 'high', 'max']);
    expect(alias?.['defaultEffort']).toBe('high');
    expect(alias?.['overrides']).toEqual({ supportEfforts: ['low'] });
  });

  it('removes managed models that upstream no longer lists', () => {
    const config: ManagedZimiConfigShape = {
      providers: {},
      models: {
        'zimi-code/kimi-k2': {
          provider: ZIMI_CODE_PROVIDER_NAME,
          model: 'kimi-k2',
          maxContextSize: 262144,
        },
        'zimi-code/removed': {
          provider: ZIMI_CODE_PROVIDER_NAME,
          model: 'removed',
          maxContextSize: 128000,
        },
      },
    };

    applyManagedZimiCodeConfig(config, {
      ...baseOptions,
      models: [
        {
          id: 'kimi-k2',
          contextLength: 262144,
          supportsReasoning: true,
          supportsImageIn: false,
          supportsVideoIn: false,
        },
      ],
    });

    expect(config.models?.['zimi-code/kimi-k2']).toBeDefined();
    expect(config.models?.['zimi-code/removed']).toBeUndefined();
  });
});

describe('applyManagedApiKeyProviderModels', () => {
  it('merges upstream models without touching provider, services, or defaults', () => {
    const config: ManagedZimiConfigShape = {
      providers: {
        'my-zimi': {
          type: 'zimi',
          baseUrl: 'https://api.example.test/coding/v1',
          apiKey: 'sk-distributed-key',
        },
      },
      models: {
        'my-zimi/kimi-k2': {
          provider: 'my-zimi',
          model: 'kimi-k2',
          maxContextSize: 262144,
          displayName: 'Old K2',
          maxOutputSize: 4096,
        } as Record<string, unknown>,
        'my-zimi/zimi-old': {
          provider: 'my-zimi',
          model: 'zimi-old',
          maxContextSize: 128000,
        },
        'other/m1': {
          provider: 'other',
          model: 'm1',
          maxContextSize: 128000,
        },
      },
      defaultModel: 'my-zimi/kimi-k2',
      thinking: { enabled: false },
    };

    applyManagedApiKeyProviderModels(
      config,
      'my-zimi',
      [makeModelInfo('kimi-k2', { displayName: 'Fresh K2' }), makeModelInfo('kimi-k2.5')],
      'my-zimi/',
    );

    // The provider record is user-owned: no rewrite, no oauth, no apiKey reset.
    expect(config.providers['my-zimi']).toEqual({
      type: 'zimi',
      baseUrl: 'https://api.example.test/coding/v1',
      apiKey: 'sk-distributed-key',
    });
    // Defaults and services are the orchestrator's / OAuth branch's business.
    expect(config.defaultModel).toBe('my-zimi/kimi-k2');
    expect(config.thinking).toEqual({ enabled: false });
    expect(config.services).toBeUndefined();
    // Upstream-owned fields merge; hand-written extras survive.
    const alias = config.models?.['my-zimi/kimi-k2'];
    expect(alias?.['displayName']).toBe('Fresh K2');
    expect(alias?.['maxOutputSize']).toBe(4096);
    // New upstream model added; dropped one removed; other providers untouched.
    expect(config.models?.['my-zimi/kimi-k2.5']).toBeDefined();
    expect(config.models?.['my-zimi/zimi-old']).toBeUndefined();
    expect(config.models?.['other/m1']).toBeDefined();
  });

  it('writes protocol routing fields for anthropic-protocol models', () => {
    const config: ManagedZimiConfigShape = { providers: {}, models: {} };

    applyManagedApiKeyProviderModels(
      config,
      'my-zimi',
      [makeModelInfo('kimi-for-coding', { protocol: 'anthropic', supportsReasoning: true })],
      'my-zimi/',
    );

    const alias = config.models?.['my-zimi/kimi-for-coding'];
    expect(alias?.['provider']).toBe('my-zimi');
    expect(alias?.['protocol']).toBe('anthropic');
    expect(alias?.['betaApi']).toBe(true);
    expect(alias?.['adaptiveThinking']).toBe(true);
    expect(alias?.['capabilities']).toEqual(['thinking', 'tool_use']);
  });

  it('rejects models without a positive context length', () => {
    const config: ManagedZimiConfigShape = { providers: {}, models: {} };

    expect(() => {
      applyManagedApiKeyProviderModels(
        config,
        'my-zimi',
        [makeModelInfo('bad', { contextLength: 0 })],
        'my-zimi/',
      );
    }).toThrow('limit.context');
  });
});

function makeModelInfo(
  id: string,
  overrides: Partial<ManagedZimiCodeModelInfo> = {},
): ManagedZimiCodeModelInfo {
  return {
    id,
    contextLength: 200000,
    supportsReasoning: false,
    supportsImageIn: false,
    supportsVideoIn: false,
    ...overrides,
  };
}

const ZIMI_BASE_URL = 'https://api.kimi.com/coding/v1';

describe('managed protocol routing', () => {
  it('reads protocol from the /models response', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 'kimi-for-coding', limit: { context: 262144 }, protocol: 'anthropic' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;

    const models = await fetchManagedZimiCodeModels({ accessToken: 't', fetchImpl });
    expect(models).toHaveLength(1);
    expect(models[0]?.protocol).toBe('anthropic');
  });

  it('maps the server "response" protocol value to openai_responses', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 'k3', limit: { context: 1048576 }, protocol: 'response' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;

    const models = await fetchManagedZimiCodeModels({ accessToken: 't', fetchImpl });
    expect(models).toHaveLength(1);
    expect(models[0]?.protocol).toBe('openai_responses');
  });

  it('records openai_responses protocol without anthropic routing fields', () => {
    const config: ManagedZimiConfigShape = { providers: {} };
    applyManagedZimiCodeConfig(config, {
      baseUrl: ZIMI_BASE_URL,
      models: [makeModelInfo('k3', { protocol: 'openai_responses', supportsReasoning: true })],
    });

    expect(config.providers[ZIMI_CODE_PROVIDER_NAME]).toMatchObject({
      type: 'zimi',
      baseUrl: ZIMI_BASE_URL,
      apiKey: '',
    });
    const alias = config.models?.['zimi-code/k3'];
    expect(alias?.protocol).toBe('openai_responses');
    expect(alias?.betaApi).toBeUndefined();
    expect(alias?.adaptiveThinking).toBeUndefined();
  });

  it('keeps the provider on the zimi REST base and records the model protocol when anthropic', () => {
    const config: ManagedZimiConfigShape = { providers: {} };
    applyManagedZimiCodeConfig(config, {
      baseUrl: ZIMI_BASE_URL,
      models: [makeModelInfo('kimi-for-coding', { protocol: 'anthropic' })],
    });

    // The provider stays on the zimi wire + REST base; the anthropic transport
    // is resolved per-model at runtime, not baked into the provider config, so
    // the REST base keeps flowing to OAuth key derivation and plugin env.
    expect(config.providers[ZIMI_CODE_PROVIDER_NAME]).toMatchObject({
      type: 'zimi',
      baseUrl: ZIMI_BASE_URL,
      apiKey: '',
    });
    expect(config.models?.['zimi-code/kimi-for-coding']).toMatchObject({
      provider: ZIMI_CODE_PROVIDER_NAME,
      protocol: 'anthropic',
      betaApi: true,
    });
  });

  it('keeps the zimi protocol and baseUrl when the model has no anthropic protocol', () => {
    const config: ManagedZimiConfigShape = { providers: {} };
    applyManagedZimiCodeConfig(config, {
      baseUrl: ZIMI_BASE_URL,
      models: [makeModelInfo('kimi-for-coding')],
    });

    expect(config.providers[ZIMI_CODE_PROVIDER_NAME]).toMatchObject({
      type: 'zimi',
      baseUrl: ZIMI_BASE_URL,
      apiKey: '',
    });
    expect(config.models?.['zimi-code/kimi-for-coding']?.provider).toBe(ZIMI_CODE_PROVIDER_NAME);
    expect(config.models?.['zimi-code/kimi-for-coding']?.protocol).toBeUndefined();
  });

  it('drops the model protocol on refresh when the server stops declaring anthropic', () => {
    const config: ManagedZimiConfigShape = { providers: {} };
    applyManagedZimiCodeConfig(config, {
      baseUrl: ZIMI_BASE_URL,
      models: [makeModelInfo('kimi-for-coding', { protocol: 'anthropic' })],
    });
    expect(config.models?.['zimi-code/kimi-for-coding']?.protocol).toBe('anthropic');

    applyManagedZimiCodeConfig(config, {
      baseUrl: ZIMI_BASE_URL,
      models: [makeModelInfo('kimi-for-coding')],
    });
    // The provider never leaves the zimi wire / REST base across refreshes —
    // only the per-model protocol annotation changes.
    expect(config.providers[ZIMI_CODE_PROVIDER_NAME]).toMatchObject({
      type: 'zimi',
      baseUrl: ZIMI_BASE_URL,
    });
    expect(config.models?.['zimi-code/kimi-for-coding']?.protocol).toBeUndefined();
  });
});
