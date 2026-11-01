// ╔══════════════════════════════════════════════════════════════════════╗
// ║ preload.js — ponte segura entre a tela do caixa e o Electron        ║
// ╚══════════════════════════════════════════════════════════════════════╝

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdv', {
  read: (name, fallback) => ipcRenderer.invoke('store:read', name, fallback),
  write: (name, data) => ipcRenderer.invoke('store:write', name, data),
  api: (req) => ipcRenderer.invoke('api:request', req),
  rememberLogin: (data) => ipcRenderer.invoke('auth:remember', data),
  offlineLogin: (data) => ipcRenderer.invoke('auth:offline', data),
  printers: () => ipcRenderer.invoke('printers:list'),
  printHtml: (data) => ipcRenderer.invoke('print:html', data),
  info: () => ipcRenderer.invoke('app:info'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
