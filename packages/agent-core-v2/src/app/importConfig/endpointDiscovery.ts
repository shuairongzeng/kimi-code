import { modelsDevModelToCapability, type ModelsDevCatalog, type ModelsDevModel } from '#/app/kosongConfig/modelsDev';
import { ProtocolSchema, type Protocol } from '#/llm-adapter/protocol/protocol';
import { getProviderDefinitions } from '#/llm-adapter/provider/provider-definition';

import { ANTHROPIC_VERSION, parseModelEntries, resolveKey, type DiscoveryOptions } from './discovery';

const DEFAULT_TIMEOUT_MS = 3000;
const TOTAL_BUDGET_MS = 8000;

export type EndpointProbeShape = 'anthropic-models' | 'openai-list' | 'openai-data-array' | 'bare-array';

export type EndpointConfidence = 'explicit' | 'strong' | 'weak';

export interface EndpointProbeEvidence {
  readonly url: string;
  readonly shape: EndpointProbeShape;
}

export interface DiscoveredModelEntry {
  readonly modelId: string;
  readonly contextWindow?: number;
  readonly supportEfforts?: string[];
  readonly offEffort?: string;
}

export interface EndpointDiscoveryTarget {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
  readonly type?: string;
}

export type EndpointDiscoveryResult =
  | {
      readonly ok: true;
      readonly protocol: Protocol | undefined;
      readonly confidence: EndpointConfidence;
      readonly models: DiscoveredModelEntry[];
      readonly evidence: EndpointProbeEvidence | undefined;
    }
  | {
      readonly ok: false;
      readonly reason: 'network' | 'auth' | 'empty';
      readonly message: string;
    };

export interface EnrichDiscoveredModelsOptions {
  readonly protocol?: Protocol;
  readonly providerHost?: string;
}

const SHAPE_INFO: Record<
  EndpointProbeShape,
  { readonly protocol: Protocol | undefined; readonly confidence: EndpointConfidence }
> = {
  'anthropic-models': { protocol: 'anthropic', confidence: 'strong' },
  'openai-list': { protocol: 'openai', confidence: 'strong' },
  'openai-data-array': { protocol: 'openai', confidence: 'weak' },
  'bare-array': { protocol: undefined, confidence: 'weak' },
};

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function buildProbeCandidates(baseUrl: string): string[] {
  const sanitized = sanitizeUrl(baseUrl);
  const root = sanitized.endsWith('/') ? sanitized.slice(0, -1) : sanitized;
  if (root.endsWith('/v1')) return [`${root}/models`];
  return [`${root}/models`, `${root}/v1/models`];
}

function classifyShape(body: unknown): EndpointProbeShape {
  if (typeof body !== 'object' || body === null) return 'openai-data-array';
  const entries: readonly unknown[] = Array.isArray(body)
    ? body
    : 'data' in body && Array.isArray(body.data)
      ? body.data
      : [];
  const entryFieldMatches = (key: string, value: string): boolean =>
    entries.some((entry) => {
      if (typeof entry !== 'object' || entry === null) return false;
      return (entry as Record<string, unknown>)[key] === value;
    });
  if (entryFieldMatches('type', 'model') || 'has_more' in body) return 'anthropic-models';
  if (('object' in body && body.object === 'list') || entryFieldMatches('object', 'model')) {
    return 'openai-list';
  }
  if (Array.isArray(body)) return 'bare-array';
  return 'openai-data-array';
}

function resolveExplicitProtocol(type: string | undefined): Protocol | undefined {
  if (type === undefined) return undefined;
  const parsed = ProtocolSchema.safeParse(type);
  if (parsed.success) return parsed.data;
  const definitions = getProviderDefinitions(type);
  if (definitions.length === 1) return definitions[0]?.baseProtocol;
  return undefined;
}

