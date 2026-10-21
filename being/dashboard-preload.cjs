// being/dashboard-preload.cjs - the dashboard's bridge (sandboxed): live snapshots in, commands out.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dash', {
  onSnap: (fn) => ipcRenderer.on('snap', (e, s) => fn(s)),          // what the being reports, ~8 times a second
  cmd: (c) => ipcRenderer.send('dev-cmd', c),                        // tuning, colours, overrides, actions (being/index.html)
  app: (key, value) => ipcRenderer.invoke('dash-app', key, value),   // window form, size, audio source, menu actions (main.cjs)
  schema: () => ipcRenderer.invoke('dash-schema'),                   // the tuning sliders (being/tune.cjs)
});
