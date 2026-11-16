import type { FastifyInstance } from 'fastify';
import type { Scope } from '@zimi-ai/agent-core-v2';
import {
  discoverEndpoint,
  enrichDiscoveredModels,
} from '@zimi-ai/agent-core-v2/app/importConfig/endpointDiscovery';
import { IAgentIdentity } from '@zimi-ai/agent-core-v2';
import { getModelsDevCatalog } from '@zimi-ai/agent-core-v2/app/kosongConfig/modelsDevUpstream';
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
  support_efforts: z.array(z.string()).optional(),
  off_effort: z.string().optional(),
});

const discoverModelsResponseSchema = z.object({
  models: z.array(discoveredModelSchema),
  protocol: z
    .enum(['anthropic', 'openai', 'openai_responses', 'google-genai'])
    .nullable(),
});

function hostOfUrl(raw: string): string | undefined {
  try {
    const hostname = new URL(raw).hostname;
    return hostname.length > 0 ? hostname : undefined;
  } catch {
    return undefined;
  }
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
      const probe = await discoverEndpoint({ baseUrl, apiKey, type });
      if (!probe.ok) {
        reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, probe.message, req.id));
        return;
      }
      const userAgent = (await core.accessor.get(IAgentIdentity).resolved()).outboundUserAgent;
      const catalog = await getModelsDevCatalog(userAgent).catch(() => undefined);
      const models =
        catalog !== undefined
          ? enrichDiscoveredModels(probe.models, catalog, {
              protocol: probe.protocol,
              providerHost: hostOfUrl(baseUrl),
            })
          : probe.models;
      reply.send(
        okEnvelope(
          {
            models: models.map((entry) => ({
              modelId: entry.modelId,
              contextWindow: entry.contextWindow,
              support_efforts: entry.supportEfforts,
              off_effort: entry.offEffort,
            })),
            protocol: probe.protocol ?? null,
          },
          req.id,
        ),
      );
    },
  );
  routeHost.post(
    discoverRoute.path,
    discoverRoute.options,
    discoverRoute.handler as Parameters<AgentDiscoverRouteHost['post']>[2],
  );
}
