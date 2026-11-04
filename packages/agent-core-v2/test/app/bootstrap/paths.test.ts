import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureZimiHome, resolveConfigPath, resolveZimiHome } from '#/app/bootstrap/bootstrap';

describe('bootstrap path helpers', () => {
  describe('resolveZimiHome', () => {
    it('uses explicit homeDir when provided', () => {
      expect(resolveZimiHome('/tmp/zimi')).toBe('/tmp/zimi');
    });

    it('falls back to ZIMI_CODE_HOME env', () => {
      const prev = process.env['ZIMI_CODE_HOME'];
      process.env['ZIMI_CODE_HOME'] = '/env/zimi';
      try {
        expect(resolveZimiHome()).toBe('/env/zimi');
      } finally {
        if (prev === undefined) delete process.env['ZIMI_CODE_HOME'];
        else process.env['ZIMI_CODE_HOME'] = prev;
      }
    });
  });

  describe('resolveConfigPath', () => {
    it('uses explicit configPath when provided', () => {
      expect(resolveConfigPath({ configPath: '/x/config.toml' })).toBe('/x/config.toml');
    });

    it('joins homeDir with config.toml', () => {
      expect(resolveConfigPath({ homeDir: '/tmp/zimi' })).toBe('/tmp/zimi/config.toml');
    });
  });

  describe('ensureZimiHome', () => {
    let dir: string | undefined;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('creates the directory with 0700 permissions', () => {
      dir = join(mkdtempSync(join(tmpdir(), 'zimi-home-')), 'nested');
      ensureZimiHome(dir);
      expect(existsSync(dir)).toBe(true);
    });
  });
});
