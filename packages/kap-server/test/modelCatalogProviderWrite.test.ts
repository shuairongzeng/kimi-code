import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer, type Server } from 'node:http';

import { IConfigService } from '@zimi-ai/agent-core-v2';
import {
  resetModelsDevUpstreamForTest,
  setModelsDevUpstreamForTest,
} from '@zimi-ai/agent-core-v2/app/kosongConfig/modelsDevUpstream';
import { parse as parseToml } from 'smol-toml';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type RunningServer, startServer } from '../src/start';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';
import { authHeaders } from './helpers/auth';

interface Envelope<T> {
  code: number;
  msg: string;
  data: T;
  request_id: string;
  details?: Array<{ path: string; message: string }>;
}

const DEFAULTED_TOML = [
  'default_provider = "openai"',
  'default_model = "gpt4o"',
  '',
  '[providers.zimi]',
  'type = "zimi"',
  'api_key = "sk-test"',
  '',
  '[providers.openai]',
  'type = "openai"',
  'api_key = "sk-openai"',
  '',
  '[models.k2]',
  'provider = "zimi"',
  'model = "kimi-k2"',
  'max_context_size = 131072',
  '',
  '[models.gpt4o]',
  'provider = "openai"',
  'model = "gpt-4o"',
  'max_context_size = 128000',
  '',
].join('\n');

const KEEP_DEFAULT_TOML = DEFAULTED_TOML.replace('default_provider = "openai"\n', '').replace(
  'default_model = "gpt4o"',
  'default_model = "k2"',
);

const DANGLING_DEFAULT_TOML = [
  'default_model = "gone"',
  '',
  '[providers.zimi]',
  'type = "zimi"',
  'api_key = "sk-test"',
  '',
].join('\n');

const POOL_TOML = [
  DEFAULTED_TOML,
  '[secondary_model]',
  'default_model = "k2"',
  '',
  '[secondary_model.models]',
  'k2 = "fast"',
  'gpt4o = "smart"',
  '',
].join('\n');

const POOL_DANGLING_DEFAULT_TOML = POOL_TOML.replace('default_model = "k2"', 'default_model = "gpt4o"');

const MANAGED_TOML = [
  '[providers."managed:zimi-code"]',
  'type = "zimi"',
  'api_key = ""',
  'base_url = "https://api.example.test/v1"',
  'oauth = { storage = "file", key = "oauth/zimi-code" }',
  '',
  '[models."managed:zimi-code/kimi-k2"]',
  'provider = "managed:zimi-code"',
  'model = "kimi-k2"',
  'max_context_size = 131072',
  '',
].join('\n');

const CREATE_BODY = {
  id: 'my-openai',
  type: 'openai',
  api_key: 'sk-test-openai',
  base_url: 'https://api.openai.example/v1',
  default_model: 'gpt-4.1',
  models: [
    {
      model: 'gpt-4.1',
      max_context_size: 1047576,
      display_name: 'GPT-4.1',
      capabilities: ['vision'],
      max_output_size: 32768,
    },
    { model: 'gpt-4o-mini', max_context_size: 128000 },
  ],
} as const;

const REPLACE_BODY = {
  type: 'openai',
  base_url: 'https://api.openai.example/v1',
  default_model: 'gpt-4.1',
  models: [
    { model: 'gpt-4.1', max_context_size: 1047576, display_name: 'GPT-4.1' },
    { model: 'gpt-4o-mini', max_context_size: 128000 },
  ],
} as const;

const DISCOVER_CATALOG = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    api: 'https://api.openai.com/v1',
    npm: '@ai-sdk/openai',
    models: {
      'gpt-x': {
        id: 'gpt-x',
        limit: { context: 96000 },
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        reasoning_options: [{ type: 'effort', values: ['low', 'high', 'none'] }],
      },
    },
  },
} as const;

type ProbeMode = 'list' | 'empty' | 'unauthorized';

async function startProbeServer(mode: ProbeMode): Promise<string> {
  const handler = createServer((req, res) => {
    if (mode === 'unauthorized' || (req.url !== '/v1/models' && req.url !== '/models')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (mode === 'empty') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [] }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: [
          { id: 'gpt-x', object: 'model', context_length: 128_000 },
          { id: 'gpt-y', object: 'model' },
        ],
      }),
    );
  });
  const listening = new Promise<void>((resolve) => {
    handler.listen(0, '127.0.0.1', () => resolve());
  });
  await listening;
  probeServers.push(handler);
  const address = handler.address();
  if (typeof address !== 'object' || address === null || !('port' in address)) {
    throw new Error('probe server did not expose a port');
  }
  return `http://127.0.0.1:${address.port}`;
}

const probeServers: Server[] = [];

