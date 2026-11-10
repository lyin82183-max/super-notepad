const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { safeStorage, net } = require("electron");

function deriveKey(password, salt) {
  return crypto.scryptSync(String(password || ""), salt, 32, { N: 16384, r: 8, p: 1 });
}

function encryptText(plainText, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(plainText || ""), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: enc.toString("base64")
  };
}

function decryptText(payload, password) {
  if (!payload || !payload.data) throw new Error("无效的密文");
  const salt = Buffer.from(payload.salt, "base64");
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final()
  ]);
  return out.toString("utf8");
}

function encryptNote(ctx, noteId, password) {
  const data = ctx.loadStore();
  const note = data.notes.find(item => item.id === noteId && !item.deletedAt);
  if (!note) throw new Error("笔记不存在");
  if (note.isEncrypted) throw new Error("笔记已加密");
  const body = String(note.body || "");
  ctx.recordNoteVersion(data, { ...note }, "加密前版本");
  note.encryptedPayload = encryptText(body, password);
  note.body = "";
  note.isEncrypted = true;
  note.updatedAt = ctx.nowIso();
  ctx.saveStore();
  return ctx.publicData();
}

function decryptNote(ctx, noteId, password) {
  const data = ctx.loadStore();
  const note = data.notes.find(item => item.id === noteId && !item.deletedAt);
  if (!note) throw new Error("笔记不存在");
  if (!note.isEncrypted || !note.encryptedPayload) throw new Error("笔记未加密");
  const plain = decryptText(note.encryptedPayload, password);
  note.body = plain;
  note.isEncrypted = false;
  note.encryptedPayload = null;
  note.updatedAt = ctx.nowIso();
  ctx.saveStore();
  return ctx.publicData();
}

function unlockNotePreview(ctx, noteId, password) {
  const data = ctx.loadStore();
  const note = data.notes.find(item => item.id === noteId && !item.deletedAt);
  if (!note) throw new Error("笔记不存在");
  if (!note.isEncrypted) return { body: note.body || "", temporary: false };
  const plain = decryptText(note.encryptedPayload, password);
  return { body: plain, temporary: true };
}

async function runOcr(ctx, payload = {}) {
  const { spawnSync } = require("child_process");
  let image = payload.dataUrl || payload.imagePath;
  if (!image && payload.fileId) {
    const data = ctx.loadStore();
    const file = data.files.find(item => item.id === payload.fileId);
    if (!file?.localPath || !fs.existsSync(file.localPath)) throw new Error("附件不存在");
    image = file.localPath;
  }
  if (!image) throw new Error("没有可识别的图片");
  // Run OCR in a child Node process: tesseract worker threads can hang inside Electron main.
  const argsPayload = JSON.stringify({
    image,
    langs: payload.langs || "chi_sim+eng",
    cachePath: path.join(ctx.appDataDir(), "tess-cache")
  });
  const r = spawnSync("node", [path.join(__dirname, "ocr-worker.js"), argsPayload], {
    cwd: __dirname,
    encoding: "utf8",
    timeout: 120000,
    shell: true,
    maxBuffer: 10 * 1024 * 1024
  });
  const raw = String(r.stdout || "").trim() || String(r.stderr || "").trim();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  if (!parsed?.ok) throw new Error(parsed?.error || raw || `OCR 失败 status=${r.status}`);
  return { text: String(parsed.text || "").trim() };
}

function aiConfigPath(ctx) {
  return path.join(ctx.appDataDir(), "ai-config.bin");
}

function loadAiConfig(ctx) {
  try {
    const file = aiConfigPath(ctx);
    if (!fs.existsSync(file)) return { baseUrl: "", model: "", hasKey: false };
    const raw = fs.readFileSync(file);
    let json;
    if (safeStorage.isEncryptionAvailable()) {
      json = JSON.parse(safeStorage.decryptString(raw));
    } else {
      json = JSON.parse(raw.toString("utf8"));
    }
    return {
      baseUrl: json.baseUrl || "",
      model: json.model || "",
      hasKey: Boolean(json.apiKey)
    };
  } catch {
    return { baseUrl: "", model: "", hasKey: false };
  }
}

function saveAiConfig(ctx, input = {}) {
  const prev = (() => {
    try {
      const file = aiConfigPath(ctx);
      if (!fs.existsSync(file)) return {};
      const raw = fs.readFileSync(file);
      if (safeStorage.isEncryptionAvailable()) return JSON.parse(safeStorage.decryptString(raw));
      return JSON.parse(raw.toString("utf8"));
    } catch {
      return {};
    }
  })();
  const next = {
    baseUrl: String(input.baseUrl || prev.baseUrl || "").trim(),
    model: String(input.model || prev.model || "").trim(),
    apiKey: input.apiKey != null && String(input.apiKey).length ? String(input.apiKey) : (prev.apiKey || "")
  };
  const encoded = JSON.stringify(next);
  const out = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(encoded)
    : Buffer.from(encoded, "utf8");
  fs.writeFileSync(aiConfigPath(ctx), out);
  return loadAiConfig(ctx);
}

