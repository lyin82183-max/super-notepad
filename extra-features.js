const { ipcMain, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, Notification, dialog, shell, app } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "log", "json", "xml", "yaml", "yml", "ini", "csv", "tsv",
  "js", "jsx", "ts", "tsx", "css", "scss", "less", "html", "htm", "py", "java", "c", "cpp", "h", "hpp",
  "go", "rs", "php", "rb", "sh", "bat", "ps1", "sql", "toml", "conf", "cfg", "env", "gitignore"
]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mkv", "avi", "mov"]);
const PDF_EXTS = new Set(["pdf"]);
const DOCX_EXTS = new Set(["docx"]);
const EXEC_EXTS = new Set(["exe", "bat", "cmd", "msi", "ps1", "vbs", "com", "scr"]);

let tray = null;
let quickWin = null;
let mainWindowGetter = () => null;
let remindedKeys = new Set();
let openExternalFileQueue = [];

function extOf(filePath) {
  return String(path.extname(filePath || "")).replace(/^\./, "").toLowerCase();
}

function classifyPath(filePath) {
  const ext = extOf(filePath);
  if (TEXT_EXTS.has(ext)) return "text";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (PDF_EXTS.has(ext)) return "pdf";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (DOCX_EXTS.has(ext)) return "docx";
  if (ext === "csv") return "csv";
  if (ext === "html" || ext === "htm") return "html";
  return "system";
}

function detectEncodingAndDecode(buf) {
  const iconv = require("iconv-lite");
  if (!buf || !buf.length) return { text: "", encoding: "utf8" };
  // UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.slice(3).toString("utf8"), encoding: "utf8-bom" };
  }
  const asUtf8 = buf.toString("utf8");
  // Heuristic: if replacement chars dominate and GBK looks cleaner, use GBK
  const bad = (asUtf8.match(/\uFFFD/g) || []).length;
  if (bad === 0) return { text: asUtf8, encoding: "utf8" };
  const asGbk = iconv.decode(buf, "gbk");
  const badGbk = (asGbk.match(/\uFFFD/g) || []).length;
  if (badGbk < bad) return { text: asGbk, encoding: "gbk" };
  return { text: asUtf8, encoding: "utf8" };
}

function readExternalFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error("文件不存在");
  const kind = classifyPath(filePath);
  const stat = fs.statSync(filePath);
  const base = {
    path: filePath,
    name: path.basename(filePath),
    ext: extOf(filePath),
    kind,
    size: stat.size,
    mtime: stat.mtime.toISOString()
  };
  if (kind === "text" || kind === "csv" || kind === "html") {
    const buf = fs.readFileSync(filePath);
    const decoded = detectEncodingAndDecode(buf);
    return { ...base, encoding: decoded.encoding, content: decoded.text };
  }
  if (kind === "image" || kind === "pdf" || kind === "audio" || kind === "video") {
    return { ...base, url: pathToFileURL(filePath).href };
  }
  if (kind === "docx") {
    const mammoth = require("mammoth");
    // sync-ish via deasync alternative: return promise handled by caller
    return { ...base, needsAsyncDocx: true };
  }
  return { ...base, systemOnly: true, isExecutable: EXEC_EXTS.has(extOf(filePath)) };
}

async function readExternalFileAsync(filePath) {
  const info = readExternalFile(filePath);
  if (info.needsAsyncDocx) {
    const mammoth = require("mammoth");
    const result = await mammoth.convertToHtml({ path: filePath });
    return { ...info, needsAsyncDocx: false, html: String(result.value || ""), messages: result.messages || [] };
  }
  return info;
}