function installDiscoverCatalog(): void {
  setModelsDevUpstreamForTest({
    fetchImpl: (async () =>
      new Response(JSON.stringify(DISCOVER_CATALOG), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  });
}

describe('server-v2 /api/v1 provider write endpoints', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let base: string;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'zimi-server-v2-provider-write-'));
    process.env['ZIMI_CODE_MODEL_CATALOG_REFRESH_ON_START'] = '0';
    process.env['ZIMI_CODE_MODEL_CATALOG_REFRESH_INTERVAL_MS'] = '0';
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    resetModelsDevUpstreamForTest();
    for (const probe of probeServers.splice(0)) {
      const closed = new Promise<void>((resolve) => {
        probe.close(() => resolve());
      });
      await closed;
    }
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
    delete process.env['ZIMI_CODE_MODEL_CATALOG_REFRESH_ON_START'];
    delete process.env['ZIMI_CODE_MODEL_CATALOG_REFRESH_INTERVAL_MS'];
  });

  async function boot(toml?: string): Promise<void> {
    await writeFile(join(home as string, 'config.toml'), toml ?? '', 'utf-8');
    await (server as RunningServer).core.accessor.get(IConfigService).reload();
  }

  async function getJson<T>(path: string): Promise<{ status: number; body: Envelope<T> }> {
    const res = await fetch(`${base}${path}`, {
      headers: authHeaders(server as RunningServer),
    } as never);
    return { status: res.status, body: (await res.json()) as Envelope<T> };
  }

  async function postJson<T>(
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Envelope<T> }> {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: authHeaders(
        server as RunningServer,
        body === undefined ? {} : { 'content-type': 'application/json' },
      ),
      body: body === undefined ? undefined : JSON.stringify(body),
    } as never);
    return { status: res.status, body: (await res.json()) as Envelope<T> };
  }

  async function putJson<T>(
    path: string,
    body: unknown,
  ): Promise<{ status: number; body: Envelope<T> }> {
    const res = await fetch(`${base}${path}`, {
      method: 'PUT',
      headers: authHeaders(server as RunningServer, { 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    } as never);
    return { status: res.status, body: (await res.json()) as Envelope<T> };
  }

  async function deleteJson<T>(
    path: string,
  ): Promise<{ status: number; text: string; body: Envelope<T> | undefined }> {
    const res = await fetch(`${base}${path}`, {
      method: 'DELETE',
      headers: authHeaders(server as RunningServer),
    } as never);
    const text = await res.text();
    return {
      status: res.status,
      text,
      body: text.length === 0 ? undefined : (JSON.parse(text) as Envelope<T>),
    };
  }

  async function readConfigToml(): Promise<Record<string, unknown>> {
    const text = await readFile(join(home as string, 'config.toml'), 'utf-8');
    return parseToml(text) as Record<string, unknown>;
  }

  it('creates a provider with model aliases and persists them to config.toml', async () => {
    await boot();
    const { status, body } = await postJson<unknown>('/api/v1/providers', CREATE_BODY);
    expect(status).toBe(201);
    expect(body.code).toBe(0);
    expect(body.data).toEqual({
      id: 'my-openai',
      type: 'openai',
      base_url: 'https://api.openai.example/v1',
      default_model: 'my-openai/gpt-4.1',
      has_api_key: true,
      status: 'connected',
      models: ['my-openai/gpt-4.1', 'my-openai/gpt-4o-mini'],
    });

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      'my-openai': {
        type: 'openai',
        api_key: 'sk-test-openai',
        base_url: 'https://api.openai.example/v1',
        default_model: 'my-openai/gpt-4.1',
      },
    });
    expect(onDisk['models']).toEqual({
      'my-openai/gpt-4.1': {
        provider: 'my-openai',
        model: 'gpt-4.1',
        max_context_size: 1047576,
        display_name: 'GPT-4.1',
        capabilities: ['vision'],
        max_output_size: 32768,
      },
      'my-openai/gpt-4o-mini': {
        provider: 'my-openai',
        model: 'gpt-4o-mini',
        max_context_size: 128000,
      },
    });

    const providers = await getJson<{ items: unknown[] }>('/api/v1/providers');
    expect(providers.body.data.items).toEqual([body.data]);

    const models = await getJson<{ items: unknown[] }>('/api/v1/models');
    expect(models.body.data.items).toEqual([
      {
        provider: 'my-openai',
        model: 'my-openai/gpt-4.1',
        display_name: 'GPT-4.1',
        max_context_size: 1047576,
        capabilities: ['vision'],
      },
      {
        provider: 'my-openai',
        model: 'my-openai/gpt-4o-mini',
        display_name: 'gpt-4o-mini',
        max_context_size: 128000,
      },
    ]);
  });

  it('creates a credential-less provider (env-resolved types may omit api_key)', async () => {
    await boot();
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'vertex',
      type: 'vertexai',
      models: [{ model: 'gemini-2.5-pro', max_context_size: 1048576 }],
    });
    expect(status).toBe(201);
    expect(body.code).toBe(0);
    expect(body.data).toEqual({
      id: 'vertex',
      type: 'vertexai',
      default_model: 'vertex/gemini-2.5-pro',
      has_api_key: false,
      status: 'unconfigured',
      models: ['vertex/gemini-2.5-pro'],
    });
  });

  it('seeds the global default_model on a fresh setup (the provider default wins)', async () => {
    await boot();
    const { status } = await postJson<unknown>('/api/v1/providers', CREATE_BODY);
    expect(status).toBe(201);

    const onDisk = await readConfigToml();
    expect(onDisk['default_model']).toBe('my-openai/gpt-4.1');

    const config = await getJson<{ default_model: string | null }>('/api/v1/config');
    expect(config.body.data.default_model).toBe('my-openai/gpt-4.1');
    const auth = await getJson<{ models_ready: boolean }>('/api/v1/auth');
    expect(auth.body.data).toMatchObject({ models_ready: true });
  });

  it('seeds the first model when the create body names no provider default', async () => {
    await boot();
    const { status } = await postJson<unknown>('/api/v1/providers', {
      id: 'my-openai',
      type: 'openai',
      api_key: 'sk-test-openai',
      models: [
        { model: 'gpt-4o-mini', max_context_size: 128000 },
        { model: 'gpt-4.1', max_context_size: 1047576 },
      ],
    });
    expect(status).toBe(201);

    const onDisk = await readConfigToml();
    expect(onDisk['default_model']).toBe('my-openai/gpt-4o-mini');
  });

  it('keeps an existing global default_model on create', async () => {
    await boot(DEFAULTED_TOML);
    const { status } = await postJson<unknown>('/api/v1/providers', CREATE_BODY);
    expect(status).toBe(201);

    const onDisk = await readConfigToml();
    expect(onDisk['default_model']).toBe('gpt4o');
  });

  it('leaves even a dangling default_model untouched on create', async () => {
    await boot(DANGLING_DEFAULT_TOML);
    const { status } = await postJson<unknown>('/api/v1/providers', CREATE_BODY);
    expect(status).toBe(201);

    const onDisk = await readConfigToml();
    expect(onDisk['default_model']).toBe('gone');
  });

  it('rejects a duplicate provider id with 40921', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { body } = await postJson<unknown>('/api/v1/providers', {
      ...CREATE_BODY,
      id: 'openai',
    });
    expect(body.code).toBe(40921);
    expect(body.data).toBeNull();

    const providers = await getJson<{ items: Array<{ id: string }> }>('/api/v1/providers');
    expect(providers.body.data.items.map((p) => p.id)).toEqual(['zimi', 'openai']);
  });

  it('accepts a Unicode provider id (Chinese + space)', async () => {
    await boot();
    const { status, body } = await postJson<{ id: string }>('/api/v1/providers', {
      ...CREATE_BODY,
      id: '测试 Zimi',
    });
    expect(status).toBe(201);
    expect(body.code).toBe(0);
    expect(body.data.id).toBe('测试 Zimi');

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toMatchObject({ '测试 Zimi': { type: 'openai' } });
    expect(onDisk['models']).toMatchObject({
      '测试 Zimi/gpt-4.1': { provider: '测试 Zimi', model: 'gpt-4.1' },
    });
  });

  it('creates models with support_efforts and adaptive_thinking', async () => {
    await boot();
    const { status } = await postJson<unknown>('/api/v1/providers', {
      ...CREATE_BODY,
      models: [
        {
          model: 'gpt-4.1',
          max_context_size: 1047576,
          support_efforts: ['low', 'max'],
          adaptive_thinking: true,
          protocol: 'openai_responses',
        },
      ],
    });
    expect(status).toBe(201);

    const onDisk = await readConfigToml();
    expect(onDisk['models']).toMatchObject({
      'my-openai/gpt-4.1': {
        support_efforts: ['low', 'max'],
        adaptive_thinking: true,
        protocol: 'openai_responses',
      },
    });
  });

  it('rejects invalid create bodies with 40001', async () => {
    await boot();
    const cases: Array<{ name: string; body: unknown; path?: string }> = [
      {
        name: 'id with illegal characters',
        body: { ...CREATE_BODY, id: 'bad!id' },
        path: 'id',
      },
      { name: 'unknown wire type', body: { ...CREATE_BODY, type: 'custom' }, path: 'type' },
      { name: 'empty models list', body: { ...CREATE_BODY, models: [] }, path: 'models' },
      {
        name: 'default_model outside the models list',
        body: { ...CREATE_BODY, default_model: 'gpt-5' },
        path: 'default_model',
      },
    ];
    for (const { name, body, path } of cases) {
      const { body: envelope } = await postJson('/api/v1/providers', body);
      expect(envelope.code, name).toBe(40001);
      expect(envelope.data, name).toBeNull();
      if (path !== undefined) {
        expect(
          envelope.details?.some((detail) => detail.path === path),
          name,
        ).toBe(true);
      }
    }
  });

  it('deletes a provider and its model aliases, keeping unrelated defaults', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { status, text } = await deleteJson<unknown>('/api/v1/providers/openai');
    expect(status).toBe(204);
    expect(text).toBe('');

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({ zimi: { type: 'zimi', api_key: 'sk-test' } });
    expect(onDisk['models']).toEqual({
      k2: { provider: 'zimi', model: 'kimi-k2', max_context_size: 131072 },
    });
    expect(onDisk['default_model']).toBe('k2');

    const providers = await getJson<{ items: Array<{ id: string }> }>('/api/v1/providers');
    expect(providers.body.data.items.map((p) => p.id)).toEqual(['zimi']);
    const models = await getJson<{ items: Array<{ model: string }> }>('/api/v1/models');
    expect(models.body.data.items.map((m) => m.model)).toEqual(['k2']);
  });

  it('never touches default_provider/default_model when deleting their owner (204, pointers dangling)', async () => {
    await boot(DEFAULTED_TOML);
    const { status, text } = await deleteJson<unknown>('/api/v1/providers/openai');
    expect(status).toBe(204);
    expect(text).toBe('');

    const onDisk = await readConfigToml();
    expect(onDisk['default_provider']).toBe('openai');
    expect(onDisk['default_model']).toBe('gpt4o');
    expect(onDisk['providers']).toEqual({ zimi: { type: 'zimi', api_key: 'sk-test' } });
    expect(onDisk['models']).toEqual({
      k2: { provider: 'zimi', model: 'kimi-k2', max_context_size: 131072 },
    });
  });

  it('leaves the secondary_model pool untouched when a provider is deleted', async () => {
    await boot(POOL_TOML);
    const { status } = await deleteJson<unknown>('/api/v1/providers/openai');
    expect(status).toBe(204);

    const onDisk = await readConfigToml();
    expect(onDisk['secondary_model']).toEqual({
      default_model: 'k2',
      models: { k2: 'fast', gpt4o: 'smart' },
    });
  });

  it('keeps the secondary_model section even when its default dangles after deletion', async () => {
    await boot(POOL_DANGLING_DEFAULT_TOML);
    const { status } = await deleteJson<unknown>('/api/v1/providers/openai');
    expect(status).toBe(204);

    const onDisk = await readConfigToml();
    expect(onDisk['secondary_model']).toEqual({
      default_model: 'gpt4o',
      models: { k2: 'fast', gpt4o: 'smart' },
    });
  });

  it('round-trips a created provider: delete removes every trace from config.toml', async () => {
    await boot();
    const created = await postJson<unknown>('/api/v1/providers', CREATE_BODY);
    expect(created.status).toBe(201);

    const { status } = await deleteJson<unknown>('/api/v1/providers/my-openai');
    expect(status).toBe(204);

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toBeUndefined();
    expect(onDisk['models']).toBeUndefined();
    expect(onDisk['default_model']).toBe('my-openai/gpt-4.1');

    const providers = await getJson<{ items: unknown[] }>('/api/v1/providers');
    expect(providers.body.data.items).toEqual([]);
  });

  it('rejects deleting an OAuth-managed provider with 40003', async () => {
    await boot(MANAGED_TOML);
    const { body } = await deleteJson<unknown>('/api/v1/providers/managed%3Azimi-code');
    expect(body?.code).toBe(40003);
    expect(body?.msg).toContain('/oauth/logout');

    const providers = await getJson<{ items: Array<{ id: string }> }>('/api/v1/providers');
    expect(providers.body.data.items.map((p) => p.id)).toEqual(['managed:zimi-code']);
  });

  it('maps an unknown provider id to 40412 on delete', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { body } = await deleteJson<unknown>('/api/v1/providers/missing');
    expect(body?.code).toBe(40412);
  });

  it('replaces a provider, keeping the stored api_key and rebuilding its aliases', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { status, body } = await putJson<{
      provider: Record<string, unknown>;
    }>('/api/v1/providers/openai', {
      ...REPLACE_BODY,
      models: [
        { ...REPLACE_BODY.models[0], protocol: 'openai' },
        REPLACE_BODY.models[1],
      ],
    });
    expect(status).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data.provider).toEqual({
      id: 'openai',
      type: 'openai',
      base_url: 'https://api.openai.example/v1',
      default_model: 'openai/gpt-4.1',
      has_api_key: true,
      status: 'connected',
      models: ['openai/gpt-4.1', 'openai/gpt-4o-mini'],
    });

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      zimi: { type: 'zimi', api_key: 'sk-test' },
      openai: {
        type: 'openai',
        api_key: 'sk-openai',
        base_url: 'https://api.openai.example/v1',
        default_model: 'openai/gpt-4.1',
      },
    });
    expect(onDisk['models']).toEqual({
      k2: { provider: 'zimi', model: 'kimi-k2', max_context_size: 131072 },
      'openai/gpt-4.1': {
        provider: 'openai',
        model: 'gpt-4.1',
        max_context_size: 1047576,
        display_name: 'GPT-4.1',
        protocol: 'openai',
      },
      'openai/gpt-4o-mini': {
        provider: 'openai',
        model: 'gpt-4o-mini',
        max_context_size: 128000,
      },
    });
    expect(onDisk['default_model']).toBe('k2');

    const models = await getJson<{ items: Array<{ model: string }> }>('/api/v1/models');
    expect(models.body.data.items.map((m) => m.model)).toEqual([
      'k2',
      'openai/gpt-4.1',
      'openai/gpt-4o-mini',
    ]);
  });

  it('sets a new api_key when a non-empty one is sent', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { status, body } = await putJson<{ provider: { has_api_key: boolean } }>(
      '/api/v1/providers/openai',
      { ...REPLACE_BODY, api_key: 'sk-new-openai' },
    );
    expect(status).toBe(200);
    expect(body.data.provider.has_api_key).toBe(true);

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      zimi: { type: 'zimi', api_key: 'sk-test' },
      openai: {
        type: 'openai',
        api_key: 'sk-new-openai',
        base_url: 'https://api.openai.example/v1',
        default_model: 'openai/gpt-4.1',
      },
    });
  });

  it('clears the stored api_key when an empty string is sent', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { status, body } = await putJson<{
      provider: { has_api_key: boolean; status: string };
    }>('/api/v1/providers/openai', { ...REPLACE_BODY, api_key: '' });
    expect(status).toBe(200);
    expect(body.data.provider.has_api_key).toBe(false);
    expect(body.data.provider.status).toBe('unconfigured');

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      zimi: { type: 'zimi', api_key: 'sk-test' },
      openai: {
        type: 'openai',
        base_url: 'https://api.openai.example/v1',
        default_model: 'openai/gpt-4.1',
      },
    });
  });

  it('sets api_key_env and drops the inline key when only api_key_env is sent', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { status, body } = await putJson<{ provider: { has_api_key: boolean } }>(
      '/api/v1/providers/openai',
      { ...REPLACE_BODY, api_key_env: 'ZIMI_TEST_REPLACE_ROUTE_KEY' },
    );
    expect(status).toBe(200);

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      zimi: { type: 'zimi', api_key: 'sk-test' },
      openai: {
        type: 'openai',
        api_key_env: 'ZIMI_TEST_REPLACE_ROUTE_KEY',
        base_url: 'https://api.openai.example/v1',
        default_model: 'openai/gpt-4.1',
      },
    });
    expect(body.data.provider.has_api_key).toBe(false);
  });

  it('rejects a replace that submits api_key and api_key_env together', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { body } = await putJson<unknown>('/api/v1/providers/openai', {
      ...REPLACE_BODY,
      api_key: 'sk-inline',
      api_key_env: 'ZIMI_TEST_REPLACE_ROUTE_KEY',
    });
    expect(body.code).toBe(40001);
    expect(body.msg).toContain('mutually exclusive');

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toMatchObject({ openai: { api_key: 'sk-openai' } });
  });

  it('creates a provider with api_key_env', async () => {
    await boot('');
    const created = await postJson<unknown>('/api/v1/providers', {
      ...CREATE_BODY,
      id: 'env-openai',
      api_key: undefined,
      api_key_env: 'ZIMI_TEST_REPLACE_ROUTE_KEY',
    });
    expect(created.status).toBe(201);

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toMatchObject({
      'env-openai': { api_key_env: 'ZIMI_TEST_REPLACE_ROUTE_KEY' },
    });
  });

  it('merges onto existing model records: unknown fields preserved, form fields authoritative', async () => {
    const RICH_TOML = [
      '[providers.openai]',
      'type = "openai"',
      'api_key = "sk-openai"',
      '',
      '[models."openai/gpt-4o"]',
      'provider = "openai"',
      'model = "gpt-4o"',
      'max_context_size = 128000',
      'beta_api = true',
      'default_effort = "high"',
      '',
    ].join('\n');
    await boot(RICH_TOML);
    const { status, body } = await putJson<unknown>('/api/v1/providers/openai', {
      type: 'openai',
      models: [
        {
          model: 'gpt-4o',
          max_context_size: 256000,
          capabilities: ['thinking', 'tool_use'],
          support_efforts: ['low', 'high', 'max'],
          adaptive_thinking: true,
        },
      ],
    });
    expect(status).toBe(200);
    expect(body.code).toBe(0);

    const onDisk = await readConfigToml();
    expect(onDisk['models']).toEqual({
      'openai/gpt-4o': {
        provider: 'openai',
        model: 'gpt-4o',
        max_context_size: 256000,
        beta_api: true,
        default_effort: 'high',
        capabilities: ['thinking', 'tool_use'],
        support_efforts: ['low', 'high', 'max'],
        adaptive_thinking: true,
      },
    });
  });

  it('never touches default_model when the rebuild drops its alias (no rename)', async () => {
    await boot(DEFAULTED_TOML);
    const { status, body } = await putJson<unknown>(
      '/api/v1/providers/openai',
      { ...REPLACE_BODY, type: 'openai_responses' },
    );
    expect(status).toBe(200);
    expect(body.code).toBe(0);

    const onDisk = await readConfigToml();
    expect(onDisk['default_model']).toBe('gpt4o');
    expect(onDisk['default_provider']).toBe('openai');
    expect(onDisk['providers']).toEqual({
      zimi: { type: 'zimi', api_key: 'sk-test' },
      openai: {
        type: 'openai_responses',
        api_key: 'sk-openai',
        base_url: 'https://api.openai.example/v1',
        default_model: 'openai/gpt-4.1',
      },
    });
  });

  it('renames a provider: providers key, aliases, default_provider and default_model all migrate', async () => {
    await boot(DEFAULTED_TOML);
    const { status, body } = await putJson<{
      provider: Record<string, unknown>;
    }>('/api/v1/providers/openai', {
      ...REPLACE_BODY,
      new_id: 'my-openai',
      models: [
        { model: 'gpt-4o', max_context_size: 128000 },
        { model: 'gpt-4.1', max_context_size: 1047576 },
      ],
    });
    expect(status).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data.provider['id']).toBe('my-openai');

    const onDisk2 = await readConfigToml();
    expect(onDisk2['providers']).toEqual({
      zimi: { type: 'zimi', api_key: 'sk-test' },
      'my-openai': {
        type: 'openai',
        api_key: 'sk-openai',
        base_url: 'https://api.openai.example/v1',
        default_model: 'my-openai/gpt-4.1',
      },
    });
    expect(onDisk2['models']).toEqual({
      k2: { provider: 'zimi', model: 'kimi-k2', max_context_size: 131072 },
      'my-openai/gpt-4o': { provider: 'my-openai', model: 'gpt-4o', max_context_size: 128000 },
      'my-openai/gpt-4.1': { provider: 'my-openai', model: 'gpt-4.1', max_context_size: 1047576 },
    });
    expect(onDisk2['default_provider']).toBe('my-openai');
    expect(onDisk2['default_model']).toBe('my-openai/gpt-4o');
  });

  it('rewrites model upgrade targets when renaming a provider', async () => {
    await boot(
      `${DEFAULTED_TOML}\n[models."openai/replacement-key"]\nprovider = "openai"\nmodel = "gpt-4.1"\nmax_context_size = 1047576\n\n[models.gpt4o.upgrade]\nmodel = "openai/replacement-key"\nmigration_markdown = "Use next"\n`,
    );
    const { status } = await putJson('/api/v1/providers/openai', {
      ...REPLACE_BODY,
      new_id: 'my-openai',
      models: [
        { model: 'gpt-4o', max_context_size: 128000 },
        { model: 'gpt-4.1', max_context_size: 1047576 },
      ],
    });
    expect(status).toBe(200);

    const onDisk = await readConfigToml();
    expect(onDisk['models']).toMatchObject({
      'my-openai/gpt-4o': {
        upgrade: { model: 'my-openai/gpt-4.1', migration_markdown: 'Use next' },
      },
    });
    const models = await getJson<{
      items: Array<{ model: string; upgrade?: { model: string } }>;
    }>('/api/v1/models');
    expect(models.body.data.items.find((item) => item.model === 'my-openai/gpt-4o')?.upgrade).toEqual({
      model: 'my-openai/gpt-4.1',
      migration_markdown: 'Use next',
    });
  });

  it('rewrites bare model upgrade targets on provider edit', async () => {
    await boot(
      `${DEFAULTED_TOML}\n[models."gpt-4.1"]\nprovider = "openai"\nmodel = "gpt-4.1"\nmax_context_size = 1047576\n\n[models.gpt4o.upgrade]\nmodel = "gpt-4.1"\nmigration_markdown = "Use next"\n`,
    );
    const { status } = await putJson('/api/v1/providers/openai', {
      ...REPLACE_BODY,
      new_id: 'my-openai',
      models: [
        { model: 'gpt-4o', max_context_size: 128000 },
        { model: 'gpt-4.1', max_context_size: 1047576 },
      ],
    });
    expect(status).toBe(200);

    const onDisk = await readConfigToml();
    expect(onDisk['models']).toMatchObject({
      'my-openai/gpt-4o': {
        upgrade: { model: 'my-openai/gpt-4.1', migration_markdown: 'Use next' },
      },
    });
    const models = await getJson<{
      items: Array<{ model: string; upgrade?: { model: string } }>;
    }>('/api/v1/models');
    expect(models.body.data.items.find((item) => item.model === 'my-openai/gpt-4o')?.upgrade).toEqual({
      model: 'my-openai/gpt-4.1',
      migration_markdown: 'Use next',
    });
  });

  it('drops model upgrades whose target disappears on provider edit', async () => {
    await boot(
      `${DEFAULTED_TOML}\n[models."openai/replacement-key"]\nprovider = "openai"\nmodel = "gpt-4.1"\nmax_context_size = 1047576\n\n[models.gpt4o.upgrade]\nmodel = "openai/replacement-key"\nmigration_markdown = "Use next"\n`,
    );
    const { status } = await putJson('/api/v1/providers/openai', {
      ...REPLACE_BODY,
      new_id: 'my-openai',
      models: [{ model: 'gpt-4o', max_context_size: 128000 }],
    });
    expect(status).toBe(200);

    const onDisk = await readConfigToml();
    expect(onDisk['models']).not.toHaveProperty('my-openai/gpt-4o.upgrade');
    const models = await getJson<{
      items: Array<{ model: string; upgrade?: unknown }>;
    }>('/api/v1/models');
    expect(models.body.data.items.find((item) => item.model === 'my-openai/gpt-4o')?.upgrade).toBeUndefined();
  });

  it('migrates default_provider on rename but leaves default_model alone when its model was dropped', async () => {
    await boot(DEFAULTED_TOML);
    const { status, body } = await putJson<unknown>(
      '/api/v1/providers/openai',
      { ...REPLACE_BODY, new_id: 'my-openai' },
    );
    expect(status).toBe(200);
    expect(body.code).toBe(0);

    const onDisk = await readConfigToml();
    expect(onDisk['default_provider']).toBe('my-openai');
    expect(onDisk['default_model']).toBe('gpt4o');
  });

  it('leaves secondary_model pool entries alone on provider rename', async () => {
    await boot(POOL_TOML);
    const { status } = await putJson<unknown>('/api/v1/providers/openai', {
      type: 'openai',
      new_id: 'my-openai',
      models: [{ model: 'gpt-4o', max_context_size: 128000 }],
    });
    expect(status).toBe(200);

    const onDisk = await readConfigToml();
    expect(onDisk['secondary_model']).toEqual({
      default_model: 'k2',
      models: { k2: 'fast', gpt4o: 'smart' },
    });
  });

  it('leaves secondary_model pool entries alone on provider edit', async () => {
    await boot(POOL_TOML);
    const { status } = await putJson<unknown>('/api/v1/providers/openai', REPLACE_BODY);
    expect(status).toBe(200);

    const onDisk = await readConfigToml();
    expect(onDisk['secondary_model']).toEqual({
      default_model: 'k2',
      models: { k2: 'fast', gpt4o: 'smart' },
    });
  });

  it('keeps the secondary_model section even when a provider edit orphans its default', async () => {
    await boot(POOL_DANGLING_DEFAULT_TOML);
    const { status } = await putJson<unknown>('/api/v1/providers/openai', REPLACE_BODY);
    expect(status).toBe(200);

    const onDisk = await readConfigToml();
    expect(onDisk['secondary_model']).toEqual({
      default_model: 'gpt4o',
      models: { k2: 'fast', gpt4o: 'smart' },
    });
  });

  it('rejects a rename to an existing provider id with 40921', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { status, body } = await putJson<unknown>('/api/v1/providers/openai', {
      ...REPLACE_BODY,
      new_id: 'zimi',
    });
    expect(status).toBe(200);
    expect(body.code).toBe(40921);

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      zimi: { type: 'zimi', api_key: 'sk-test' },
      openai: { type: 'openai', api_key: 'sk-openai' },
    });
  });

  it('rejects invalid replace bodies with 40001', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const cases: Array<{ name: string; body: unknown; path?: string }> = [
      { name: 'unknown wire type', body: { ...REPLACE_BODY, type: 'custom' }, path: 'type' },
      { name: 'empty models list', body: { ...REPLACE_BODY, models: [] }, path: 'models' },
      {
        name: 'default_model outside the models list',
        body: { ...REPLACE_BODY, default_model: 'gpt-5' },
        path: 'default_model',
      },
    ];
    for (const { name, body, path } of cases) {
      const { body: envelope } = await putJson('/api/v1/providers/openai', body);
      expect(envelope.code, name).toBe(40001);
      expect(envelope.data, name).toBeNull();
      if (path !== undefined) {
        expect(
          envelope.details?.some((detail) => detail.path === path),
          name,
        ).toBe(true);
      }
    }
  });

  it('rejects replacing an OAuth-managed provider with 40003', async () => {
    await boot(MANAGED_TOML);
    const { body } = await putJson<unknown>(
      '/api/v1/providers/managed%3Azimi-code',
      REPLACE_BODY,
    );
    expect(body.code).toBe(40003);
    expect(body.msg).toContain('/oauth/logout');

    const providers = await getJson<{ items: Array<{ id: string }> }>('/api/v1/providers');
    expect(providers.body.data.items.map((p) => p.id)).toEqual(['managed:zimi-code']);
    const models = await getJson<{ items: Array<{ model: string }> }>('/api/v1/models');
    expect(models.body.data.items.map((m) => m.model)).toEqual(['managed:zimi-code/kimi-k2']);
  });

  it('maps an unknown provider id to 40412 on replace', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { body } = await putJson<unknown>('/api/v1/providers/missing', REPLACE_BODY);
    expect(body.code).toBe(40412);
    expect(body.data).toBeNull();
  });

  it('clears omitted provider fields (base_url/default_model) from config.toml for real', async () => {
    const FULL_TOML = [
      '[providers.openai]',
      'type = "openai"',
      'api_key = "sk-openai"',
      'base_url = "https://api.openai.example/v1"',
      'default_model = "openai/gpt-4.1"',
      'custom_headers = { "X-Org" = "acme" }',
      '',
      '[models."openai/gpt-4.1"]',
      'provider = "openai"',
      'model = "gpt-4.1"',
      'max_context_size = 1047576',
      'display_name = "GPT-4.1"',
      'capabilities = ["tool_use"]',
      '',
    ].join('\n');
    await boot(FULL_TOML);
    const { status } = await putJson<unknown>('/api/v1/providers/openai', {
      type: 'openai',
      models: [{ model: 'gpt-4.1', max_context_size: 1047576 }],
    });
    expect(status).toBe(200);

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      openai: {
        type: 'openai',
        api_key: 'sk-openai',
        custom_headers: { 'X-Org': 'acme' },
      },
    });
    expect(onDisk['models']).toEqual({
      'openai/gpt-4.1': {
        provider: 'openai',
        model: 'gpt-4.1',
        max_context_size: 1047576,
      },
    });

    const single = await getJson<Record<string, unknown>>('/api/v1/providers/openai');
    expect(single.body.data).not.toHaveProperty('base_url');
    expect(single.body.data).not.toHaveProperty('default_model');
  });

  it('does not reveal an empty-string api_key on the single GET', async () => {
    await boot(KEEP_DEFAULT_TOML);
    await putJson<unknown>('/api/v1/providers/openai', { ...REPLACE_BODY, api_key: '' });
    const { body } = await getJson<Record<string, unknown>>('/api/v1/providers/openai');
    expect(body.data).not.toHaveProperty('api_key');
  });

  it('rejects duplicate model rows with 40001 on both create and replace', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const duplicate = {
      ...CREATE_BODY,
      models: [
        { model: 'gpt-4.1', max_context_size: 1047576 },
        { model: 'gpt-4.1', max_context_size: 128000 },
      ],
    };
    const created = await postJson<unknown>('/api/v1/providers', duplicate);
    expect(created.body.code).toBe(40001);
    expect(created.body.msg).toContain('duplicate model');

    const replaced = await putJson<unknown>('/api/v1/providers/openai', {
      type: 'openai',
      models: [
        { model: 'gpt-4.1', max_context_size: 1047576 },
        { model: 'gpt-4.1', max_context_size: 128000 },
      ],
    });
    expect(replaced.body.code).toBe(40001);
  });

  it('rejects a base_url containing an env placeholder with 40001', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { body } = await postJson<unknown>('/api/v1/providers', {
      ...CREATE_BODY,
      base_url: 'https://${HOST}/v1',
    });
    expect(body.code).toBe(40001);
    expect(body.msg).toContain('base_url');
  });

  it('trims a padded base_url before persisting', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { status, body } = await postJson<{ base_url?: string }>('/api/v1/providers', {
      ...CREATE_BODY,
      base_url: '  https://api.openai.example/v1  ',
    });
    expect(status).toBe(201);
    expect(body.data.base_url).toBe('https://api.openai.example/v1');
  });

  it('rejects a rename/rebuild whose alias key is owned by another provider (40001, no writes)', async () => {
    const FOREIGN_TOML = [
      '[providers.openai]',
      'type = "openai"',
      'api_key = "sk-openai"',
      '',
      '[providers.other]',
      'type = ' + '"anthropic"',
      'api_key = "sk-other"',
      '',
      '[models."openai/gpt-4.1"]',
      'provider = "other"',
      'model = "claude-thing"',
      'max_context_size = 200000',
      '',
      '[models."other/claude-thing"]',
      'provider = "other"',
      'model = "claude-thing"',
      'max_context_size = 200000',
      '',
    ].join('\n');
    await boot(FOREIGN_TOML);
    const { status, body } = await putJson<unknown>('/api/v1/providers/openai', {
      type: 'openai',
      models: [{ model: 'gpt-4.1', max_context_size: 1047576 }],
    });
    expect(status).toBe(200);
    expect(body.code).toBe(40001);
    expect(body.msg).toContain('openai/gpt-4.1');

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      openai: { type: 'openai', api_key: 'sk-openai' },
      other: { type: 'anthropic', api_key: 'sk-other' },
    });
    const models = onDisk['models'] as Record<string, Record<string, unknown>>;
    expect(models['openai/gpt-4.1']).toEqual({
      provider: 'other',
      model: 'claude-thing',
      max_context_size: 200000,
    });
  });

  it('creates a provider via discover:true with the probed protocol and enriched models', async () => {
    await boot();
    const probeUrl = await startProbeServer('list');
    installDiscoverCatalog();
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'my-gateway',
      api_key: 'sk-probe',
      base_url: probeUrl,
      discover: true,
    });
    expect(status).toBe(201);
    expect(body.code).toBe(0);
    expect(body.data).toEqual({
      id: 'my-gateway',
      type: 'openai',
      base_url: probeUrl,
      default_model: 'my-gateway/gpt-x',
      has_api_key: true,
      status: 'connected',
      models: ['my-gateway/gpt-x', 'my-gateway/gpt-y'],
    });

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      'my-gateway': {
        type: 'openai',
        api_key: 'sk-probe',
        base_url: probeUrl,
      },
    });
    expect(onDisk['models']).toEqual({
      'my-gateway/gpt-x': {
        provider: 'my-gateway',
        model: 'gpt-x',
        max_context_size: 128000,
        support_efforts: ['low', 'high'],
        off_effort: 'none',
      },
      'my-gateway/gpt-y': {
        provider: 'my-gateway',
        model: 'gpt-y',
        max_context_size: 262144,
      },
    });
    expect(onDisk['default_model']).toBe('my-gateway/gpt-x');

    const models = await getJson<{ items: unknown[] }>('/api/v1/models');
    expect(models.body.data.items).toEqual([
      {
        provider: 'my-gateway',
        model: 'my-gateway/gpt-x',
        display_name: 'gpt-x',
        max_context_size: 128000,
        support_efforts: ['low', 'high'],
      },
      {
        provider: 'my-gateway',
        model: 'my-gateway/gpt-y',
        display_name: 'gpt-y',
        max_context_size: 262144,
      },
    ]);
  });

  it('uses an explicit type over the probed protocol on discover:true', async () => {
    await boot();
    const probeUrl = await startProbeServer('list');
    installDiscoverCatalog();
    const { status, body } = await postJson<{ type: string }>('/api/v1/providers', {
      id: 'my-explicit',
      type: 'openai_responses',
      api_key: 'sk-probe',
      base_url: probeUrl,
      discover: true,
    });
    expect(status).toBe(201);
    expect(body.data.type).toBe('openai_responses');

    const onDisk = await readConfigToml();
    expect((onDisk['providers'] as Record<string, { type: string }>)['my-explicit']?.type).toBe(
      'openai_responses',
    );
  });

  it('rejects discover:true when the endpoint cannot be reached (network envelope, no writes)', async () => {
    await boot();
    installDiscoverCatalog();
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'net-fail',
      api_key: 'sk-probe',
      base_url: 'http://127.0.0.1:1',
      discover: true,
    });
    expect(status).toBe(200);
    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
    expect(body.msg).toContain('无法连接');

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toBeUndefined();
    expect(onDisk['models']).toBeUndefined();
    expect(onDisk['default_model']).toBeUndefined();
  });

  it('rejects discover:true with an auth failure (no writes)', async () => {
    await boot();
    const probeUrl = await startProbeServer('unauthorized');
    installDiscoverCatalog();
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'auth-fail',
      api_key: 'sk-probe',
      base_url: probeUrl,
      discover: true,
    });
    expect(status).toBe(200);
    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
    expect(body.msg).toContain('API Key');

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toBeUndefined();
    expect(onDisk['models']).toBeUndefined();
  });

  it('rejects discover:true when the endpoint returns no models (no writes)', async () => {
    await boot();
    const probeUrl = await startProbeServer('empty');
    installDiscoverCatalog();
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'empty-fail',
      api_key: 'sk-probe',
      base_url: probeUrl,
      discover: true,
    });
    expect(status).toBe(200);
    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
    expect(body.msg).toContain('没有返回任何模型');

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toBeUndefined();
    expect(onDisk['models']).toBeUndefined();
  });

  it('rejects discover and models submitted together with 40001', async () => {
    await boot();
    installDiscoverCatalog();
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      ...CREATE_BODY,
      id: 'both-given',
      discover: true,
    });
    expect(status).toBe(200);
    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
    expect(body.msg).toContain('exactly one of discover=true or models[]');

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toBeUndefined();
  });

  it('rejects neither discover nor models with 40001', async () => {
    await boot();
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'neither-given',
      type: 'openai',
    });
    expect(status).toBe(200);
    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
    expect(body.msg).toContain('exactly one of discover=true or models[]');
  });

  it('rejects a default_model outside the probed model set with 40001 (no writes)', async () => {
    await boot();
    const probeUrl = await startProbeServer('list');
    installDiscoverCatalog();
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'dm-fail',
      api_key: 'sk-probe',
      base_url: probeUrl,
      default_model: 'gpt-5',
      discover: true,
    });
    expect(status).toBe(200);
    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
    expect(body.msg).toContain('default_model 必须在探测到的模型列表中');

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toBeUndefined();
    expect(onDisk['models']).toBeUndefined();
  });

  it('honors a default_model inside the probed model set on discover:true', async () => {
    await boot();
    const probeUrl = await startProbeServer('list');
    installDiscoverCatalog();
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'dm-ok',
      api_key: 'sk-probe',
      base_url: probeUrl,
      default_model: 'gpt-y',
      discover: true,
    });
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ id: 'dm-ok', default_model: 'dm-ok/gpt-y' });

    const onDisk = await readConfigToml();
    expect(onDisk['default_model']).toBe('dm-ok/gpt-y');
  });

  it('creates a provider via discover:true without efforts when the catalog is unavailable', async () => {
    await boot();
    const probeUrl = await startProbeServer('list');
    resetModelsDevUpstreamForTest();
    setModelsDevUpstreamForTest({
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'my-offline',
      api_key: 'sk-probe',
      base_url: probeUrl,
      discover: true,
    });
    expect(status).toBe(201);
    expect(body.code).toBe(0);
    expect(body.data).toMatchObject({ id: 'my-offline', type: 'openai' });

    const onDisk = await readConfigToml();
    expect(onDisk['models']).toEqual({
      'my-offline/gpt-x': {
        provider: 'my-offline',
        model: 'gpt-x',
        max_context_size: 128000,
      },
      'my-offline/gpt-y': {
        provider: 'my-offline',
        model: 'gpt-y',
        max_context_size: 262144,
      },
    });
  });

  it('merges onto an OAuth-managed provider is rejected with 40003 (no writes)', async () => {
    const OAUTH_TOML = [
      '[providers.oauth-zimi]',
      'type = "openai"',
      'api_key = ""',
      'oauth = { storage = "file", key = "oauth/zimi-code" }',
      '',
      '[models."oauth-zimi/kimi-k2"]',
      'provider = "oauth-zimi"',
      'model = "kimi-k2"',
      'max_context_size = 131072',
      '',
    ].join('\n');
    await boot(OAUTH_TOML);
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'oauth-zimi',
      on_existing: 'merge',
      type: 'openai',
      api_key: 'sk-new',
    });
    expect(status).toBe(200);
    expect(body.code).toBe(40003);
    expect(body.msg).toContain('/oauth/logout');

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      'oauth-zimi': {
        type: 'openai',
        api_key: '',
        oauth: { storage: 'file', key: 'oauth/zimi-code' },
      },
    });
    expect(onDisk['models']).toEqual({
      'oauth-zimi/kimi-k2': {
        provider: 'oauth-zimi',
        model: 'kimi-k2',
        max_context_size: 131072,
      },
    });
  });

  it('merging a mismatched type is rejected with 40936 (no writes)', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'anthropic',
      api_key: 'sk-merged',
    });
    expect(status).toBe(200);
    expect(body.code).toBe(40936);
    expect(body.data).toBeNull();

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      zimi: { type: 'zimi', api_key: 'sk-test' },
      openai: { type: 'openai', api_key: 'sk-openai' },
    });
    expect(onDisk['models']).toEqual({
      k2: { provider: 'zimi', model: 'kimi-k2', max_context_size: 131072 },
      gpt4o: { provider: 'openai', model: 'gpt-4o', max_context_size: 128000 },
    });
  });

  it('merging onto a provider without a stored type is rejected with 40936', async () => {
    const UNTYPED_TOML = [
      '[providers.openai]',
      'api_key = "sk-openai"',
      '',
      '[models.gpt4o]',
      'provider = "openai"',
      'model = "gpt-4o"',
      'max_context_size = 128000',
      '',
    ].join('\n');
    await boot(UNTYPED_TOML);
    const { body } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
    });
    expect(body.code).toBe(40936);

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({ openai: { api_key: 'sk-openai' } });
  });

  it('merging onto a provider with a free-string (non-enum) type is rejected with 40936', async () => {
    const CUSTOM_TOML = [
      '[providers.acme]',
      'type = "custom-engine"',
      '',
      '[models."acme/pro"]',
      'provider = "acme"',
      'model = "pro"',
      'max_context_size = 128000',
      '',
    ].join('\n');
    await boot(CUSTOM_TOML);
    const { body } = await postJson<unknown>('/api/v1/providers', {
      id: 'acme',
      on_existing: 'merge',
      type: 'openai',
    });
    expect(body.code).toBe(40936);

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({ acme: { type: 'custom-engine' } });
  });

  it('merging accepts a base_url that only differs by trailing slashes', async () => {
    const BASED_TOML = [
      '[providers.openai]',
      'type = "openai"',
      'api_key = "sk-openai"',
      'base_url = "https://api.openai.example/v1"',
      '',
      '[models."openai/gpt-4o"]',
      'provider = "openai"',
      'model = "gpt-4o"',
      'max_context_size = 128000',
      '',
    ].join('\n');
    await boot(BASED_TOML);
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      base_url: 'https://api.openai.example/v1/',
      api_key: 'sk-new',
    });
    expect(status).toBe(200);
    expect(body.code).toBe(0);

    const onDisk = await readConfigToml();
    expect((onDisk['providers'] as Record<string, { base_url?: string }>)['openai']?.base_url).toBe(
      'https://api.openai.example/v1',
    );
  });

  it('merging a genuinely different base_url is rejected with 40936 (no writes)', async () => {
    const BASED_TOML = [
      '[providers.openai]',
      'type = "openai"',
      'api_key = "sk-openai"',
      'base_url = "https://api.openai.example/v1"',
      '',
      '[models."openai/gpt-4o"]',
      'provider = "openai"',
      'model = "gpt-4o"',
      'max_context_size = 128000',
      '',
    ].join('\n');
    await boot(BASED_TOML);
    const { body } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      base_url: 'https://api.other.example/v1',
      api_key: 'sk-new',
    });
    expect(body.code).toBe(40936);

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      openai: {
        type: 'openai',
        api_key: 'sk-openai',
        base_url: 'https://api.openai.example/v1',
      },
    });
  });

  it('merging a base_url onto a provider that has none is rejected with 40936', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { body } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      base_url: 'https://api.openai.example/v1',
    });
    expect(body.code).toBe(40936);

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      zimi: { type: 'zimi', api_key: 'sk-test' },
      openai: { type: 'openai', api_key: 'sk-openai' },
    });
  });

  it('merge keeps the stored api_key when api_key is omitted', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
    });
    expect(status).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data).toMatchObject({ id: 'openai', has_api_key: true });

    const onDisk = await readConfigToml();
    expect((onDisk['providers'] as Record<string, { api_key?: string }>)['openai']?.api_key).toBe(
      'sk-openai',
    );
  });

  it('merge replaces the api_key when a non-empty one is submitted', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { status } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      api_key: 'sk-rotated',
    });
    expect(status).toBe(200);

    const onDisk = await readConfigToml();
    expect((onDisk['providers'] as Record<string, { api_key?: string }>)['openai']?.api_key).toBe(
      'sk-rotated',
    );
  });

  it('merge clears the api_key when an empty string is submitted', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      api_key: '',
    });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ id: 'openai', has_api_key: false });

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      zimi: { type: 'zimi', api_key: 'sk-test' },
      openai: { type: 'openai' },
    });
  });

  it('merge switches apiKey to apiKeyEnv without leaving residue, and back', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const toEnv = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      api_key_env: 'ZIMI_TEST_MERGE_KEY',
    });
    expect(toEnv.status).toBe(200);

    let onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      zimi: { type: 'zimi', api_key: 'sk-test' },
      openai: { type: 'openai', api_key_env: 'ZIMI_TEST_MERGE_KEY' },
    });

    const backToKey = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      api_key: 'sk-back',
    });
    expect(backToKey.status).toBe(200);

    onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      zimi: { type: 'zimi', api_key: 'sk-test' },
      openai: { type: 'openai', api_key: 'sk-back' },
    });
  });

  it('merge rejects api_key and api_key_env submitted together with 40001 (no writes)', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { body } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      api_key: 'sk-inline',
      api_key_env: 'ZIMI_TEST_MERGE_KEY',
    });
    expect(body.code).toBe(40001);
    expect(body.msg).toContain('mutually exclusive');

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      zimi: { type: 'zimi', api_key: 'sk-test' },
      openai: { type: 'openai', api_key: 'sk-openai' },
    });
  });

  it('merge updates default_model when it names an existing-only alias', async () => {
    const ALIASED_TOML = [
      '[providers.openai]',
      'type = "openai"',
      'api_key = "sk-openai"',
      '',
      '[models."openai/gpt-4o"]',
      'provider = "openai"',
      'model = "gpt-4o"',
      'max_context_size = 128000',
      '',
    ].join('\n');
    await boot(ALIASED_TOML);
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      default_model: 'gpt-4o',
    });
    expect(status).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data).toMatchObject({ id: 'openai', default_model: 'openai/gpt-4o' });

    const onDisk = await readConfigToml();
    expect((onDisk['providers'] as Record<string, { default_model?: string }>)['openai']?.default_model).toBe(
      'openai/gpt-4o',
    );
  });

  it('merge rejects a default_model outside the merged model set with 40001 (no writes)', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { body } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      default_model: 'gpt-5',
    });
    expect(body.code).toBe(40001);

    const onDisk = await readConfigToml();
    expect(onDisk['providers']).toEqual({
      zimi: { type: 'zimi', api_key: 'sk-test' },
      openai: { type: 'openai', api_key: 'sk-openai' },
    });
  });

  it('merge keeps the stored default_model when it is omitted', async () => {
    const DEFAULTED_PROVIDER_TOML = [
      '[providers.openai]',
      'type = "openai"',
      'api_key = "sk-openai"',
      'default_model = "openai/gpt-4o"',
      '',
      '[models.gpt4o]',
      'provider = "openai"',
      'model = "gpt-4o"',
      'max_context_size = 128000',
      '',
    ].join('\n');
    await boot(DEFAULTED_PROVIDER_TOML);
    const { status } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      api_key: 'sk-new',
    });
    expect(status).toBe(200);

    const onDisk = await readConfigToml();
    expect((onDisk['providers'] as Record<string, { default_model?: string }>)['openai']?.default_model).toBe(
      'openai/gpt-4o',
    );
  });

  it('merge upserts models: new aliases added, submitted fields overwritten, existing fields kept, unlisted aliases untouched', async () => {
    const RICH_TOML = [
      '[providers.openai]',
      'type = "openai"',
      'api_key = "sk-openai"',
      '',
      '[models."openai/gpt-4o"]',
      'provider = "openai"',
      'model = "gpt-4o"',
      'max_context_size = 128000',
      'display_name = "Old Name"',
      'beta_api = true',
      '',
      '[models."openai/legacy"]',
      'provider = "openai"',
      'model = "legacy"',
      'max_context_size = 64000',
      '',
    ].join('\n');
    await boot(RICH_TOML);
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      models: [
        {
          model: 'gpt-4o',
          max_context_size: 256000,
          display_name: 'New Name',
        },
        { model: 'gpt-4.1', max_context_size: 1047576 },
      ],
    });
    expect(status).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data).toMatchObject({
      id: 'openai',
      models: ['openai/gpt-4o', 'openai/legacy', 'openai/gpt-4.1'],
    });

    const onDisk = await readConfigToml();
    expect(onDisk['models']).toEqual({
      'openai/gpt-4o': {
        provider: 'openai',
        model: 'gpt-4o',
        max_context_size: 256000,
        display_name: 'New Name',
        beta_api: true,
      },
      'openai/legacy': {
        provider: 'openai',
        model: 'legacy',
        max_context_size: 64000,
      },
      'openai/gpt-4.1': {
        provider: 'openai',
        model: 'gpt-4.1',
        max_context_size: 1047576,
      },
    });
  });

  it('merge preserves an existing upgrade pointer on a resubmitted model', async () => {
    const UPGRADE_TOML = [
      '[providers.openai]',
      'type = "openai"',
      'api_key = "sk-openai"',
      '',
      '[models."openai/gpt-4o"]',
      'provider = "openai"',
      'model = "gpt-4o"',
      'max_context_size = 128000',
      '',
      '[models."openai/gpt-4.1"]',
      'provider = "openai"',
      'model = "gpt-4.1"',
      'max_context_size = 1047576',
      '',
      '[models."openai/gpt-4o".upgrade]',
      'model = "openai/gpt-4.1"',
      'migration_markdown = "Use next"',
      '',
    ].join('\n');
    await boot(UPGRADE_TOML);
    const { status } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      models: [{ model: 'gpt-4o', max_context_size: 256000 }],
    });
    expect(status).toBe(200);

    const onDisk = await readConfigToml();
    expect(onDisk['models']).toMatchObject({
      'openai/gpt-4o': {
        max_context_size: 256000,
        upgrade: { model: 'openai/gpt-4.1', migration_markdown: 'Use next' },
      },
      'openai/gpt-4.1': { max_context_size: 1047576 },
    });
  });

  it('merge with models omitted makes zero changes to the models section', async () => {
    const RICH_TOML = [
      '[providers.openai]',
      'type = "openai"',
      'api_key = "sk-openai"',
      '',
      '[models."openai/gpt-4o"]',
      'provider = "openai"',
      'model = "gpt-4o"',
      'max_context_size = 128000',
      '',
    ].join('\n');
    await boot(RICH_TOML);
    const { status } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      api_key: 'sk-rotated',
    });
    expect(status).toBe(200);

    const onDisk = await readConfigToml();
    expect(onDisk['models']).toEqual({
      'openai/gpt-4o': {
        provider: 'openai',
        model: 'gpt-4o',
        max_context_size: 128000,
      },
    });
    expect((onDisk['providers'] as Record<string, { api_key?: string }>)['openai']?.api_key).toBe(
      'sk-rotated',
    );
  });

  it('merge rejects a duplicate model row with 40001', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { body } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      models: [
        { model: 'gpt-4.1', max_context_size: 1047576 },
        { model: 'gpt-4.1', max_context_size: 128000 },
      ],
    });
    expect(body.code).toBe(40001);
    expect(body.msg).toContain('duplicate model');
  });

  it('replaying the same merge body leaves config.toml byte-identical', async () => {
    const RICH_TOML = [
      '[providers.openai]',
      'type = "openai"',
      'api_key = "sk-openai"',
      'base_url = "https://api.openai.example/v1"',
      'default_model = "openai/gpt-4o"',
      '',
      '[models."openai/gpt-4o"]',
      'provider = "openai"',
      'model = "gpt-4o"',
      'max_context_size = 128000',
      'display_name = "GPT-4o"',
      '',
    ].join('\n');
    await boot(RICH_TOML);
    const mergeBody = {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      base_url: 'https://api.openai.example/v1',
      models: [
        { model: 'gpt-4o', max_context_size: 256000, display_name: 'GPT-4o' },
        { model: 'gpt-4.1', max_context_size: 1047576 },
      ],
    };
    const first = await postJson<unknown>('/api/v1/providers', mergeBody);
    expect(first.status).toBe(200);
    expect(first.body.code).toBe(0);

    const textAfterFirst = await readFile(join(home as string, 'config.toml'), 'utf-8');
    const second = await postJson<unknown>('/api/v1/providers', mergeBody);
    expect(second.status).toBe(200);
    expect(second.body.code).toBe(0);

    const textAfterSecond = await readFile(join(home as string, 'config.toml'), 'utf-8');
    expect(textAfterSecond).toBe(textAfterFirst);
  });

  it('merge seeds the global default_model on a fresh setup but never overwrites a set one', async () => {
    const PROVIDER_ONLY_TOML = [
      '[providers.openai]',
      'type = "openai"',
      'api_key = "sk-openai"',
      '',
      '[models.gpt4o]',
      'provider = "openai"',
      'model = "gpt-4o"',
      'max_context_size = 128000',
      '',
    ].join('\n');
    await boot(PROVIDER_ONLY_TOML);
    const seeded = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      models: [{ model: 'gpt-4.1', max_context_size: 1047576 }],
    });
    expect(seeded.status).toBe(200);
    expect((await readConfigToml())['default_model']).toBe('openai/gpt-4.1');

    await boot(KEEP_DEFAULT_TOML);
    const kept = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      models: [{ model: 'gpt-4.1', max_context_size: 1047576 }],
    });
    expect(kept.status).toBe(200);
    expect((await readConfigToml())['default_model']).toBe('k2');
  });

  it('merge falls back to the first existing alias when seeding and no models are submitted', async () => {
    const PROVIDER_ONLY_TOML = [
      '[providers.openai]',
      'type = "openai"',
      'api_key = "sk-openai"',
      '',
      '[models."openai/gpt-4o"]',
      'provider = "openai"',
      'model = "gpt-4o"',
      'max_context_size = 128000',
      '',
    ].join('\n');
    await boot(PROVIDER_ONLY_TOML);
    const { status } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      api_key: 'sk-rotated',
    });
    expect(status).toBe(200);
    expect((await readConfigToml())['default_model']).toBe('openai/gpt-4o');
  });

  it('concurrent same-id creates: one 201, one 40921', async () => {
    await boot();
    const [a, b] = await Promise.all([
      postJson<unknown>('/api/v1/providers', CREATE_BODY),
      postJson<unknown>('/api/v1/providers', CREATE_BODY),
    ]);
    const statuses = [a.status, b.status].sort();
    const codes = [a.body.code, b.body.code].sort();
    expect(statuses).toEqual([200, 201]);
    expect(codes).toEqual([0, 40921]);
  });

  it('concurrent create + merge: one 201, one 200 merge', async () => {
    await boot();
    const mergeBody = {
      ...CREATE_BODY,
      on_existing: 'merge',
    };
    const [a, b] = await Promise.all([
      postJson<unknown>('/api/v1/providers', CREATE_BODY),
      postJson<unknown>('/api/v1/providers', mergeBody),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.code).toBe(0);
    expect(b.body.code).toBe(0);

    const providers = await getJson<{ items: Array<{ id: string }> }>('/api/v1/providers');
    expect(providers.body.data.items.map((p) => p.id)).toEqual(['my-openai']);
  });

  it('merge combines with discover:true: probe first, then merge into the existing record', async () => {
    const probeUrl = await startProbeServer('list');
    installDiscoverCatalog();
    const EXISTING_TOML = [
      '[providers.my-gateway]',
      'type = "openai"',
      'api_key = "sk-old"',
      'base_url = "' + probeUrl + '"',
      '',
      '[models."my-gateway/legacy"]',
      'provider = "my-gateway"',
      'model = "legacy"',
      'max_context_size = 64000',
      '',
    ].join('\n');
    await boot(EXISTING_TOML);
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      id: 'my-gateway',
      on_existing: 'merge',
      api_key: 'sk-probe',
      base_url: probeUrl,
      discover: true,
    });
    expect(status).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data).toMatchObject({
      id: 'my-gateway',
      type: 'openai',
      has_api_key: true,
    });

    const onDisk = await readConfigToml();
    const providers = onDisk['providers'] as Record<string, Record<string, unknown>>;
    expect(providers['my-gateway']).toEqual({
      type: 'openai',
      api_key: 'sk-probe',
      base_url: probeUrl,
    });
    const models = onDisk['models'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(models).sort()).toEqual(
      ['my-gateway/gpt-x', 'my-gateway/gpt-y', 'my-gateway/legacy'].sort(),
    );
    expect(models['my-gateway/legacy']).toEqual({
      provider: 'my-gateway',
      model: 'legacy',
      max_context_size: 64000,
    });
  });

  it('merge with discover:true and a mismatched probed protocol is rejected with 40936', async () => {
    const probeUrl = await startProbeServer('list');
    installDiscoverCatalog();
    const EXISTING_TOML = [
      '[providers.my-gateway]',
      'type = "anthropic"',
      'api_key = "sk-old"',
      'base_url = "' + probeUrl + '"',
      '',
    ].join('\n');
    await boot(EXISTING_TOML);
    const { body } = await postJson<unknown>('/api/v1/providers', {
      id: 'my-gateway',
      on_existing: 'merge',
      base_url: probeUrl,
      discover: true,
    });
    expect(body.code).toBe(40936);
    expect(body.data).toBeNull();
  });

  it('merge onto a missing provider id still creates it (201)', async () => {
    await boot();
    const { status, body } = await postJson<unknown>('/api/v1/providers', {
      ...CREATE_BODY,
      on_existing: 'merge',
    });
    expect(status).toBe(201);
    expect(body.code).toBe(0);
    expect(body.data).toMatchObject({ id: 'my-openai' });
  });

  it('merge with neither discover nor models requires type (40001)', async () => {
    await boot(KEEP_DEFAULT_TOML);
    const { body } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      api_key: 'sk-new',
    });
    expect(body.code).toBe(40001);
    expect(body.msg).toContain('type is required');
  });

  it('merge still rejects discover and models submitted together with 40001', async () => {
    await boot(KEEP_DEFAULT_TOML);
    installDiscoverCatalog();
    const { body } = await postJson<unknown>('/api/v1/providers', {
      id: 'openai',
      on_existing: 'merge',
      type: 'openai',
      discover: true,
      models: [{ model: 'gpt-4.1', max_context_size: 1047576 }],
    });
    expect(body.code).toBe(40001);
    expect(body.msg).toContain('exactly one of discover=true or models[]');
  });
});