export async function discoverEndpoint(
  provider: EndpointDiscoveryTarget,
  options: DiscoveryOptions = {},
): Promise<EndpointDiscoveryResult> {
  if (provider.baseUrl.length === 0) {
    return { ok: false, reason: 'network', message: '端点地址为空' };
  }
  const explicitProtocol = resolveExplicitProtocol(provider.type);
  const key = resolveKey(provider);
  const candidates = buildProbeCandidates(provider.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const perRequestMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  let attempted = 0;
  let emptyHits = 0;
  let authUrl: string | undefined;

  for (const url of candidates) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remaining <= 0) {
      return { ok: false, reason: 'network', message: '端点探测超时，请稍后重试' };
    }
    attempted++;
    const headers: Record<string, string> = { 'anthropic-version': ANTHROPIC_VERSION };
    if (key !== undefined) {
      headers['x-api-key'] = key;
      headers['Authorization'] = `Bearer ${key}`;
    }
    let response: Response;
    try {
      response = await fetchImpl(
        new Request(url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(Math.min(perRequestMs, remaining)),
        }),
      );
    } catch {
      continue;
    }
    if (response.status === 401) {
      authUrl ??= url;
      continue;
    }
    if (!response.ok) continue;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      continue;
    }
    const entries = parseModelEntries(body);
    if (entries.length === 0) {
      emptyHits++;
      continue;
    }
    const shape = classifyShape(body);
    const info = SHAPE_INFO[shape];
    return {
      ok: true,
      protocol: explicitProtocol ?? info.protocol,
      confidence: explicitProtocol !== undefined ? 'explicit' : info.confidence,
      models: entries.map((entry) => ({
        modelId: entry.id,
        ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
      })),
      evidence: explicitProtocol !== undefined ? undefined : { url, shape },
    };
  }

  if (attempted > 0 && emptyHits === attempted) {
    return { ok: false, reason: 'empty', message: '该端点没有返回任何模型' };
  }
  if (authUrl !== undefined) {
    return {
      ok: false,
      reason: 'auth',
      message: `API Key 无效或端点拒绝访问：${authUrl}`,
    };
  }
  return { ok: false, reason: 'network', message: '无法连接到该端点，请检查网络或地址是否可达' };
}

function hostOf(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const hostname = new URL(withScheme).hostname;
    return hostname.length > 0 ? hostname : undefined;
  } catch {
    return undefined;
  }
}

interface CatalogIndex {
  readonly global: ReadonlyMap<string, ModelsDevModel>;
  readonly byHost: ReadonlyMap<string, ReadonlyMap<string, ModelsDevModel>>;
}

function buildCatalogIndex(catalog: ModelsDevCatalog): CatalogIndex {
  const global = new Map<string, ModelsDevModel>();
  const byHost = new Map<string, Map<string, ModelsDevModel>>();
  for (const entry of Object.values(catalog)) {
    const modelsById = new Map<string, ModelsDevModel>();
    for (const [key, raw] of Object.entries(entry.models ?? {})) {
      const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : key;
      if (modelsById.has(id)) continue;
      const model = modelsDevModelToCapability(raw);
      if (model === undefined) continue;
      modelsById.set(id, model);
      if (!global.has(id)) global.set(id, model);
    }
    if (modelsById.size === 0) continue;
    const api = entry.api;
    const host = typeof api === 'string' && !api.includes('${') ? hostOf(api) : undefined;
    if (host === undefined) continue;
    const existing = byHost.get(host);
    if (existing === undefined) {
      byHost.set(host, modelsById);
    } else {
      for (const [id, model] of modelsById) {
        if (!existing.has(id)) existing.set(id, model);
      }
    }
  }
  return { global, byHost };
}

function enrichEntry(model: DiscoveredModelEntry, match: ModelsDevModel): DiscoveredModelEntry {
  const contextWindow =
    model.contextWindow === undefined ? match.capability.max_context_tokens : undefined;
  const supportEfforts =
    model.supportEfforts === undefined && match.supportEfforts !== undefined
      ? [...match.supportEfforts]
      : undefined;
  const offEffort =
    model.offEffort === undefined && match.offEffort !== undefined ? match.offEffort : undefined;
  if (contextWindow === undefined && supportEfforts === undefined && offEffort === undefined) {
    return model;
  }
  return {
    ...model,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(supportEfforts !== undefined ? { supportEfforts } : {}),
    ...(offEffort !== undefined ? { offEffort } : {}),
  };
}

export function enrichDiscoveredModels(
  models: readonly DiscoveredModelEntry[],
  catalog: ModelsDevCatalog,
  options?: EnrichDiscoveredModelsOptions,
): DiscoveredModelEntry[] {
  if (options?.protocol === 'anthropic') return [...models];
  const index = buildCatalogIndex(catalog);
  const host = options?.providerHost !== undefined ? hostOf(options.providerHost) : undefined;
  return models.map((model) => {
    const match =
      (host !== undefined ? index.byHost.get(host)?.get(model.modelId) : undefined) ??
      index.global.get(model.modelId);
    return match === undefined ? model : enrichEntry(model, match);
  });
}
