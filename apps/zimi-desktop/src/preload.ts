import { contextBridge, ipcRenderer, webUtils } from 'electron';

// Channel names must stay in sync with src/main.ts.
const CHANNEL_OPEN_EXTERNAL = 'zimi-desktop:openExternal';
const CHANNEL_SET_ONBOARDED = 'zimi-desktop:setOnboarded';
const CHANNEL_SHOW_WINDOW = 'zimi-desktop:showWindow';
const CHANNEL_WRITE_CLIPBOARD = 'zimi-desktop:writeClipboardText';
const RENDERER_MENU_ACTION = 'menu-action';

type MenuAction = string;

const bridge = {
  // Registers a listener for menu actions pushed from the main process.
  // Returns an unsubscribe function the web bundle calls on teardown.
  onMenuAction(cb: (action: MenuAction) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, action: MenuAction): void => {
      cb(action);
    };
    ipcRenderer.on(RENDERER_MENU_ACTION, listener);
    return () => {
      ipcRenderer.removeListener(RENDERER_MENU_ACTION, listener);
    };
  },
  openExternal(url: string): void {
    void ipcRenderer.invoke(CHANNEL_OPEN_EXTERNAL, url);
  },
  setOnboarded(): void {
    void ipcRenderer.invoke(CHANNEL_SET_ONBOARDED);
  },
  showWindow(): void {
    void ipcRenderer.invoke(CHANNEL_SHOW_WINDOW);
  },
  // The web bundle treats a falsy return as "not handled" and falls back to
  // navigator.clipboard, so resolve with whether main actually wrote it.
  writeClipboardText(text: string): Promise<boolean> {
    return ipcRenderer.invoke(CHANNEL_WRITE_CLIPBOARD, text);
  },
  // Resolves the real filesystem path of a File chosen via <input type=file>.
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
};

contextBridge.exposeInMainWorld('kimiDesktop', bridge);

export type KimiDesktopBridge = typeof bridge;
