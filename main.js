const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, shell, globalShortcut } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const fullFeatures = require("./full-features");
const extraFeatures = require("./extra-features");

const APP_TITLE = "Super Notepad";

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function todayLabel() {
  const now = new Date();
  return `今天 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function appDataDir() {
  const config = loadRuntimeConfig();
  if (config.dataDir) {
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      return config.dataDir;
    } catch {
      // Fall back to Electron's default userData path if the custom path is unavailable.
    }
  }
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function defaultAppDataDir() {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runtimeConfigFile() {
  return path.join(defaultAppDataDir(), "runtime-config.json");
}

function loadRuntimeConfig() {
  try {
    return JSON.parse(fs.readFileSync(runtimeConfigFile(), "utf8"));
  } catch {
    return {};
  }
}

function saveRuntimeConfig(config) {
  fs.writeFileSync(runtimeConfigFile(), JSON.stringify(config || {}, null, 2), "utf8");
}

function dataFile() {
  return path.join(appDataDir(), "data.json");
}

function uploadsDir() {
  const dir = path.join(appDataDir(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function backupsDir() {
  const dir = path.join(appDataDir(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeName(name) {
  return String(name || "file").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "file";
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password || ""), salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(expectedHash, "hex"));
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function markdownToHtml(markdown) {
  return String(markdown || "")
    .split(/\r?\n/)
    .map(line => {
      if (line.startsWith("### ")) return `<h3>${escapeHtml(line.slice(4))}</h3>`;
      if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
      if (/^-\s+\[.\]\s+/.test(line)) return `<p>${escapeHtml(line)}</p>`;
      if (/^[-*]\s+/.test(line)) return `<p>• ${escapeHtml(line.replace(/^[-*]\s+/, ""))}</p>`;
      if (!line.trim()) return "<br>";
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fileKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if ([".doc", ".docx", ".txt", ".md", ".rtf"].includes(ext)) return "doc";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"].includes(ext)) return "img";
  if ([".xls", ".xlsx", ".csv"].includes(ext)) return "xls";
  if ([".zip", ".rar", ".7z"].includes(ext)) return "zip";
  return "file";
}

function readTextFileSafe(filePath, maxBytes = 180000) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > maxBytes) return "";
    const buffer = fs.readFileSync(filePath);
    if (buffer.includes(0)) return "";
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function fileHashSafe(filePath) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return "";
  }
}

function tokenize(value) {
  const text = activeText(value)
    .replace(/[，。！？、；：“”‘’（）【】\[\]{}<>#*_`~|/\\.,;:!?()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = new Set();
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word.length >= 2) tokens.add(word);
    if (/[\u4e00-\u9fa5]/.test(word)) {
      for (let i = 0; i < word.length - 1; i += 1) tokens.add(word.slice(i, i + 2));
    }
  }
  return [...tokens];
}

function semanticScore(query, content) {
  const q = tokenize(query);
  const c = new Set(tokenize(content));
  if (!q.length || !c.size) return 0;
  const hits = q.filter(token => c.has(token)).length;
  return hits / Math.sqrt(q.length * c.size);
}

