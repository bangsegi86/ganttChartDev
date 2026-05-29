import { contextBridge, ipcRenderer } from 'electron';

// The preload script is the *only* surface exposed to the renderer. It is a
// narrow, typed bridge — no raw ipcRenderer, no Node primitives leak through.
export interface PersistenceResult {
  ok: boolean;
  json?: string | null;
  path?: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

const bridge = {
  persistence: {
    save: (id: string, json: string): Promise<PersistenceResult> =>
      ipcRenderer.invoke('persistence:save', id, json),
    load: (id: string): Promise<PersistenceResult> =>
      ipcRenderer.invoke('persistence:load', id),
    list: (): Promise<string[]> => ipcRenderer.invoke('persistence:list'),
    delete: (id: string): Promise<PersistenceResult> =>
      ipcRenderer.invoke('persistence:delete', id),
  },
  autosave: {
    write: (json: string): Promise<PersistenceResult> =>
      ipcRenderer.invoke('autosave:write', json),
    read: (): Promise<PersistenceResult> => ipcRenderer.invoke('autosave:read'),
    clear: (): Promise<PersistenceResult> => ipcRenderer.invoke('autosave:clear'),
  },
  export: {
    saveBinary: (
      defaultName: string,
      base64: string,
      filters: FileFilter[],
    ): Promise<PersistenceResult> =>
      ipcRenderer.invoke('export:save-binary', defaultName, base64, filters),
  },
};

export type AppBridge = typeof bridge;

contextBridge.exposeInMainWorld('app', bridge);
