const { contextBridge, ipcRenderer } = require('electron')
const { version } = require('../package.json')

contextBridge.exposeInMainWorld('zhixing', {
  isDesktop: true,
  version,
  pickFolder: (defaultPath) => ipcRenderer.invoke('zhixing:pick-folder', defaultPath ?? null),
  openExternal: (url) => ipcRenderer.invoke('zhixing:open-external', url),
})
