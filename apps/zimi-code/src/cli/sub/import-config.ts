/**
 * `zimi import-config` sub-command — import third-party coding-agent
 * configuration (omp / kimi-code / pi / zcode) into Zimi Code.
 *
 * Reads each source CLI's config files, converts providers + models + API
 * keys into Zimi's `config.toml` schema, and persists via the SDK `setConfig`
 * (comment-preserving TOML writeback). Dry-run by default; `--yes` applies.
 */

import { createZimiHarness, type ZimiConfig, type ZimiHarness } from '@zimi-ai/zimi-code-sdk';
import type { Command } from 'commander';

import { createZimiCodeHostIdentity } from '#/cli/host-identity';

import {
  convertImports,
  kimiAdapter,
  ompAdapter,
  piAdapter,
  zcodeAdapter,
} from '@zimi-ai/agent-core-v2/app/importConfig/convert';
import { type ImportSourceAdapter, type ImportReport } from '@zimi-ai/agent-core-v2/app/importConfig/index';

interface WritableLike {
  write(chunk: string): boolean;
}
export interface ImportConfigDeps {
  readonly getHarness: () => ZimiHarness;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly exit: (code: number) => never;
}

const SOURCES: readonly ImportSourceAdapter[] = [ompAdapter, kimiAdapter, piAdapter, zcodeAdapter];

interface ImportConfigOptions {
  readonly source?: string;
  readonly yes?: boolean;
  readonly dryRun?: boolean;
}

export async function handleImportConfig(
  deps: ImportConfigDeps,
  opts: ImportConfigOptions,
): Promise<void> {
  const selected = SOURCES.filter((adapter) => {
    if (opts.source === undefined) return true;
    return adapter.name === opts.source;
  });
  if (selected.length === 0) {
    deps.stderr.write(`Unknown source "${opts.source}". Available: ${SOURCES.map((s) => s.name).join(', ')}.\n`);
    deps.exit(1);
  }

  const reports: ImportReport[] = [];
  for (const adapter of selected) {
    if (!adapter.isAvailable({})) continue;
    const report = adapter.read({});
    if (report !== undefined) reports.push(report);
  }

  if (reports.length === 0) {
    deps.stdout.write('No importable configuration found.\n');
    return;
  }

  for (const report of reports) {
    const providers = report.providers
      .map((p) => `${p.id} (${p.protocol}${p.apiKey !== undefined ? ', key' : ''})`)
      .join(', ');
    deps.stdout.write(`Found ${report.source}: ${providers}\n`);
  }

  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const skipExisting = (providerId: string): boolean => config.providers[providerId] !== undefined;
  const skipExistingModel = (alias: string): boolean => config.models?.[alias] !== undefined;
  const converted = convertImports(reports, { skipExisting, skipExistingModel });
  const skippedCount = Object.keys(converted.providers).length;
  const modelCount = Object.keys(converted.models).length;

  if (skippedCount === 0 && modelCount === 0) {
    deps.stdout.write('Nothing new to import (all providers already configured).\n');
    return;
  }

  if (opts.dryRun !== true && opts.yes !== true) {
    deps.stdout.write('Dry run (no changes written). Re-run with --yes to apply.\n');
    return;
  }

  if (opts.yes === true) {
    await harness.setConfig({
      providers: converted.providers as ZimiConfig['providers'],
      models: converted.models as ZimiConfig['models'],
      // Never clobber a default_model the user already chose — only adopt the
      // source CLI's default when none is configured yet.
      ...(converted.defaultModel !== undefined && config.defaultModel === undefined
        ? { defaultModel: converted.defaultModel }
        : {}),
    });
    const modelCount = Object.keys(converted.models).length;
    deps.stdout.write(
      `Imported ${skippedCount} provider(s), ${modelCount} model alias(es)${
        converted.defaultModel !== undefined ? `, default model ${converted.defaultModel}` : ''
      } into config.toml.\n`,
    );
    for (const id of converted.skipped) {
      deps.stdout.write(`Skipped ${id}: unmappable protocol.\n`);
    }
  } else {
    deps.stdout.write('Dry run (no changes written). Re-run with --yes to apply.\n');
  }
}

type ResolvedImportConfigDeps = ImportConfigDeps & { readonly close: () => Promise<void> };

function resolveDeps(overrides: Partial<ImportConfigDeps> = {}): ResolvedImportConfigDeps {
  let harness: ZimiHarness | undefined;
  return {
    getHarness:
      overrides.getHarness ??
      (() => {
        harness ??= createZimiHarness({ identity: createZimiCodeHostIdentity() });
        return harness;
      }),
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    exit: overrides.exit ?? ((code: number) => process.exit(code)),
    close: async () => {
      await harness?.close();
    },
  };
}

export function registerImportConfigCommand(parent: Command): void {
  const cmd = parent
    .command('import-config')
    .description('Import provider/model/API-key configuration from omp, kimi-code, pi, or zcode.');

  cmd
    .option('--source <name>', 'Import only one source: omp, kimi-code, pi, or zcode.')
    .option('--dry-run', 'Preview the conversion without writing config.toml.')
    .option('-y, --yes', 'Apply the import (default is a dry-run preview).', false)
    .action(async (options: ImportConfigOptions) => {
      const resolved = resolveDeps();
      try {
        await handleImportConfig(resolved, {
          source: options.source,
          yes: options.yes,
          dryRun: options.dryRun,
        });
      } catch (error) {
        resolved.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        resolved.exit(1);
      } finally {
        await resolved.close();
      }
    });
}