async function runAiComplete(ctx, input = {}) {
  const file = aiConfigPath(ctx);
  if (!fs.existsSync(file)) throw new Error("请先在设置中配置 AI 接口");
  const raw = fs.readFileSync(file);
  const cfg = safeStorage.isEncryptionAvailable()
    ? JSON.parse(safeStorage.decryptString(raw))
    : JSON.parse(raw.toString("utf8"));
  if (!cfg.baseUrl || !cfg.apiKey) throw new Error("请先在设置中配置 AI 接口");
  const endpoint = cfg.baseUrl.replace(/\/$/, "") + "/chat/completions";
  const body = {
    model: cfg.model || "gpt-4o-mini",
    messages: [
      { role: "system", content: input.system || "你是笔记助手，请用简洁中文回答。" },
      { role: "user", content: String(input.prompt || "") }
    ],
    temperature: 0.3
  };
  const res = await net.fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI 请求失败：${res.status} ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content || "";
  return { content: String(content) };
}

function mergeSync(ctx, targetDir) {
  const target = targetDir || ctx.loadStore().settings.syncDir;
  if (!target) return { canceled: true, data: ctx.publicData() };
  fs.mkdirSync(target, { recursive: true });
  const remoteDataFile = path.join(target, "data.json");
  const local = ctx.loadStore();
  let remote = null;
  if (fs.existsSync(remoteDataFile)) {
    try { remote = JSON.parse(fs.readFileSync(remoteDataFile, "utf8")); } catch { remote = null; }
  }

  if (remote && Array.isArray(remote.notes)) {
    const byId = new Map(local.notes.map(n => [n.id, n]));
    for (const rn of remote.notes) {
      const ln = byId.get(rn.id);
      if (!ln) {
        local.notes.push(rn);
        continue;
      }
      const lt = new Date(ln.updatedAt || 0).getTime();
      const rt = new Date(rn.updatedAt || 0).getTime();
      if (rt > lt) {
        // keep both on conflict of encrypted/body divergence
        if ((ln.body || "") !== (rn.body || "") && !ln.isEncrypted && !rn.isEncrypted) {
          const conflict = {
            ...rn,
            id: ctx.uid("note"),
            title: `${rn.title || "未命名"}（同步冲突副本）`,
            createdAt: ctx.nowIso(),
            updatedAt: ctx.nowIso(),
            deletedAt: null
          };
          local.notes.unshift(conflict);
        } else {
          Object.assign(ln, rn);
        }
      }
    }
    // merge files metadata lightly
    const fileMap = new Map((local.files || []).map(f => [f.id, f]));
    for (const rf of remote.files || []) {
      if (!fileMap.has(rf.id)) local.files.push(rf);
    }
  }

  ctx.saveStore();
  // export local snapshot after merge
  fs.copyFileSync(ctx.dataFile(), remoteDataFile);
  ctx.copyDirSafe(ctx.uploadsDir(), path.join(target, "uploads"));
  local.settings.syncDir = target;
  local.settings.lastSyncAt = ctx.nowIso();
  ctx.saveStore();
  return { canceled: false, target, data: ctx.publicData(), merged: Boolean(remote) };
}

function redactEncryptedForSearch(note) {
  if (!note?.isEncrypted) return note;
  return { ...note, body: "" };
}

function patchSearchNotes(ctx, originalSearchAll) {
  return function searchAll(query) {
    // temporarily scrub encrypted bodies
    const data = ctx.loadStore();
    const backup = data.notes.map(n => n.body);
    data.notes.forEach(n => {
      if (n.isEncrypted) n.body = "";
    });
    try {
      return originalSearchAll(query);
    } finally {
      data.notes.forEach((n, i) => { n.body = backup[i]; });
    }
  };
}

function register(ipcMain, ctx) {
  ipcMain.handle("notes:encrypt", (_e, noteId, password) => {
    try { return { ok: true, data: encryptNote(ctx, noteId, password) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("notes:decrypt", (_e, noteId, password) => {
    try { return { ok: true, data: decryptNote(ctx, noteId, password) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("notes:unlock-preview", (_e, noteId, password) => {
    try { return { ok: true, ...unlockNotePreview(ctx, noteId, password) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("ocr:recognize", async (_e, payload) => {
    try { return { ok: true, ...(await runOcr(ctx, payload || {})) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("ai:get-config", () => loadAiConfig(ctx));
  ipcMain.handle("ai:save-config", (_e, input) => saveAiConfig(ctx, input || {}));
  ipcMain.handle("ai:complete", async (_e, input) => {
    try { return { ok: true, ...(await runAiComplete(ctx, input || {})) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("app:sync-merge", (_e, targetDir) => mergeSync(ctx, targetDir));
  ipcMain.handle("highlight:code", (_e, payload = {}) => {
    try {
      const hljs = require("highlight.js");
      const code = String(payload.code || "");
      const language = payload.language;
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return null;
    }
  });
}

module.exports = {
  register,
  encryptText,
  decryptText,
  mergeSync,
  loadAiConfig
};
