import { contextBridge, ipcRenderer } from 'electron';

// Privileged bridge for the settings page only. The page itself is loaded
// from a data: URL, so the server origin and the bearer token stay in the
// main process (see settingsWindow.ts); this file just funnels every call
// through a single allow-listed channel.
const api = {
  req(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status?: number; data?: unknown; error?: string }> {
    return ipcRenderer.invoke('zimi-settings:req', { method, path, body });
  },
};

contextBridge.exposeInMainWorld('zimiSettings', api);
