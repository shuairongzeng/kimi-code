import type { FastifyInstance } from 'fastify';
import type { Scope } from '@zimi-ai/agent-core-v2';
import { discoverProviderModels } from '@zimi-ai/agent-core-v2/app/importConfig/discovery';
import { z } from 'zod';

import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';

interface AgentDiscoverRouteHost {
  post(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
}

const discoverBodySchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  type: z
    .enum(['openai', 'anthropic', 'openai_responses', 'google-genai', 'vertexai', 'zimi'])
    .optional(),
});

const discoveredModelSchema = z.object({
  providerId: z.string().optional(),
  modelId: z.string(),
  contextWindow: z.number().optional(),
});

const discoverModelsResponseSchema = z.object({
  models: z.array(discoveredModelSchema),
});

function friendlyDiscoveryFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/\b401\b|unauthorized/i.test(message)) {
    return 'API Key 无效或端点拒绝访问';
  }
  if (
    /fetch failed|econnrefused|enotfound|etimedout|econnreset|econnaborted|eai_again|getaddrinfo|network|socket|timeout|timed out|aborted|refused|unreachable|dns|connect/i.test(
      message,
    )
  ) {
    return '无法连接到该端点';
  }
  return `无法获取该端点的模型列表：${message}`;
}

export function registerAgentDiscoverRoutes(app: FastifyInstance, core: Scope): void {
  const routeHost = app as unknown as AgentDiscoverRouteHost;
  const discoverRoute = defineRoute(
    {
      method: 'POST',
      path: '/agents/discover-models',
      body: discoverBodySchema,
      success: { data: discoverModelsResponseSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description:
        'Probe a provider endpoint for its available models without registering a provider or touching config (one-shot query)',
      tags: ['agents'],
      operationId: 'discoverAgentModels',
    },
    async (req, reply) => {
      const { baseUrl, apiKey, type } = req.body;
      try {
        const models = await discoverProviderModels([
          { id: 'discover-models', baseUrl, apiKey, type },
        ]);
        if (models.length === 0) {
          reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, '该端点没有返回任何模型', req.id));
          return;
        }
        reply.send(okEnvelope({ models }, req.id));
      } catch (err) {
        reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, friendlyDiscoveryFailure(err), req.id));
      }
    },
  );
  routeHost.post(
    discoverRoute.path,
    discoverRoute.options,
    discoverRoute.handler as Parameters<AgentDiscoverRouteHost['post']>[2],
  );
}
