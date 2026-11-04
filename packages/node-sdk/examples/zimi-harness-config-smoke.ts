import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createZimiHarness } from '@zimi-ai/zimi-code-sdk';

import { smokeIdentityFromEnv } from './runtime-smoke-helpers';

async function main(): Promise<void> {
  const homeDir = await mkdtemp(join(tmpdir(), 'zimi-harness-config-home-'));
  const harness = createZimiHarness({ homeDir, identity: smokeIdentityFromEnv() });

  const initial = await harness.getConfig();
  if (Object.keys(initial.providers).length > 0) {
    throw new Error('expected empty providers for a fresh config home');
  }

  await harness.setConfig({
    defaultModel: 'zimi-code/kimi-for-coding',
    thinking: { enabled: true },
    defaultPermissionMode: 'manual',
    defaultPlanMode: false,
    providers: {
      'managed:zimi-code': {
        type: 'zimi',
        baseUrl: 'https://api.kimi.com/coding/v1',
        apiKey: '',
        oauth: { storage: 'file', key: 'oauth/zimi-code' },
      },
    },
    models: {
      'zimi-code/kimi-for-coding': {
        provider: 'managed:zimi-code',
        model: 'kimi-for-coding',
        maxContextSize: 262144,
        capabilities: ['image_in', 'thinking', 'video_in'],
        displayName: 'Zimi for Coding',
      },
    },
    loopControl: {
      maxRetriesPerStep: 3,
      maxRalphIterations: 0,
      reservedContextSize: 50000,
      compactionTriggerRatio: 0.85,
    },
    services: {
      zimiSearch: {
        baseUrl: 'https://api.kimi.com/coding/v1/search',
        apiKey: '',
        oauth: { storage: 'file', key: 'oauth/zimi-code' },
      },
      zimiFetch: {
        baseUrl: 'https://api.kimi.com/coding/v1/fetch',
        apiKey: '',
        oauth: { storage: 'file', key: 'oauth/zimi-code' },
      },
    },
  });

  const configPath = join(homeDir, 'config.toml');
  const text = await readFile(configPath, 'utf-8');
  for (const expected of [
    'default_model = "zimi-code/kimi-for-coding"',
    'default_permission_mode = "manual"',
    '[providers."managed:zimi-code"]',
    '[providers."managed:zimi-code".oauth]',
    '[models."zimi-code/kimi-for-coding"]',
    '[services.zimi_search]',
  ]) {
    if (!text.includes(expected)) {
      throw new Error(`missing ${expected} in written config`);
    }
  }

  const reloaded = await harness.getConfig({ reload: true });
  if (reloaded.defaultModel !== 'zimi-code/kimi-for-coding') {
    throw new Error('reloaded config did not preserve defaultModel');
  }
  if (reloaded.providers['managed:zimi-code']?.oauth?.key !== 'oauth/zimi-code') {
    throw new Error('reloaded config did not preserve provider oauth');
  }

  process.stdout.write(`config: ${configPath}\n`);
  process.stdout.write('ok\n');
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
