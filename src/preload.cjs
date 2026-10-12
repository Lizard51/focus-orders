const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'focusAPI',
  Object.freeze({
    init: () => ipcRenderer.invoke('focus:init'),
    command: (name, payload) => ipcRenderer.invoke('focus:command', name, payload),
    listBackups: () => ipcRenderer.invoke('focus:backups'),
    previewBackup: (id) => ipcRenderer.invoke('focus:preview-backup', id),
    exportFile: () => ipcRenderer.invoke('focus:export'),
    readImportFile: () => ipcRenderer.invoke('focus:read-import'),
    previewImport: (text) => ipcRenderer.invoke('focus:preview-import', text),
    copyText: (text) => ipcRenderer.invoke('focus:copy', text),
    openDataFolder: () => ipcRenderer.invoke('focus:folder'),
  }),
);
