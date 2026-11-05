import type {
  ImportModel,
  ImportOptions,
  ImportProvider,
  ImportReport,
  ImportSourceAdapter,
} from './index';
import { asArray, asNumber, asRecord, asString, resolveEnv, tryJson } from './fsUtils';
import type { ResolvedImportEnv } from './fsUtils';

/**
 * zcode stores provider templates + credentials in
 * `~/.zcode/v2/provider_config.json` and model limits in
 * `~/.zcode/v2/config.json` (`config.provider.<id>.models`).
 */
export const zcodeAdapter: ImportSourceAdapter = {
  name: 'zcode',
  configDirName: '.zcode',
  isAvailable(options: ImportOptions): boolean {
    const env = resolveEnv(options);
    return env.exists(env.joinPath(env.homeDir, '.zcode', 'v2', 'provider_config.json'));
  },
  read(options: ImportOptions): ImportReport | undefined {
    const env = resolveEnv(options);
    const providerJson = asRecord(
      tryJson(env.readFile(env.joinPath(env.homeDir, '.zcode', 'v2', 'provider_config.json'))),
    );
    if (providerJson === undefined) return undefined;

    const rules = asArray(asRecord(providerJson['config'])?.['providerRules']);
    if (rules === undefined) return undefined;

    const limits = readZcodeLimits(env);
    const providers: ImportProvider[] = [];
    for (const rule of rules) {
      const shape = asRecord(rule);
      if (shape === undefined) continue;
      if (shape['enabled'] === false) continue;
      const id = asString(shape['providerId']);
      if (id === undefined) continue;
      const info = zcodeTemplateInfo(asString(shape['templateId']) ?? id);
      if (info === undefined) continue;
      const access = asRecord(asRecord(shape['config'])?.['access']);
      const apiKey = access === undefined ? undefined : asString(access['apiKey']);
      const models = limits.get(id) ?? [];
      providers.push({ id, protocol: info.protocol, baseUrl: info.baseUrl, apiKey, models });
    }

    if (providers.length === 0) return undefined;
    return { source: 'zcode', homeDir: env.homeDir, providers };
  },
};

function readZcodeLimits(env: ResolvedImportEnv): Map<string, readonly ImportModel[]> {
  const out = new Map<string, readonly ImportModel[]>();
  const configJson = asRecord(
    tryJson(env.readFile(env.joinPath(env.homeDir, '.zcode', 'v2', 'config.json'))),
  );
  const providers = asRecord(asRecord(configJson?.['provider']));
  if (providers === undefined) return out;
  for (const [providerId, rawModels] of Object.entries(providers)) {
    const modelsRecord = asRecord(rawModels);
    if (modelsRecord === undefined) continue;
    const models: ImportModel[] = [];
    for (const [modelId, rawLimit] of Object.entries(modelsRecord)) {
      const limit = asRecord(asRecord(rawLimit)?.['limit']);
      const modalities = asRecord(asRecord(rawLimit)?.['modalities']);
      const rawInput = asArray(modalities?.['input']);
      const capabilities: string[] = [];
      if (rawInput !== undefined) {
        if (rawInput.some((entry) => entry === 'text')) capabilities.push('text');
        if (rawInput.some((entry) => entry === 'image')) capabilities.push('image');
      }
      models.push({
        id: modelId,
        displayName: modelId,
        maxContextSize: limit === undefined ? undefined : asNumber(limit['context']),
        maxOutputSize: limit === undefined ? undefined : asNumber(limit['output']),
        capabilities: capabilities.length > 0 ? capabilities : undefined,
      });
    }
    out.set(providerId, models);
  }
  return out;
}

interface ZcodeTemplateInfo {
  readonly protocol: 'anthropic' | 'openai';
  readonly baseUrl: string;
}

const ZCODE_TEMPLATE_HINTS: readonly (readonly [string, ZcodeTemplateInfo])[] = [
  ['bigmodel', { protocol: 'anthropic', baseUrl: 'https://open.bigmodel.cn/api/anthropic' }],
  ['deepseek', { protocol: 'openai', baseUrl: 'https://api.deepseek.com' }],
  ['moonshot', { protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1' }],
  ['qwen', { protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }],
  ['openai', { protocol: 'openai', baseUrl: 'https://api.openai.com/v1' }],
  ['anthropic', { protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' }],
];

function zcodeTemplateInfo(templateId: string): ZcodeTemplateInfo | undefined {
  const lower = templateId.toLowerCase();
  for (const [hint, info] of ZCODE_TEMPLATE_HINTS) {
    if (lower.includes(hint)) return info;
  }
  return undefined;
}
