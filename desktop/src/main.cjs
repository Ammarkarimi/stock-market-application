// StockKaro desktop: runs the StockKaro server privately on this computer and shows it in an app window.
const { app, BrowserWindow, Menu, dialog, nativeTheme, session, shell, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_ENTRY = path.join(__dirname, 'server', 'dist', 'index.js');
const RELEASES_URL = 'https://github.com/Ammarkarimi/stock-market-application/releases/latest';
const START_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 5_000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

// STOCKKARO_USER_DATA keeps the app's data in another folder (used by the desktop tests, and for portable copies).
if (process.env.STOCKKARO_USER_DATA) {
  app.setPath('userData', process.env.STOCKKARO_USER_DATA);
  app.setAppLogsPath(path.join(process.env.STOCKKARO_USER_DATA, 'logs'));
}

let server = null;
let serverUrl = null;
let mainWindow = null;
let quitting = false;
let serverStopped = false;

function logFilePath() {
  return path.join(app.getPath('logs'), 'server.log');
}

function openLog() {
  const file = logFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Keep one previous log so a failed start can still be diagnosed after a restart.
  if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, `${file}.old`);
  const stream = fs.createWriteStream(file, { flags: 'a' });
  stream.write(`\n--- StockKaro ${app.getVersion()} started ${new Date().toISOString()} ---\n`);
  return stream;
}

/** Starts the server on a free port reachable only from this computer; resolves with its address. */
function startServer() {
  const dataDir = app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });
  const log = openLog();

  server = utilityProcess.fork(SERVER_ENTRY, [], {
    serviceName: 'StockKaro server',
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '0',
      DATABASE_PATH: path.join(dataDir, 'stockkaro.db'),
      // Plain HTTP on the loopback interface: no TLS, so cookies cannot be marked Secure.
      COOKIE_SECURE: 'false',
      FIRST_USER_IS_ADMIN: 'true',
      SEED_DEMO_DATA: 'false',
      TRUST_PROXY: '0',
    },
  });
  server.stdout?.pipe(log, { end: false });
  server.stderr?.pipe(log, { end: false });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The StockKaro engine took too long to start.')), START_TIMEOUT_MS);
    server.on('message', (message) => {
      if (message?.type === 'listening') {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${message.port}`);
      } else if (message?.type === 'error') {
        clearTimeout(timer);
        reject(new Error(message.message));
      }
    });
    server.on('exit', (code) => {
      serverStopped = true;
      clearTimeout(timer);
      log.end(`--- server exited with code ${code} ---\n`);
      if (quitting) return;
      if (!serverUrl) {
        reject(new Error(`The StockKaro engine stopped while starting (exit code ${code}).`));
      } else {
        dialog.showErrorBox('StockKaro stopped', `The StockKaro engine stopped unexpectedly (exit code ${code}). StockKaro will close; your data is safe.\n\nDetails are in ${logFilePath()}`);
        app.quit();
      }
    });
  });
}

function isAppUrl(url) {
  return serverUrl !== null && url.startsWith(`${serverUrl}/`);
}

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 380,
    minHeight: 560,
    title: 'StockKaro',
    backgroundColor: dark ? '#0a0d14' : '#f5f6f8',
    show: false,
    icon: process.platform === 'linux' ? path.join(__dirname, 'icon.png') : undefined,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Pages of other websites open in the user's browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !isAppUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url) || url.startsWith('file:')) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  void mainWindow.loadFile(path.join(__dirname, 'splash.html'));
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Data Folder', click: () => void shell.openPath(app.getPath('userData')) },
        { label: 'Open Logs Folder', click: () => void shell.openPath(app.getPath('logs')) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Download the Latest Version', click: () => void shell.openExternal(RELEASES_URL) },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'about' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function launch() {
  app.setAboutPanelOptions({
    applicationName: 'StockKaro',
    applicationVersion: app.getVersion(),
    copyright: 'Paper trading with virtual money. Market data and chart analysis are for information only, not investment advice.',
  });
  // The app needs no camera, microphone, location or notification permissions.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  buildMenu();
  createWindow();
  try {
    serverUrl = await startServer();
    if (mainWindow) await mainWindow.loadURL(`${serverUrl}/`);
  } catch (err) {
    dialog.showErrorBox('StockKaro could not start', `${err.message}\n\nDetails are in ${logFilePath()}`);
    quitting = true;
    server?.kill();
    app.quit();
  }
}

// One copy at a time: two would share, and fight over, the same database.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(launch);
  app.on('window-all-closed', () => app.quit());

  // Ask the server to finish its work and close the database before the app exits.
  app.on('before-quit', (event) => {
    quitting = true;
    if (!server || serverStopped) return;
    event.preventDefault();
    server.once('exit', () => app.quit());
    server.postMessage({ type: 'shutdown' });
    setTimeout(() => server?.kill(), STOP_TIMEOUT_MS).unref();
  });
}
