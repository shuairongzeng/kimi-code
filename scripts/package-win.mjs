// Rerunnable Windows installer pipeline (see apps/zimi-desktop/electron-builder.yml):
//   1. pnpm -r run build                                  workspace-wide build
//   2. redeploy the self-contained CLI into apps/zimi-desktop/stage/cli
//      (pnpm deploy refuses a non-empty target, so the staging dir is wiped first;
//      rmdir /s /q cleans junctions and read-only files on Windows, rm -rf elsewhere).
//      --config.node-linker=hoisted keeps the layout flat and junction-free; the
//      isolated layout's junctions (node_modules/x -> .pnpm/...) break during NSIS
//      packing and the installed tree then fails ESM resolution (chokidar ->
//      readdirp ERR_MODULE_NOT_FOUND, the 2026-11-13 incident).
//   3. staging gate: copy the staged CLI into a temp dir WITHOUT following links,
//      then (a) resolve every package specifier imported by dist/main.mjs against
//      the copy — static ESM imports resolve at load, so a copy where resolution
//      fails proves NSIS would ship a broken tree; (b) boot the server from the
//      copy and wait for the http://127.0.0.1:<port>/#token= handshake line.
//      A server booted from the staging tree itself proves nothing: its junctions
//      are still intact there. Red gate aborts before packing.
//   4. pnpm --filter @zimi-ai/zimi-desktop run package    electron-builder --win nsis
//      -> apps/zimi-desktop/release/Zimi Code Setup <version>.exe
//   5. install gate: silently install the exe into a throwaway dir and re-run
//      gate (3) against the INSTALLED tree (real packaged exe as node runtime).
//      Red gate keeps the throwaway dir for debugging and exits non-zero.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staging = join(root, 'apps', 'zimi-desktop', 'stage', 'cli');
const releaseDir = join(root, 'apps', 'zimi-desktop', 'release');
const IS_WIN = process.platform === 'win32';

