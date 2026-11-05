/**
 * Background config sync — mirror the provider-models background refresh
 * pattern: on TUI startup, silently discover third-party CLI configs (omp,
 * kimi-code, pi, zcode) and import any *new* providers into config.toml.
 *
 * Only adds entries the user does not already have (`skipExisting` on every
 * provider id); never rewrites or removes existing config. Errors are
 * swallowed — startup must not fail because an unrelated CLI's config file is
 * malformed. Returns a short human-readable summary for the status line.
 */

import {
  convertImports,
  kimiAdapter,
  ompAdapter,
  piAdapter,
  zcodeAdapter,
} from '@zimi-ai/agent-core-v2/app/importConfig/convert';
import type {
  ImportReport,
  ImportSourceAdapter,
} from '@zimi-ai/agent-core-v2/app/importConfig/index';
import type { ZimiConfig, ZimiHarness } from '@zimi-ai/zimi-code-sdk';

const SOURCES: readonly ImportSourceAdapter[] = [ompAdapter, kimiAdapter, piAdapter, zcodeAdapter];

export interface ImportSyncResult {
  readonly providerCount: number;
  readonly modelCount: number;
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
  if (reports.length === 0) return undefined;

  const config = await harness.getConfig();
  const skipExisting = (providerId: string): boolean => config.providers[providerId] !== undefined;
  const converted = convertImports(reports, { skipExisting });
  if (Object.keys(converted.providers).length === 0) return undefined;

  await harness.setConfig({
    providers: converted.providers as ZimiConfig['providers'],
    models: converted.models as ZimiConfig['models'],
    ...(converted.defaultModel !== undefined && config.defaultModel === undefined
      ? { defaultModel: converted.defaultModel }
      : {}),
  });

  return {
    providerCount: Object.keys(converted.providers).length,
    modelCount: Object.keys(converted.models).length,
    sources: [...new Set(reports.map((r) => r.source))],
  };
}
