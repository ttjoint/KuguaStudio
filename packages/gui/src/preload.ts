import { contextBridge, ipcRenderer } from "electron";

declare global {
  interface Window {
    kugua: {
      request: (target: string, action: string, params?: unknown) => Promise<unknown>;
      broadcast: (action: string, params?: unknown) => Promise<unknown>;
      writeTempFile: (payload: { base64?: string; name?: string; ext?: string }) => Promise<string>;
      onLog: (callback: (entry: unknown) => void) => void;
      onReady: (callback: () => void) => void;
      window: {
        minimize: () => Promise<void>;
        toggleMaximize: () => Promise<boolean>;
        close: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
        onMaximized: (callback: (isMax: boolean) => void) => void;
      };
      dialog: {
        openFiles: (options?: {
          title?: string;
          filters?: Array<{ name: string; extensions: string[] }>;
          multi?: boolean;
        }) => Promise<string[]>;
        openImages: () => Promise<string[]>;
      };
    };
  }
}

contextBridge.exposeInMainWorld("kugua", {
  request: (target: string, action: string, params?: unknown) =>
    ipcRenderer.invoke("kugua:request", target, action, params),
  broadcast: (action: string, params?: unknown) =>
    ipcRenderer.invoke("kugua:broadcast", action, params),
  writeTempFile: (payload: { base64?: string; name?: string; ext?: string }) =>
    ipcRenderer.invoke("kugua:writeTempFile", payload),
  onLog: (callback: (entry: unknown) => void) => {
    const handler = (_event: unknown, entry: unknown): void => callback(entry);
    ipcRenderer.on("kugua:log", handler);
  },
  onReady: (callback: () => void) => {
    ipcRenderer.on("kugua:ready", () => callback());
  },
  window: {
    minimize: () => ipcRenderer.invoke("kugua:window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("kugua:window:maximize"),
    close: () => ipcRenderer.invoke("kugua:window:close"),
    isMaximized: () => ipcRenderer.invoke("kugua:window:isMaximized"),
    onMaximized: (callback: (isMax: boolean) => void) => {
      ipcRenderer.on("kugua:window:maximized", (_event, isMax: boolean) => callback(isMax));
    },
  },
  dialog: {
    openFiles: (options?: {
      title?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
      multi?: boolean;
    }) => ipcRenderer.invoke("kugua:dialog:openFiles", options),
    openImages: () => ipcRenderer.invoke("kugua:dialog:openImages"),
  },
});
