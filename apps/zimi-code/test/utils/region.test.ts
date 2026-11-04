import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  currentZimiRegion,
  refreshZimiRegion,
  regionForBareLogin,
  resetZimiRegionCache,
} from '#/utils/region';

const originalEnv = { ...process.env };

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'zimi-region-test-'));
  process.env['ZIMI_CODE_HOME'] = home;
  delete process.env['ZIMI_CODE_OAUTH_HOST'];
  delete process.env['ZIMI_OAUTH_HOST'];
  delete process.env['ZIMI_CODE_REGION_MARKER'];
  resetZimiRegionCache();
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetZimiRegionCache();
  rmSync(home, { recursive: true, force: true });
});

describe('currentZimiRegion', () => {
  it('follows the install-channel marker before the first login', () => {
    writeFileSync(join(home, 'region'), 'global\n');
    expect(refreshZimiRegion()).toBe('global');
    expect(currentZimiRegion()).toBe('global');
  });

  it('ignores the marker when ZIMI_CODE_REGION_MARKER=off (embedded server)', () => {
    writeFileSync(join(home, 'region'), 'global\n');
    process.env['ZIMI_CODE_REGION_MARKER'] = 'off';
    expect(refreshZimiRegion()).toBe('mainland-cn');
  });

  it('still honors a persisted global login when the marker is opted out', () => {
    writeFileSync(join(home, 'region'), 'global\n');
    writeFileSync(
      join(home, 'config.toml'),
      [
        '[providers."managed:zimi-code"]',
        'type = "zimi"',
        '',
        '[providers."managed:zimi-code".oauth]',
        'storage = "file"',
        'key = "oauth/zimi-code-env-0123456789abcdef"',
        'oauthHost = "https://auth.kimi.ai"',
        '',
      ].join('\n'),
    );
    process.env['ZIMI_CODE_REGION_MARKER'] = 'off';
    expect(refreshZimiRegion()).toBe('global');
  });
});

describe('regionForBareLogin', () => {
  it('follows the resolved region for a fresh install (no persisted ref)', () => {
    writeFileSync(join(home, 'region'), 'mainland-cn\n');
    expect(regionForBareLogin(undefined)).toBe('mainland-cn');
    writeFileSync(join(home, 'region'), 'global\n');
    resetZimiRegionCache();
    expect(regionForBareLogin(undefined)).toBe('global');
  });

  it('re-pins mainland-cn for the default slot', () => {
    expect(regionForBareLogin({ key: 'oauth/zimi-code' })).toBe('mainland-cn');
  });

  it('keeps the configured environment for a scoped slot without a persisted host', () => {
    expect(regionForBareLogin({ key: 'oauth/zimi-code-env-0123456789abcdef' })).toBeUndefined();
  });

  it('keeps the persisted environment for a global login', () => {
    expect(
      regionForBareLogin({
        key: 'oauth/zimi-code-env-0123456789abcdef',
        oauthHost: 'https://auth.kimi.ai',
      }),
    ).toBeUndefined();
  });
});
