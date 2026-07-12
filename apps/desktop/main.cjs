const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 640,
    title: 'Perfect 21',
    backgroundColor: '#0b0f0d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu?.();

  // External links (e.g. the blackjackinfo source engine) open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Packaged builds bundle the game under ./game/dist (see electron-builder.json);
  // in development it lives in the sibling workspace.
  const dist = app.isPackaged
    ? path.join(__dirname, 'game/dist/index.html')
    : path.join(__dirname, '../game/dist/index.html');

  // `--smoke` verifies the bundle loads and exits (used by CI / scripted checks).
  if (process.argv.includes('--smoke')) {
    win.webContents.on('did-finish-load', () => {
      console.log('smoke: loaded OK');
      app.exit(0);
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      console.error(`smoke: failed to load (${code} ${desc})`);
      app.exit(1);
    });
  }

  win.loadFile(dist);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
