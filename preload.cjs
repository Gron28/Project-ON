const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('entity', {
  pickAudioFile: () => ipcRenderer.invoke('pick-audio-file'),
  listApps: () => ipcRenderer.invoke('list-apps'),
  startApp: (pid) => ipcRenderer.invoke('start-app', pid),
  stopApp: () => ipcRenderer.invoke('stop-app'),
  onPcm: (cb) => { ipcRenderer.on('pcm', (_e, chunk) => cb(chunk)); },
  onPcmEnd: (cb) => { ipcRenderer.on('pcm-end', () => cb()); },
});