function extractPdfTextBasic(filePath) {
  try {
    const raw = fs.readFileSync(filePath).toString("latin1");
    const chunks = [];
    for (const match of raw.matchAll(/\(([^()]{2,200})\)\s*Tj/g)) chunks.push(match[1]);
    for (const match of raw.matchAll(/\[([^\]]{2,600})\]\s*TJ/g)) {
      chunks.push(match[1].replace(/\(([^()]*)\)/g, " $1 "));
    }
    return chunks.join(" ").replace(/\\[nrtbf()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
  } catch {
    return "";
  }
}

function extractFileIndex(file) {
  if (!file?.localPath || !fs.existsSync(file.localPath)) return "";
  if (["doc", "xls"].includes(file.kind)) return readTextFileSafe(file.localPath, 500000);
  if (file.kind === "pdf") return extractPdfTextBasic(file.localPath) || `PDF 文件 ${file.name}`;
  if (file.kind === "img") return `图片 OCR 索引 ${file.name} ${(file.tags || []).join(" ")} ${file.category || ""}`;
  return `${file.name} ${file.category || ""} ${(file.tags || []).join(" ")}`;
}

function guessFileCategory(file) {
  const text = activeText(`${file.name} ${(file.tags || []).join(" ")} ${file.textIndex || ""} ${file.ocrText || ""}`);
  if (file.kind === "img" || /截图|图片|设计|素材|logo|封面|photo|image|png|jpg/.test(text)) return "图片";
  if (/合同|协议|发票|票据|收据|款|合同/.test(text)) return "合同";
  if (/会议|纪要|meeting|议程/.test(text)) return "会议";
  if (/prd|产品|需求|方案|原型|规划/.test(text)) return "产品";
  if (/表格|报表|excel|csv|数据/.test(text)) return "表格";
  return "文档";
}

function seedData() {
  const t = nowIso();
  const folderProduct = uid("folder");
  const folderDesign = uid("folder");
  const folderContract = uid("folder");
  const noteMain = uid("note");
  const noteCompetitor = uid("note");
  const noteInterview = uid("note");

  return {
    version: 1,
    currentNoteId: noteMain,
    currentView: "home",
    settings: {
      workspaceName: "我的工作区",
      userName: "墨先生",
      autoSaveMs: 700,
      defaultFolderId: folderProduct,
      aiMode: "local-rules",
      theme: "light",
      authEnabled: false,
      passwordSalt: null,
      passwordHash: null,
      encryptionEnabled: false,
      storageLimitKB: 1024 * 200,
      syncDir: "",
      lastSyncAt: null,
      idleLockMinutes: 0,
      quickNoteShortcut: "CommandOrControl+Alt+N",
      dailyBackupKeep: 7,
      noteVersionKeep: 40,
      authWarningAck: false
    },
    folders: [
      { id: folderProduct, name: "产品文档", kind: "文档", createdAt: t, updatedAt: t, deletedAt: null },
      { id: folderDesign, name: "设计素材", kind: "图片", createdAt: t, updatedAt: t, deletedAt: null },
      { id: folderContract, name: "合同与票据", kind: "文档", createdAt: t, updatedAt: t, deletedAt: null }
    ],
    notes: [
      {
        id: noteMain,
        title: "超级记事本产品方案",
        body: [
          "## 产品定位",
          "把“记录”和“归档”合在一个界面里：左边管理笔记，右边管理文件，中间专注写作。文件可以直接拖进笔记正文，自动生成附件卡片，也能在文件库里长期归档和复用。",
          "",
          "## 核心价值",
          "- 用记事本方式快速记录，不必切到复杂文档系统。",
          "- 文件与笔记天然关联，不再分散在网盘、桌面和聊天记录里。",
          "- 支持拖拽上传、文件引用、文件预览、附件搜索和 AI 摘要。",
          "- 保持“记事本”边界，不做复杂项目管理，只做好记录、整理、搜索和归档。"
        ].join("\n"),
        tags: ["产品规划", "文件管理", "拖拽上传"],
        folderId: folderProduct,
        isFavorite: true,
        isPinned: true,
        createdAt: t,
        updatedAt: t,
        deletedAt: null
      },
      {
        id: noteCompetitor,
        title: "竞品功能拆解",
        body: "对比传统笔记产品的文件能力、搜索能力、AI 整理能力和同步能力。",
        tags: ["竞品", "AI 整理"],
        folderId: folderProduct,
        isFavorite: false,
        isPinned: false,
        createdAt: t,
        updatedAt: t,
        deletedAt: null
      },
      {
        id: noteInterview,
        title: "用户访谈纪要",
        body: "记录用户对“记事 + 文件归档 + 拖拽引用”的真实需求场景。",
        tags: ["会议纪要"],
        folderId: folderContract,
        isFavorite: false,
        isPinned: false,
        createdAt: t,
        updatedAt: t,
        deletedAt: null
      }
    ],
    files: [],
    noteAttachments: [],
    noteVersions: [],
    templates: [
      {
        id: uid("tpl"),
        name: "会议纪要",
        icon: "会议",
        body: "## 会议主题\n\n## 参会人员\n\n## 讨论结论\n- \n\n## 行动项\n- [ ] ",
        tags: ["会议纪要"],
        createdAt: t,
        updatedAt: t,
        deletedAt: null
      },
      {
        id: uid("tpl"),
        name: "PRD 产品方案",
        icon: "PRD",
        body: "## 背景\n\n## 目标用户\n\n## 核心需求\n- \n\n## 功能范围\n\n## 验收标准\n- [ ] ",
        tags: ["产品规划"],
        createdAt: t,
        updatedAt: t,
        deletedAt: null
      },
      {
        id: uid("tpl"),
        name: "读书/资料笔记",
        icon: "资料",
        body: "## 来源\n\n## 核心观点\n- \n\n## 可复用内容\n\n## 我的结论\n",
        tags: ["资料"],
        createdAt: t,
        updatedAt: t,
        deletedAt: null
      }
    ],
    recentSearches: [],
    recent: [],
    aiCache: {}
  };
}

function normalizeData(data) {
  const seeded = seedData();
  const normalized = {
    ...seeded,
    ...data,
    settings: { ...seeded.settings, ...(data.settings || {}) },
    folders: Array.isArray(data.folders) ? data.folders : seeded.folders,
    notes: Array.isArray(data.notes) ? data.notes : seeded.notes,
    files: Array.isArray(data.files) ? data.files : seeded.files,
    noteAttachments: Array.isArray(data.noteAttachments) ? data.noteAttachments : seeded.noteAttachments,
    noteVersions: Array.isArray(data.noteVersions) ? data.noteVersions : seeded.noteVersions,
    templates: Array.isArray(data.templates) ? data.templates : seeded.templates,
    recentSearches: Array.isArray(data.recentSearches) ? data.recentSearches : seeded.recentSearches,
    recent: Array.isArray(data.recent) ? data.recent : seeded.recent,
    aiCache: data.aiCache && typeof data.aiCache === "object" ? data.aiCache : {}
  };
  normalized.notes = normalized.notes.map(note => ({ icon: "📝", cover: "", dailyDate: null, ...note }));
  normalized.files = normalized.files.map(file => ({ tags: [], isFavorite: false, ocrText: "", hash: "", ...file }));
  return normalized;
}

let store = null;
let sessionUnlocked = false;

function loadStore() {
  if (store) return store;
  try {
    const raw = JSON.parse(fs.readFileSync(dataFile(), "utf8"));
    store = normalizeData(raw);
  } catch {
    store = seedData();
    saveStore();
  }
  return store;
}

function saveStore() {
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(store || seedData(), null, 2), "utf8");
}

function sanitizeSettings(settings) {
  const { passwordHash, passwordSalt, ...safe } = settings || {};
  return { ...safe, authConfigured: Boolean(passwordHash && passwordSalt) };
}

function isLocked(data = loadStore()) {
  return Boolean(data.settings?.authEnabled && !sessionUnlocked);
}

function buildNoteLinks(data) {
  const notes = (data.notes || []).filter(note => !note.deletedAt);
  const byTitle = new Map(notes.map(note => [String(note.title || "").trim(), note]));
  const links = {};
  for (const note of notes) links[note.id] = { outgoing: [], incoming: [] };
  for (const note of notes) {
    const body = String(note.body || "");
    const matches = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map(item => item[1].trim()).filter(Boolean);
    for (const title of matches) {
      const target = byTitle.get(title);
      if (!target || target.id === note.id) continue;
      links[note.id].outgoing.push({ id: target.id, title: target.title });
      links[target.id].incoming.push({ id: note.id, title: note.title });
    }
  }
  return links;
}

function publicData() {
  const data = loadStore();
  const runtimeConfig = loadRuntimeConfig();
  const base = {
    locked: isLocked(data),
    settings: sanitizeSettings(data.settings),
    dataPath: dataFile(),
    dataRootPath: appDataDir(),
    uploadsPath: uploadsDir(),
    dataLocationCustom: Boolean(runtimeConfig.dataDir)
  };
  if (base.locked) {
    return {
      ...base,
      currentNoteId: null,
      folders: [],
      notes: [],
      files: [],
      noteAttachments: [],
      noteVersions: [],
      templates: [],
      recentSearches: [],
      recent: [],
      aiCache: {},
      noteLinks: {}
    };
  }
  const notes = (data.notes || []).map(note => {
    if (!note.isEncrypted) return note;
    const clone = { ...note, body: "", isEncrypted: true };
    delete clone.encryptedPayload;
    return clone;
  });
  return {
    ...data,
    notes,
    settings: base.settings,
    locked: false,
    noteLinks: buildNoteLinks(data),
    dataPath: base.dataPath,
    dataRootPath: base.dataRootPath,
    uploadsPath: base.uploadsPath,
    dataLocationCustom: base.dataLocationCustom
  };
}

