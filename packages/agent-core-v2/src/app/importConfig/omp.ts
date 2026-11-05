import { load as loadYaml } from 'js-yaml';

import type {
  ImportModel,
  ImportOptions,
  ImportProvider,
  ImportReport,
  ImportSourceAdapter,
} from './index';
import { asArray, asNumber, asRecord, asString, resolveEnv } from './fsUtils';

/** omp protocol label → zimi provider type. */
export function ompApiToProtocol(api: string | undefined): 'anthropic' | 'openai' | 'openai_responses' | undefined {
  switch (api) {
    case 'anthropic-messages':
    case 'anthropic':
      return 'anthropic';
    case 'openai-completions':
    case 'openai-chat':
    case 'openai':
      return 'openai';
    case 'openai-responses':
    case 'responses':
      return 'openai_responses';
    default:
      return undefined;
  }
}

interface OmpModelShape {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly reasoning?: boolean;
  readonly input?: readonly string[];
}

interface OmpProviderShape {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly api?: string;
  readonly models?: readonly OmpModelShape[];
}

function readOmpModels(
  providers: Record<string, unknown>,
): readonly ImportProvider[] {
  const out: ImportProvider[] = [];
  for (const [id, raw] of Object.entries(providers)) {
    const shape = asRecord(raw);
    if (shape === undefined) continue;
    const provider: OmpProviderShape = {
      baseUrl: asString(shape['baseUrl']),
      apiKey: asString(shape['apiKey']),
      api: asString(shape['api']),
      models: undefined,
    };
    const rawModels = asArray(shape['models']);
    const rawOverrides = asRecord(shape['modelOverrides']);
    const models: ImportModel[] = [];
    if (rawModels !== undefined) {
      for (const rawModel of rawModels) {
        const m = asRecord(rawModel);
        const modelId = m === undefined ? undefined : asString(m['id']);
        if (m === undefined || modelId === undefined) continue;
        models.push(ompModel(m, modelId));
      }
    }
    if (rawOverrides !== undefined) {
      for (const [modelId, rawModel] of Object.entries(rawOverrides)) {
        const m = asRecord(rawModel);
        if (m === undefined) continue;
        models.push(ompModel(m, modelId));
      }
    }
    const protocol = ompApiToProtocol(provider.api);
    if (protocol === undefined || provider.baseUrl === undefined) continue;
    out.push({
      id,
      protocol,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      models,
    });
  }
  return out;
}

function ompModel(m: Record<string, unknown>, modelId: string): ImportModel {
  return {
    id: modelId,
    displayName: asString(m['name']) ?? modelId,
    maxContextSize: asNumber(m['contextWindow']),
    maxOutputSize: asNumber(m['maxTokens']),
    capabilities: ompCapabilities(m),
  };
}

function ompCapabilities(model: Record<string, unknown>): readonly string[] | undefined {
  const input = model['input'];
  const inputList = asArray(input);
  if (inputList === undefined) return undefined;
  const caps: string[] = [];
  const hasText = inputList.some((entry) => entry === 'text');
  const hasImage = inputList.some((entry) => entry === 'image');
  if (hasText) caps.push('text');
  if (hasImage) caps.push('image');
  if (model['reasoning'] === true) caps.push('reasoning');
  return caps.length > 0 ? caps : undefined;
}

function ompDefaultModel(configYml: unknown): string | undefined {
  const record = asRecord(configYml);
  const roles = asRecord(record?.['modelRoles']);
  return asString(roles?.['default']);
}

export const ompAdapter: ImportSourceAdapter = {
  name: 'omp',
  configDirName: '.omp',
  isAvailable(options: ImportOptions): boolean {
    const env = resolveEnv(options);
    return env.exists(env.joinPath(env.homeDir, '.omp', 'agent', 'models.yml'));
  },
  read(options: ImportOptions): ImportReport | undefined {
    const env = resolveEnv(options);
    const modelsPath = env.joinPath(env.homeDir, '.omp', 'agent', 'models.yml');
    const modelsText = env.readFile(modelsPath);
    if (modelsText === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = loadYaml(modelsText);
    } catch {
      return undefined;
    }
    const root = asRecord(parsed);
    const providers = asRecord(root?.['providers']);
    if (providers === undefined) return undefined;

    const importProviders = readOmpModels(providers);
    if (importProviders.length === 0) return undefined;

    let defaultModel: string | undefined;
    const configText = env.readFile(env.joinPath(env.homeDir, '.omp', 'agent', 'config.yml'));
    if (configText !== undefined) {
      try {
        defaultModel = ompDefaultModel(loadYaml(configText));
      } catch {
        defaultModel = undefined;
      }
    }

    return { source: 'omp', homeDir: env.homeDir, providers: importProviders, defaultModel };
  },
};

export { readOmpModels as _readOmpModelsForTest };