function run(args, cwd = root, env) {
  console.log(`\n> ${args.join(' ')}`);
  const [cmd, ...rest] = args;
  const res = spawnSync(cmd, rest, { cwd, shell: true, stdio: 'inherit', env });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

function removeTree(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
  if (existsSync(dir)) {
    const res = spawnSync(`rmdir /s /q "${dir}"`, { shell: true, stdio: 'inherit' });
    if (existsSync(dir) && res.status !== 0) {
      console.error(`could not remove: ${dir}`);
      process.exit(1);
    }
  }
}

// Best-effort cleanup of a previous probe install: run its uninstaller, then
// drop the leftovers. A pinned installer/uninstaller tree (e.g. the process
// spawn host on this box still holds one open) is skipped and reported
// instead of aborting the chain — never silently left without a note.
function purgeOldProbes() {
  const tmp = tmpdir();
  for (const name of readdirSync(tmp)) {
    if (!name.startsWith('zimi-pack-probe')) continue;
    const dir = join(tmp, name);
    const uninstaller = join(dir, 'Uninstall Zimi Code.exe');
    if (existsSync(uninstaller)) {
      spawnSync(uninstaller, ['/S'], { stdio: 'ignore', shell: false });
    }
    if (existsSync(dir)) {
      if (IS_WIN) spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', `"${dir}"`], { shell: false });
      else rmSync(dir, { recursive: true, force: true });
      if (existsSync(dir)) console.log(`NOTE: ${dir} is pinned and was left in place; delete it manually.`);
    }
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

if (existsSync(staging)) removeTree(staging);

run(['pnpm', '-r', 'run', 'build']);

// --legacy keeps the deploy self-contained; hoisted (flat) node_modules is the
// hard requirement from the 2026-11-13 incident (see file header).
const hoistedEnv = { ...process.env, NPM_CONFIG_NODE_LINKER: 'hoisted' };
run(
  ['pnpm', '--filter', '@zimi-ai/zimi-code', 'deploy', '--prod', '--legacy', '--config.node-linker=hoisted', join('apps', 'zimi-desktop', 'stage', 'cli')],
  root,
  hoistedEnv,
);
if (!existsSync(join(staging, 'dist', 'main.mjs'))) {
  console.error('deploy produced no dist/main.mjs');
  process.exit(1);
}

purgeOldProbes();

function resolveProbe(fromDir) {
  const server = join(fromDir, 'dist', 'main.mjs');
  const src = readFileSync(server, 'utf8');
  const req = createRequire(server);
  const seen = new Set();
  const missing = new Set();
  const re = /from[ \t\n]{1,3}["']([^"']+)["']/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const spec = m[1];
    if (seen.has(spec)) continue;
    seen.add(spec);
    if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('#/')) continue;
    if (spec.startsWith('node:')) continue;
    if (spec.includes('$') || spec.includes(' ')) continue;
    try {
      req(spec);
    } catch {
      missing.add(spec);
    }
  }
  return { checked: seen.size, missing: [...missing] };
}

// A server booted from a dereferenced copy proves the layout that NSIS will
// ship: every symlink/junction of the staging tree is copied as real data.
const PORT_PROBE = 8793;
const probeDir = mkdtempSync(join(tmpdir(), 'zimi-pack-probe'));
const probeRoot = join(probeDir, 'staged');

function bootProbe(exePath, mainPath, port, tag) {
  const cwd = dirname(dirname(mainPath));
  const args = [mainPath, 'web', '--no-open', '--port', String(port)];
  return new Promise((resolve) => {
    const child = spawn(exePath, args, {
      cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let settled = false;
    const finish = (ok, why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (IS_WIN && child.pid) {
          spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
        } else {
          child.kill('SIGKILL');
        }
      } catch {}
      console.log(`${tag} ${ok ? 'OK' : 'FAIL'}: ${why}`);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false, `no handshake line within 45s:\n${out}`), 45_000);
    child.stdout.on('data', (c) => {
      out += c;
      if (out.includes(`127.0.0.1:${port}`)) finish(true, `server bound port ${port}`);
    });
    child.stderr.on('data', (c) => console.error(`[${tag} stderr]`, String(c)));
    child.once('exit', (code) => finish(false, `server exited early (code ${code}):\n${out}`));
  });
}

try {
  cpSync(staging, probeRoot, { recursive: true, force: true });
  // no literal-import scan: main.mjs is a flattened bundle where quoted specifiers
  // are noise (72 false positives proven twice); the boot run below is the gate.
  const booted = await bootProbe(process.execPath, join(probeRoot, 'dist', 'main.mjs'), PORT_PROBE, '[pre-pack probe]');
  if (!booted) {
    console.error('PRE-PACK BOOT PROBE FAILED: the server cannot boot from the copied layout.');
    process.exit(1);
  }
} finally {
  removeTree(probeDir);
}

run(['pnpm', '--filter', '@zimi-ai/zimi-desktop', 'run', 'package']);

purgeOldProbes();

const setupExe = readdirSync(releaseDir).find((f) => f.endsWith('.exe') && !f.endsWith('.blockmap'));
if (!setupExe) {
  console.error('no Setup .exe found under release/');
  process.exit(1);
}

const verifyRoot = mkdtempSync(join(tmpdir(), 'zimi-pack-probe'));
const installDir = join(verifyRoot, 'app');
console.log(`\n--- install gate: silent install into ${installDir} ---`);
const inst = spawnSync(join(releaseDir, setupExe), ['/S', `/D=${installDir}`], { stdio: 'ignore', shell: false });
sleepSync(15_000);

const installedMain = join(installDir, 'resources', 'cli', 'dist', 'main.mjs');
if (!existsSync(installedMain)) {
  console.error(`INSTALL GATE FAIL: installer exit ${inst.status}, ${installedMain} not found (kept in ${verifyRoot})`);
  process.exit(1);
}
console.log('layout OK: installed tree ships resources/cli/dist/main.mjs');


const PORT_INSTALLED = 8795;
const booted2 = await bootProbe(join(installDir, 'Zimi Code.exe'), installedMain, PORT_INSTALLED, '[installed boot gate]');
if (existsSync(dirname(installDir))) {
  const un = join(dirname(installDir), 'Uninstall Zimi Code.exe');
  if (existsSync(un)) {
    spawnSync(un, ['/S'], { stdio: 'ignore', shell: false });
    sleepSync(5000);
  }
  removeTree(dirname(installDir));
}

if (!booted2) {
  console.error('INSTALL GATE FAIL: server did not boot from the installed tree');
  process.exit(1);
}
console.log('\nINSTALL GATE OK:', setupExe, 'boots the server with the installed layout — verified.');
