'use strict';
const { app, BrowserWindow, ipcMain, protocol, dialog, shell, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const pipeline = require('../data/pipeline');

const APP_ID = 'open-anatomy-atlas';
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

// One stable location shared with `npm run fetch-data`.
const dataDir = process.env.ANATOMY_DATA_DIR || path.join(app.getPath('appData'), APP_ID, 'dataset');
app.setPath('userData', path.join(app.getPath('appData'), APP_ID));

// atlas://local/app/...  -> bundled UI files
// atlas://local/data/... -> built atlas (index.json, meshes.bin)
protocol.registerSchemesAsPrivileged([{
  scheme: 'atlas',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream',
};

function safeJoin(root, rel) {
  const p = path.normalize(path.join(root, rel));
  return p.startsWith(path.normalize(root + path.sep)) ? p : null;
}

function registerProtocol() {
  protocol.handle('atlas', async (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let file = null;
    if (rel.startsWith('app/')) file = safeJoin(RENDERER_DIR, rel.slice(4));
    else if (rel.startsWith('data/')) {
      const f = pipeline.resolveDataFile(dataDir, rel.slice(5));
      file = f && safeJoin(dataDir, path.relative(dataDir, f));
    }
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('Not found', { status: 404 });
    const size = fs.statSync(file).size;
    return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': String(size), 'cache-control': 'no-store',
    } });
  });
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0f14',
    title: 'Open Anatomy Atlas',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL('atlas://local/app/index.html');

  // External links open in the system browser; the app window never navigates away.
  const external = (url) => /^(https:\/\/|mailto:)/.test(url);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (external(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('atlas://')) { e.preventDefault(); if (external(url)) shell.openExternal(url); }
  });
}

// ---- IPC ----
let busy = false;
function progressSender(evt) {
  return (p) => { if (!evt.sender.isDestroyed()) evt.sender.send('dataset:progress', p); };
}
async function exclusive(fn) {
  if (busy) throw new Error('Another atlas operation is already running.');
  busy = true;
  try { return await fn(); } finally { busy = false; }
}

ipcMain.handle('dataset:status', () => pipeline.status(dataDir));

// opts: { source: 'bp3d43' | 'bp3d40' | 'zanatomy', variant: 'full' | 'core', commercialSafe, mirror }
ipcMain.handle('dataset:prepare', (evt, opts = {}) => exclusive(() => pipeline.prepare({
  dataDir,
  source: pipeline.SOURCES[opts.source] ? opts.source : 'bp3d40',
  variant: opts.variant === 'core' ? 'core' : 'full',
  commercialSafe: !!opts.commercialSafe,
  mirror: opts.mirror === false ? { categories: [] } : undefined,
  fetchImpl: (u, o) => net.fetch(u, o),
  onProgress: progressSender(evt),
})));
ipcMain.handle('dataset:rebuild', (evt, opts = {}) => exclusive(() => pipeline.rebuild({
  dataDir, source: opts.source, commercialSafe: !!opts.commercialSafe,
  mirror: opts.mirror === false ? { categories: [] } : undefined, onProgress: progressSender(evt),
})));
ipcMain.handle('dataset:setActive', (evt, id) => pipeline.setActive(dataDir, id));

ipcMain.handle('dataset:import', async (evt) => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Select BodyParts3D zip archives and .txt lists (or a 4.3 folder with metadata/ and objs/)',
    // Linux/Windows dialogs pick either files or folders; macOS can do both.
    properties: process.platform === 'darwin' ? ['openFile', 'openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
    filters: [{ name: 'BodyParts3D files', extensions: ['zip', 'obj', 'txt'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true, ...pipeline.status(dataDir) };
  return exclusive(() => pipeline.importLocal({ dataDir, files: r.filePaths, onProgress: progressSender(evt) }));
});

ipcMain.handle('dataset:remove', (evt, id) => exclusive(async () => pipeline.remove(dataDir, pipeline.SOURCES[id] ? id : undefined)));
ipcMain.handle('dataset:openFolder', () => { fs.mkdirSync(dataDir, { recursive: true }); return shell.openPath(dataDir); });
ipcMain.handle('shell:openExternal', (evt, url) => { if (/^https:\/\//.test(String(url))) return shell.openExternal(url); });

app.whenReady().then(() => {
  registerProtocol();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
