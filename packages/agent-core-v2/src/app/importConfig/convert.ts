import type { ImportReport } from './index';
import { kimiAdapter } from './kimi';
import { ompAdapter } from './omp';
import { piAdapter } from './pi';
import { zcodeAdapter } from './zcode';

export interface ConvertedConfig {
  /** providerId → zimi ProviderConfig patch. */
  readonly providers: Record<string, ProviderPatch>;
  /** model alias → zimi model alias record. */
  readonly models: Record<string, ModelAliasPatch>;
  readonly defaultModel?: string;
  /** Provider ids skipped because their source protocol is unmappable. */
  readonly skipped: readonly string[];
}

export interface ProviderPatch {
  readonly type?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly defaultModel?: string;
  readonly source?: Record<string, unknown>;
}

export interface ModelAliasPatch {
  readonly provider: string;
  readonly model: string;
  readonly maxContextSize?: number;
  readonly maxOutputSize?: number;
  readonly displayName?: string;
  readonly capabilities?: readonly string[];
}

const IMPORTED_TAG = 'imported';

/** Convert one or more import reports into a zimi config patch. */
export function convertImports(
  reports: readonly ImportReport[],
  options: { readonly skipExisting?: (providerId: string) => boolean } = {},
): ConvertedConfig {
  const providers: Record<string, ProviderPatch> = {};
  const models: Record<string, ModelAliasPatch> = {};
  const skipped: string[] = [];
  let defaultModel: string | undefined;

  for (const report of reports) {
    for (const provider of report.providers) {
      const providerId = importProviderId(report.source, provider.id);
      if (options.skipExisting?.(providerId) === true) continue;

      providers[providerId] = {
        type: provider.protocol,
        ...(provider.apiKey !== undefined ? { apiKey: provider.apiKey } : {}),
        ...(provider.baseUrl !== undefined ? { baseUrl: provider.baseUrl } : {}),
        source: { [IMPORTED_TAG]: report.source, origin: provider.id },
      };

      for (const model of provider.models) {
        const alias = `${providerId}/${model.id}`;
        models[alias] = {
          provider: providerId,
          model: model.id,
          ...(model.maxContextSize !== undefined ? { maxContextSize: model.maxContextSize } : {}),
          ...(model.maxOutputSize !== undefined ? { maxOutputSize: model.maxOutputSize } : {}),
          ...(model.displayName !== undefined ? { displayName: model.displayName } : {}),
          ...(model.capabilities !== undefined ? { capabilities: [...model.capabilities] } : {}),
        };
      }
    }

    if (defaultModel === undefined && report.defaultModel !== undefined) {
      const [providerKey, ...rest] = report.defaultModel.split('/');
      const sourceProvider = report.providers.find((p) => p.id === providerKey);
      if (sourceProvider !== undefined && rest.length > 0) {
        const providerId = importProviderId(report.source, sourceProvider.id);
        const modelId = rest.join('/');
        if (models[`${providerId}/${modelId}`] !== undefined) {
          defaultModel = `${providerId}/${modelId}`;
        }
      }
    }
  }

  return { providers, models, defaultModel, skipped };
}

function importProviderId(source: string, originId: string): string {
  // Keep the source CLI's own provider id so imported entries stay recognizable
  // (e.g. omp "zhipu" imports as "zhipu", not "omp-zhipu"). Source identity is
  // preserved in `source.origin`.
  const conflictFreeId = originId.trim().toLowerCase() || source.toLowerCase();
  return conflictFreeId;
}

export { ompAdapter, kimiAdapter, piAdapter, zcodeAdapter };
