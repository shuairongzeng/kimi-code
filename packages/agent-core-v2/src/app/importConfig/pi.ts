import type {
  ImportModel,
  ImportOptions,
  ImportProvider,
  ImportReport,
  ImportSourceAdapter,
} from './index';
import { asArray, asNumber, asRecord, asString, resolveEnv, tryJson } from './fsUtils';

/**
 * pi (and omp's pi-based runtimes) store provider API keys in
 * `~/.pi/agent/auth.json`: `{ "<providerKey>": { "type": "api_key", "key": "..." } }`
 * and static model metadata in `~/.pi/agent/models.json`.
 */
export const piAdapter: ImportSourceAdapter = {
  name: 'pi',
  configDirName: '.pi',
  isAvailable(options: ImportOptions): boolean {
    const env = resolveEnv(options);
    return env.exists(env.joinPath(env.homeDir, '.pi', 'agent', 'auth.json'));
  },
  read(options: ImportOptions): ImportReport | undefined {
    const env = resolveEnv(options);
    const auth = asRecord(tryJson(env.readFile(env.joinPath(env.homeDir, '.pi', 'agent', 'auth.json'))));
    if (auth === undefined) return undefined;

    const modelsJson = asRecord(
      tryJson(env.readFile(env.joinPath(env.homeDir, '.pi', 'agent', 'models.json'))),
    );
    const providers = piProvidersFromAuth(auth, modelsJson);
    if (providers.length === 0) return undefined;
    return { source: 'pi', homeDir: env.homeDir, providers };
  },
};

function piProvidersFromAuth(
  auth: Record<string, unknown>,
  modelsJson: Record<string, unknown> | undefined,
): readonly ImportProvider[] {
  const out: ImportProvider[] = [];
  for (const [key, raw] of Object.entries(auth)) {
    const entry = asRecord(raw);
    if (entry === undefined) continue;
    if (asString(entry['type']) !== 'api_key') continue;
    const apiKey = asString(entry['key']);
    if (apiKey === undefined) continue;
    const info = piProviderInfo(key);
    if (info === undefined) continue;
    const models = modelsJson === undefined ? [] : piModelsForProvider(modelsJson, key, info.baseUrl);
    out.push({ id: key, protocol: info.protocol, baseUrl: info.baseUrl, apiKey, models });
  }
  return out;
}

interface PiProviderInfo {
  readonly protocol: 'anthropic' | 'openai';
  readonly baseUrl: string;
}

const PI_PROVIDER_HINTS: readonly (readonly [string, PiProviderInfo])[] = [
  ['anthropic', { protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' }],
  ['openai', { protocol: 'openai', baseUrl: 'https://api.openai.com/v1' }],
  ['openrouter', { protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1' }],
  ['deepseek', { protocol: 'openai', baseUrl: 'https://api.deepseek.com' }],
  ['zhipu', { protocol: 'anthropic', baseUrl: 'https://open.bigmodel.cn/api/anthropic' }],
  ['moonshot', { protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1' }],
  ['bigmodel', { protocol: 'anthropic', baseUrl: 'https://open.bigmodel.cn/api/anthropic' }],
];

function piProviderInfo(key: string): PiProviderInfo | undefined {
  const lower = key.toLowerCase();
  for (const [hint, info] of PI_PROVIDER_HINTS) {
    if (lower.includes(hint)) return info;
  }
  return undefined;
}

function piModelsForProvider(
  modelsJson: Record<string, unknown>,
  providerKey: string,
  _baseUrl: string,
): readonly ImportModel[] {
  const providers = asRecord(modelsJson['providers']);
  const provider = providers === undefined ? undefined : asRecord(providers[providerKey]);
  const rawModels = provider === undefined ? undefined : asArray(provider['models']);
  if (rawModels === undefined) return [];
  const out: ImportModel[] = [];
  for (const rawModel of rawModels) {
    const m = asRecord(rawModel);
    const modelId = m === undefined ? undefined : asString(m['id']);
    if (m === undefined || modelId === undefined) continue;
    out.push({
      id: modelId,
      displayName: asString(m['name']) ?? modelId,
      maxContextSize: asNumber(m['contextWindow']) ?? asNumber(m['context_window']),
      maxOutputSize: asNumber(m['maxTokens']) ?? asNumber(m['max_tokens']),
      capabilities: piCapabilities(m),
    });
  }
  return out;
}

function piCapabilities(model: Record<string, unknown>): readonly string[] | undefined {
  const inputList = asArray(model['input']);
  if (inputList === undefined) return undefined;
  const caps: string[] = [];
  if (inputList.some((entry) => entry === 'text')) caps.push('text');
  if (inputList.some((entry) => entry === 'image')) caps.push('image');
  if (model['reasoning'] === true) caps.push('reasoning');
  return caps.length > 0 ? caps : undefined;
}
