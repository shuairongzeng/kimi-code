/**
 * `zimi agents` CLI unit tests. Handlers receive an injected homeDir plus
 * capturing stdout/stderr, so the full add/list/remove lifecycle is asserted
 * against a temporary directory without booting the engine.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  handleAgentsAdd,
  handleAgentsList,
  handleAgentsRemove,
  type AgentsCommandDeps,
} from '#/cli/sub/agents';

interface Captured {
  out: string;
  err: string;
  exitCode: number | undefined;
}

function makeDeps(homeDir: string): { deps: AgentsCommandDeps; captured: Captured } {
  const captured: Captured = { out: '', err: '', exitCode: undefined };
  const deps: AgentsCommandDeps = {
    homeDir,
    stdout: { write: (chunk: string) => ((captured.out += chunk), true) },
    stderr: { write: (chunk: string) => ((captured.err += chunk), true) },
    exit: (code: number) => {
      captured.exitCode = code;
      throw new Error(`exit:${code}`);
    },
  };
  return { deps, captured };
}

describe('zimi agents', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'zimi-agents-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('lists an empty agents directory', async () => {
    const { deps, captured } = makeDeps(home);
    await handleAgentsList(deps);
    expect(captured.out).toContain('No custom agents');
  });

  it('add writes a parseable agent file and list shows it', async () => {
    const { deps } = makeDeps(home);
    await handleAgentsAdd(deps, 'doc-writer', {
      description: 'Writes project documentation',
      whenToUse: 'When docs need updating',
      prompt: 'You write concise docs. 中文提示：保持简洁。',
    });
    const text = await readFile(join(home, 'agents', 'doc-writer.md'), 'utf-8');
    expect(text).toContain('name: doc-writer');
    expect(text).toContain('You write concise docs.');
    expect(text).toContain('- Agent');
    expect(text).toContain('- AgentSwarm');

    const { deps: listDeps, captured } = makeDeps(home);
    await handleAgentsList(listDeps);
    expect(captured.out).toContain('doc-writer');
    expect(captured.out).toContain('Writes project documentation');
    expect(captured.out).toContain('When docs need updating');
  });

  it('add writes model and thinking into the agent file', async () => {
    const { deps } = makeDeps(home);
    await handleAgentsAdd(deps, 'thinker', {
      description: 'Reasons hard',
      model: 'provider/deep-thinker',
      thinking: 'max',
      prompt: 'Think deeply.',
    });
    const text = await readFile(join(home, 'agents', 'thinker.md'), 'utf-8');
    expect(text).toContain('model: provider/deep-thinker');
    expect(text).toContain('thinking: max');

    const { deps: listDeps, captured } = makeDeps(home);
    await handleAgentsList(listDeps);
    expect(captured.out).toContain('thinker');
  });

  it('add refuses to overwrite without --force', async () => {
    const { deps } = makeDeps(home);
    await handleAgentsAdd(deps, 'dup', { description: 'first', prompt: 'body one' });
    const { deps: second, captured } = makeDeps(home);
    await expect(
      handleAgentsAdd(second, 'dup', { description: 'second', prompt: 'body two' }),
    ).rejects.toThrow('exit:1');
    expect(captured.err).toContain('already exists');
    const text = await readFile(join(home, 'agents', 'dup.md'), 'utf-8');
    expect(text).toContain('body one');
  });

  it('add with --force overwrites', async () => {
    const { deps } = makeDeps(home);
    await handleAgentsAdd(deps, 'dup', { description: 'first', prompt: 'body one' });
    await handleAgentsAdd(deps, 'dup', {
      description: 'second',
      prompt: 'body two',
      force: true,
    });
    const text = await readFile(join(home, 'agents', 'dup.md'), 'utf-8');
    expect(text).toContain('body two');
    expect(text).not.toContain('body one');
  });

  it('add rejects an invalid name via the engine parser', async () => {
    const { deps, captured } = makeDeps(home);
    await expect(
      handleAgentsAdd(deps, 'Bad_Name', { description: 'x', prompt: 'body' }),
    ).rejects.toThrow('exit:1');
    expect(captured.err).toContain('kebab-case');
  });

  it('add requires a prompt', async () => {
    const { deps, captured } = makeDeps(home);
    await expect(
      handleAgentsAdd(deps, 'no-prompt', { description: 'x' }),
    ).rejects.toThrow('exit:1');
    expect(captured.err).toContain('Missing prompt');
  });

  it('remove deletes the file and reports missing names', async () => {
    const { deps } = makeDeps(home);
    await handleAgentsAdd(deps, 'gone', { description: 'x', prompt: 'body' });
    await handleAgentsRemove(deps, 'gone');
    const { deps: listDeps, captured } = makeDeps(home);
    await handleAgentsList(listDeps);
    expect(captured.out).toContain('No custom agents');

    const { deps: rmDeps, captured: rmCaptured } = makeDeps(home);
    await expect(handleAgentsRemove(rmDeps, 'ghost')).rejects.toThrow('exit:1');
    expect(rmCaptured.err).toContain('No custom agent');
  });

  it('list warns on a corrupt agent file but keeps the rest', async () => {
    const { deps } = makeDeps(home);
    await handleAgentsAdd(deps, 'good', { description: 'x', prompt: 'body' });
    await mkdir(join(home, 'agents'), { recursive: true });
    await writeFile(join(home, 'agents', 'broken.md'), 'no frontmatter here\n', 'utf-8');
    const { deps: listDeps, captured } = makeDeps(home);
    await handleAgentsList(listDeps);
    expect(captured.out).toContain('good');
    expect(captured.err).toContain('broken.md');
  });
});
