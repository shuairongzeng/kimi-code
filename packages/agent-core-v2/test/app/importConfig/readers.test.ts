import { describe, expect, it } from 'vitest';

import { ompAdapter, _readOmpModelsForTest } from '#/app/importConfig/omp';
import { kimiAdapter } from '#/app/importConfig/kimi';
import { piAdapter } from '#/app/importConfig/pi';
import { zcodeAdapter } from '#/app/importConfig/zcode';
import type { ImportOptions } from '#/app/importConfig/index';

function envWithFiles(files: Record<string, string>): ImportOptions {
  return {
    homeDir: '/home/u',
    readFile: (path) => files[path],
    exists: (path) => files[path] !== undefined,
    joinPath: (...parts) => parts.join('/'),
  };
}

describe('omp adapter', () => {
  it('reads providers, models, capabilities and the default model', () => {
    const modelsYml = `
providers:
  zhipu:
    baseUrl: https://open.bigmodel.cn/api/anthropic
    apiKey: key-zhipu
    api: anthropic-messages
    models:
      - id: GLM-5.2
        name: GLM-5.2
        reasoning: true
        input: [text, image]
        contextWindow: 1000000
        maxTokens: 16384
`;
    const configYml = `
modelRoles:
  default: aliyun/qwen3.8-max-0902
`;
    const report = ompAdapter.read(envWithFiles({
      '/home/u/.omp/agent/models.yml': modelsYml,
      '/home/u/.omp/agent/config.yml': configYml,
    }));

    expect(report).toBeDefined();
    expect(report?.providers).toHaveLength(1);
    expect(report?.providers[0]).toMatchObject({
      id: 'zhipu',
      protocol: 'anthropic',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      apiKey: 'key-zhipu',
    });
    expect(report?.providers[0]?.models[0]).toMatchObject({
      id: 'GLM-5.2',
      maxContextSize: 1_000_000,
      maxOutputSize: 16_384,
    });
    expect(report?.providers[0]?.models[0]?.capabilities).toEqual(['text', 'image', 'reasoning']);
    expect(report?.defaultModel).toBe('aliyun/qwen3.8-max-0902');
  });

  it('skips providers with unmappable api type or missing baseUrl', () => {
    const providers = _readOmpModelsForTest({
      bad: { baseUrl: 'https://x', api: 'weird' },
      nobase: { api: 'openai-completions' },
    });
    expect(providers).toHaveLength(0);
  });
});

describe('kimi adapter', () => {
  it('reads providers with static api_key and maps models', () => {
    const configToml = `
default_model = "magpie/qwen-cn/qwen3.8-max-0902"

[providers.magpie]
type = "openai"
base_url = "https://api.example.com/v1"
api_key = "key-magpie"

[models."magpie/auto/kimi-k3.1"]
provider = "magpie"
model = "kimi-k3.1"
max_context_size = 262144
`;
    const report = kimiAdapter.read(envWithFiles({
      '/home/u/.kimi-code/config.toml': configToml,
    }));

    expect(report).toBeDefined();
    expect(report?.providers[0]).toMatchObject({
      id: 'magpie',
      protocol: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'key-magpie',
    });
    expect(report?.providers[0]?.models[0]).toMatchObject({
      id: 'kimi-k3.1',
      maxContextSize: 262_144,
    });
    expect(report?.defaultModel).toBe('magpie/qwen-cn/qwen3.8-max-0902');
  });

  it('drops api_key for managed providers but keeps the provider', () => {
    const configToml = `
[providers."managed:kimi-code"]
type = "openai"
base_url = "https://api.kimi.com/coding/v1"
api_key = "should-not-import"

[providers."managed:kimi-code".oauth]
storage = "file"
key = "oauth/kimi-code"
`;
    const report = kimiAdapter.read(envWithFiles({
      '/home/u/.kimi-code/config.toml': configToml,
    }));

    expect(report?.providers[0]?.apiKey).toBeUndefined();
    expect(report?.providers[0]?.id).toBe('managed:kimi-code');
  });
});

describe('pi adapter', () => {
  it('reads api_key entries and infers protocol from the provider key', () => {
    const authJson = JSON.stringify({
      'zhipu-token-plan': { type: 'api_key', key: 'key-zhipu' },
      'openai-main': { type: 'api_key', key: 'key-openai' },
    });
    const modelsJson = JSON.stringify({
      providers: {
        'zhipu-token-plan': {
          models: [{ id: 'glm-5', contextWindow: 128_000 }],
        },
      },
    });
    const report = piAdapter.read(envWithFiles({
      '/home/u/.pi/agent/auth.json': authJson,
      '/home/u/.pi/agent/models.json': modelsJson,
    }));

    expect(report?.providers).toHaveLength(2);
    expect(report?.providers[0]).toMatchObject({
      id: 'zhipu-token-plan',
      protocol: 'anthropic',
      apiKey: 'key-zhipu',
    });
    expect(report?.providers[0]?.models[0]).toMatchObject({
      id: 'glm-5',
      maxContextSize: 128_000,
    });
    expect(report?.providers[1]?.protocol).toBe('openai');
  });

  it('returns undefined when no api_key entry matches a known provider hint', () => {
    const authJson = JSON.stringify({
      'xiaomi-token-plan-cn': { type: 'api_key', key: 'tp-xxx' },
    });
    expect(piAdapter.read(envWithFiles({
      '/home/u/.pi/agent/auth.json': authJson,
    }))).toBeUndefined();
  });
});

describe('zcode adapter', () => {
  it('reads enabled provider rules with api-key access and model limits', () => {
    const providerConfig = JSON.stringify({
      config: {
        providerRules: [
          {
            providerId: 'bigmodel-api',
            templateId: 'bigmodel-api',
            config: { access: { type: 'api-key', apiKey: 'key-zcode' } },
          },
          {
            providerId: 'disabled-one',
            enabled: false,
            config: { access: { type: 'api-key', apiKey: 'k' } },
          },
        ],
      },
    });
    const configJson = JSON.stringify({
      provider: {
        'bigmodel-api': {
          'qwen-cn/ZHIPU/GLM-5.3-Flash': {
            limit: { context: 1_000_000, output: 128_000 },
            modalities: { input: ['text', 'image'] },
          },
        },
      },
    });
    const report = zcodeAdapter.read(envWithFiles({
      '/home/u/.zcode/v2/provider_config.json': providerConfig,
      '/home/u/.zcode/v2/config.json': configJson,
    }));

    expect(report?.providers).toHaveLength(1);
    expect(report?.providers[0]).toMatchObject({
      id: 'bigmodel-api',
      protocol: 'anthropic',
      apiKey: 'key-zcode',
    });
    expect(report?.providers[0]?.models[0]).toMatchObject({
      id: 'qwen-cn/ZHIPU/GLM-5.3-Flash',
      maxContextSize: 1_000_000,
      maxOutputSize: 128_000,
    });
  });
});
