// The sky window's bridge (sandboxed): read the sky, follow it, change the modes and the place.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sky', {
  get: () => ipcRenderer.invoke('sky-get'),
  set: (key, value) => ipcRenderer.invoke('sky-set', key, value),
  onCosmos: (fn) => ipcRenderer.on('cosmos', (_e, v) => fn(v)),
});
