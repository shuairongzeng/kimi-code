import { setTelemetryContext, track, withTelemetryContext } from '@zimi-ai/zimi-telemetry';
import { createZimiHarness, type TelemetryClient } from '@zimi-ai/zimi-code-sdk';
import { ProcessTerminal, TuiMainScreen } from '@zimi-ai/pi-tui';
import type { Command } from 'commander';

import { createCliTelemetryBootstrap } from '#/cli/telemetry';
import { createZimiCodeHostIdentity } from '#/cli/host-identity';

import { importBudget, importSessions, scanImportableSessions, sourceHomes } from './run-import';
import { ImportSessionsScreenComponent } from './screen';

export function registerImportSessionsCommand(
  parent: Command,
  run: () => Promise<number> = runImportSessionsCommand,
): void {
  parent
    .command('import-sessions')
    .description('Import recent Claude Code and Codex sessions into Zimi Code.')
    .action(async () => {
      process.exitCode = await run();
    });
}

/** `zimi import-sessions`: show only the import page in a bare terminal UI, then exit. */
export async function runImportSessionsCommand(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('zimi import-sessions needs an interactive terminal.\n');
    return 1;
  }
  const telemetry: TelemetryClient = { track, withContext: withTelemetryContext, setContext: setTelemetryContext };
  const harness = createZimiHarness({
    homeDir: createCliTelemetryBootstrap().homeDir,
    identity: createZimiCodeHostIdentity(),
    telemetry,
  });
  try {
    const zimiHome = harness.homeDir;
    const budget = importBudget(await harness.getConfig().catch(() => ({})));
    const now = Date.now();
    const homes = sourceHomes();
    const ui = new TuiMainScreen(new ProcessTerminal());
    await new Promise<void>((resolve) => {
      const screen = new ImportSessionsScreenComponent({
        now,
        scan: () => scanImportableSessions({ zimiHome, ...homes, now }),
        run: (candidates, hooks) => importSessions(candidates, { zimiHome, ...budget, now, ...hooks }),
        requestRender: () => {
          ui.requestRender();
        },
        onClose: () => {
          resolve();
        },
      });
      ui.addChild(screen);
      ui.setFocus(screen);
      ui.start();
    });
    ui.stop();
    return 0;
  } finally {
    await harness.close();
  }
}
