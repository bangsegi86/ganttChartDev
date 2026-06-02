import { clipboard, contextBridge, ipcRenderer } from 'electron';

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

type MenuAction =
  | 'menu:new-project'
  | 'menu:open-projects'
  | 'menu:save'
  | 'menu:export-excel'
  | 'menu:export-png'
  | 'menu:export-pdf'
  | 'menu:zoom-in'
  | 'menu:zoom-out'
  | 'menu:zoom-reset'
  | 'menu:share-export'
  | 'menu:share-import';

const bridge = {
  menu: {
    onAction: (callback: (action: MenuAction) => void) => {
      const actions: MenuAction[] = [
        'menu:new-project',
        'menu:open-projects',
        'menu:save',
        'menu:export-excel',
        'menu:export-png',
        'menu:export-pdf',
        'menu:zoom-in',
        'menu:zoom-out',
        'menu:zoom-reset',
        'menu:share-export',
        'menu:share-import',
      ];
      const listeners = actions.map((ch) => {
        const fn = () => callback(ch);
        ipcRenderer.on(ch, fn);
        return { ch, fn } as const;
      });
      return () => listeners.forEach(({ ch, fn }) => ipcRenderer.removeListener(ch, fn));
    },
  },
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
  project: {
    exportFile: (defaultName: string, json: string): Promise<PersistenceResult> =>
      ipcRenderer.invoke('project:export-file', defaultName, json),
    importFile: (): Promise<PersistenceResult> =>
      ipcRenderer.invoke('project:import-file'),
  },
  // Native clipboard — works under file:// where navigator.clipboard is
  // unavailable (file:// is not a secure context in Chromium).
  clipboard: {
    readText: (): string => clipboard.readText(),
    writeText: (text: string): void => clipboard.writeText(text),
  },
};

export type AppBridge = typeof bridge;

contextBridge.exposeInMainWorld('app', bridge);
