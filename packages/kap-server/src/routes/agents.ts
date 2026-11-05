import {
  BUILTIN_AGENT_PROFILE_SOURCE_ID,
  IAgentProfileRegistry,
  IBootstrapService,
  IHostFileSystem,
  IWorkspaceInstanceManager,
  parseAgentFileText,
  type Scope,
} from '@zimi-ai/agent-core-v2';
import { writeAgentFileText } from '@zimi-ai/agent-core-v2/workspace/workspaceAgentProfileLoader/internal/agentFileWriter';
import { leafWorkerDisallowedTools } from '@zimi-ai/agent-core-v2/app/agentProfileCatalog/profile-shared';
import { join } from 'node:path';
import { z } from 'zod';

import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';

interface AgentRouteHost {
  get(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  post(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  put(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  delete(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
}

interface StatusReply {
  code(status: number): StatusReply;
  send(payload?: unknown): unknown;
}

const AGENT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const agentNameParamSchema = z.object({
  name: z.string().regex(AGENT_NAME_PATTERN),
});

const stringListSchema = z.array(z.string().min(1));

const agentBodySchema = z.object({
  name: z.string().regex(AGENT_NAME_PATTERN),
  description: z.string().min(1),
  whenToUse: z.string().min(1).optional(),
  tools: stringListSchema.optional(),
  disallowedTools: stringListSchema.optional(),
  subagents: stringListSchema.optional(),
  delegate: z.boolean().optional(),
  model: z.string().min(1).optional(),
  thinking: z.string().min(1).optional(),
  prompt: z.string().min(1),
});

type AgentBody = z.infer<typeof agentBodySchema>;

const agentViewSchema = z.object({
  name: z.string(),
  description: z.string(),
  whenToUse: z.string().optional(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  subagents: z.array(z.string()).optional(),
  model: z.string().optional(),
  thinking: z.string().optional(),
  prompt: z.string(),
  path: z.string().optional(),
  source: z.string(),
});

interface AgentView {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly tools?: readonly string[];
  readonly disallowedTools?: readonly string[];
  readonly subagents?: readonly string[];
  readonly model?: string;
  readonly thinking?: string;
  readonly prompt: string;
  readonly path?: string;
  readonly source: string;
}

async function pathExists(fs: IHostFileSystem, path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

function userAgentsDir(bootstrap: IBootstrapService): string {
  return join(bootstrap.homeDir, 'agents');
}

function userAgentFile(bootstrap: IBootstrapService, name: string): string {
  return join(userAgentsDir(bootstrap), `${name}.md`);
}

async function listUserAgentFiles(
  fs: IHostFileSystem,
  bootstrap: IBootstrapService,
): Promise<readonly string[]> {
  const dir = userAgentsDir(bootstrap);
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((entry) => entry.isFile && entry.name.endsWith('.md'))
      .map((entry) => join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function toAgentView(path: string, text: string): AgentView | undefined {
  try {
    const definition = parseAgentFileText({ path, source: 'user', text });
    return {
      name: definition.name,
      description: definition.description,
      whenToUse: definition.whenToUse,
      tools: definition.tools,
      disallowedTools: definition.disallowedTools,
      subagents: definition.subagents,
      model: definition.model,
      thinking: definition.thinking,
      prompt: definition.prompt,
      path,
      source: 'user',
    };
  } catch {
    return undefined;
  }
}

async function collectAgentViews(
  core: Scope,
  fs: IHostFileSystem,
  bootstrap: IBootstrapService,
): Promise<AgentView[]> {
  const views: AgentView[] = [];
  const seen = new Set<string>();
  for (const path of await listUserAgentFiles(fs, bootstrap)) {
    const text = await fs.readText(path).catch(() => undefined);
    if (text === undefined) continue;
    const view = toAgentView(path, text);
    if (view === undefined) continue;
    seen.add(view.name);
    views.push(view);
  }
  const registry = core.accessor.get(IAgentProfileRegistry);
  for (const entry of registry.entries()) {
    for (const profile of entry.contribution.profiles) {
      if (seen.has(profile.name)) continue;
      if (entry.sourceId === 'user') continue;
      seen.add(profile.name);
      views.push({
        name: profile.name,
        description: profile.description ?? '',
        whenToUse: profile.whenToUse,
        tools: profile.tools,
        disallowedTools: profile.disallowedTools,
        subagents: profile.subagents,
        prompt: profile.systemPrompt({}),
        source: entry.sourceId,
      });
    }
  }
  return views.toSorted((a, b) => a.name.localeCompare(b.name));
}

async function reloadUserAgentProfiles(core: Scope): Promise<void> {
  for (const instance of core.accessor.get(IWorkspaceInstanceManager).list()) {
    await instance.program.reload().catch(() => undefined);
  }
}

function findBuiltinProfile(core: Scope, name: string): boolean {
  return core
    .accessor.get(IAgentProfileRegistry)
    .entries()
    .some(
      (entry) =>
        entry.sourceId === BUILTIN_AGENT_PROFILE_SOURCE_ID &&
        entry.contribution.profiles.some((profile) => profile.name === name),
    );
}

async function writeAgentFile(
  core: Scope,
  fs: IHostFileSystem,
  bootstrap: IBootstrapService,
  name: string,
  body: AgentBody,
  requestId: string,
  reply: { send(payload: unknown): unknown },
  created: boolean,
): Promise<void> {
  if (findBuiltinProfile(core, name)) {
    reply.send(
      errEnvelope(
        ErrorCode.PROMPT_ID_CONFLICT,
        `agent ${name} is a builtin profile and cannot be modified`,
        requestId,
      ),
    );
    return;
  }
  const target = userAgentFile(bootstrap, name);
  const disallowedTools = leafWorkerDisallowedTools(body.tools, body.disallowedTools, body.delegate);
  const text = writeAgentFileText({
    name,
    description: body.description,
    whenToUse: body.whenToUse,
    tools: body.tools,
    disallowedTools,
    subagents: body.subagents,
    model: body.model,
    thinking: body.thinking,
    prompt: body.prompt,
  });
  try {
    parseAgentFileText({ path: target, source: 'user', text });
  } catch (error) {
    reply.send(
      errEnvelope(
        ErrorCode.VALIDATION_FAILED,
        error instanceof Error ? error.message : String(error),
        requestId,
      ),
    );
    return;
  }
  await fs.mkdir(userAgentsDir(bootstrap), { recursive: true });
  const temporary = `${target}.tmp`;
  await fs.writeText(temporary, text);
  const rename = fs.rename;
  if (rename !== undefined) {
    await rename(temporary, target);
  } else {
    await fs.writeText(target, text);
    await fs.remove(temporary).catch(() => undefined);
  }
  await reloadUserAgentProfiles(core);
  const view = toAgentView(target, await fs.readText(target));
  if (view === undefined) {
    reply.send(
      errEnvelope(ErrorCode.INTERNAL_ERROR, `agent ${name} could not be read back`, requestId),
    );
    return;
  }
  if (created) {
    (reply as unknown as StatusReply).code(201);
  }
  reply.send(okEnvelope(view, requestId));
}

export function registerAgentRoutes(app: AgentRouteHost, core: Scope): void {
  const listRoute = defineRoute(
    {
      method: 'GET',
      path: '/agents',
      success: { data: z.object({ agents: z.array(agentViewSchema) }) },
      description:
        'List agent profiles: custom user agents from ~/.zimi-code/agents plus builtin profiles',
      tags: ['agents'],
      operationId: 'listAgents',
    },
    async (req, reply) => {
      const bootstrap = core.accessor.get(IBootstrapService);
      const views = await collectAgentViews(core, core.accessor.get(IHostFileSystem), bootstrap);
      reply.send(okEnvelope({ agents: views }, req.id));
    },
  );
  app.get(
    listRoute.path,
    listRoute.options,
    listRoute.handler as Parameters<AgentRouteHost['get']>[2],
  );

  const createRoute = defineRoute(
    {
      method: 'POST',
      path: '/agents',
      body: agentBodySchema,
      success: { data: agentViewSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
        [ErrorCode.PROMPT_ID_CONFLICT]: {},
      },
      description: 'Create a custom subagent profile stored at ~/.zimi-code/agents/<name>.md',
      tags: ['agents'],
      operationId: 'createAgent',
    },
    async (req, reply) => {
      const body = req.body as AgentBody;
      const bootstrap = core.accessor.get(IBootstrapService);
      const fs = core.accessor.get(IHostFileSystem);
      const target = userAgentFile(bootstrap, body.name);
      if (await pathExists(fs, target)) {
        reply.send(
          errEnvelope(
            ErrorCode.PROMPT_ID_CONFLICT,
            `agent ${body.name} already exists at ${target}`,
            req.id,
          ),
        );
        return;
      }
      await writeAgentFile(core, fs, bootstrap, body.name, body, req.id, reply, true);
    },
  );
  app.post(
    createRoute.path,
    createRoute.options,
    createRoute.handler as Parameters<AgentRouteHost['post']>[2],
  );

  const updateRoute = defineRoute(
    {
      method: 'PUT',
      path: '/agents/{name}',
      params: agentNameParamSchema,
      body: agentBodySchema.omit({ name: true }),
      success: { data: agentViewSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
        [ErrorCode.PROMPT_ID_CONFLICT]: {},
        [ErrorCode.PROMPT_NOT_FOUND]: {},
      },
      description: 'Replace a custom subagent profile at ~/.zimi-code/agents/<name>.md',
      tags: ['agents'],
      operationId: 'replaceAgent',
    },
    async (req, reply) => {
      const { name } = req.params as z.infer<typeof agentNameParamSchema>;
      const body = req.body as Omit<AgentBody, 'name'>;
      const bootstrap = core.accessor.get(IBootstrapService);
      const fs = core.accessor.get(IHostFileSystem);
      const target = userAgentFile(bootstrap, name);
      if (!(await pathExists(fs, target))) {
        reply.send(
          errEnvelope(
            ErrorCode.PROMPT_NOT_FOUND,
            `agent ${name} does not exist at ${target}`,
            req.id,
          ),
        );
        return;
      }
      await writeAgentFile(
        core,
        fs,
        bootstrap,
        name,
        { ...body, name },
        req.id,
        reply,
        false,
      );
    },
  );
  app.put(
    updateRoute.path,
    updateRoute.options,
    updateRoute.handler as Parameters<AgentRouteHost['put']>[2],
  );

  const deleteRoute = defineRoute(
    {
      method: 'DELETE',
      path: '/agents/{name}',
      params: agentNameParamSchema,
      success: { data: z.object({}) },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
        [ErrorCode.PROMPT_NOT_FOUND]: {},
      },
      description: 'Delete a custom subagent profile at ~/.zimi-code/agents/<name>.md',
      tags: ['agents'],
      operationId: 'deleteAgent',
    },
    async (req, reply) => {
      const { name } = req.params as z.infer<typeof agentNameParamSchema>;
      const bootstrap = core.accessor.get(IBootstrapService);
      const fs = core.accessor.get(IHostFileSystem);
      const target = userAgentFile(bootstrap, name);
      if (!(await pathExists(fs, target))) {
        reply.send(
          errEnvelope(
            ErrorCode.PROMPT_NOT_FOUND,
            `agent ${name} does not exist at ${target}`,
            req.id,
          ),
        );
        return;
      }
      await fs.remove(target);
      await reloadUserAgentProfiles(core);
      reply.send(okEnvelope({}, req.id));
    },
  );
  app.delete(
    deleteRoute.path,
    deleteRoute.options,
    deleteRoute.handler as Parameters<AgentRouteHost['delete']>[2],
  );
}
