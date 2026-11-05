import {
  getAgentToolContributions,
  type AgentToolCtor,
} from '@zimi-ai/agent-core-v2/agent/toolRegistry/toolContribution';
import { type Scope } from '@zimi-ai/agent-core-v2';
import { z } from 'zod';

import { okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';

interface AgentToolOptionsRouteHost {
  get(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (req: { id: string }, reply: { send(payload: unknown): unknown }) => unknown,
  ): unknown;
}

const agentToolOptionSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
});

export type AgentToolOption = z.infer<typeof agentToolOptionSchema>;

const agentToolOptionsResponseSchema = z.object({
  tools: z.array(agentToolOptionSchema),
});

function listAgentToolOptions(): AgentToolOption[] {
  const byName = new Map<string, AgentToolOption>();
  for (const contribution of getAgentToolContributions()) {
    const name = contribution.options.name;
    const description = readToolDescription(contribution.ctor);
    byName.set(name, { name, description });
  }
  return [...byName.values()].toSorted((left, right) => left.name.localeCompare(right.name));
}

function readToolDescription(ctor: AgentToolCtor): string {
  try {
    const instance = Object.create(ctor.prototype);
    const description = Reflect.get(instance, 'description');
    return typeof description === 'string' ? description : '';
  } catch {
    return '';
  }
}

export function registerAgentToolOptionsRoutes(app: AgentToolOptionsRouteHost, _core: Scope): void {
  const listRoute = defineRoute(
    {
      method: 'GET',
      path: '/agents/tool-options',
      success: { data: agentToolOptionsResponseSchema },
      description: 'List builtin agent tool names and descriptions for selection lists',
      tags: ['agents'],
      operationId: 'listAgentToolOptions',
    },
    async (req, reply) => {
      reply.send(okEnvelope({ tools: listAgentToolOptions() }, req.id));
    },
  );
  app.get(
    listRoute.path,
    listRoute.options,
    listRoute.handler as Parameters<AgentToolOptionsRouteHost['get']>[2],
  );
}