function touchRecent(type, id) {
  const data = loadStore();
  data.recent = [{ type, id, at: nowIso() }, ...(data.recent || []).filter(item => !(item.type === type && item.id === id))].slice(0, 80);
}

function recordNoteVersion(data, note, reason = "自动保存") {
  extraFeatures.recordEncryptedAwareVersion({
    uid, nowIso, loadStore, saveStore, publicData, appDataDir, dataFile
  }, data, note, reason);
}

function updateNote(input) {
  const data = loadStore();
  const id = input.id || uid("note");
  const existing = data.notes.find(item => item.id === id);
  const t = nowIso();
  if (existing) {
    if (existing.isEncrypted && Object.prototype.hasOwnProperty.call(input, "body")) {
      delete input.body;
    }
    const changed = ["title", "body", "tags"].some(key => JSON.stringify(existing[key] || null) !== JSON.stringify(input[key] ?? existing[key] ?? null));
    if (changed) recordNoteVersion(data, existing, input.versionReason || "编辑前版本");
    Object.assign(existing, input, { id, updatedAt: t, deletedAt: input.deletedAt ?? existing.deletedAt ?? null });
    if (existing.isEncrypted) existing.body = "";
  } else {
    data.notes.unshift({
      id,
      title: input.title || "未命名笔记",
      body: input.body || "",
      tags: Array.isArray(input.tags) ? input.tags : [],
      folderId: input.folderId || data.settings.defaultFolderId || null,
      isFavorite: Boolean(input.isFavorite),
      isPinned: Boolean(input.isPinned),
      icon: input.icon || "📝",
      cover: input.cover || "",
      dailyDate: input.dailyDate || null,
      createdAt: t,
      updatedAt: t,
      deletedAt: null
    });
  }
  data.currentNoteId = id;
  touchRecent("note", id);
  saveStore();
  try {
    extraFeatures.ensureDailyBackup({ loadStore, saveStore, publicData, appDataDir, dataFile, uid, nowIso });
  } catch (_) {}
  return publicData();
}

function createFolder(name, kind = "文档") {
  const data = loadStore();
  const t = nowIso();
  data.folders.unshift({ id: uid("folder"), name: name || "新建文件夹", kind, createdAt: t, updatedAt: t, deletedAt: null });
  saveStore();
  return publicData();
}

function createDailyNote() {
  const data = loadStore();
  const dailyDate = localDateKey();
  const existing = data.notes.find(note => note.dailyDate === dailyDate && !note.deletedAt);
  if (existing) {
    data.currentNoteId = existing.id;
    touchRecent("note", existing.id);
    saveStore();
    return publicData();
  }
  return updateNote({
    title: `每日笔记 ${dailyDate}`,
    body: `## 今日记录\n\n## 待办\n- [ ] \n\n## 总结\n`,
    tags: ["每日笔记"],
    dailyDate,
    icon: "📅",
    folderId: data.settings.defaultFolderId
  });
}

function upsertTemplate(input = {}) {
  const data = loadStore();
  const t = nowIso();
  const id = input.id || uid("tpl");
  const existing = data.templates.find(item => item.id === id);
  if (existing) Object.assign(existing, input, { id, updatedAt: t, deletedAt: input.deletedAt ?? existing.deletedAt ?? null });
  else data.templates.unshift({
    id,
    name: input.name || "新模板",
    icon: input.icon || "模板",
    body: input.body || "",
    tags: Array.isArray(input.tags) ? input.tags : [],
    createdAt: t,
    updatedAt: t,
    deletedAt: null
  });
  saveStore();
  return publicData();
}

function createNoteFromTemplate(templateId) {
  const data = loadStore();
  const template = data.templates.find(item => item.id === templateId && !item.deletedAt);
  if (!template) return publicData();
  return updateNote({
    title: `${template.name} ${localDateKey()}`,
    body: template.body || "",
    tags: template.tags || [],
    icon: template.icon || "📝",
    folderId: data.settings.defaultFolderId
  });
}

function copyFilesIntoLibrary(filePaths, options = {}) {
  const data = loadStore();
  const noteId = options.noteId || data.currentNoteId;
  const folderId = options.folderId || data.settings.defaultFolderId || data.folders.find(f => !f.deletedAt)?.id || null;
  const t = nowIso();
  const copied = [];

  for (const source of filePaths || []) {
    if (!source || !fs.existsSync(source)) continue;
    const stat = fs.statSync(source);
    if (!stat.isFile()) continue;
    const hash = fileHashSafe(source);

    const originalName = path.basename(source);
    const targetName = `${Date.now()}_${Math.random().toString(16).slice(2)}_${safeName(originalName)}`;
    const target = path.join(uploadsDir(), targetName);
    fs.copyFileSync(source, target);

    const kind = fileKind(source);
    const file = {
      id: uid("file"),
      name: originalName,
      kind,
      category: kind === "img" ? "图片" : "文档",
      sizeKB: Math.max(1, Math.round(stat.size / 1024)),
      localPath: target,
      folderId,
      textIndex: "",
      ocrText: "",
      tags: [],
      isFavorite: false,
      hash,
      duplicateOf: hash ? data.files.find(item => item.hash === hash && !item.deletedAt)?.id || null : null,
      createdAt: t,
      updatedAt: t,
      lastOpenedAt: null,
      deletedAt: null
    };
    file.textIndex = extractFileIndex(file);
    file.ocrText = kind === "img" ? file.textIndex : "";
    file.category = guessFileCategory(file);
    data.files.unshift(file);
    if (noteId) {
      data.noteAttachments.unshift({ noteId, fileId: file.id, source: options.source || "上传文件", createdAt: t, deletedAt: null });
    }
    touchRecent("file", file.id);
    copied.push(file);
  }
  saveStore();
  return { data: publicData(), files: copied };
}

