import { parse as parseToml } from 'smol-toml';

import type {
  ImportModel,
  ImportOptions,
  ImportProvider,
  ImportReport,
  ImportSourceAdapter,
} from './index';
import { asNumber, asRecord, asString, resolveEnv, tryJson } from './fsUtils';

/** kimi-code provider `type` → zimi provider type. */
export function kimiTypeToProtocol(type: string | undefined): 'anthropic' | 'openai' | undefined {
  switch (type) {
    case 'anthropic':
      return 'anthropic';
    case 'openai':
    case 'openai-completions':
    case 'openai-responses':
      return 'openai';
    default:
      return undefined;
  }
}

export const kimiAdapter: ImportSourceAdapter = {
  name: 'kimi-code',
  configDirName: '.kimi-code',
  isAvailable(options: ImportOptions): boolean {
    const env = resolveEnv(options);
    return env.exists(env.joinPath(env.homeDir, '.kimi-code', 'config.toml'));
  },
  read(options: ImportOptions): ImportReport | undefined {
    const env = resolveEnv(options);
    const configPath = env.joinPath(env.homeDir, '.kimi-code', 'config.toml');
    const configText = env.readFile(configPath);
    if (configText === undefined) return undefined;

    let parsed: unknown;
    try {
      parsed = parseToml(configText);
    } catch {
      return undefined;
    }
    const root = asRecord(parsed);
    if (root === undefined) return undefined;

    const providers: ImportProvider[] = [];
    const providerRecords = asRecord(root['providers']);
    const modelRecords = asRecord(root['models']);
    if (providerRecords !== undefined) {
      for (const [id, raw] of Object.entries(providerRecords)) {
        const shape = asRecord(raw);
        if (shape === undefined) continue;
        const protocol = kimiTypeToProtocol(asString(shape['type']));
        const baseUrl = asString(shape['base_url']) ?? asString(shape['baseUrl']);
        if (protocol === undefined) continue;
        // Managed/oauth providers carry no usable static credentials for zimi.
        const managed = id.startsWith('managed:');
        const apiKey = managed ? undefined : asString(shape['api_key']) ?? asString(shape['apiKey']);
        const models = modelsForKimiProvider(modelRecords, id);
        providers.push({ id, protocol, baseUrl, apiKey, models });
      }
    }

    if (providers.length === 0) return undefined;

    const defaultModel = asString(root['default_model']);
    return { source: 'kimi-code', homeDir: env.homeDir, providers, defaultModel };
  },
};

function modelsForKimiProvider(
  modelRecords: Record<string, unknown> | undefined,
  providerId: string,
): readonly ImportModel[] {
  if (modelRecords === undefined) return [];
  const out: ImportModel[] = [];
  for (const [alias, raw] of Object.entries(modelRecords)) {
    const shape = asRecord(raw);
    if (shape === undefined) continue;
    if (asString(shape['provider']) !== providerId) continue;
    const modelId = asString(shape['model']) ?? alias;
    out.push({
      id: modelId,
      displayName: asString(shape['display_name']) ?? alias,
      maxContextSize: asNumber(shape['max_context_size']) ?? asNumber(shape['maxContextSize']),
      maxOutputSize: asNumber(shape['max_output_size']) ?? asNumber(shape['maxOutputSize']),
    });
  }
  return out;
}

export { tryJson as _tryJsonForTest };
