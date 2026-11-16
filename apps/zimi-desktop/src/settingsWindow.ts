import { BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { SETTINGS_HTML } from './settingsHtml';

// One hidden-until-painted window per app instance, re-focused and
// re-loaded on repeat activation so its data never goes stale behind a
// second window. It loads the self-contained HTML from settingsHtml.ts and
// talks to the embedded server exclusively through the 'zimi-settings:req'
// proxy below — the bearer token stays in this process.

let settingsWin: BrowserWindow | null = null;
let serverBase: string | null = null;
let bearerToken: string | null = null;

export function setServerUrl(url: string): void {
  const parsed = new URL(url);
  serverBase = parsed.origin;
  const token = new URLSearchParams(parsed.hash.replace(/^#/, '')).get('token');
  bearerToken = token ?? null;
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.reload();
}

export function openSettingsWindow(): void {
  if (!serverBase) {
    dialog.showErrorBox('zimi server not ready', 'The embedded server has not reported its port yet; open Settings again once the main window is up.');
    return;
  }
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.reload();
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    backgroundColor: '#0d1117',
    title: 'Zimi Code Settings',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload-settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  settingsWin = win;
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  win.on('closed', () => {
    if (settingsWin === win) settingsWin = null;
  });
  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SETTINGS_HTML));
}

function settingsHeaders(withBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  if (withBody) headers['content-type'] = 'application/json';
  if (bearerToken) headers.authorization = 'Bearer ' + bearerToken;
  return headers;
}

function describeFailure(status: number, payload: unknown): string {
  const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
  if (typeof record.message === 'string') return `${status} ${record.message}`;
  if (typeof record.error === 'string') return `${status} ${record.error}`;
  return `${status} request failed`;
}

export function registerSettingsIpc(): void {
  ipcMain.handle('zimi-settings:req', async (_event, req: { method?: unknown; path?: unknown; body?: unknown }) => {
    if (!serverBase || typeof req?.path !== 'string' || !req.path.startsWith('/api/v1/')) {
      return { ok: false, error: 'unreachable: no server or unexpected path' };
    }
    const method = typeof req.method === 'string' ? req.method : 'GET';
    try {
      const res = await fetch(serverBase + req.path, {
        method,
        headers: settingsHeaders(req.body !== undefined),
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      });
      const text = await res.text();
      let payload: unknown = text;
      try {
        payload = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      if (res.ok && !(typeof payload === 'object' && payload !== null && 'ok' in payload && (payload as { ok: unknown }).ok === false)) {
        return { ok: true, status: res.status, data: payload };
      }
      return { ok: false, status: res.status, error: describeFailure(res.status, payload) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
}


