// ╔══════════════════════════════════════════════════════════════════════╗
// ║ Consart Starter — Frente de Caixa (processo principal do Electron)  ║
// ║ Guarda config, catálogo e fila de vendas no PC; fala com o ERP;     ║
// ║ imprime o cupom.                                                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = () => path.join(app.getPath('userData'), 'dados');
const STORE_FILES = new Set(['config', 'catalog', 'queue', 'session', 'history', 'users', 'favorites']);

function storePath(name) {
  if (!STORE_FILES.has(name)) throw new Error(`Arquivo inválido: ${name}`);
  return path.join(DATA_DIR(), `${name}.json`);
}

function readStore(name, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(storePath(name), 'utf8'));
  } catch {
    return fallback;
  }
}

// Grava em arquivo temporário e renomeia: não corrompe a fila se o PC desligar.
function writeStore(name, data) {
  fs.mkdirSync(DATA_DIR(), { recursive: true });
  const file = storePath(name);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
  return true;
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1200,
    minHeight: 700,
    autoHideMenuBar: true,
    backgroundColor: '#07160e',
    title: 'Consart Starter — Frente de Caixa',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

/* ── Armazenamento local ───────────────────────────────────────────── */
ipcMain.handle('store:read', (_e, name, fallback) => readStore(name, fallback));
ipcMain.handle('store:write', (_e, name, data) => writeStore(name, data));

/* ── API do ERP (feita aqui para não depender de CORS) ─────────────── */
ipcMain.handle('api:request', async (_e, { method = 'GET', url, token, body, timeoutMs = 15000 }) => {
  const config = readStore('config', {}) || {};
  const base = String(config.apiUrl || '').replace(/\/+$/, '');
  if (!base) return { ok: false, offline: true, status: 0, data: { message: 'Endereço do ERP não configurado.' } };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 300) }; }
    return { ok: res.ok, status: res.status, data };
  } catch (error) {
    return { ok: false, offline: true, status: 0, data: { message: `Sem conexão com o ERP (${error.name === 'AbortError' ? 'tempo esgotado' : error.message}).` } };
  } finally {
    clearTimeout(timer);
  }
});

/* ── Login sem internet: hash da última senha válida (scrypt) ──────── */
ipcMain.handle('auth:remember', (_e, { username, password, user }) => {
  const users = readStore('users', {}) || {};
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  users[String(username).toLowerCase()] = { salt, hash, user, savedAt: new Date().toISOString() };
  writeStore('users', users);
  return true;
});

ipcMain.handle('auth:offline', (_e, { username, password }) => {
  const users = readStore('users', {}) || {};
  const entry = users[String(username).toLowerCase()];
  if (!entry) return null;
  const hash = crypto.scryptSync(String(password), entry.salt, 32);
  const ok = crypto.timingSafeEqual(hash, Buffer.from(entry.hash, 'hex'));
  return ok ? entry.user : null;
});

/* ── Impressão do cupom (80 mm) ────────────────────────────────────── */
ipcMain.handle('printers:list', async () => {
  if (!mainWindow) return [];
  const list = await mainWindow.webContents.getPrintersAsync();
  return list.map((p) => ({ name: p.name, isDefault: p.isDefault }));
});

ipcMain.handle('print:html', async (_e, { html, printer }) => {
  const win = new BrowserWindow({ show: false, width: 320, height: 600, webPreferences: { sandbox: true } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await new Promise((resolve) => {
      win.webContents.print(
        {
          silent: Boolean(printer),
          deviceName: printer || undefined,
          printBackground: true,
          margins: { marginType: 'none' },
          pageSize: { width: 80000, height: 297000 },
        },
        (success, reason) => resolve({ ok: success, reason }),
      );
    });
  } finally {
    setTimeout(() => win.destroy(), 1000);
  }
});

ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir: DATA_DIR() }));
ipcMain.handle('app:quit', () => app.quit());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
