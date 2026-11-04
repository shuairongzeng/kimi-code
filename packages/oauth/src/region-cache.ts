import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ZimiRegion } from './region';

export const ZIMI_REGION_CACHE_FILENAME = 'region.json';

export interface ZimiRegionCacheRecord {
  readonly version: 1;
  readonly authState: 'logged-out';
  readonly region: ZimiRegion;
  readonly source: 'local-signals';
}

function cachePath(homeDir: string): string {
  return join(homeDir, ZIMI_REGION_CACHE_FILENAME);
}

function parseCache(raw: string): ZimiRegionCacheRecord | undefined {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value['version'] === 1 &&
      value['authState'] === 'logged-out' &&
      (value['region'] === 'mainland-cn' || value['region'] === 'global') &&
      value['source'] === 'local-signals'
    ) {
      return {
        version: 1,
        authState: 'logged-out',
        region: value['region'],
        source: 'local-signals',
      };
    }
  } catch {}
  return undefined;
}

export function readZimiRegionCache(homeDir: string): ZimiRegionCacheRecord | undefined {
  let raw: string;
  try {
    raw = readFileSync(cachePath(homeDir), 'utf-8');
  } catch {
    return undefined;
  }
  const cached = parseCache(raw);
  if (cached === undefined) clearZimiRegionCache(homeDir);
  return cached;
}

export function writeZimiRegionCache(homeDir: string, region: ZimiRegion): void {
  const record: ZimiRegionCacheRecord = {
    version: 1,
    authState: 'logged-out',
    region,
    source: 'local-signals',
  };
  try {
    mkdirSync(homeDir, { recursive: true, mode: 0o700 });
    writeFileSync(cachePath(homeDir), `${JSON.stringify(record)}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch {}
}

export function clearZimiRegionCache(homeDir: string): void {
  try {
    unlinkSync(cachePath(homeDir));
  } catch {}
}