function ensureDailyBackup(ctx) {
  const data = ctx.loadStore();
  const keep = Math.max(3, Number(data.settings?.dailyBackupKeep || 7));
  const dir = path.join(ctx.appDataDir(), "backups", "daily");
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const target = path.join(dir, `data-${day}.json`);
  if (!fs.existsSync(target)) {
    try {
      fs.copyFileSync(ctx.dataFile(), target);
    } catch (_) {}
  }
  // prune
  try {
    const files = fs.readdirSync(dir)
      .filter(name => name.startsWith("data-") && name.endsWith(".json"))
      .sort()
      .reverse();
    for (const name of files.slice(keep)) {
      try { fs.unlinkSync(path.join(dir, name)); } catch (_) {}
    }
  } catch (_) {}
  return { ok: true, path: target, keep };
}

function pruneNoteVersions(data, noteId, maxPerNote = 40) {
  const all = data.noteVersions || [];
  const mine = all.filter(v => v.noteId === noteId);
  const others = all.filter(v => v.noteId !== noteId);
  // keep newest maxPerNote, but sparsify older ones: keep all of last 10, then every other of rest
  const sorted = mine.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const kept = [];
  sorted.forEach((item, index) => {
    if (index < 10 || index % 2 === 0) kept.push(item);
  });
  data.noteVersions = [...kept.slice(0, maxPerNote), ...others].slice(0, 500);
}

function recordEncryptedAwareVersion(ctx, data, note, reason) {
  if (!note?.id) return;
  const snap = {
    id: ctx.uid("ver"),
    noteId: note.id,
    title: note.title || "未命名笔记",
    tags: Array.isArray(note.tags) ? note.tags : [],
    reason: reason || "编辑前版本",
    createdAt: ctx.nowIso(),
    isEncrypted: !!note.isEncrypted
  };
  if (note.isEncrypted) {
    snap.body = "";
    snap.encryptedPayload = note.encryptedPayload || null;
  } else {
    snap.body = note.body || "";
    snap.encryptedPayload = null;
  }
  const latest = (data.noteVersions || []).find(item => item.noteId === note.id);
  const same =
    latest &&
    latest.title === snap.title &&
    latest.isEncrypted === snap.isEncrypted &&
    latest.body === snap.body &&
    JSON.stringify(latest.encryptedPayload || null) === JSON.stringify(snap.encryptedPayload || null) &&
    JSON.stringify(latest.tags || []) === JSON.stringify(snap.tags || []);
  if (same) return;
  data.noteVersions = [snap, ...(data.noteVersions || [])];
  pruneNoteVersions(data, note.id, Number(data.settings?.noteVersionKeep || 40));
}

function saveEncryptedNote(ctx, noteId, password, patch = {}) {
  const data = ctx.loadStore();
  const note = data.notes.find(item => item.id === noteId && !item.deletedAt);
  if (!note) throw new Error("笔记不存在");
  if (!note.isEncrypted) throw new Error("笔记未加密");
  const fullFeatures = require("./full-features");
  // version before overwrite — store previous ciphertext
  recordEncryptedAwareVersion(ctx, data, note, "加密编辑前");
  const title = patch.title != null ? String(patch.title) : note.title;
  const tags = Array.isArray(patch.tags) ? patch.tags : note.tags;
  const body = String(patch.body || "");
  note.title = title;
  note.tags = tags;
  note.encryptedPayload = fullFeatures.encryptText(body, password);
  note.body = "";
  note.isEncrypted = true;
  note.updatedAt = ctx.nowIso();
  ctx.saveStore();
  ensureDailyBackup(ctx);
  return ctx.publicData();
}

function restoreNoteVersionSafe(ctx, noteId, versionId) {
  const data = ctx.loadStore();
  const note = data.notes.find(item => item.id === noteId && !item.deletedAt);
  const version = (data.noteVersions || []).find(item => item.id === versionId && item.noteId === noteId);
  if (!note || !version) throw new Error("版本不存在");
  recordEncryptedAwareVersion(ctx, data, note, "恢复前版本");
  note.title = version.title || note.title;
  note.tags = Array.isArray(version.tags) ? version.tags : [];
  if (version.isEncrypted) {
    note.isEncrypted = true;
    note.encryptedPayload = version.encryptedPayload || null;
    note.body = "";
  } else {
    note.isEncrypted = false;
    note.encryptedPayload = null;
    note.body = version.body || "";
  }
  note.updatedAt = ctx.nowIso();
  ctx.saveStore();
  return ctx.publicData();
}

