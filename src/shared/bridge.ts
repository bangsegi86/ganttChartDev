import type { AppBridge } from '../../electron/preload';

/**
 * Typed accessor for the preload bridge. When the renderer runs outside
 * Electron (e.g. `vite` in a plain browser for component work), the bridge is
 * absent and we fall back to a `localStorage`-backed shim so the app still
 * loads and persists.
 */
declare global {
  interface Window {
    app?: AppBridge;
  }
}

const memoryStore = new Map<string, string>();

function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memoryStore.set(key, value);
  }
}

const fallback: AppBridge = {
  menu: {
    onAction: () => () => {},
  },
  persistence: {
    async save(id, json) {
      lsSet(`project:${id}`, json);
      const list = JSON.parse(lsGet('project:index') ?? '[]') as string[];
      if (!list.includes(id)) lsSet('project:index', JSON.stringify([...list, id]));
      return { ok: true };
    },
    async load(id) {
      return { ok: true, json: lsGet(`project:${id}`) };
    },
    async list() {
      return JSON.parse(lsGet('project:index') ?? '[]') as string[];
    },
    async delete(id) {
      lsSet(`project:${id}`, '');
      return { ok: true };
    },
  },
  autosave: {
    async write(json) {
      lsSet('autosave:latest', json);
      return { ok: true };
    },
    async read() {
      return { ok: true, json: lsGet('autosave:latest') };
    },
    async clear() {
      lsSet('autosave:latest', '');
      return { ok: true };
    },
  },
  export: {
    async saveBinary(defaultName, base64) {
      // Browser fallback: trigger a download.
      const link = document.createElement('a');
      link.href = `data:application/octet-stream;base64,${base64}`;
      link.download = defaultName;
      link.click();
      return { ok: true };
    },
  },
};

export function bridge(): AppBridge {
  return window.app ?? fallback;
}

export const isElectron = (): boolean => Boolean(window.app);
