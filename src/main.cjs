'use strict';
const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store.cjs');
const seed = require('./seed.json');
const MAX_IMPORT = 10 * 1024 * 1024;
const entry = pathToFileURL(path.join(__dirname, 'index.html')).href;
const testDirectory = process.argv.find((arg) => arg.startsWith('--focus-data-dir='));
app.setName('Focus Orders');
app.setPath(
  'userData',
  testDirectory
    ? path.resolve(testDirectory.slice('--focus-data-dir='.length))
    : path.join(app.getPath('appData'), 'FocusOrders'),
);
let window,
  store,
  allowClose = false,
  closePending = false;
const commands = new Set([
  'createOrder',
  'saveOrder',
  'archiveOrder',
  'restoreOrder',
  'deleteOrder',
  'createTemplate',
  'saveTemplate',
  'deleteTemplate',
  'importData',
  'restoreBackup',
]);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.on('window-all-closed', () => app.quit());
  app
    .whenReady()
    .then(async () => {
      try {
        store = await Store.open({ directory: app.getPath('userData'), seed });
        // Used only by automated acceptance runs; it never touches the normal database.
        if (testDirectory && process.argv.includes('--focus-test-save-failure')) {
          const original = store.command.bind(store);
          let failures = 1;
          store.command = async (name, payload) => {
            if (name === 'saveOrder' && failures-- > 0)
              throw Error('TEST_DISK_FAILURE: Проверочная ошибка записи');
            return original(name, payload);
          };
        }
        registerIPC();
        createWindow();
      } catch (error) {
        dialog.showErrorBox(
          'Не удалось открыть базу заказов',
          'Данные не сброшены. Сохраните исходную папку и восстановите подходящую резервную копию.\n\n' +
            error.message,
        );
        app.quit();
      }
    })
    .catch((error) => {
      dialog.showErrorBox('Ошибка запуска', error.message);
      app.quit();
    });
}
function safeSender(event) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== entry
  )
    throw Error('Недоступный источник команды');
}
function bind(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    safeSender(event);
    return handler(...args);
  });
}
function failure(error) {
  return { ok: false, error: message(error) };
}
function message(error) {
  const raw = error?.message || String(error);
  if (raw.includes('CONFLICT'))
    return 'CONFLICT: Заказ уже изменился. Обновите данные перед повторением.';
  if (raw.includes('ARCHIVED')) return 'ARCHIVED: Сначала восстановите заказ из архива.';
  if (raw.includes('ENOSPC'))
    return 'На диске закончилось свободное место. Изменения не сохранены.';
  if (raw.includes('EACCES') || raw.includes('EPERM'))
    return 'Нет доступа для записи. Изменения не сохранены: ' + raw;
  return raw;
}
function registerIPC() {
  bind('focus:init', () => ({
    snapshot: store.snapshot(),
    warnings: store.warnings,
    dataPath: app.getPath('userData'),
  }));
  bind('focus:command', async (name, payload) => {
    try {
      if (!commands.has(name)) throw Error('Неизвестная команда');
      await store.command(name, payload);
      return { ok: true, snapshot: store.snapshot(), warnings: store.warnings };
    } catch (error) {
      return failure(error);
    }
  });
  bind('focus:backups', () => store.listBackups());
  bind('focus:preview-backup', async (id) => {
    try {
      return { snapshot: await store.previewBackup(id) };
    } catch (error) {
      return { error: message(error) };
    }
  });
  bind('focus:preview-import', (text) => {
    try {
      return { snapshot: store.previewImport(text) };
    } catch (error) {
      return { error: message(error) };
    }
  });
  bind('focus:export', async () => {
    try {
      const chosen = await dialog.showSaveDialog(window, {
        title: 'Сохранить резервную копию',
        defaultPath: 'Фокус-заказы-' + new Date().toISOString().slice(0, 10) + '.json',
        filters: [{ name: 'Резервная копия JSON', extensions: ['json'] }],
      });
      if (chosen.canceled || !chosen.filePath) return { ok: true, cancelled: true };
      const temporary = chosen.filePath + '.' + randomUUID() + '.tmp';
      let file;
      try {
        file = await fs.open(temporary, 'wx');
        await file.writeFile(store.export(), 'utf8');
        await file.sync();
        await file.close();
        file = null;
        await fs.rename(temporary, chosen.filePath);
      } finally {
        if (file) await file.close().catch(() => {});
        await fs.unlink(temporary).catch(() => {});
      }
      return { ok: true, cancelled: false };
    } catch (error) {
      return failure(error);
    }
  });
  bind('focus:read-import', async () => {
    const chosen = await dialog.showOpenDialog(window, {
      title: 'Открыть резервную копию или старые «Данные»',
      properties: ['openFile'],
      filters: [{ name: 'Данные JSON', extensions: ['json', 'txt'] }],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return null;
    const file = chosen.filePaths[0];
    if ((await fs.stat(file)).size > MAX_IMPORT) throw Error('Файл больше 10 МБ. Импорт отменён.');
    return { text: await fs.readFile(file, 'utf8'), fileName: path.basename(file) };
  });
  bind('focus:copy', (text) => {
    if (typeof text !== 'string' || text.length > MAX_IMPORT) throw Error('Некорректный текст');
    clipboard.writeText(text);
    return { ok: true };
  });
  bind('focus:folder', async () => {
    const error = await shell.openPath(app.getPath('userData'));
    if (error) throw Error(error);
    return { ok: true };
  });
}
function createWindow() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#f5f6f2',
    icon: path.join(__dirname, 'assets/app-icon.png'),
    autoHideMenuBar: true,
    show: false,
    title: 'Фокус — Заказы',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: !process.argv.includes('--focus-hidden'),
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== entry) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-prevent-unload', (event) => {
    if (allowClose) event.preventDefault();
  });
  window.once('ready-to-show', () => {
    if (!process.argv.includes('--focus-hidden')) window.show();
  });
  window.on('close', (event) => {
    if (allowClose) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    window.webContents
      .executeJavaScript('window.focusFlush ? window.focusFlush() : true')
      .then(async (clean) => {
        if (!clean) {
          const result = await dialog.showMessageBox(window, {
            type: 'warning',
            title: 'Изменения не сохранены',
            message: 'Не удалось сохранить изменения.',
            detail:
              'Можно остаться в приложении и повторить сохранение. Закрытие без сохранения потеряет только неподтверждённый ввод.',
            buttons: ['Остаться', 'Закрыть без сохранения'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (result.response !== 1) return;
        }
        allowClose = true;
        window.close();
      })
      .catch(() => {})
      .finally(() => {
        closePending = false;
      });
  });
  window.loadURL(entry);
}
