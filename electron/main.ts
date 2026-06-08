import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
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

// --- IPC: project file sharing (공유 내보내기/가져오기) -------------------------

ipcMain.handle('project:export-file', async (_e, defaultName: string, json: string) => {
  const win = mainWindow ?? BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win!, {
    defaultPath: `${defaultName}.smgantt`,
    filters: [
      { name: '스마트 간트 프로젝트', extensions: ['smgantt'] },
      { name: 'JSON 파일', extensions: ['json'] },
    ],
  });
  if (canceled || !filePath) return { ok: false };
  await fs.writeFile(filePath, json, 'utf-8');
  return { ok: true, path: filePath };
});

ipcMain.handle('project:import-file', async () => {
  const win = mainWindow ?? BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    filters: [
      { name: '스마트 간트 프로젝트', extensions: ['smgantt', 'json'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return { ok: false, json: null, path: null };
  try {
    const json = await fs.readFile(filePaths[0], 'utf-8');
    return { ok: true, json, path: filePaths[0] };
  } catch {
    return { ok: false, json: null, path: null };
  }
});

ipcMain.handle('project:save-to-path', async (_e, filePath: string, json: string) => {
  await fs.writeFile(filePath, json, 'utf-8');
  return { ok: true, path: filePath };
});

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function send(channel: string) {
  mainWindow?.webContents.send(channel);
}

type MI = Electron.MenuItemConstructorOptions;

function buildKoreanMenu(): void {
  const isMac = process.platform === 'darwin';

  const fileSubmenu: MI[] = [
    { label: '새 프로젝트', accelerator: 'CmdOrCtrl+N', click: () => send('menu:new-project') },
    { label: '열기…', accelerator: 'CmdOrCtrl+O', click: () => send('menu:open-file') },
    { type: 'separator' },
    { label: '저장', accelerator: 'CmdOrCtrl+S', click: () => send('menu:save') },
    { label: '다른 이름으로 저장…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu:save-as') },
    { type: 'separator' },
    { label: '파일로 내보내기 (.smgantt)…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('menu:share-export') },
    { label: '파일 가져오기 (.smgantt)…', accelerator: 'CmdOrCtrl+Shift+I', click: () => send('menu:share-import') },
    { type: 'separator' },
    {
      label: '이미지/문서로 내보내기',
      submenu: [
        { label: '엑셀 (.xlsx)', click: () => send('menu:export-excel') },
        { label: 'PNG 이미지', click: () => send('menu:export-png') },
        { label: 'PDF 문서', click: () => send('menu:export-pdf') },
      ],
    },
    { type: 'separator' },
    isMac ? { role: 'close' as const, label: '창 닫기' } : { role: 'quit' as const, label: '종료' },
  ];

  const viewSubmenu: MI[] = [
    ...(VITE_DEV_SERVER_URL
      ? [
          { role: 'reload' as const, label: '새로 고침' },
          { role: 'forceReload' as const, label: '강제 새로 고침' },
          { role: 'toggleDevTools' as const, label: '개발자 도구' },
          { type: 'separator' as const },
        ]
      : []),
    { label: '간트 확대', accelerator: 'CmdOrCtrl+=', click: () => send('menu:zoom-in') },
    { label: '간트 축소', accelerator: 'CmdOrCtrl+-', click: () => send('menu:zoom-out') },
    { label: '간트 비율 초기화', accelerator: 'CmdOrCtrl+0', click: () => send('menu:zoom-reset') },
    { type: 'separator' as const },
    { role: 'togglefullscreen' as const, label: '전체 화면' },
  ];

  const windowSubmenu: MI[] = [
    { role: 'minimize' as const, label: '최소화' },
    { role: 'zoom' as const, label: '확대/축소' },
    ...(isMac
      ? [
          { type: 'separator' as const },
          { role: 'front' as const, label: '모든 창 앞으로' },
        ]
      : [{ role: 'close' as const, label: '닫기' }]),
  ];

  const template: MI[] = [
    ...(isMac
      ? [
          {
            label: '스마트 간트',
            submenu: [
              { role: 'about' as const, label: '스마트 간트 정보' },
              { type: 'separator' as const },
              { role: 'services' as const, label: '서비스' },
              { type: 'separator' as const },
              { role: 'hide' as const, label: '스마트 간트 숨기기' },
              { role: 'hideOthers' as const, label: '다른 앱 숨기기' },
              { role: 'unhide' as const, label: '모두 표시' },
              { type: 'separator' as const },
              { role: 'quit' as const, label: '스마트 간트 종료' },
            ],
          } satisfies MI,
        ]
      : []),
    { label: '파일', submenu: fileSubmenu },
    {
      label: '편집',
      submenu: [
        { role: 'undo' as const, label: '실행 취소' },
        { role: 'redo' as const, label: '다시 실행' },
        { type: 'separator' as const },
        { role: 'cut' as const, label: '잘라내기' },
        { role: 'copy' as const, label: '복사' },
        { role: 'paste' as const, label: '붙여넣기' },
        { role: 'selectAll' as const, label: '모두 선택' },
      ],
    },
    { label: '보기', submenu: viewSubmenu },
    { label: '창', submenu: windowSubmenu },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  createWindow();
  buildKoreanMenu();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
  mainWindow = null;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
