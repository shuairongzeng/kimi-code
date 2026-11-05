import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export interface ResolvedImportEnv {
  readonly homeDir: string;
  readonly readFile: (path: string) => string | undefined;
  readonly exists: (path: string) => boolean;
  readonly joinPath: (...parts: string[]) => string;
}

import type { ImportOptions } from './index';
export function resolveEnv(options: ImportOptions): ResolvedImportEnv {
  return {
    homeDir: options.homeDir ?? process.env['HOME'] ?? process.env['USERPROFILE'] ?? '.',
    readFile: options.readFile ?? ((path) => {
      try {
        return readFileSync(path, 'utf-8');
      } catch {
        return undefined;
      }
    }),
    exists: options.exists ?? ((path) => existsSync(path)),
    joinPath: options.joinPath ?? join,
  };
}

/** Parse JSON, returning undefined on any failure (never throws). */
export function tryJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function asStringArray(value: unknown): readonly string[] | undefined {
  const list = asArray(value);
  if (list === undefined) return undefined;
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') return undefined;
    out.push(item);
  }
  return out;
}
