import { describe, expect, it } from 'vitest';
import { convertImports } from '#/app/importConfig/convert';
import type { ImportReport } from '#/app/importConfig/index';

describe('convertImports', () => {
  it('maps provider protocol to zimi type and prefixes provider id with source', () => {
    const report: ImportReport = {
      source: 'omp',
      homeDir: '/home/u',
      providers: [
        {
          id: 'zhipu',
          protocol: 'anthropic',
          baseUrl: 'https://open.bigmodel.cn/api/anthropic',
          apiKey: 'key-1',
          models: [
            {
              id: 'GLM-5.2',
              displayName: 'GLM-5.2',
              maxContextSize: 1_000_000,
              maxOutputSize: 16_384,
              capabilities: ['text', 'image', 'reasoning'],
            },
          ],
        },
      ],
    };

    const converted = convertImports([report]);

    expect(converted.providers['zhipu']).toEqual({
      type: 'anthropic',
      apiKey: 'key-1',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      source: { imported: 'omp', origin: 'zhipu' },
    });
    expect(converted.models['zhipu/GLM-5.2']).toEqual({
      provider: 'zhipu',
      model: 'GLM-5.2',
      maxContextSize: 1_000_000,
      maxOutputSize: 16_384,
      displayName: 'GLM-5.2',
      capabilities: ['text', 'image', 'reasoning'],
    });
  });

  it('rewrites the source default model to the imported alias namespace', () => {
    const report: ImportReport = {
      source: 'omp',
      homeDir: '/home/u',
      defaultModel: 'aliyun/qwen3.8-max-0902',
      providers: [
        {
          id: 'aliyun',
          protocol: 'openai',
          baseUrl: 'https://dashscope.example/v1',
          models: [{ id: 'qwen3.8-max-0902' }],
        },
      ],
    };

    const converted = convertImports([report]);

    expect(converted.defaultModel).toBe('aliyun/qwen3.8-max-0902');
  });

  it('skips providers that already exist in config when skipExisting is given', () => {
    const report: ImportReport = {
      source: 'pi',
      homeDir: '/home/u',
      providers: [
        { id: 'anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', models: [] },
      ],
    };

    const converted = convertImports([report], { skipExisting: (id) => id === 'anthropic' });

    expect(converted.providers['anthropic']).toBeUndefined();
    expect(converted.models['anthropic/*']).toBeUndefined();
  });

  it('backfills models for a provider that exists but lost its model aliases', () => {
    const report: ImportReport = {
      source: 'omp',
      homeDir: '/home/u',
      providers: [
        {
          id: 'deepseek',
          protocol: 'anthropic',
          baseUrl: 'https://api.deepseek.com/anthropic',
          apiKey: 'k',
          models: [{ id: 'deepseek-v4-flash', displayName: 'flash', maxContextSize: 900000 }],
        },
      ],
    };

    // Provider already in config (skip), models absent (backfill).
    const converted = convertImports([report], {
      skipExisting: (id) => id === 'deepseek',
      skipExistingModel: (alias) => alias === 'deepseek/other-model',
    });

    expect(converted.providers['deepseek']).toBeUndefined();
    expect(converted.models['deepseek/deepseek-v4-flash']).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      maxContextSize: 900000,
    });
  });

  it('skips model aliases that already exist when skipExistingModel is given', () => {
    const report: ImportReport = {
      source: 'omp',
      homeDir: '/home/u',
      providers: [
        {
          id: 'zhipu',
          protocol: 'anthropic',
          baseUrl: 'https://open.bigmodel.cn/api/anthropic',
          apiKey: 'k',
          models: [{ id: 'GLM-5.2' }, { id: 'GLM-4.7' }],
        },
      ],
    };

    const converted = convertImports([report], {
      skipExisting: (id) => id === 'zhipu',
      skipExistingModel: (alias) => alias === 'zhipu/GLM-5.2',
    });

    expect(converted.models['zhipu/GLM-5.2']).toBeUndefined();
    expect(converted.models['zhipu/GLM-4.7']).toBeDefined();
  });

  it('leaves defaultModel undefined when the source default is not among imported models', () => {
    const report: ImportReport = {
      source: 'zcode',
      homeDir: '/home/u',
      defaultModel: 'magpie/unknown-model',
      providers: [{ id: 'magpie', protocol: 'openai', baseUrl: 'https://x', models: [{ id: 'other' }] }],
    };

    expect(convertImports([report]).defaultModel).toBeUndefined();
  });
});