function compareVersions(ctx, noteId, versionIdA, versionIdB) {
  const data = ctx.loadStore();
  const a = (data.noteVersions || []).find(item => item.id === versionIdA && item.noteId === noteId);
  const b = versionIdB
    ? (data.noteVersions || []).find(item => item.id === versionIdB && item.noteId === noteId)
    : data.notes.find(item => item.id === noteId);
  if (!a || !b) throw new Error("无法对比");
  const redact = v => ({
    id: v.id || "current",
    title: v.title || "",
    tags: v.tags || [],
    isEncrypted: !!v.isEncrypted,
    body: v.isEncrypted ? "" : String(v.body || ""),
    createdAt: v.createdAt || v.updatedAt || null,
    reason: v.reason || "当前"
  });
  return { a: redact(a), b: redact(b) };
}

async function exportDocx(ctx, noteId, plainBody) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");
  const data = ctx.loadStore();
  const note = data.notes.find(item => item.id === noteId);
  if (!note) return { canceled: true };
  if (note.isEncrypted && plainBody == null) throw new Error("加密笔记需先解锁再导出");
  const body = plainBody != null ? String(plainBody) : String(note.body || "");
  const result = dialog.showSaveDialogSync({
    title: "导出 Word",
    defaultPath: `${String(note.title || "note").replace(/[<>:"/\\|?*]/g, "_")}.docx`,
    filters: [{ name: "Word", extensions: ["docx"] }]
  });
  if (!result) return { canceled: true };
  const paras = [];
  paras.push(new Paragraph({ text: note.title || "未命名笔记", heading: HeadingLevel.HEADING_1 }));
  for (const line of body.split(/\r?\n/)) {
    paras.push(new Paragraph({ children: [new TextRun(line || " ")] }));
  }
  const doc = new Document({ sections: [{ children: paras }] });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(result, buf);
  return { canceled: false, path: result };
}

