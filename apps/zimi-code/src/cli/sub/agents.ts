/**
 * `zimi agents` sub-command — manage custom subagent profiles stored as
 * markdown files under `~/.zimi-code/agents/`. The engine's user agent
 * profile loader discovers these files and registers them so the main
 * agent can dispatch work to them via the task tool.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Command } from 'commander';

import {
  parseAgentFileText,
} from '@zimi-ai/agent-core-v2/workspace/workspaceAgentProfileLoader/internal/agentFile';
import {
  writeAgentFileText,
} from '@zimi-ai/agent-core-v2/workspace/workspaceAgentProfileLoader/internal/agentFileWriter';
import { leafWorkerDisallowedTools } from '@zimi-ai/agent-core-v2/app/agentProfileCatalog/profile-shared';

interface WritableLike {
  write(chunk: string): boolean;
}

export interface AgentsCommandDeps {
  readonly homeDir: string;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly exit: (code: number) => never;
}

interface AgentRow {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly model?: string;
  readonly thinking?: string;
  readonly path: string;
}

function agentsDir(homeDir: string): string {
  return join(homeDir, 'agents');
}

async function listAgentFiles(homeDir: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(agentsDir(homeDir), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function readAgentRows(deps: AgentsCommandDeps): Promise<readonly AgentRow[]> {
  const rows: AgentRow[] = [];
  for (const file of await listAgentFiles(deps.homeDir)) {
    const path = join(agentsDir(deps.homeDir), file);
    try {
      const text = await readFile(path, 'utf-8');
      const definition = parseAgentFileText({ path, source: 'user', text });
      rows.push({
        name: definition.name,
        description: definition.description,
        whenToUse: definition.whenToUse,
        model: definition.model,
        thinking: definition.thinking,
        path,
      });
    } catch (error) {
      deps.stderr.write(
        `warning: skipping ${file}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
  return rows;
}

export async function handleAgentsList(deps: AgentsCommandDeps): Promise<void> {
  const rows = await readAgentRows(deps);
  if (rows.length === 0) {
    deps.stdout.write(`No custom agents in ${agentsDir(deps.homeDir)}.\n`);
    return;
  }
  for (const row of rows) {
    deps.stdout.write(`${row.name}\n  ${row.description}\n`);
    if (row.whenToUse !== undefined) deps.stdout.write(`  when: ${row.whenToUse}\n`);
    if (row.model !== undefined || row.thinking !== undefined) {
      deps.stdout.write(`  model: ${row.model ?? 'inherit'}${row.thinking !== undefined ? ` thinking: ${row.thinking}` : ''}\n`);
    }
  }
}

interface AddOptions {
  readonly description?: string;
  readonly whenToUse?: string;
  readonly prompt?: string;
  readonly promptFile?: string;
  readonly force?: boolean;
  readonly delegate?: boolean;
  readonly model?: string;
  readonly thinking?: string;
}

export async function handleAgentsAdd(
  deps: AgentsCommandDeps,
  name: string,
  opts: AddOptions,
): Promise<void> {
  if (opts.description === undefined || opts.description.trim() === '') {
    deps.stderr.write('Missing required option --description.\n');
    deps.exit(1);
  }
  let prompt = opts.prompt;
  if (prompt === undefined && opts.promptFile !== undefined) {
    prompt = await readFile(opts.promptFile, 'utf-8');
  }
  if (prompt === undefined || prompt.trim() === '') {
    deps.stderr.write('Missing prompt: pass --prompt <text> or --prompt-file <path>.\n');
    deps.exit(1);
  }
  const target = join(agentsDir(deps.homeDir), `${name}.md`);
  let exists = false;
  try {
    await readFile(target);
    exists = true;
  } catch {
    exists = false;
  }
  if (exists && opts.force !== true) {
    deps.stderr.write(`Agent "${name}" already exists (${target}); use --force to overwrite.\n`);
    deps.exit(1);
  }
  const text = writeAgentFileText({
    name,
    description: opts.description.trim(),
    whenToUse: opts.whenToUse,
    disallowedTools: leafWorkerDisallowedTools(undefined, undefined, opts.delegate),
    model: opts.model,
    thinking: opts.thinking,
    prompt: prompt.trim(),
  });
  try {
    parseAgentFileText({ path: target, source: 'user', text });
  } catch (error) {
    deps.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    deps.exit(1);
  }
  await mkdir(agentsDir(deps.homeDir), { recursive: true });
  await writeFile(target, text, 'utf-8');
  deps.stdout.write(`Saved ${target}\n`);
}

export async function handleAgentsRemove(deps: AgentsCommandDeps, name: string): Promise<void> {
  const target = join(agentsDir(deps.homeDir), `${name}.md`);
  try {
    await rm(target);
  } catch {
    deps.stderr.write(`No custom agent "${name}" at ${target}.\n`);
    deps.exit(1);
  }
  deps.stdout.write(`Removed ${target}\n`);
}

export function registerAgentsCommand(parent: Command, getHomeDir: () => string): void {
  const cmd = parent
    .command('agents')
    .description('Manage custom subagent profiles (~/.zimi-code/agents/*.md).');

  const deps = (): AgentsCommandDeps => ({
    homeDir: getHomeDir(),
    stdout: process.stdout,
    stderr: process.stderr,
    exit: (code: number) => process.exit(code),
  });

  cmd
    .command('list')
    .description('List custom subagents.')
    .action(async () => {
      await handleAgentsList(deps());
    });

  cmd
    .command('add <name>')
    .description('Create or overwrite a custom subagent.')
    .requiredOption('--description <text>', 'One-line description shown to the main agent.')
    .option('--when-to-use <text>', 'Guidance for when the main agent should pick it.')
    .option('--prompt <text>', 'System prompt body for the subagent.')
    .option('--prompt-file <path>', 'Read the system prompt body from a file.')
    .option('--force', 'Overwrite an existing agent of the same name.', false)
    .option('--delegate', 'Allow this agent to launch further subagents (default: leaf worker).', false)
    .option('--model <alias>', 'Default model alias for this agent (e.g. zhipu/GLM-5.2).')
    .option('--thinking <level>', 'Reasoning effort for this agent (e.g. low, high, max).')
    .action(async (name: string, options: Record<string, unknown>) => {
      await handleAgentsAdd(deps(), name, {
        description: typeof options['description'] === 'string' ? options['description'] : undefined,
        whenToUse: typeof options['whenToUse'] === 'string' ? options['whenToUse'] : undefined,
        prompt: typeof options['prompt'] === 'string' ? options['prompt'] : undefined,
        promptFile: typeof options['promptFile'] === 'string' ? options['promptFile'] : undefined,
        force: options['force'] === true,
        delegate: options['delegate'] === true,
        model: typeof options['model'] === 'string' ? options['model'] : undefined,
        thinking: typeof options['thinking'] === 'string' ? options['thinking'] : undefined,
      });
    });

  cmd
    .command('remove <name>')
    .description('Delete a custom subagent file.')
    .action(async (name: string) => {
      await handleAgentsRemove(deps(), name);
    });
}
