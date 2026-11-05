/**
 * Background config sync — mirror the provider-models background refresh
 * pattern: on TUI startup, silently discover third-party CLI configs (omp,
 * kimi-code, pi, zcode) and import any *new* providers into config.toml.
 *
 * Only adds entries the user does not already have (`skipExisting` per
 * provider id, `skipExistingModel` per alias — a provider present without its
 * models still gets the models back); never rewrites or removes existing
 * config. Errors are swallowed — startup must not fail because an unrelated
 * CLI's config file is malformed. Returns a short human-readable summary for
 * the status line.
 */

import {
  convertImports,
  kimiAdapter,
  ompAdapter,
  piAdapter,
  zcodeAdapter,
} from '@zimi-ai/agent-core-v2/app/importConfig/convert';
import {
  DISCOVERY_DEFAULT_CONTEXT_SIZE,
  discoverProviderModels,
} from '@zimi-ai/agent-core-v2/app/importConfig/discovery';
import type {
  ImportReport,
  ImportSourceAdapter,
} from '@zimi-ai/agent-core-v2/app/importConfig/index';
import type { ZimiConfig, ZimiHarness } from '@zimi-ai/zimi-code-sdk';

const SOURCES: readonly ImportSourceAdapter[] = [ompAdapter, kimiAdapter, piAdapter, zcodeAdapter];

export interface ImportSyncResult {
  readonly providerCount: number;
  readonly modelCount: number;
  readonly discoveredCount: number;
  readonly sources: readonly string[];
}

export async function syncImportedConfigInBackground(
  harness: ZimiHarness,
): Promise<ImportSyncResult | undefined> {
  const reports: ImportReport[] = [];
  for (const adapter of SOURCES) {
    if (!adapter.isAvailable({})) continue;
    const report = adapter.read({});
    if (report !== undefined && report.providers.length > 0) reports.push(report);
  }

  let config = await harness.getConfig();
  const skipExisting = (providerId: string): boolean => config.providers[providerId] !== undefined;
  const skipExistingModel = (alias: string): boolean => config.models?.[alias] !== undefined;
  const converted = convertImports(reports, { skipExisting, skipExistingModel });
  const providerCount = Object.keys(converted.providers).length;
  const modelCount = Object.keys(converted.models).length;

  if (providerCount > 0 || modelCount > 0) {
    await harness.setConfig({
      providers: converted.providers as ZimiConfig['providers'],
      models: converted.models as ZimiConfig['models'],
      ...(converted.defaultModel !== undefined && config.defaultModel === undefined
        ? { defaultModel: converted.defaultModel }
        : {}),
    });
    config = await harness.getConfig();
  }

  // Auto-discover: probe the provider's own `/models` endpoint with its API
  // key for every non-managed provider that still has zero model aliases.
  // Upstream's refreshProviderModels deliberately refuses arbitrary endpoints;
  // this fills the gap for imported/custom providers. Best-effort and silent.
  const aliasesByProvider = new Map<string, number>();
  for (const alias of Object.keys(config.models ?? {})) {
    const providerId = alias.slice(0, alias.indexOf('/'));
    aliasesByProvider.set(providerId, (aliasesByProvider.get(providerId) ?? 0) + 1);
  }
  const probeTargets = Object.entries(config.providers ?? {})
    .filter(([id, provider]) => {
      if (provider?.type === 'zimi') return false; // managed — upstream refresh owns it
      if (provider?.baseUrl === undefined || provider.baseUrl.length === 0) return false;
      if (provider.apiKey === undefined && provider.apiKeyEnv === undefined) return false;
      return (aliasesByProvider.get(id) ?? 0) === 0;
    })
    .map(([id, provider]) => ({
      id,
      type: provider?.type,
      baseUrl: provider?.baseUrl,
      apiKey: provider?.apiKey,
      apiKeyEnv: provider?.apiKeyEnv,
    }));

  let discoveredCount = 0;
  if (probeTargets.length > 0) {
    const discovered = await discoverProviderModels(probeTargets);
    const known = new Set(Object.keys(config.models ?? {}));
    const discoveryPatch: Record<
      string,
      { provider: string; model: string; maxContextSize: number }
    > = {};
    for (const { providerId, modelId, contextWindow } of discovered) {
      const alias = `${providerId}/${modelId}`;
      if (known.has(alias) || discoveryPatch[alias] !== undefined) continue;
      discoveryPatch[alias] = {
        provider: providerId,
        model: modelId,
        // zimi rejects model aliases without a positive max_context_size.
        maxContextSize: contextWindow ?? DISCOVERY_DEFAULT_CONTEXT_SIZE,
      };
    }
    discoveredCount = Object.keys(discoveryPatch).length;
    if (discoveredCount > 0) {
      await harness.setConfig({ models: discoveryPatch as ZimiConfig['models'] });
    }
  }

  if (providerCount === 0 && modelCount === 0 && discoveredCount === 0) return undefined;

  return {
    providerCount,
    modelCount,
    discoveredCount,
    sources: [...new Set(reports.map((r) => r.source))],
  };
}
