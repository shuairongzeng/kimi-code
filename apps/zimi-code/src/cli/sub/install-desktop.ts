import type { Command } from 'commander';

import { zimiCodeOfficialInstallUrl } from '#/constant/app';
import { openUrl } from '#/utils/open-url';

function openDesktopAppPage(): void {
  const url = zimiCodeOfficialInstallUrl();
  process.stdout.write(`${url}\n`);
  openUrl(url);
}

export function registerInstallDesktopCommand(program: Command): void {
  program
    .command('install-desktop')
    .description('Print the Zimi Code desktop app page and open it in your browser.')
    .action(openDesktopAppPage);

  program.command('install-app', { hidden: true }).action(openDesktopAppPage);
}
