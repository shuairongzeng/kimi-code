import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  MenuItem,
  shell,
} from 'electron';
import { ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Renderer-facing channel names; must stay in sync with src/preload.ts.
// Every ipcRenderer.invoke channel carries the 'zimi-desktop:' prefix.
// 'menu-action' is the main -> renderer push event the web bundle's
// onMenuAction bridge subscribes to.
const CHANNEL_OPEN_EXTERNAL = 'zimi-desktop:openExternal';
const CHANNEL_SET_ONBOARDED = 'zimi-desktop:setOnboarded';
const CHANNEL_SHOW_WINDOW = 'zimi-desktop:showWindow';
const CHANNEL_WRITE_CLIPBOARD = 'zimi-desktop:writeClipboardText';
const RENDERER_MENU_ACTION = 'menu-action';

const SERVER_READY_URL = /http:\/\/127\.0\.0\.1:(\d+)\/#token=([A-Za-z0-9._-]+)/;
const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;
const HANDSHAKE_TIMEOUT_MS = 30_000;
const LOAD_RETRIES = 3;
const LOAD_RETRY_DELAY_MS = 1_000;
const STDERR_TAIL_LINES = 20;
const KILL_GRACE_MS = 2_000;

let mainWindow: BrowserWindow | null = null;
let serverProc: ChildProcess | null = null;
let serverUrl: string | null = null;
let killingServer = false;
let loadRetriesLeft = LOAD_RETRIES;

function resolveCliEntry(): string {
  // Packaged: electron-builder.yml maps ../zimi-code/dist -> <resources>/cli/dist
  if (app.isPackaged) {
    return join(process.resourcesPath, 'cli', 'dist', 'main.mjs');
  }
  // Dev: apps/zimi-desktop/dist -> apps/zimi-desktop -> apps, where the
  // CLI workspace apps/zimi-code/dist/main.mjs lives.
  return join(__dirname, '..', '..', 'zimi-code', 'dist', 'main.mjs');
}

function quitAfterServerKilled(): void {
  killServer(() => app.quit());
}

function fatal(title: string, message: string): void {
  dialog.showErrorBox(title, message);
  quitAfterServerKilled();
}

function killServer(done?: () => void): void {
  const proc = serverProc;
  if (!proc || proc.killed || proc.exitCode !== null) {
    if (done) done();
    return;
  }
  killingServer = true;
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    clearTimeout(graceTimer);
    if (done) done();
  };
  // SIGTERM first so the CLI can shut down gracefully. On Windows
  // child.kill() does not reach grandchildren the CLI may have spawned,
  // so after the grace period falls back to `taskkill /pid <pid> /t /f`,
  // which tears the whole tree down. On other platforms SIGKILL applies.
  const graceTimer = setTimeout(() => {
    if (finished) return;
    if (process.platform === 'win32' && proc.pid !== undefined) {
      try {
        spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], {
          stdio: 'ignore',
        });
      } catch {
        // best effort; the process may already be gone
      }
      setTimeout(finish, 250);
    } else {
      try {
        proc.kill('SIGKILL');
      } catch {
        // already dead
      }
    }
  }, KILL_GRACE_MS);
  try {
    proc.kill('SIGTERM');
  } catch {
    // fall through to the timer fallback
  }
  proc.once('exit', finish);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showErrorPage(win: BrowserWindow, title: string, detail: string): void {
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'body{background:#0d1117;color:#e6edf3;font:14px/1.6 system-ui,sans-serif;margin:48px auto;max-width:680px;padding:0 24px}' +
    'h1{font-size:18px;margin:0 0 16px}' +
    'pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,monospace;color:#8b949e}' +
    '</style></head><body><h1>' +
    escapeHtml(title) +
    '</h1><pre>' +
    escapeHtml(detail) +
    '</pre></body></html>';
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function createWindow(url: string): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = win;
  // Show only once the page has painted to avoid a white flash.
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
  });
  win.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (win.isDestroyed() || !isMainFrame) return;
      // -3 is ERR_ABORTED, fired for cancelled navigations; not a real failure.
      if (errorCode === -3) return;
      if (loadRetriesLeft <= 0) {
        fatal(
          'Unable to load zimi',
          'The zimi web UI failed to load.\n\n' +
            'URL: ' +
            validatedURL +
            '\nCode: ' +
            errorCode +
            ' ' +
            errorDescription
        );
        return;
      }
      loadRetriesLeft -= 1;
      setTimeout(() => {
        if (!win.isDestroyed()) win.loadURL(url);
      }, LOAD_RETRY_DELAY_MS);
    }
  );
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  void win.loadURL(url);
}

