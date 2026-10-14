// being/settings-preload.cjs - the small settings card (first run, and "Settings" in the menus); sandboxed.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('being', {
  get: () => ipcRenderer.invoke('settings-get'),
  set: (key, value) => ipcRenderer.invoke('settings-set', key, value),
});
