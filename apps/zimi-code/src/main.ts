/**
 * Zimi Code process entry.
 *
 * `zimi exec-server` (or the explicit `--listen stdio` spelling) is the
 * remote-executor light entry, and the SSH askpass helper is another light
 * entry: the engine's SSH password retry re-enters this binary as
 * `SSH_ASKPASS`, recognised by its environment rather than argv. Both
 * dispatch before the CLI's static import chain pulls
 * `@zimi-ai/zimi-code-sdk` into module evaluation (full registration,
 * config/OAuth/telemetry/session services). Only node builtins, the light
 * SDK subpaths and these light helpers are imported statically; the regular
 * CLI lives behind a dynamic import so npm and SEA bundles keep both paths
 * free of the SDK mega-module.
 */

import { isSshAskpassEnvironment, runSshAskpass } from '@zimi-ai/zimi-code-sdk/ssh-askpass';

import { isExecServerArgv, runExecServerCommand } from './cli/exec-server';

// Piping into `head`/`less` closes stdout early; without this guard Node
// throws an unhandled 'error' event (EPIPE) mid-write and dumps a stack
// trace instead of exiting quietly like every other Unix CLI.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

if (isSshAskpassEnvironment()) {
  void runSshAskpass().then((code) => {
    process.exitCode = code;
  });
} else if (isExecServerArgv(process.argv)) {
  // stdout is reserved for protocol frames; the runner logs to stderr only.
  // No process.exit: the stdio streams drain on connection EOF and the
  // process exits with this code on its own.
  void runExecServerCommand('stdio').then((code) => {
    process.exitCode = code;
  });
} else {
  void import('./cli/main').then(({ main }) => main());
}