function installMenu(): void {
  // Keep Electron's default application menu and append a custom top-level
  // item. Its click reaches the web UI through the kimiDesktop.onMenuAction
  // bridge ('open-settings' opens the settings view in the web bundle).
  const menu = Menu.getApplicationMenu() ?? Menu.buildFromTemplate([]);
  menu.append(
    new MenuItem({
      label: 'zimi',
      submenu: Menu.buildFromTemplate([
        {
          label: 'Open Settings',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(RENDERER_MENU_ACTION, 'open-settings');
            }
          },
        },
      ]),
    })
  );
  Menu.setApplicationMenu(menu);
}

function registerIpc(): void {
  ipcMain.handle(CHANNEL_OPEN_EXTERNAL, (_event, url: unknown) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
  });
  ipcMain.handle(CHANNEL_WRITE_CLIPBOARD, (_event, text: unknown): boolean => {
    if (typeof text !== 'string') return false;
    clipboard.writeText(text);
    return true;
  });
  // Onboarding state is persisted by the web app through the server API;
  // the bridge only notifies main so future shell logic can react.
  ipcMain.handle(CHANNEL_SET_ONBOARDED, () => undefined);
  ipcMain.handle(CHANNEL_SHOW_WINDOW, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function startServer(): void {
  const cliEntry = resolveCliEntry();
  if (!existsSync(cliEntry)) {
    fatal(
      'zimi CLI not found',
      'Expected the zimi CLI entry at:\n' +
        cliEntry +
        '\n\nBuild the CLI first (pnpm --filter zimi-code build), then restart zimi desktop.'
    );
    return;
  }

  const stderrTail: string[] = [];
  // Electron ships its own Node; ELECTRON_RUN_AS_NODE turns the Electron
  // binary into a plain node runtime for the CLI server process.
  const proc = spawn(process.execPath, [cliEntry, 'web', '--no-open'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc = proc;

  const handshakeTimer = setTimeout(() => {
    if (serverUrl) return;
    fatal(
      'zimi failed to start',
      'The zimi web server did not report a URL within ' +
        HANDSHAKE_TIMEOUT_MS / 1000 +
        ' seconds.\n\n' +
        stderrTail.join('\n')
    );
  }, HANDSHAKE_TIMEOUT_MS);

  let stdoutBuffer = '';
  proc.stdout!.on('data', (chunk: Buffer) => {
    if (serverUrl) return;
    stdoutBuffer += chunk.toString('utf8');
    const match = SERVER_READY_URL.exec(stdoutBuffer.replace(ANSI_ESCAPE, ''));
    if (match) {
      serverUrl = match[0];
      clearTimeout(handshakeTimer);
      console.log('[zimi-desktop] server ready at', serverUrl);
      createWindow(serverUrl);
    }
  });
  proc.stderr!.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    console.error('[zimi-desktop] cli stderr:', text);
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) continue;
      stderrTail.push(line);
      while (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
    }
  });
  proc.on('exit', (code, signal) => {
    if (killingServer) return;
    clearTimeout(handshakeTimer);
    const detail =
      'The zimi server exited unexpectedly (code ' +
      (code ?? 'null') +
      ', signal ' +
      (signal ?? 'null') +
      ').\n\n' +
      stderrTail.join('\n');
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Window is up: swap its contents for an error page, then quit once
      // the user has had a moment to read it.
      showErrorPage(mainWindow, 'zimi stopped', detail);
      setTimeout(() => app.quit(), 8_000);
    } else {
      fatal('zimi stopped', detail);
    }
  });
  proc.on('error', (err) => {
    clearTimeout(handshakeTimer);
    fatal('Failed to start zimi', String(err));
  });
}

function main(): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    installMenu();
    registerIpc();
    startServer();
  });

  app.on('window-all-closed', () => {
    // Quit on every platform (including win32): the server process must
    // never outlive the app.
    quitAfterServerKilled();
  });

  app.on('will-quit', (event) => {
    // Ensure the server tree is torn down before the app exits.
    if (serverProc && !serverProc.killed && serverProc.exitCode === null) {
      event.preventDefault();
      quitAfterServerKilled();
    }
  });
}

main();