function extensionFromMime(mime = "") {
  const normalized = String(mime || "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return ".jpg";
  if (normalized.includes("webp")) return ".webp";
  if (normalized.includes("gif")) return ".gif";
  if (normalized.includes("bmp")) return ".bmp";
  if (normalized.includes("svg")) return ".svg";
  return ".png";
}

function decodeDataUrl(dataUrl = "") {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const mime = match[1] || "image/png";
  const data = match[3] || "";
  const buffer = match[2] ? Buffer.from(data, "base64") : Buffer.from(decodeURIComponent(data), "utf8");
  return { mime, buffer };
}

function savePastedImages(images = [], options = {}) {
  const data = loadStore();
  const noteId = options.noteId || data.currentNoteId;
  const note = data.notes.find(item => item.id === noteId && !item.deletedAt);
  const folderId = options.folderId || note?.folderId || data.settings.defaultFolderId || data.folders.find(f => !f.deletedAt)?.id || null;
  const t = nowIso();
  const saved = [];
  let versionRecorded = false;

  for (const [index, image] of (images || []).entries()) {
    const decoded = decodeDataUrl(image?.dataUrl);
    if (!decoded || !decoded.buffer.length || !String(decoded.mime).startsWith("image/")) continue;
    const ext = path.extname(image.name || "") || extensionFromMime(image.type || decoded.mime);
    const originalName = safeName(image.name || `粘贴图片_${new Date().toISOString().replace(/[:.]/g, "-")}_${index + 1}${ext}`);
    const targetName = `${Date.now()}_${Math.random().toString(16).slice(2)}_${originalName}`;
    const target = path.join(uploadsDir(), targetName);
    fs.writeFileSync(target, decoded.buffer);
    const hash = crypto.createHash("sha256").update(decoded.buffer).digest("hex");
    const stat = fs.statSync(target);
    const file = {
      id: uid("file"),
      name: originalName,
      kind: "img",
      category: "图片",
      sizeKB: Math.max(1, Math.round(stat.size / 1024)),
      localPath: target,
      folderId,
      textIndex: `粘贴图片 ${originalName}`,
      ocrText: `粘贴图片 ${originalName}`,
      tags: ["粘贴图片"],
      isFavorite: false,
      hash,
      duplicateOf: hash ? data.files.find(item => item.hash === hash && !item.deletedAt)?.id || null : null,
      createdAt: t,
      updatedAt: t,
      lastOpenedAt: null,
      deletedAt: null
    };
    file.category = guessFileCategory(file);
    data.files.unshift(file);
    if (note) {
      data.noteAttachments.unshift({ noteId: note.id, fileId: file.id, source: "粘贴图片", createdAt: t, deletedAt: null });
      if (!versionRecorded) {
        recordNoteVersion(data, note, "粘贴图片前");
        versionRecorded = true;
      }
      note.body = `${note.body || ""}\n\n[[file:${file.id}]]`.trim();
      note.updatedAt = t;
      data.currentNoteId = note.id;
    }
    touchRecent("file", file.id);
    saved.push(file);
  }

  saveStore();
  return { data: publicData(), files: saved };
}

function activeText(value) {
  return String(value || "").toLowerCase();
}

function searchAll(query) {
  const data = loadStore();
  const encryptedBodies = new Map();
  for (const note of data.notes || []) {
    if (note.isEncrypted) {
      encryptedBodies.set(note.id, note.body);
      note.body = "";
    }
  }
  const restoreEncrypted = () => {
    for (const [id, body] of encryptedBodies.entries()) {
      const note = data.notes.find(item => item.id === id);
      if (note) note.body = body;
    }
  };
  try {
  const options = typeof query === "object" && query ? query : { q: query };
  const q = activeText(options.q).trim();
  const type = options.type || "all";
  const kind = options.kind || "all";
  const tag = activeText(options.tag || "").trim();
  const withAttachments = Boolean(options.withAttachments);
  const semantic = Boolean(options.semantic);
  const from = options.from ? new Date(options.from).getTime() : 0;
  const to = options.to ? new Date(`${options.to}T23:59:59`).getTime() : Number.MAX_SAFE_INTEGER;
  if (!q) return [];
  data.recentSearches = [{ q, at: nowIso() }, ...(data.recentSearches || []).filter(item => item.q !== q)].slice(0, 12);
  const results = [];
  const attached = new Set((data.noteAttachments || []).filter(item => !item.deletedAt).map(item => item.noteId));
  for (const note of data.notes.filter(item => !item.deletedAt && (type === "all" || type === "note"))) {
    const updated = new Date(note.updatedAt || note.createdAt || 0).getTime();
    if (updated < from || updated > to) continue;
    if (withAttachments && !attached.has(note.id)) continue;
    if (tag && !(note.tags || []).some(item => activeText(item).includes(tag))) continue;
    const content = `${note.title} ${note.body} ${(note.tags || []).join(" ")}`;
    const score = semantic ? semanticScore(q, content) : 0;
    if (activeText(content).includes(q) || score > 0.08) {
      results.push({ type: "note", id: note.id, title: note.title, subline: `${score ? `语义匹配 ${(score * 100).toFixed(0)}% · ` : ""}${(note.body || "").slice(0, 140)}`, score });
    }
  }
  for (const file of data.files.filter(item => !item.deletedAt && (type === "all" || type === "file"))) {
    const updated = new Date(file.updatedAt || file.createdAt || 0).getTime();
    if (updated < from || updated > to) continue;
    if (kind !== "all" && file.kind !== kind) continue;
    if (tag && !(file.tags || []).some(item => activeText(item).includes(tag))) continue;
    const content = `${file.name} ${file.category} ${(file.tags || []).join(" ")} ${file.textIndex || ""} ${file.ocrText || ""}`;
    const score = semantic ? semanticScore(q, content) : 0;
    if (activeText(content).includes(q) || score > 0.08) {
      results.push({ type: "file", id: file.id, title: file.name, subline: `${score ? `语义匹配 ${(score * 100).toFixed(0)}% · ` : ""}${file.localPath}`, score });
    }
  }
  restoreEncrypted();
  saveStore();
  const sorted = results.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 200);
  return sorted;
  } finally {
    restoreEncrypted();
  }
}

