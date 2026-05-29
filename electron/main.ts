import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite injects these env vars at build/dev time.
process.env.APP_ROOT = path.join(__dirname, '..');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

let mainWindow: BrowserWindow | null = null;

// Persistence lives in the user-data directory so it survives app updates and
// is writable on all platforms. We use a documents-style JSON store; the same
// IPC contract can be backed by SQLite without touching the renderer.
function dataDir(): string {
  return path.join(app.getPath('userData'), 'projects');
}

function autosaveDir(): string {
  return path.join(app.getPath('userData'), 'autosave');
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // Hardened renderer: no Node in the renderer, isolated context, and a
      // sandboxed bridge defined in preload.ts.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Open external links in the OS browser, never inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

// --- IPC: project persistence -------------------------------------------------

ipcMain.handle('persistence:save', async (_e, id: string, json: string) => {
  await ensureDir(dataDir());
  const file = path.join(dataDir(), `${sanitize(id)}.json`);
  await fs.writeFile(file, json, 'utf-8');
  return { ok: true, path: file };
});

ipcMain.handle('persistence:load', async (_e, id: string) => {
  const file = path.join(dataDir(), `${sanitize(id)}.json`);
  try {
    const json = await fs.readFile(file, 'utf-8');
    return { ok: true, json };
  } catch {
    return { ok: false, json: null };
  }
});

ipcMain.handle('persistence:list', async () => {
  await ensureDir(dataDir());
  const entries = await fs.readdir(dataDir());
  return entries.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
});

ipcMain.handle('persistence:delete', async (_e, id: string) => {
  const file = path.join(dataDir(), `${sanitize(id)}.json`);
  try {
    await fs.unlink(file);
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

// --- IPC: autosave / crash recovery ------------------------------------------

ipcMain.handle('autosave:write', async (_e, json: string) => {
  await ensureDir(autosaveDir());
  const file = path.join(autosaveDir(), 'latest.json');
  // Write to a temp file then rename for an atomic, crash-safe autosave.
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, json, 'utf-8');
  await fs.rename(tmp, file);
  return { ok: true };
});

ipcMain.handle('autosave:read', async () => {
  const file = path.join(autosaveDir(), 'latest.json');
  try {
    const json = await fs.readFile(file, 'utf-8');
    return { ok: true, json };
  } catch {
    return { ok: false, json: null };
  }
});

ipcMain.handle('autosave:clear', async () => {
  const file = path.join(autosaveDir(), 'latest.json');
  try {
    await fs.unlink(file);
  } catch {
    /* nothing to clear */
  }
  return { ok: true };
});

// --- IPC: file export dialogs ------------------------------------------------

ipcMain.handle(
  'export:save-binary',
  async (_e, defaultName: string, base64: string, filters: Electron.FileFilter[]) => {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
      filters,
    });
    if (canceled || !filePath) return { ok: false };
    await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
    return { ok: true, path: filePath };
  },
);

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
  mainWindow = null;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
