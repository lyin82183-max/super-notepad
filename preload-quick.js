const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("quickNoteApi", {
  save: text => ipcRenderer.invoke("quicknote:save", text),
  close: () => ipcRenderer.invoke("quicknote:close")
});