function extractKeywords(text) {
  const source = String(text || "")
    .replace(/[，。！？、；：“”‘’（）【】\[\]{}<>#*_`~|/\\]/g, " ")
    .split(/\s+/)
    .map(item => item.trim())
    .filter(item => item.length >= 2 && item.length <= 12);
  const freq = new Map();
  for (const word of source) freq.set(word, (freq.get(word) || 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

function summarizeNote(noteId) {
  const data = loadStore();
  const note = data.notes.find(item => item.id === noteId);
  if (!note) return null;
  const plain = String(note.body || "").replace(/[#>*\-`]/g, "").replace(/\s+/g, " ").trim();
  const summary = plain.length > 120 ? `${plain.slice(0, 120)}...` : plain || "当前笔记内容较少，可先补充正文。";
  const keywords = extractKeywords(`${note.title} ${note.body}`).slice(0, 5);
  const actionItems = String(note.body || "")
    .split(/\r?\n/)
    .filter(line => /-\s+\[\s?\]|待办|todo|下一步|行动/i.test(line))
    .slice(0, 8);
  const outline = [
    `# ${note.title}`,
    "",
    "## 背景",
    "补充问题背景、目标用户和使用场景。",
    "",
    "## 核心需求",
    "- 记录关键内容",
    "- 归档相关文件",
    "- 快速搜索和复用",
    "",
    "## 下一步",
    "- 完善内容",
    "- 检查附件",
    "- 导出或分享"
  ].join("\n");
  const attachments = data.noteAttachments
    .filter(item => item.noteId === noteId && !item.deletedAt)
    .map(item => data.files.find(file => file.id === item.fileId))
    .filter(Boolean);
  return {
    summary,
    tags: keywords.length ? keywords : ["整理", "记录"],
    titleSuggestion: keywords.length ? `${keywords.slice(0, 2).join(" · ")}记录` : `${note.title}整理版`,
    actionItems: actionItems.length ? actionItems.join("\n") : "- [ ] 补充下一步行动项",
    outline,
    attachmentDigest: attachments.length
      ? attachments.map(file => `- ${file.name}（${file.category}，${file.sizeKB} KB）`).join("\n")
      : "当前笔记没有附件。"
  };
}

function answerNoteQuestion(noteId, question) {
  const data = loadStore();
  const note = data.notes.find(item => item.id === noteId);
  if (!note) return "当前没有可问答的笔记。";
  const qTokens = extractKeywords(question).map(activeText);
  const sentences = String(note.body || "")
    .split(/[。！？\n]/)
    .map(item => item.trim())
    .filter(Boolean);
  const matched = sentences
    .map(sentence => ({ sentence, score: qTokens.filter(token => activeText(sentence).includes(token)).length }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => item.sentence);
  if (matched.length) return `根据当前笔记，相关内容是：${matched.join("；")}。`;
  return "当前笔记没有明显匹配内容，建议补充更多正文或换一个问题。";
}

function summarizeAllNotes() {
  const data = loadStore();
  const notes = data.notes.filter(item => !item.deletedAt);
  const corpus = notes.map(note => `${note.title}\n${note.body}`).join("\n\n");
  const keywords = extractKeywords(corpus).slice(0, 10);
  const withFiles = new Set(data.noteAttachments.filter(item => !item.deletedAt).map(item => item.noteId));
  const latest = [...notes].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5);
  return {
    summary: `当前共有 ${notes.length} 篇笔记、${data.files.filter(item => !item.deletedAt).length} 个文件，带附件笔记 ${withFiles.size} 篇。最近重点集中在：${keywords.slice(0, 5).join("、") || "暂无关键词"}。`,
    keywords,
    notes: latest.map(note => `- ${note.title}：${String(note.body || "").replace(/\s+/g, " ").slice(0, 80)}`).join("\n"),
    actions: [
      "- [ ] 清理未归类文件",
      "- [ ] 给重要笔记补充标签",
      "- [ ] 对带附件笔记执行一次 AI 摘要"
    ].join("\n")
  };
}

function similarNotes(noteId) {
  const data = loadStore();
  const current = data.notes.find(item => item.id === noteId && !item.deletedAt);
  if (!current) return [];
  const source = `${current.title} ${current.body} ${(current.tags || []).join(" ")}`;
  return data.notes
    .filter(note => note.id !== noteId && !note.deletedAt)
    .map(note => ({
      type: "note",
      id: note.id,
      title: note.title,
      score: semanticScore(source, `${note.title} ${note.body} ${(note.tags || []).join(" ")}`),
      subline: String(note.body || "").slice(0, 120)
    }))
    .filter(item => item.score > 0.03)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

async function exportNote(noteId, format, plainBody) {
  const data = loadStore();
  const note = data.notes.find(item => item.id === noteId);
  if (!note) return { canceled: true };
  if (note.isEncrypted && plainBody == null) {
    return { canceled: true, error: "加密笔记需先解锁再导出" };
  }
  const bodyText = plainBody != null ? String(plainBody) : String(note.body || "");
  const ext = format === "txt" ? "txt" : format === "pdf" ? "pdf" : "md";
  const result = dialog.showSaveDialogSync({
    title: "导出笔记",
    defaultPath: `${safeName(note.title)}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  });
  if (!result) return { canceled: true };
  if (format === "pdf") {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const html = `
      <html><head><meta charset="UTF-8"><style>
      body{font-family:"Microsoft YaHei",Arial,sans-serif;padding:36px;color:#172235;line-height:1.75}
      h1{font-size:28px} h2{margin-top:26px;border-bottom:1px solid #e5eaf3;padding-bottom:8px}
      p{margin:8px 0} code{background:#eef3ff;padding:2px 5px;border-radius:4px}
      </style></head><body><h1>${escapeHtml(note.title)}</h1>${markdownToHtml(bodyText)}</body></html>
    `;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: "A4", marginsType: 1 });
    fs.writeFileSync(result, pdf);
    win.destroy();
  } else {
    const content = format === "txt" ? `${note.title}\n\n${bodyText}` : `# ${note.title}\n\n${bodyText}`;
    fs.writeFileSync(result, content, "utf8");
  }
  return { canceled: false, path: result };
}

function backupData() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupsDir(), `super-notepad-backup-${stamp}.json`);
  fs.copyFileSync(dataFile(), target);
  return target;
}

function copyDirSafe(source, target) {
  try {
    if (source && target && fs.existsSync(source) && path.resolve(source) !== path.resolve(target)) {
      fs.mkdirSync(target, { recursive: true });
      fs.cpSync(source, target, { recursive: true, force: true });
    }
  } catch {
    // Directory copy is best-effort; the JSON data is still migrated below.
  }
}

function changeDataDir(targetDir) {
  if (!targetDir) return publicData();
  const current = loadStore();
  const oldRoot = appDataDir();
  const oldUploads = uploadsDir();
  const oldBackups = backupsDir();
  const nextRoot = path.resolve(targetDir);
  const nextUploads = path.join(nextRoot, "uploads");
  const nextBackups = path.join(nextRoot, "backups");

  fs.mkdirSync(nextRoot, { recursive: true });
  copyDirSafe(oldUploads, nextUploads);
  copyDirSafe(oldBackups, nextBackups);

  current.files = (current.files || []).map(file => {
    if (file.localPath && path.resolve(file.localPath).startsWith(path.resolve(oldUploads))) {
      return { ...file, localPath: path.join(nextUploads, path.basename(file.localPath)) };
    }
    return file;
  });

  saveRuntimeConfig({ ...loadRuntimeConfig(), dataDir: nextRoot });
  store = normalizeData(current);
  saveStore();
  return publicData();
}

function resetDataDir() {
  const current = loadStore();
  const oldUploads = uploadsDir();
  const oldBackups = backupsDir();
  const nextRoot = defaultAppDataDir();
  const nextUploads = path.join(nextRoot, "uploads");
  const nextBackups = path.join(nextRoot, "backups");

  copyDirSafe(oldUploads, nextUploads);
  copyDirSafe(oldBackups, nextBackups);
  current.files = (current.files || []).map(file => {
    if (file.localPath && path.resolve(file.localPath).startsWith(path.resolve(oldUploads))) {
      return { ...file, localPath: path.join(nextUploads, path.basename(file.localPath)) };
    }
    return file;
  });

  const config = loadRuntimeConfig();
  delete config.dataDir;
  saveRuntimeConfig(config);
  store = normalizeData(current);
  saveStore();
  return publicData();
}

function encryptedBackup(password) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupsDir(), `super-notepad-encrypted-${stamp}.snbak`);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(String(password || ""), salt, 140000, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const input = fs.readFileSync(dataFile());
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const payload = {
    version: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64")
  };
  fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
  return target;
}

function updateFile(fileId, patch = {}) {
  const data = loadStore();
  const file = data.files.find(item => item.id === fileId);
  if (file) {
    Object.assign(file, patch, { id: fileId, updatedAt: nowIso() });
    if (typeof file.tags === "string") file.tags = file.tags.split(",").map(item => item.trim()).filter(Boolean);
  }
  saveStore();
  return publicData();
}

function attachExistingFile(noteId, fileId, insertReference = true) {
  const data = loadStore();
  const note = data.notes.find(item => item.id === noteId && !item.deletedAt);
  const file = data.files.find(item => item.id === fileId && !item.deletedAt);
  if (!note || !file) return publicData();
  const exists = data.noteAttachments.some(item => item.noteId === noteId && item.fileId === fileId && !item.deletedAt);
  if (!exists) data.noteAttachments.unshift({ noteId, fileId, source: "文件库引用", createdAt: nowIso(), deletedAt: null });
  if (insertReference && !String(note.body || "").includes(`[[file:${file.id}]]`)) {
    recordNoteVersion(data, note, "插入文件引用前");
    note.body = `${note.body || ""}\n\n> 文件引用：[[file:${file.id}]] ${file.name}`;
    note.updatedAt = nowIso();
  }
  data.currentNoteId = noteId;
  touchRecent("file", fileId);
  saveStore();
  return publicData();
}

function restoreNoteVersion(noteId, versionId) {
  const data = loadStore();
  const note = data.notes.find(item => item.id === noteId);
  const version = data.noteVersions.find(item => item.id === versionId && item.noteId === noteId);
  if (note && version) {
    recordNoteVersion(data, note, "恢复版本前");
    Object.assign(note, {
      title: version.title,
      body: version.body,
      tags: version.tags || [],
      updatedAt: nowIso()
    });
    data.currentNoteId = note.id;
  }
  saveStore();
  return publicData();
}

function previewFile(fileId) {
  const data = loadStore();
  const file = data.files.find(item => item.id === fileId);
  if (!file || !fs.existsSync(file.localPath)) return { error: "文件不存在" };
  const stat = fs.statSync(file.localPath);
  const result = {
    id: file.id,
    name: file.name,
    kind: file.kind,
    sizeKB: file.sizeKB,
    localPath: file.localPath,
    text: file.textIndex || file.ocrText || "",
    tooLarge: stat.size > 10 * 1024 * 1024
  };
  if (file.kind === "img" && !result.tooLarge) {
    result.dataUrl = imageDataUrl(file.localPath);
  }
  if (["doc", "xls"].includes(file.kind) && !result.text) result.text = readTextFileSafe(file.localPath, 300000);
  if (file.kind === "pdf") result.text = "PDF 已进入文件库，可用系统预览打开；内置预览保留文件信息和引用能力。";
  return result;
}

function imageDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace(".", "") || "png";
  const mime = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml"
  }[ext] || "image/png";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function thumbnailFile(fileId) {
  const data = loadStore();
  const file = data.files.find(item => item.id === fileId);
  if (!file || file.kind !== "img" || !fs.existsSync(file.localPath)) {
    return { error: "图片文件不存在" };
  }

  try {
    const image = nativeImage.createFromPath(file.localPath);
    if (image.isEmpty()) throw new Error("无法读取图片缩略图");
    const { width, height } = image.getSize();
    const thumbnail = width > 640 ? image.resize({ width: 640, quality: "better" }) : image;
    return {
      id: file.id,
      width,
      height,
      dataUrl: thumbnail.toDataURL()
    };
  } catch (error) {
    try {
      const stat = fs.statSync(file.localPath);
      if (stat.size <= 10 * 1024 * 1024) return { id: file.id, dataUrl: imageDataUrl(file.localPath) };
    } catch {
      // Preserve the original thumbnail error below when the raw-image fallback also fails.
    }
    return { error: error.message || "生成图片缩略图失败" };
  }
}

function setAuth(password, enabled) {
  const data = loadStore();
  if (enabled) {
    if (password !== "__keep__" || !data.settings.passwordHash) {
      const { salt, hash } = hashPassword(password);
      data.settings.passwordSalt = salt;
      data.settings.passwordHash = hash;
    }
    data.settings.authEnabled = true;
    sessionUnlocked = true;
  } else {
    data.settings.authEnabled = false;
    sessionUnlocked = false;
  }
  saveStore();
  return publicData();
}

function reindexFiles() {
  const data = loadStore();
  let updated = 0;
  for (const file of data.files.filter(item => !item.deletedAt)) {
    const text = extractFileIndex(file);
    file.textIndex = text;
    file.ocrText = file.kind === "img" ? text : file.ocrText || "";
    file.category = guessFileCategory(file);
    file.updatedAt = nowIso();
    updated += 1;
  }
  saveStore();
  return { data: publicData(), updated };
}

function classifyFiles() {
  const data = loadStore();
  let updated = 0;
  for (const file of data.files.filter(item => !item.deletedAt)) {
    const category = guessFileCategory(file);
    const tags = new Set([...(file.tags || []), category, file.kind]);
    file.category = category;
    file.tags = [...tags].filter(Boolean).slice(0, 8);
    file.updatedAt = nowIso();
    updated += 1;
  }
  saveStore();
  return { data: publicData(), updated };
}

function syncNow(targetDir) {
  const target = targetDir || loadStore().settings.syncDir;
  if (!target) return { canceled: true, data: publicData() };
  // Prefer merge-aware sync so remote changes are pulled; conflicts keep both copies.
  try {
    return fullFeatures.mergeSync({
      loadStore, saveStore, publicData, nowIso, uid, recordNoteVersion,
      dataFile, uploadsDir, appDataDir, copyDirSafe
    }, target);
  } catch (error) {
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(dataFile(), path.join(target, "data.json"));
    copyDirSafe(uploadsDir(), path.join(target, "uploads"));
    const data = loadStore();
    data.settings.syncDir = target;
    data.settings.lastSyncAt = nowIso();
    saveStore();
    return { canceled: false, target, data: publicData(), error: error.message };
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#eef5fb",
    show: false,
    autoHideMenuBar: true,
    title: APP_TITLE,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    const queued = extraFeatures.takeQueuedFiles();
    if (queued.length) {
      setTimeout(() => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send("files:external-open", queued);
      }, 800);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.on("will-quit", () => {
  try { globalShortcut.unregisterAll(); } catch (_) {}
});

function registerIpc() {
  ipcMain.handle("app:load", () => publicData());
  ipcMain.handle("app:data-path", () => ({ dataPath: dataFile(), uploadsPath: uploadsDir() }));
  ipcMain.handle("app:backup", () => backupData());
  ipcMain.handle("app:backup-encrypted", (_event, password) => encryptedBackup(password));
  ipcMain.handle("app:open-data-folder", () => {
    shell.openPath(appDataDir());
    return appDataDir();
  });
  ipcMain.handle("app:choose-data-folder", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择超级记事本数据保存目录",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true, data: publicData() };
    return { canceled: false, data: changeDataDir(result.filePaths[0]) };
  });
  ipcMain.handle("app:reset-data-folder", () => resetDataDir());
  ipcMain.handle("app:choose-sync-folder", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择本地同步目录",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true, data: publicData() };
    return syncNow(result.filePaths[0]);
  });
  ipcMain.handle("app:sync-now", () => syncNow());

  ipcMain.handle("auth:unlock", (_event, password) => {
    const data = loadStore();
    const ok = verifyPassword(password, data.settings.passwordSalt, data.settings.passwordHash);
    if (ok) sessionUnlocked = true;
    return { ok, data: publicData() };
  });
  ipcMain.handle("auth:set", (_event, password, enabled) => setAuth(password, enabled));
  ipcMain.handle("auth:lock", () => {
    sessionUnlocked = false;
    return publicData();
  });

  ipcMain.handle("settings:save", (_event, settings) => {
    const data = loadStore();
    data.settings = { ...data.settings, ...(settings || {}) };
    saveStore();
    return publicData();
  });

  ipcMain.handle("notes:create", (_event, payload) => updateNote(payload || {}));
  ipcMain.handle("notes:update", (_event, payload) => updateNote(payload || {}));
  ipcMain.handle("notes:daily", () => createDailyNote());
  ipcMain.handle("notes:from-template", (_event, templateId) => createNoteFromTemplate(templateId));
  ipcMain.handle("notes:select", (_event, noteId) => {
    const data = loadStore();
    if (data.notes.some(note => note.id === noteId && !note.deletedAt)) {
      data.currentNoteId = noteId;
      touchRecent("note", noteId);
      saveStore();
    }
    return publicData();
  });
  ipcMain.handle("notes:delete", (_event, noteId) => {
    const data = loadStore();
    const note = data.notes.find(item => item.id === noteId);
    if (note) note.deletedAt = nowIso();
    if (data.currentNoteId === noteId) {
      data.currentNoteId = data.notes.find(item => !item.deletedAt)?.id || null;
    }
    saveStore();
    return publicData();
  });
  ipcMain.handle("notes:restore", (_event, noteId) => {
    const note = loadStore().notes.find(item => item.id === noteId);
    if (note) note.deletedAt = null;
    saveStore();
    return publicData();
  });
  ipcMain.handle("notes:restore-version", (_event, noteId, versionId) => restoreNoteVersion(noteId, versionId));
  ipcMain.handle("notes:export", (_event, noteId, format, plainBody) => exportNote(noteId, format, plainBody));

  ipcMain.handle("templates:save", (_event, payload) => upsertTemplate(payload || {}));
  ipcMain.handle("templates:delete", (_event, templateId) => upsertTemplate({ id: templateId, deletedAt: nowIso() }));

  ipcMain.handle("folders:create", (_event, name, kind) => createFolder(name, kind));
  ipcMain.handle("folders:update", (_event, folderId, patch) => {
    const folder = loadStore().folders.find(item => item.id === folderId);
    if (folder) Object.assign(folder, patch || {}, { updatedAt: nowIso() });
    saveStore();
    return publicData();
  });
  ipcMain.handle("folders:delete", (_event, folderId) => {
    const data = loadStore();
    const folder = data.folders.find(item => item.id === folderId);
    if (folder) folder.deletedAt = nowIso();
    for (const note of data.notes) if (note.folderId === folderId) note.folderId = null;
    for (const file of data.files) if (file.folderId === folderId) file.folderId = null;
    saveStore();
    return publicData();
  });

  ipcMain.handle("files:choose", async (_event, options) => {
    const result = await dialog.showOpenDialog({
      title: "选择要附加到笔记的文件",
      properties: ["openFile", "multiSelections"]
    });
    if (result.canceled) return { data: publicData(), files: [] };
    return copyFilesIntoLibrary(result.filePaths, { ...(options || {}), source: "上传文件" });
  });
  ipcMain.handle("files:copyPaths", (_event, filePaths, options) => copyFilesIntoLibrary(filePaths || [], { ...(options || {}), source: "拖拽上传" }));
  ipcMain.handle("files:pasteImages", (_event, images, options) => savePastedImages(images || [], options || {}));
  ipcMain.handle("files:detach", (_event, noteId, fileId) => {
    const rel = loadStore().noteAttachments.find(item => item.noteId === noteId && item.fileId === fileId && !item.deletedAt);
    if (rel) rel.deletedAt = nowIso();
    saveStore();
    return publicData();
  });
  ipcMain.handle("files:update", (_event, fileId, patch) => updateFile(fileId, patch || {}));
  ipcMain.handle("files:attach", (_event, noteId, fileId, insertReference) => attachExistingFile(noteId, fileId, insertReference));
  ipcMain.handle("files:reindex", () => reindexFiles());
  ipcMain.handle("files:classify", () => classifyFiles());
  ipcMain.handle("files:delete", (_event, fileId) => {
    const data = loadStore();
    const file = data.files.find(item => item.id === fileId);
    if (file) file.deletedAt = nowIso();
    for (const rel of data.noteAttachments) if (rel.fileId === fileId) rel.deletedAt = nowIso();
    saveStore();
    return publicData();
  });
  ipcMain.handle("files:preview", (_event, fileId) => previewFile(fileId));
  ipcMain.handle("files:thumbnail", (_event, fileId) => thumbnailFile(fileId));
  ipcMain.handle("files:restore", (_event, fileId) => {
    const file = loadStore().files.find(item => item.id === fileId);
    if (file) file.deletedAt = null;
    saveStore();
    return publicData();
  });
  ipcMain.handle("files:open", async (_event, fileIdOrPath) => {
    const data = loadStore();
    const file = data.files.find(item => item.id === fileIdOrPath);
    const target = file ? file.localPath : fileIdOrPath;
    if (!target || !fs.existsSync(target)) return "文件不存在";
    if (file) {
      file.lastOpenedAt = nowIso();
      touchRecent("file", file.id);
      saveStore();
    }
    return shell.openPath(target);
  });
  ipcMain.handle("files:reveal", (_event, fileIdOrPath) => {
    const data = loadStore();
    const file = data.files.find(item => item.id === fileIdOrPath);
    const target = file ? file.localPath : fileIdOrPath;
    if (target && fs.existsSync(target)) shell.showItemInFolder(target);
    return true;
  });

  ipcMain.handle("search:query", (_event, query) => searchAll(query));
  ipcMain.handle("search:similar", (_event, noteId) => similarNotes(noteId));
  ipcMain.handle("ai:organize", (_event, noteId) => summarizeNote(noteId));
  ipcMain.handle("ai:ask", (_event, noteId, question) => answerNoteQuestion(noteId, question));
  ipcMain.handle("ai:summarize-all", () => summarizeAllNotes());

  fullFeatures.register(ipcMain, {
    loadStore,
    saveStore,
    publicData,
    nowIso,
    uid,
    recordNoteVersion,
    dataFile,
    uploadsDir,
    appDataDir,
    copyDirSafe
  });

  extraFeatures.register(ipcMain, {
    loadStore,
    saveStore,
    publicData,
    nowIso,
    uid,
    recordNoteVersion,
    dataFile,
    uploadsDir,
    appDataDir,
    copyDirSafe,
    isSessionUnlocked: () => sessionUnlocked
  }, {
    getMainWindow: () => BrowserWindow.getAllWindows()[0] || null
  });

  ipcMain.handle("quicknote:close", () => {
    BrowserWindow.getAllWindows().filter(w => w.getTitle() === "随手记").forEach(w => w.close());
    return { ok: true };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const files = extraFeatures.consumeArgvFiles(argv);
    extraFeatures.queueExternalFiles(files);
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (files.length) win.webContents.send("files:external-open", files);
    }
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  loadStore();
  registerIpc();
  extraFeatures.queueExternalFiles(extraFeatures.consumeArgvFiles(process.argv));
  createWindow();
  extraFeatures.bootDesktopExtras({
    loadStore, saveStore, publicData, nowIso, uid, recordNoteVersion, dataFile, uploadsDir, appDataDir, copyDirSafe,
    isSessionUnlocked: () => sessionUnlocked
  }, { getMainWindow: () => BrowserWindow.getAllWindows()[0] || null });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  console.log("NOTEPAD_SMOKE env", process.env.NOTEPAD_SMOKE);
  if (process.env.NOTEPAD_SMOKE_SIDEBAR === "1") {
    try {
      const smoke = require("./smoke-sidebar-run");
      await smoke.run(BrowserWindow.getAllWindows()[0], {
        fullFeatures, loadStore, saveStore, publicData, dataFile, uploadsDir, appDataDir
      });
    } catch (error) {
      console.error("SMOKE_FATAL", error);
      app.exit(1);
    }
  } else if (process.env.NOTEPAD_SMOKE_EXTRA === "1") {
    try {
      const smoke = require("./smoke-extra-run");
      await smoke.run(BrowserWindow.getAllWindows()[0], {
        fullFeatures,
        loadStore,
        saveStore,
        publicData,
        dataFile,
        uploadsDir,
        appDataDir
      });
    } catch (error) {
      console.error("SMOKE_FATAL", error);
      app.exit(1);
    }
  } else if (process.env.NOTEPAD_SMOKE === "1") {
    try {
      const smoke = require("./smoke-full-run");
      await smoke.run(BrowserWindow.getAllWindows()[0], {
        fullFeatures,
        loadStore,
        saveStore,
        publicData,
        dataFile,
        uploadsDir,
        appDataDir
      });
    } catch (error) {
      console.error("SMOKE_FATAL", error);
      app.exit(1);
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
