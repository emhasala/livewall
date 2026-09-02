const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('api', {
  snapshot: () => invoke('app:snapshot'),
  setGlobal: (patch) => invoke('config:global', patch),
  setDisplay: (keys, patch) => invoke('config:display', { keys, patch }),
  setArrangement: (map) => invoke('config:arrangement', map),
  pickMedia: () => invoke('media:pick'),
  importMedia: (paths) => invoke('media:import', paths),
  removeMedia: (id) => invoke('media:remove', id),
  saveMeta: (meta) => invoke('media:meta', meta),
  renameMedia: (id, name) => invoke('media:rename', { id, name }),
  identifyDisplays: () => invoke('displays:identify'),
  openMediaFolder: () => invoke('app:open-media-folder'),
  quit: () => invoke('app:quit'),
  onChanged: (cb) => ipcRenderer.on('app:changed', (_e, snap) => cb(snap)),
  // Electron 32+ removed File.path; this is the supported replacement.
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file.path || null;
    }
  },
});
