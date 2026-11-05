import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type RunningServer, startServer } from '../src/start';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';
import { authHeaders } from './helpers/auth';

interface Envelope<T> {
  code: number;
  msg: string;
  data: T;
  request_id: string;
}

interface AgentView {
  name: string;
  description: string;
  whenToUse?: string;
  tools?: string[];
  disallowedTools?: string[];
  subagents?: string[];
  model?: string;
  thinking?: string;
  prompt: string;
  path?: string;
  source: string;
}

describe('server-v2 /api/v1 agents', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let base: string;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'zimi-server-v2-agents-'));
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

  async function listAgents(): Promise<AgentView[]> {
    const res = await fetch(`${base}/api/v1/agents`, { headers: authHeaders(live()) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<{ agents: AgentView[] }>;
    return body.data.agents;
  }

  it('creates, lists, updates and deletes a custom agent', async () => {
    const create = await fetch(`${base}/api/v1/agents`, {
      method: 'POST',
      headers: authHeaders(live(), { 'content-type': 'application/json' }),
      body: JSON.stringify({
        name: 'doc-writer',
        description: 'Writes project documentation',
        whenToUse: 'When docs need updating',
        tools: ['Read', 'Edit'],
        prompt: 'You write concise docs. 中文提示：保持简洁。',
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as Envelope<AgentView>;
    expect(created.data.name).toBe('doc-writer');
    expect(created.data.tools).toEqual(['Read', 'Edit']);
    expect(created.data.disallowedTools).toBeUndefined();

    const leaf = await fetch(`${base}/api/v1/agents`, {
      method: 'POST',
      headers: authHeaders(live(), { 'content-type': 'application/json' }),
      body: JSON.stringify({
        name: 'leaf-worker',
        description: 'Unrestricted tools but leaf by default',
        prompt: 'Do the work.',
      }),
    });
    expect(leaf.status).toBe(201);
    const leafView = (await leaf.json()) as Envelope<AgentView>;
    expect(leafView.data.disallowedTools).toEqual(expect.arrayContaining(['Agent', 'AgentSwarm']));

    const delegating = await fetch(`${base}/api/v1/agents`, {
      method: 'POST',
      headers: authHeaders(live(), { 'content-type': 'application/json' }),
      body: JSON.stringify({
        name: 'orchestrator',
        description: 'Delegates to other agents',
        delegate: true,
        prompt: 'Coordinate subagents.',
      }),
    });
    expect(delegating.status).toBe(201);
    const delegated = (await delegating.json()) as Envelope<AgentView>;
    expect(delegated.data.disallowedTools).toBeUndefined();

    let agents = await listAgents();
    const row = agents.find((agent) => agent.name === 'doc-writer');
    expect(row).toBeDefined();
    expect(row?.description).toBe('Writes project documentation');
    expect(row?.whenToUse).toBe('When docs need updating');
    expect(row?.prompt).toContain('中文提示：保持简洁。');
    expect(row?.source).toBe('user');

    const update = await fetch(`${base}/api/v1/agents/doc-writer`, {
      method: 'PUT',
      headers: authHeaders(live(), { 'content-type': 'application/json' }),
      body: JSON.stringify({
        name: 'doc-writer',
        description: 'Writes project documentation',
        prompt: 'Updated prompt body.',
      }),
    });
    expect(update.status).toBe(200);
    agents = await listAgents();
    const updated = agents.find((agent) => agent.name === 'doc-writer');
    expect(updated?.prompt).toBe('Updated prompt body.');
    expect(updated?.whenToUse).toBeUndefined();
    expect(updated?.tools).toBeUndefined();

    const removed = await fetch(`${base}/api/v1/agents/doc-writer`, {
      method: 'DELETE',
      headers: authHeaders(live()),
    });
    expect(removed.status).toBe(200);
    await fetch(`${base}/api/v1/agents/orchestrator`, {
      method: 'DELETE',
      headers: authHeaders(live()),
    });
    await fetch(`${base}/api/v1/agents/leaf-worker`, {
      method: 'DELETE',
      headers: authHeaders(live()),
    });
    agents = await listAgents();
    expect(agents.find((agent) => agent.name === 'doc-writer')).toBeUndefined();
  });

  it('round-trips model and thinking fields', async () => {
    const create = await fetch(`${base}/api/v1/agents`, {
      method: 'POST',
      headers: authHeaders(live(), { 'content-type': 'application/json' }),
      body: JSON.stringify({
        name: 'thinker',
        description: 'Reasons hard',
        model: 'provider/deep-thinker',
        thinking: 'max',
        prompt: 'Think deeply.',
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as Envelope<AgentView>;
    expect(created.data.model).toBe('provider/deep-thinker');
    expect(created.data.thinking).toBe('max');

    const listed = await listAgents();
    const thinker = listed.find((agent) => agent.name === 'thinker');
    expect(thinker?.model).toBe('provider/deep-thinker');
    expect(thinker?.thinking).toBe('max');
  });

  it('rejects an invalid agent name', async () => {
    const res = await fetch(`${base}/api/v1/agents`, {
      method: 'POST',
      headers: authHeaders(live(), { 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'Bad_Name', description: 'x', prompt: 'body' }),
    });
    const body = (await res.json()) as Envelope<null>;
    expect(body.code).not.toBe(0);
    const agents = await listAgents();
    expect(agents.find((agent) => agent.name === 'Bad_Name')).toBeUndefined();
  });

  it('rejects a missing prompt', async () => {
    const res = await fetch(`${base}/api/v1/agents`, {
      method: 'POST',
      headers: authHeaders(live(), { 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'no-prompt', description: 'x' }),
    });
    const body = (await res.json()) as Envelope<null>;
    expect(body.code).not.toBe(0);
  });

  it('refuses to modify a builtin profile', async () => {
    const res = await fetch(`${base}/api/v1/agents/coder`, {
      method: 'PUT',
      headers: authHeaders(live(), { 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'coder', description: 'x', prompt: 'body' }),
    });
    const body = (await res.json()) as Envelope<null>;
    expect(body.code).not.toBe(0);
  });

  it('lists builtin profiles alongside custom ones', async () => {
    const agents = await listAgents();
    expect(agents.some((agent) => agent.name === 'coder')).toBe(true);
  });
});
