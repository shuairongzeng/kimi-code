import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
  providerId?: string;
  modelId: string;
  contextWindow?: number;
}

const discoveryMock = vi.hoisted(() => ({
  discoverProviderModels: vi.fn(),
}));

vi.mock('@zimi-ai/agent-core-v2/app/importConfig/discovery', () => ({
  discoverProviderModels: discoveryMock.discoverProviderModels,
}));

const VALID_BODY = {
  baseUrl: 'https://gateway.example/v1',
  apiKey: 'sk-test-key',
  type: 'openai',
};

async function discover(
  base: string,
  server: RunningServer,
  body: unknown = VALID_BODY,
): Promise<Envelope<{ models: DiscoveredModel[] }>> {
  const res = await fetch(`${base}/api/v1/agents/discover-models`, {
    method: 'POST',
    headers: authHeaders(server, { 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Envelope<{ models: DiscoveredModel[] }>;
}

describe('server-v2 /api/v1 agents discover-models', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let base: string;

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
    discoveryMock.discoverProviderModels.mockReset();
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
  });

  function live(): RunningServer {
    if (server === undefined) throw new Error('server not started');
    return server;
  }

  it('returns discovered models as-is on success', async () => {
    const models: DiscoveredModel[] = [
      { modelId: 'gpt-x', contextWindow: 128_000 },
      { modelId: 'claude-3-7' },
    ];
    discoveryMock.discoverProviderModels.mockResolvedValueOnce(models);

    const body = await discover(base, live());

    expect(body.code).toBe(0);
    expect(body.data?.models).toEqual(models);
    expect(discoveryMock.discoverProviderModels).toHaveBeenCalledTimes(1);
    expect(discoveryMock.discoverProviderModels).toHaveBeenCalledWith([
      { id: 'discover-models', ...VALID_BODY },
    ]);
  });

  it('maps a 401-style error to VALIDATION_FAILED with an API Key message', async () => {
    discoveryMock.discoverProviderModels.mockRejectedValueOnce(
      new Error('401 Unauthorized'),
    );

    const body = await discover(base, live());

    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
    expect(body.msg).toContain('API Key');
  });

  it('maps a network error to VALIDATION_FAILED with a connection message', async () => {
    discoveryMock.discoverProviderModels.mockRejectedValueOnce(
      new Error('fetch failed'),
    );

    const body = await discover(base, live());

    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
    expect(body.msg).toContain('无法连接');
  });

  it('maps an empty model list to VALIDATION_FAILED with an empty-list message', async () => {
    discoveryMock.discoverProviderModels.mockResolvedValueOnce([]);

    const body = await discover(base, live());

    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
    expect(body.msg).toContain('没有返回任何模型');
  });
});
