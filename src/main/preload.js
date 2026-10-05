'use strict';
const { contextBridge, ipcRenderer } = require('electron');

function withProgress(channel, arg, onProgress) {
  const listener = (_e, p) => { try { onProgress && onProgress(p); } catch (_) { /* ignore UI errors */ } };
  ipcRenderer.on('dataset:progress', listener);
  return ipcRenderer.invoke(channel, arg).finally(() => ipcRenderer.removeListener('dataset:progress', listener));
}

contextBridge.exposeInMainWorld('atlasHost', {
  isDesktop: true,
  dataBase: 'atlas://local/data/',
  status: () => ipcRenderer.invoke('dataset:status'),
  prepare: (opts, onProgress) => withProgress('dataset:prepare', opts, onProgress),
  rebuild: (opts, onProgress) => withProgress('dataset:rebuild', opts, onProgress),
  setActive: (id) => ipcRenderer.invoke('dataset:setActive', id),
  importFiles: (onProgress) => withProgress('dataset:import', undefined, onProgress),
  remove: (id) => ipcRenderer.invoke('dataset:remove', id),
  openDataFolder: () => ipcRenderer.invoke('dataset:openFolder'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});
