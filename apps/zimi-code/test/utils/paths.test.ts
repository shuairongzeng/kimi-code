import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getBinDir,
  getDataDir,
  getInputHistoryFile,
  getLogDir,
  getUpdateInstallStateFile,
  getUpdateStateFile,
} from '#/utils/paths';

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env['ZIMI_CODE_HOME'];
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('getDataDir', () => {
  it('returns ~/.zimi-code when ZIMI_CODE_HOME is not set', () => {
    expect(getDataDir()).toBe(join(homedir(), '.zimi-code'));
  });

  it('returns ZIMI_CODE_HOME when set', () => {
    process.env['ZIMI_CODE_HOME'] = '/tmp/zimi-test-data';
    expect(getDataDir()).toBe('/tmp/zimi-test-data');
  });

  it('returns ZIMI_CODE_HOME even if it is a relative path', () => {
    process.env['ZIMI_CODE_HOME'] = 'relative/path';
    expect(getDataDir()).toBe('relative/path');
  });
});

describe('getLogDir', () => {
  it('returns <dataDir>/logs', () => {
    expect(getLogDir()).toBe(join(homedir(), '.zimi-code', 'logs'));
  });

  it('respects ZIMI_CODE_HOME', () => {
    process.env['ZIMI_CODE_HOME'] = '/z';
    expect(getLogDir()).toBe(join('/z', 'logs'));
  });
});

describe('getBinDir', () => {
  it('returns <dataDir>/bin', () => {
    expect(getBinDir()).toBe(join(homedir(), '.zimi-code', 'bin'));
  });

  it('respects ZIMI_CODE_HOME', () => {
    process.env['ZIMI_CODE_HOME'] = '/custom-bin-home';
    expect(getBinDir()).toBe(join('/custom-bin-home', 'bin'));
  });
});

describe('getUpdateStateFile', () => {
  it('returns <dataDir>/updates/latest.json', () => {
    expect(getUpdateStateFile()).toBe(join(homedir(), '.zimi-code', 'updates', 'latest.json'));
  });

  it('respects ZIMI_CODE_HOME', () => {
    process.env['ZIMI_CODE_HOME'] = '/updates-home';
    expect(getUpdateStateFile()).toBe(join('/updates-home', 'updates', 'latest.json'));
  });
});

describe('getUpdateInstallStateFile', () => {
  it('returns <dataDir>/updates/install.json', () => {
    expect(getUpdateInstallStateFile()).toBe(
      join(homedir(), '.zimi-code', 'updates', 'install.json'),
    );
  });

  it('respects ZIMI_CODE_HOME', () => {
    process.env['ZIMI_CODE_HOME'] = '/updates-home';
    expect(getUpdateInstallStateFile()).toBe(join('/updates-home', 'updates', 'install.json'));
  });
});

describe('getInputHistoryFile', () => {
  it('returns <dataDir>/user-history/<md5(workDir)>.jsonl', () => {
    const workDir = '/home/user/project';
    const hash = createHash('md5').update(workDir, 'utf-8').digest('hex');
    expect(getInputHistoryFile(workDir)).toBe(
      join(homedir(), '.zimi-code', 'user-history', `${hash}.jsonl`),
    );
  });

  it('respects ZIMI_CODE_HOME', () => {
    process.env['ZIMI_CODE_HOME'] = '/custom/data';
    const hash = createHash('md5').update('/proj', 'utf-8').digest('hex');
    expect(getInputHistoryFile('/proj')).toBe(
      join('/custom/data', 'user-history', `${hash}.jsonl`),
    );
  });
});
