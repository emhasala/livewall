const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallpaper', {
  onState: (cb) => ipcRenderer.on('wallpaper:state', (_e, state) => cb(state)),
  onSync: (cb) => ipcRenderer.on('wallpaper:sync', (_e, payload) => cb(payload)),
  onIdentify: (cb) => ipcRenderer.on('wallpaper:identify', (_e, payload) => cb(payload)),
  mediaError: (payload) => ipcRenderer.send('wallpaper:media-error', payload),
});
