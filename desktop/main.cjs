const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');
const { startLocalServer } = require('./local-server.cjs');

let mainWindow = null;
let localServer = null;

function resolveDistDir() {
  const packagedDist = path.join(__dirname, 'dist');
  if (fs.existsSync(path.join(packagedDist, 'index.html'))) return packagedDist;
  return path.resolve(__dirname, '..', 'dist');
}

async function createWindow() {
  const distDir = resolveDistDir();
  const started = await startLocalServer(distDir);
  localServer = started.server;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    title: 'TizenXuper TV',
    backgroundColor: '#0a0a0f',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${started.port}/`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (localServer) {
    try { localServer.close(); } catch {}
    localServer = null;
  }
  app.quit();
});
