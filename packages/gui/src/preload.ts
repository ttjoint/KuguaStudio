import { contextBridge, ipcRenderer } from "electron";

declare global {
  interface Window {
    kugua: {
      request: (target: string, action: string, params?: unknown) => Promise<unknown>;
      broadcast: (action: string, params?: unknown) => Promise<unknown>;
      onLog: (callback: (entry: unknown) => void) => void;
      onReady: (callback: () => void) => void;
    };
  }
}

contextBridge.exposeInMainWorld("kugua", {
  request: (target: string, action: string, params?: unknown) =>
    ipcRenderer.invoke("kugua:request", target, action, params),
  broadcast: (action: string, params?: unknown) =>
    ipcRenderer.invoke("kugua:broadcast", action, params),
  onLog: (callback: (entry: unknown) => void) => {
    const handler = (_event: unknown, entry: unknown): void => callback(entry);
    ipcRenderer.on("kugua:log", handler);
  },
  onReady: (callback: () => void) => {
    ipcRenderer.on("kugua:ready", () => callback());
  },
});
