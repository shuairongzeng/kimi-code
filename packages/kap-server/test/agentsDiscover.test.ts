import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer, type Server } from 'node:http';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  resetModelsDevUpstreamForTest,
  setModelsDevUpstreamForTest,
} from '@zimi-ai/agent-core-v2/app/kosongConfig/modelsDevUpstream';
import { type RunningServer, startServer } from '../src/start';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';
import { authHeaders } from './helpers/auth';

interface Envelope<T> {
  code: number;
  msg: string;
  data: T | null;
  request_id: string;
}

interface DiscoveredModel {
  modelId: string;
  contextWindow?: number;
  support_efforts?: string[];
  off_effort?: string;
}

interface DiscoverModelsData {
  models: DiscoveredModel[];
  protocol: 'anthropic' | 'openai' | 'openai_responses' | 'google-genai' | null;
}

const CATALOG = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    api: 'https://api.openai.com/v1',
    npm: '@ai-sdk/openai',
    models: {
      'gpt-x': {
        id: 'gpt-x',
        name: 'GPT X',
        limit: { context: 96000 },
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        reasoning_options: [{ type: 'effort', values: ['low', 'high', 'none'] }],
      },
    },
  },
} as const;

const VALID_BODY = {
  baseUrl: 'https://gateway.example/v1',
  apiKey: 'sk-test-key',
  type: 'openai',
};

async function discover(
  base: string,
  server: RunningServer,
  body: unknown = VALID_BODY,
): Promise<Envelope<DiscoverModelsData>> {
  const res = await fetch(`${base}/api/v1/agents/discover-models`, {
    method: 'POST',
    headers: authHeaders(server, { 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Envelope<DiscoverModelsData>;
}

describe('server-v2 /api/v1 agents discover-models', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let base: string;
  let probeServer: Server | undefined;
  let probePort = 0;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'zimi-server-v2-agents-discover-'));
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
    });
    base = `http://127.0.0.1:${server.port}`;
    probeServer = createServer((req, res) => {
      if (req.url === '/v1/models' || req.url === '/models') {
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
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    const listenPromise = new Promise<void>((resolve) => {
      probeServer?.listen(0, '127.0.0.1', () => resolve());
    });
    await listenPromise;
    const address = probeServer?.address();
    if (typeof address !== 'object' || address === null || !('port' in address)) {
      throw new Error('probe server did not expose a port');
    }
    probePort = address.port;
    setModelsDevUpstreamForTest({
      fetchImpl: (async () =>
        new Response(JSON.stringify(CATALOG), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
  });

  afterEach(() => {
    resetModelsDevUpstreamForTest();
  });

  afterAll(async () => {
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
    if (probeServer !== undefined) {
      probeServer.close();
      probeServer = undefined;
    }
  });

  function live(): RunningServer {
    if (server === undefined) throw new Error('server not started');
    return server;
  }

  it('returns discovered models with protocol and support_efforts on the wire', async () => {
    const body = await discover(base, live(), {
      baseUrl: `http://127.0.0.1:${probePort}`,
      apiKey: 'sk-test-key',
    });

    expect(body.code).toBe(0);
    expect(body.data?.protocol).toBe('openai');
    expect(body.data?.models).toEqual([
      {
        modelId: 'gpt-x',
        contextWindow: 128_000,
        support_efforts: ['low', 'high'],
        off_effort: 'none',
      },
      { modelId: 'gpt-y' },
    ]);
  });

  it('degrades to unenriched models when the models.dev catalog is unavailable', async () => {
    setModelsDevUpstreamForTest({
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    const body = await discover(base, live(), {
      baseUrl: `http://127.0.0.1:${probePort}`,
      apiKey: 'sk-test-key',
    });

    expect(body.code).toBe(0);
    expect(body.data?.protocol).toBe('openai');
    expect(body.data?.models).toEqual([
      { modelId: 'gpt-x', contextWindow: 128_000 },
      { modelId: 'gpt-y' },
    ]);
  });

  it('maps an auth failure to VALIDATION_FAILED with an API Key message', async () => {
    const authServer = createServer((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
    });
    const listening = new Promise<void>((resolve) => {
      authServer.listen(0, '127.0.0.1', () => resolve());
    });
    await listening;
    const address = authServer.address();
    if (typeof address !== 'object' || address === null || !('port' in address)) {
      throw new Error('auth server did not expose a port');
    }
    try {
      const body = await discover(base, live(), {
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: 'sk-test-key',
      });
      expect(body.code).toBe(40001);
      expect(body.data).toBeNull();
      expect(body.msg).toContain('API Key');
    } finally {
      const closed = new Promise<void>((resolve) => {
        authServer.close(() => resolve());
      });
      await closed;
    }
  });

  it('maps a network failure to VALIDATION_FAILED with a connection message', async () => {
    const body = await discover(base, live(), {
      baseUrl: 'http://127.0.0.1:1',
      apiKey: 'sk-test-key',
    });

    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
    expect(body.msg).toContain('无法连接');
  });

  it('maps an empty model list to VALIDATION_FAILED with an empty-list message', async () => {
    const emptyServer = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [] }));
    });
    const listening = new Promise<void>((resolve) => {
      emptyServer.listen(0, '127.0.0.1', () => resolve());
    });
    await listening;
    const address = emptyServer.address();
    if (typeof address !== 'object' || address === null || !('port' in address)) {
      throw new Error('empty-list server did not expose a port');
    }
    try {
      const body = await discover(base, live(), {
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: 'sk-test-key',
      });
      expect(body.code).toBe(40001);
      expect(body.data).toBeNull();
      expect(body.msg).toContain('没有返回任何模型');
    } finally {
      const closed = new Promise<void>((resolve) => {
        emptyServer.close(() => resolve());
      });
      await closed;
    }
  });
});
