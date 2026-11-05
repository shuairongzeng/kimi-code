/**
 * Best-effort model discovery for custom providers.
 *
 * Upstream `refreshProviderModels` deliberately refuses to probe arbitrary
 * third-party endpoints ("Strict baseUrl matching keeps proxies / gateways
 * with an untrusted `/models` schema out") — it only auto-discovers for the
 * managed Zimi endpoint, open platforms, and models.dev-style registries.
 *
 * This module fills that gap for imported/custom providers: probe the
 * provider's own `/models` listing endpoint with its configured API key and
 * merge whatever comes back as model aliases. Every failure (network, auth,
 * 404, unparseable body) is silent — discovery is an enhancement, never a
 * requirement, and existing imported aliases are never touched.
 */

export interface DiscoverableProvider {
  readonly id: string;
  readonly type?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
}

export interface DiscoveredModel {
  readonly providerId: string;
  readonly modelId: string;
  /** Context length reported by the gateway, when the listing includes one. */
  readonly contextWindow?: number;
}

/** Fallback context window for discovered models whose listing omits limits. */
export const DISCOVERY_DEFAULT_CONTEXT_SIZE = 128_000;

export interface DiscoveryOptions {
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const ANTHROPIC_VERSION = '2023-06-01';

/** Resolve the bearer/api key for a provider (inline key or env indirection). */
function resolveKey(provider: DiscoverableProvider): string | undefined {
  if (provider.apiKey !== undefined && provider.apiKey.length > 0) return provider.apiKey;
  if (provider.apiKeyEnv !== undefined && provider.apiKeyEnv.length > 0) {
    const fromEnv = process.env[provider.apiKeyEnv];
    if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  }
  return undefined;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export interface ParsedModelEntry {
  readonly id: string;
  readonly contextWindow?: number;
}

/**
 * Extract model entries from a `/models` response body. Tolerates the shapes
 * real gateways return: OpenAI `{data:[{id}]}`, Anthropic `{data:[{id}]}`, a
 * bare array of objects, or a bare array of strings. Context length is picked
 * up when the gateway reports it (key spellings vary: `context_length`,
 * `context_window`, `contextWindow`). Anything unrecognized → empty.
 */
export function parseModelEntries(body: unknown): ParsedModelEntry[] {
  let list: unknown[] | undefined;
  if (Array.isArray(body)) {
    list = body;
  } else if (body !== null && typeof body === 'object' && 'data' in body && Array.isArray(body.data)) {
    list = body.data;
  }
  if (list === undefined) return [];
  const entries: ParsedModelEntry[] = [];
  for (const item of list) {
    if (typeof item === 'string' && item.length > 0) {
      entries.push({ id: item });
    } else if (item !== null && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
      if (item.id.length === 0) continue;
      entries.push({ id: item.id, ...readContextWindow(item) });
    }
  }
  return entries;
}

const CONTEXT_WINDOW_KEYS = ['context_length', 'context_window', 'contextWindow', 'max_context_length'] as const;

function readContextWindow(item: Record<string, unknown>): { contextWindow?: number } {
  for (const key of CONTEXT_WINDOW_KEYS) {
    const value = item[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return { contextWindow: value };
    }
  }
  return {};
}

async function probeOne(
  provider: DiscoverableProvider,
  options: DiscoveryOptions,
): Promise<DiscoveredModel[]> {
  const baseUrl = provider.baseUrl;
  if (baseUrl === undefined || baseUrl.length === 0) return [];
  const key = resolveKey(provider);
  if (key === undefined) return [];

  const root = trimTrailingSlash(baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3000;

  // Real gateways disagree about whether the listing endpoint sits at
  // {baseUrl}/models or {baseUrl}/v1/models (the anthropic-style base URLs
  // like https://api.example.com/anthropic usually want /v1/models). Try
  // both, first successful response wins. Auth style follows the protocol:
  // x-api-key for anthropic, bearer otherwise.
  const candidates = [`${root}/models`, `${root}/v1/models`];
  const headers: Record<string, string> =
    provider.type === 'anthropic'
      ? { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION }
      : { Authorization: `Bearer ${key}` };

  for (const url of candidates) {
    const response = await fetchImpl(
      new Request(url, { headers, signal: AbortSignal.timeout(timeoutMs) }),
    );
    if (!response.ok) continue;
    const body: unknown = await response.json();
    const entries = parseModelEntries(body);
    if (entries.length > 0) {
      return entries.map((entry) => ({
        providerId: provider.id,
        modelId: entry.id,
        ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
      }));
    }
  }
  return [];
}

/** Probe all providers concurrently; per-provider failures yield nothing. */
export async function discoverProviderModels(
  providers: readonly DiscoverableProvider[],
  options: DiscoveryOptions = {},
): Promise<DiscoveredModel[]> {
  const results = await Promise.all(
    providers.map(async (provider) => {
      try {
        return await probeOne(provider, options);
      } catch {
        return [];
      }
    }),
  );
  return results.flat();
}