function createQuickNoteWindow(ctx) {
  const data = ctx.loadStore();
  if (data.settings?.authEnabled && typeof ctx.isSessionUnlocked === "function" && !ctx.isSessionUnlocked()) {
    dialog.showMessageBoxSync({
      type: "info",
      buttons: ["好的"],
      title: "工作区已锁定",
      message: "工作区已锁定，请先解锁后再打开随手记。"
    });
    const win = mainWindowGetter();
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      win.webContents.send("app:force-lock");
    }
    return null;
  }
  if (quickWin && !quickWin.isDestroyed()) {
    quickWin.show();
    quickWin.focus();
    return quickWin;
  }
  quickWin = new BrowserWindow({
    width: 420,
    height: 280,
    resizable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: "随手记",
    backgroundColor: "#f7fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload-quick.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  quickWin.setMenuBarVisibility(false);
  quickWin.loadFile(path.join(__dirname, "quick-note.html"));
  quickWin.on("closed", () => { quickWin = null; });
  return quickWin;
}

function saveQuickNote(ctx, text) {
  const data = ctx.loadStore();
  if (data.settings?.authEnabled && typeof ctx.isSessionUnlocked === "function" && !ctx.isSessionUnlocked()) {
    dialog.showMessageBoxSync({
      type: "info",
      buttons: ["好的"],
      title: "工作区已锁定",
      message: "工作区已锁定，请先解锁后再使用随手记。"
    });
    return { ok: false, locked: true, error: "工作区已锁定" };
  }
  let folder = (data.folders || []).find(item => item.name === "随手记" && !item.deletedAt);
  if (!folder) {
    folder = {
      id: ctx.uid("folder"),
      name: "随手记",
      kind: "文档",
      createdAt: ctx.nowIso(),
      updatedAt: ctx.nowIso(),
      deletedAt: null
    };
    data.folders.unshift(folder);
  }
  const note = {
    id: ctx.uid("note"),
    title: `随手记 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    body: String(text || "").trim(),
    tags: ["随手记"],
    folderId: folder.id,
    isFavorite: false,
    isPinned: false,
    createdAt: ctx.nowIso(),
    updatedAt: ctx.nowIso(),
    deletedAt: null
  };
  data.notes.unshift(note);
  data.currentNoteId = note.id;
  ctx.saveStore();
  const win = mainWindowGetter();
  if (win && !win.isDestroyed()) {
    win.webContents.send("notes:changed", ctx.publicData());
    win.show();
  }
  return { ok: true, id: note.id, data: ctx.publicData() };
}

function setupTray(ctx) {
  if (tray) return;
  try {
    const img = nativeImage.createEmpty();
    tray = new Tray(img.isEmpty() ? nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAALElEQVQoka3OMQEAAAjDMMC/52ECvhBI0YGT1pYkSZIkSZIkSZIkSZIkSZL8swc9QwABn0nHWgAAAABJRU5ErkJggg==") : img);
    tray.setToolTip("超级记事本");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "显示主窗口", click: () => { const w = mainWindowGetter(); if (w) { w.show(); w.focus(); } } },
      { label: "随手记", click: () => createQuickNoteWindow(ctx) },
      { label: "锁定", click: () => { const w = mainWindowGetter(); if (w) w.webContents.send("app:force-lock"); } },
      { type: "separator" },
      { label: "退出", click: () => app.quit() }
    ]));
    tray.on("double-click", () => {
      const w = mainWindowGetter();
      if (w) { w.show(); w.focus(); }
    });
  } catch (error) {
    console.warn("tray failed", error.message);
  }
}

function registerGlobalShortcuts(ctx) {
  const data = ctx.loadStore();
  const accel = data.settings?.quickNoteShortcut || "CommandOrControl+Alt+N";
  try {
    globalShortcut.unregisterAll();
  } catch (_) {}
  const ok = globalShortcut.register(accel, () => createQuickNoteWindow(ctx));
  return { ok, accelerator: accel, conflict: !ok };
}

function parseTodoReminders(notes) {
  const items = [];
  const re = /^- \[( |x|X)\]\s+(.+?)(?:\s+@remind\(([^\)]+)\))?\s*$/gm;
  for (const note of notes || []) {
    if (note.deletedAt || note.isEncrypted) continue;
    const body = String(note.body || "");
    let m;
    const localRe = new RegExp(re);
    while ((m = localRe.exec(body))) {
      const done = m[1].toLowerCase() === "x";
      const text = m[2].trim();
      const whenRaw = m[3] ? m[3].trim() : "";
      if (!whenRaw || done) continue;
      const when = new Date(whenRaw.replace(/年|月/g, "-").replace(/日/g, " ").trim());
      if (Number.isNaN(when.getTime())) continue;
      items.push({
        key: `${note.id}:${when.toISOString()}:${text.slice(0, 40)}`,
        noteId: note.id,
        title: note.title || "未命名笔记",
        text,
        when: when.toISOString()
      });
    }
  }
  return items;
}

function tickReminders(ctx) {
  if (!Notification.isSupported()) return;
  const data = ctx.loadStore();
  if (data.settings?.authEnabled && !ctx.isSessionUnlocked?.()) return;
  const now = Date.now();
  for (const item of parseTodoReminders(data.notes)) {
    const t = new Date(item.when).getTime();
    if (t > now) continue;
    if (now - t > 24 * 3600 * 1000) continue; // ignore very old
    if (remindedKeys.has(item.key)) continue;
    remindedKeys.add(item.key);
    try {
      const n = new Notification({
        title: `待办提醒 · ${item.title}`,
        body: item.text
      });
      n.on("click", () => {
        const w = mainWindowGetter();
        if (w) {
          w.show();
          w.focus();
          w.webContents.send("reminders:open-note", item.noteId);
        }
      });
      n.show();
    } catch (_) {}
  }
}

function openPathSafely(filePath, { confirmExec = true } = {}) {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: "文件不存在" };
  const ext = extOf(filePath);
  if (confirmExec && EXEC_EXTS.has(ext)) {
    const res = dialog.showMessageBoxSync({
      type: "warning",
      buttons: ["取消", "打开"],
      defaultId: 0,
      cancelId: 0,
      title: "打开可执行文件",
      message: `即将用系统默认方式打开可执行文件：\n${path.basename(filePath)}\n\n请确认来源可信。`
    });
    if (res !== 1) return { ok: false, canceled: true };
  }
  const err = shell.openPath(filePath);
  // openPath returns promise in modern electron - handle both
  if (err && typeof err.then === "function") {
    return err.then(message => ({ ok: !message, error: message || "" }));
  }
  return Promise.resolve({ ok: !err, error: err || "" });
}

function revealInFolder(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false };
  shell.showItemInFolder(filePath);
  return { ok: true };
}

function consumeArgvFiles(argv = []) {
  return (argv || [])
    .slice(1)
    .filter(arg => arg && !arg.startsWith("-") && !/electron/i.test(arg) && !arg.endsWith(".js"))
    .filter(arg => fs.existsSync(arg) && fs.statSync(arg).isFile());
}

function queueExternalFiles(files) {
  for (const f of files || []) {
    if (f && !openExternalFileQueue.includes(f)) openExternalFileQueue.push(f);
  }
}

function takeQueuedFiles() {
  const list = [...openExternalFileQueue];
  openExternalFileQueue = [];
  return list;
}

function register(ipcMainRef, ctx, options = {}) {
  mainWindowGetter = options.getMainWindow || (() => null);
  if (typeof ctx.isSessionUnlocked !== "function") {
    ctx.isSessionUnlocked = () => true;
  }

  // settings defaults patch happens in main

  ipcMainRef.handle("notes:save-encrypted", (_e, noteId, password, patch) => {
    try {
      return { ok: true, data: saveEncryptedNote(ctx, noteId, password, patch || {}) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMainRef.handle("notes:version-compare", (_e, noteId, a, b) => {
    try { return { ok: true, ...(compareVersions(ctx, noteId, a, b)) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });

  ipcMainRef.handle("notes:restore-version-safe", (_e, noteId, versionId) => {
    try { return { ok: true, data: restoreNoteVersionSafe(ctx, noteId, versionId) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });

  ipcMainRef.handle("notes:list-versions", (_e, noteId) => {
    const data = ctx.loadStore();
    const list = (data.noteVersions || [])
      .filter(item => item.noteId === noteId)
      .map(item => ({
        id: item.id,
        title: item.title,
        reason: item.reason,
        createdAt: item.createdAt,
        isEncrypted: !!item.isEncrypted,
        hasBody: item.isEncrypted ? !!item.encryptedPayload : !!item.body
      }));
    return list;
  });

  ipcMainRef.handle("backup:daily", () => ensureDailyBackup(ctx));
  ipcMainRef.handle("backup:list-daily", () => {
    const dir = path.join(ctx.appDataDir(), "backups", "daily");
    try {
      return fs.readdirSync(dir)
        .filter(name => name.endsWith(".json"))
        .sort()
        .reverse()
        .map(name => ({ name, path: path.join(dir, name), mtime: fs.statSync(path.join(dir, name)).mtime.toISOString() }));
    } catch {
      return [];
    }
  });

  ipcMainRef.handle("export:docx", async (_e, noteId, plainBody) => {
    try { return await exportDocx(ctx, noteId, plainBody); }
    catch (error) { return { canceled: true, error: error.message }; }
  });

  ipcMainRef.handle("quicknote:save", (_e, text) => saveQuickNote(ctx, text));
  ipcMainRef.handle("quicknote:open", () => {
    createQuickNoteWindow(ctx);
    return { ok: true };
  });
  ipcMainRef.handle("shortcut:register-quick", () => registerGlobalShortcuts(ctx));

  ipcMainRef.handle("reminders:list", () => parseTodoReminders(ctx.loadStore().notes));
  ipcMainRef.handle("reminders:tick", () => {
    tickReminders(ctx);
    return { ok: true };
  });

  ipcMainRef.handle("files:open-external-dialog", async () => {
    const result = await dialog.showOpenDialog({
      title: "打开文件",
      properties: ["openFile", "multiSelections"]
    });
    if (result.canceled) return { canceled: true, files: [] };
    return { canceled: false, files: result.filePaths || [] };
  });

  ipcMainRef.handle("files:read-external", async (_e, filePath) => {
    try { return { ok: true, file: await readExternalFileAsync(filePath) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });

  ipcMainRef.handle("files:save-external", (_e, filePath, content, encoding = "utf8") => {
    try {
      const iconv = require("iconv-lite");
      let buf;
      if (encoding === "gbk") buf = iconv.encode(String(content || ""), "gbk");
      else buf = Buffer.from(String(content || ""), "utf8");
      fs.writeFileSync(filePath, buf);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMainRef.handle("files:save-external-as", async (_e, content, encoding, defaultName) => {
    const result = dialog.showSaveDialogSync({
      title: "另存为",
      defaultPath: defaultName || "untitled.txt",
      filters: [{ name: "All", extensions: ["*"] }]
    });
    if (!result) return { canceled: true };
    const iconv = require("iconv-lite");
    const buf = encoding === "gbk" ? iconv.encode(String(content || ""), "gbk") : Buffer.from(String(content || ""), "utf8");
    fs.writeFileSync(result, buf);
    return { canceled: false, path: result };
  });

  ipcMainRef.handle("files:open-path", async (_e, filePath) => openPathSafely(filePath));
  ipcMainRef.handle("files:reveal-path", (_e, filePath) => revealInFolder(filePath));
  ipcMainRef.handle("files:take-queued", () => takeQueuedFiles());

  ipcMainRef.handle("notes:import-from-file", (_e, payload = {}) => {
    const data = ctx.loadStore();
    const note = {
      id: ctx.uid("note"),
      title: payload.title || path.basename(payload.path || "导入文件"),
      body: String(payload.content || ""),
      tags: Array.isArray(payload.tags) ? payload.tags : ["导入"],
      folderId: data.settings?.defaultFolderId || null,
      isFavorite: false,
      isPinned: false,
      createdAt: ctx.nowIso(),
      updatedAt: ctx.nowIso(),
      deletedAt: null
    };
    data.notes.unshift(note);
    data.currentNoteId = note.id;
    ctx.saveStore();
    return { ok: true, data: ctx.publicData(), id: note.id };
  });
}

function bootDesktopExtras(ctx, options = {}) {
  mainWindowGetter = options.getMainWindow || (() => null);
  setupTray(ctx);
  const shortcut = registerGlobalShortcuts(ctx);
  ensureDailyBackup(ctx);
  setInterval(() => {
    try { tickReminders(ctx); } catch (_) {}
  }, 30000);
  setInterval(() => {
    try { ensureDailyBackup(ctx); } catch (_) {}
  }, 60 * 60 * 1000);
  return { shortcut };
}

module.exports = {
  register,
  bootDesktopExtras,
  queueExternalFiles,
  consumeArgvFiles,
  takeQueuedFiles,
  classifyPath,
  readExternalFileAsync,
  ensureDailyBackup,
  recordEncryptedAwareVersion,
  saveEncryptedNote,
  TEXT_EXTS,
  EXEC_EXTS
};
