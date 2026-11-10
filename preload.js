const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("superNotepadNative", {
  loadApp: () => ipcRenderer.invoke("app:load"),
  dataPath: () => ipcRenderer.invoke("app:data-path"),
  backup: () => ipcRenderer.invoke("app:backup"),
  backupEncrypted: password => ipcRenderer.invoke("app:backup-encrypted", password),
  openDataFolder: () => ipcRenderer.invoke("app:open-data-folder"),
  chooseDataFolder: () => ipcRenderer.invoke("app:choose-data-folder"),
  resetDataFolder: () => ipcRenderer.invoke("app:reset-data-folder"),
  chooseSyncFolder: () => ipcRenderer.invoke("app:choose-sync-folder"),
  syncNow: () => ipcRenderer.invoke("app:sync-now"),
  syncMerge: () => ipcRenderer.invoke("app:sync-merge"),

  unlock: password => ipcRenderer.invoke("auth:unlock", password),
  setAuth: (password, enabled) => ipcRenderer.invoke("auth:set", password, enabled),
  lock: () => ipcRenderer.invoke("auth:lock"),

  saveSettings: settings => ipcRenderer.invoke("settings:save", settings),

  createNote: payload => ipcRenderer.invoke("notes:create", payload),
  updateNote: payload => ipcRenderer.invoke("notes:update", payload),
  createDailyNote: () => ipcRenderer.invoke("notes:daily"),
  createNoteFromTemplate: templateId => ipcRenderer.invoke("notes:from-template", templateId),
  selectNote: noteId => ipcRenderer.invoke("notes:select", noteId),
  deleteNote: noteId => ipcRenderer.invoke("notes:delete", noteId),
  restoreNote: noteId => ipcRenderer.invoke("notes:restore", noteId),
  restoreNoteVersion: (noteId, versionId) => ipcRenderer.invoke("notes:restore-version", noteId, versionId),
  exportNote: (noteId, format, plainBody) => ipcRenderer.invoke("notes:export", noteId, format, plainBody),
  encryptNote: (noteId, password) => ipcRenderer.invoke("notes:encrypt", noteId, password),
  decryptNote: (noteId, password) => ipcRenderer.invoke("notes:decrypt", noteId, password),
  unlockNotePreview: (noteId, password) => ipcRenderer.invoke("notes:unlock-preview", noteId, password),

  saveTemplate: payload => ipcRenderer.invoke("templates:save", payload),
  deleteTemplate: templateId => ipcRenderer.invoke("templates:delete", templateId),

  createFolder: (name, kind) => ipcRenderer.invoke("folders:create", name, kind),
  updateFolder: (folderId, patch) => ipcRenderer.invoke("folders:update", folderId, patch),
  deleteFolder: folderId => ipcRenderer.invoke("folders:delete", folderId),

  chooseFiles: options => ipcRenderer.invoke("files:choose", options),
  copyDroppedFiles: (filePaths, options) => ipcRenderer.invoke("files:copyPaths", filePaths, options),
  savePastedImages: (images, options) => ipcRenderer.invoke("files:pasteImages", images, options),
  detachFile: (noteId, fileId) => ipcRenderer.invoke("files:detach", noteId, fileId),
  updateFile: (fileId, patch) => ipcRenderer.invoke("files:update", fileId, patch),
  attachFile: (noteId, fileId, insertReference) => ipcRenderer.invoke("files:attach", noteId, fileId, insertReference),
  reindexFiles: () => ipcRenderer.invoke("files:reindex"),
  classifyFiles: () => ipcRenderer.invoke("files:classify"),
  deleteFile: fileId => ipcRenderer.invoke("files:delete", fileId),
  restoreFile: fileId => ipcRenderer.invoke("files:restore", fileId),
  openFile: fileIdOrPath => ipcRenderer.invoke("files:open", fileIdOrPath),
  revealFile: fileIdOrPath => ipcRenderer.invoke("files:reveal", fileIdOrPath),
  previewFile: fileId => ipcRenderer.invoke("files:preview", fileId),
  thumbnailFile: fileId => ipcRenderer.invoke("files:thumbnail", fileId),

  search: query => ipcRenderer.invoke("search:query", query),
  similarNotes: noteId => ipcRenderer.invoke("search:similar", noteId),
  organizeNote: noteId => ipcRenderer.invoke("ai:organize", noteId),
  askNote: (noteId, question) => ipcRenderer.invoke("ai:ask", noteId, question),
  summarizeAllNotes: () => ipcRenderer.invoke("ai:summarize-all"),
  getAiConfig: () => ipcRenderer.invoke("ai:get-config"),
  saveAiConfig: payload => ipcRenderer.invoke("ai:save-config", payload),
  aiComplete: payload => ipcRenderer.invoke("ai:complete", payload),
  ocrRecognize: payload => ipcRenderer.invoke("ocr:recognize", payload),

  highlightCode: (code, language) => ipcRenderer.invoke("highlight:code", { code, language }),

  saveEncryptedNote: (noteId, password, patch) => ipcRenderer.invoke("notes:save-encrypted", noteId, password, patch),
  listNoteVersions: noteId => ipcRenderer.invoke("notes:list-versions", noteId),
  compareNoteVersions: (noteId, a, b) => ipcRenderer.invoke("notes:version-compare", noteId, a, b),
  restoreNoteVersionSafe: (noteId, versionId) => ipcRenderer.invoke("notes:restore-version-safe", noteId, versionId),
  exportDocx: (noteId, plainBody) => ipcRenderer.invoke("export:docx", noteId, plainBody),
  dailyBackup: () => ipcRenderer.invoke("backup:daily"),
  listDailyBackups: () => ipcRenderer.invoke("backup:list-daily"),
  openQuickNote: () => ipcRenderer.invoke("quicknote:open"),
  registerQuickShortcut: () => ipcRenderer.invoke("shortcut:register-quick"),
  listReminders: () => ipcRenderer.invoke("reminders:list"),
  tickReminders: () => ipcRenderer.invoke("reminders:tick"),
  openExternalDialog: () => ipcRenderer.invoke("files:open-external-dialog"),
  readExternalFile: filePath => ipcRenderer.invoke("files:read-external", filePath),
  saveExternalFile: (filePath, content, encoding) => ipcRenderer.invoke("files:save-external", filePath, content, encoding),
  saveExternalFileAs: (content, encoding, defaultName) => ipcRenderer.invoke("files:save-external-as", content, encoding, defaultName),
  openPath: filePath => ipcRenderer.invoke("files:open-path", filePath),
  revealPath: filePath => ipcRenderer.invoke("files:reveal-path", filePath),
  takeQueuedFiles: () => ipcRenderer.invoke("files:take-queued"),
  importNoteFromFile: payload => ipcRenderer.invoke("notes:import-from-file", payload),
  onExternalOpen: cb => {
    const listener = (_e, files) => cb(files || []);
    ipcRenderer.on("files:external-open", listener);
    return () => ipcRenderer.removeListener("files:external-open", listener);
  },
  onForceLock: cb => {
    const listener = () => cb();
    ipcRenderer.on("app:force-lock", listener);
    return () => ipcRenderer.removeListener("app:force-lock", listener);
  },
  onReminderOpenNote: cb => {
    const listener = (_e, noteId) => cb(noteId);
    ipcRenderer.on("reminders:open-note", listener);
    return () => ipcRenderer.removeListener("reminders:open-note", listener);
  },
  onNotesChanged: cb => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on("notes:changed", listener);
    return () => ipcRenderer.removeListener("notes:changed", listener);
  },

  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  }
});
