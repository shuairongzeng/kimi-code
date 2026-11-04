import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { resolveLegacySourceHome, sameLegacyPath } from '#/migration/legacy-source';

const HOME = '/home/user';
const CWD = '/work/project';

describe('resolveLegacySourceHome', () => {
  it('defaults to ~/.zimi when ZIMI_SHARE_DIR is unset', () => {
    const r = resolveLegacySourceHome({}, HOME, CWD);
    expect(r).toEqual({ sourceHome: join(HOME, '.zimi'), origin: 'default' });
  });

  it('defaults to ~/.zimi when ZIMI_SHARE_DIR is empty or blank', () => {
    expect(resolveLegacySourceHome({ ZIMI_SHARE_DIR: '' }, HOME, CWD).origin).toBe('default');
    expect(resolveLegacySourceHome({ ZIMI_SHARE_DIR: '   ' }, HOME, CWD).origin).toBe('default');
  });

  it('uses an absolute ZIMI_SHARE_DIR verbatim', () => {
    const r = resolveLegacySourceHome({ ZIMI_SHARE_DIR: '/data/zimi' }, HOME, CWD);
    expect(r.sourceHome).toBe('/data/zimi');
    expect(r.origin).toBe('share-dir');
  });

  it('resolves a relative ZIMI_SHARE_DIR against the process CWD (old-CLI rule)', () => {
    const r = resolveLegacySourceHome({ ZIMI_SHARE_DIR: 'relative/zimi' }, HOME, CWD);
    expect(r.sourceHome).toBe(join(CWD, 'relative', 'zimi'));
    expect(r.origin).toBe('share-dir');
  });

  it('does not expand ~ in ZIMI_SHARE_DIR (old-CLI rule)', () => {
    const r = resolveLegacySourceHome({ ZIMI_SHARE_DIR: '~/custom' }, HOME, CWD);
    expect(r.sourceHome).toBe(join(CWD, '~/custom'));
  });

  it('resolves skills from ~/.zimi when the share dir is redirected', () => {
    const r = resolveLegacySourceHome({ ZIMI_SHARE_DIR: '/data/zimi' }, HOME, CWD);
    expect(r.skillsSourceHome).toBe(join(HOME, '.zimi'));
  });

  it('keeps a single source when ZIMI_SHARE_DIR points at ~/.zimi itself', () => {
    const r = resolveLegacySourceHome({ ZIMI_SHARE_DIR: join(HOME, '.zimi') }, HOME, CWD);
    expect(r.skillsSourceHome).toBeUndefined();
  });
});

describe('sameLegacyPath', () => {
  it('matches identical and redundant forms', () => {
    expect(sameLegacyPath('/a/b', '/a/b')).toBe(true);
    expect(sameLegacyPath('/a/b/', '/a/b')).toBe(true);
    expect(sameLegacyPath('/a/./b', '/a/b')).toBe(true);
  });

  it('rejects different paths', () => {
    expect(sameLegacyPath('/a/b', '/a/c')).toBe(false);
  });
});
