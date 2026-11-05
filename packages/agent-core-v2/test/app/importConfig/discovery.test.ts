import { describe, expect, it, vi } from 'vitest';

import {
  DISCOVERY_DEFAULT_CONTEXT_SIZE,
  discoverProviderModels,
  parseModelEntries,
  type DiscoverableProvider,
} from '#/app/importConfig/discovery';

describe('parseModelEntries', () => {
  it('reads the OpenAI/Anthropic {data:[{id}]} shape', () => {
    expect(parseModelEntries({ data: [{ id: 'a' }, { id: 'b' }], object: 'list' })).toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
  });

  it('picks up context_length when the gateway reports it', () => {
    expect(parseModelEntries({ data: [{ id: 'a', context_length: 262144 }] })).toEqual([
      { id: 'a', contextWindow: 262144 },
    ]);
  });

  it('reads a bare array of objects', () => {
    expect(parseModelEntries([{ id: 'x' }, { name: 'ignored' }])).toEqual([{ id: 'x' }]);
  });

  it('reads a bare array of strings', () => {
    expect(parseModelEntries(['m1', '', 'm2'])).toEqual([{ id: 'm1' }, { id: 'm2' }]);
  });

  it('returns empty for unrecognized shapes instead of throwing', () => {
    expect(parseModelEntries(undefined)).toEqual([]);
    expect(parseModelEntries({ models: 'nope' })).toEqual([]);
    expect(parseModelEntries(42)).toEqual([]);
  });

  it('exposes a positive default context size for listings without limits', () => {
    expect(DISCOVERY_DEFAULT_CONTEXT_SIZE).toBeGreaterThan(0);
  });
});

describe('discoverProviderModels', () => {
  const provider: DiscoverableProvider = {
    id: 'gw',
    type: 'openai',
    baseUrl: 'https://gw.example/v1/',
    apiKey: 'sk-test',
  };

  it('probes {baseUrl}/models with a bearer token for openai providers', async () => {
    const fetchImpl = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://gw.example/v1/models');
      expect(request.headers.get('authorization')).toBe('Bearer sk-test');
      return new Response(JSON.stringify({ data: [{ id: 'gpt-x' }] }), { status: 200 });
    });

    const found = await discoverProviderModels([provider], { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(found).toEqual([{ providerId: 'gw', modelId: 'gpt-x' }]);
  });

  it('probes {baseUrl}/models with x-api-key for anthropic providers', async () => {
    const fetchImpl = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://gw.example/anthropic/models');
      expect(request.headers.get('x-api-key')).toBe('sk-test');
      expect(request.headers.get('anthropic-version')).toBe('2023-06-01');
      return new Response(JSON.stringify({ data: [{ id: 'claude-x' }] }), { status: 200 });
    });

    const found = await discoverProviderModels(
      [{ ...provider, type: 'anthropic', baseUrl: 'https://gw.example/anthropic' }],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(found).toEqual([{ providerId: 'gw', modelId: 'claude-x' }]);
  });

  it('falls back to {baseUrl}/v1/models when /models is not found', async () => {
    const fetchImpl = vi.fn(async (request: Request) => {
      if (request.url === 'https://gw.example/v1/models') {
        return new Response('not found', { status: 404 });
      }
      expect(request.url).toBe('https://gw.example/v1/v1/models');
      return new Response(JSON.stringify({ data: [{ id: 'late-model' }] }), { status: 200 });
    });

    const found = await discoverProviderModels([provider], { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(found).toEqual([{ providerId: 'gw', modelId: 'late-model' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('resolves apiKeyEnv indirection from the process environment', async () => {
    process.env['DISCOVERY_TEST_KEY'] = 'sk-env';
    const fetchImpl = vi.fn(async (request: Request) => {
      expect(request.headers.get('authorization')).toBe('Bearer sk-env');
      return new Response(JSON.stringify({ data: [{ id: 'm' }] }), { status: 200 });
    });

    const found = await discoverProviderModels(
      [{ id: 'gw', type: 'openai', baseUrl: 'https://gw.example/v1', apiKeyEnv: 'DISCOVERY_TEST_KEY' }],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(found).toHaveLength(1);
    delete process.env['DISCOVERY_TEST_KEY'];
  });

  it('yields nothing on HTTP errors, network failures, or missing credentials', async () => {
    const errorFetch = vi.fn(async () => new Response('nope', { status: 401 }));
    const throwingFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    expect(await discoverProviderModels([provider], { fetchImpl: errorFetch as unknown as typeof fetch })).toEqual([]);
    expect(await discoverProviderModels([provider], { fetchImpl: throwingFetch as unknown as typeof fetch })).toEqual([]);
    expect(
      await discoverProviderModels([{ id: 'nokey', type: 'openai', baseUrl: 'https://x/v1' }], {
        fetchImpl: errorFetch as unknown as typeof fetch,
      }),
    ).toEqual([]);
    // errorFetch: two candidate URLs (/models, /v1/models) in one probe round.
    expect(errorFetch).toHaveBeenCalledTimes(2);
    expect(throwingFetch).toHaveBeenCalledTimes(1); // network failure aborts the provider
  });

  it('skips providers without a baseUrl', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(
      await discoverProviderModels([{ id: 'bare', type: 'openai', apiKey: 'k' }], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
