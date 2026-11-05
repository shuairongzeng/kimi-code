import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerAgentToolOptionsRoutes } from '../src/routes/agentsToolOptions';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';
import { type RunningServer, startServer } from '../src/start';

interface Envelope<T> {
  code: number;
  msg: string;
  data: T;
  request_id: string;
}

interface AgentToolOption {
  name: string;
  description: string;
}

describe('server-v2 /api/v1 agents tool-options', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let app: FastifyInstance | undefined;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'zimi-server-v2-agent-tool-options-'));
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
    });
    app = Fastify();
    await app.register(
      async (apiV1) => {
        registerAgentToolOptionsRoutes(
          apiV1 as unknown as Parameters<typeof registerAgentToolOptionsRoutes>[0],
          (server as RunningServer).core,
        );
      },
      { prefix: '/api/v1' },
    );
    await app.ready();
  });

  afterAll(async () => {
    if (app !== undefined) {
      await app.close();
      app = undefined;
    }
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  it('lists builtin tool names and descriptions sorted by name', async () => {
    const res = await (app as FastifyInstance).inject({
      method: 'GET',
      url: '/api/v1/agents/tool-options',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Envelope<{ tools: AgentToolOption[] }>;
    expect(body.code).toBe(0);
    const tools = body.data.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.map((tool) => tool.name)).toContain('Bash');
    expect(tools.map((tool) => tool.name)).toContain('Read');
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
    }
    const names = tools.map((tool) => tool.name);
    const sorted = names.toSorted((left, right) => left.localeCompare(right));
    expect(names).toEqual(sorted);
  });
});
