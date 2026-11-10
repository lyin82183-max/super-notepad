(() => {
  const api = window.superNotepadNative;
  const state = {
    data: null,
    currentView: "notes",
    currentFilter: "all",
    selectedFolderId: null,
    searchQuery: "",
    searchFilters: { type: "all", kind: "all", tag: "", from: "", to: "", withAttachments: false, semantic: true },
    fileViewMode: "list",
    pendingFocus: null,
    contextPanelOpen: false,
    contextPanelPinned: false,
    sidebarCollapsed: false,
    editorMode: "rich",
    autosaveTimer: null,
    pasteInFlight: false,
    aiResult: null,
    aiResultNoteId: null,
    saveState: "saved",
    openTabs: [],
    dirtyTabIds: {},
    unlockedBodies: {},
    commandOpen: false,
    commandQuery: "",
    commandIndex: 0,
    aiConfig: null,
    notePasswords: {},
    lastActivityAt: Date.now(),
    idleTimer: null,
    externalFile: null,
    wikiSuggest: { open: false, items: [], index: 0, start: -1, end: -1 },
    lockFailCount: 0,
    lockBusyUntil: 0
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const el = {
    workspaceSubline: $("#workspaceSubline"),
    workspaceName: $("#workspaceName"),
    avatarText: $("#avatarText"),
    globalSearch: $("#globalSearch"),
    noteList: $("#noteList"),
    smartTags: $("#smartTags"),
    editorSurface: $("#editorSurface"),
    storageUsed: $("#storageUsed"),
    storageBar: $("#storageBar"),
    totalFilesMirror: $("#totalFilesMirror"),
    folderList: $("#folderList"),
    recentFiles: $("#recentFiles"),
    aiSuggestionText: $("#aiSuggestionText"),
    toast: $("#toast"),
    modalBackdrop: $("#modalBackdrop"),
    modalTitle: $("#modalTitle"),
    modalBody: $("#modalBody"),
    contextPanel: $("#contextPanel"),
    contextPanelButton: $("#contextPanelBtn"),
    contextPanelScrim: $("#contextScrim"),
    lastAction: $("#lastAction"),
    mainLayout: $("#mainLayout"),
    sidebarPanel: $("#sidebarPanel"),
    saveStatus: $("#saveStatus"),
    wordCount: $("#wordCount"),
    readTime: $("#readTime"),
    themeToggleBtn: $("#themeToggleBtn"),
    toggleSidebarBtn: $("#toggleSidebarBtn"),
    contextPanelPinBtn: $("#contextPanelPinBtn")
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function markdownToHtml(markdown) {
    const lines = String(markdown || "").split(/\r?\n/);
    const html = [];
    let inList = false;
    let inCode = false;
    let codeLang = "";
    let codeLines = [];

    const closeList = () => {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
    };

    const inline = value => escapeHtml(value)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[\[([^\]]+)\]\]/g, (_m, title) => `<a href="#" class="wiki-link" data-wiki-title="${escapeHtml(title)}">${escapeHtml(title)}</a>`);

    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        if (inCode) {
          const raw = codeLines.join("\n");
          let colored = null; // hydrated async after render
          html.push(`<pre class="hljs-pre"><code class="hljs">${colored || escapeHtml(raw)}</code></pre>`);
          codeLines = [];
          codeLang = "";
          inCode = false;
        } else {
          closeList();
          inCode = true;
          codeLang = line.trim().slice(3).trim().split(/\s+/)[0] || "";
        }
        continue;
      }

      if (inCode) {
        codeLines.push(line);
        continue;
      }

      if (!line.trim()) {
        closeList();
        continue;
      }

      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        closeList();
        const level = heading[1].length;
        html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        continue;
      }

      const todo = line.match(/^-\s+\[( |x|X)\]\s+(.+)$/);
      if (todo) {
        if (!inList) {
          html.push("<ul>");
          inList = true;
        }
        html.push(`<li class="todo-line"><input type="checkbox" disabled ${todo[1].toLowerCase() === "x" ? "checked" : ""}> ${inline(todo[2])}</li>`);
        continue;
      }

      const bullet = line.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        if (!inList) {
          html.push("<ul>");
          inList = true;
        }
        html.push(`<li>${inline(bullet[1])}</li>`);
        continue;
      }

      if (line.startsWith(">")) {
        closeList();
        html.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
        continue;
      }

      closeList();
      html.push(`<p>${inline(line)}</p>`);
    }

    closeList();
    if (inCode) {
      const raw = codeLines.join("\n");
      let colored = null; // hydrated async after render
      html.push(`<pre class="hljs-pre"><code class="hljs">${colored || escapeHtml(raw)}</code></pre>`);
    }
    return html.join("") || `<p class="muted-text">暂无内容。</p>`;
  }

  function htmlToMarkdown(html) {
    const doc = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html");
    const root = doc.body.firstElementChild;
    const lines = [];
    const walk = node => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\s+/g, " ");
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const tag = node.tagName.toLowerCase();
      const text = [...node.childNodes].map(walk).join("").trim();
      if (tag === "h1") return `# ${text}\n\n`;
      if (tag === "h2") return `## ${text}\n\n`;
      if (tag === "h3") return `### ${text}\n\n`;
      if (tag === "strong" || tag === "b") return `**${text}**`;
      if (tag === "code") return `\`${text}\``;
      if (tag === "blockquote") return `> ${text}\n\n`;
      if (tag === "li") return `- ${text}\n`;
      if (tag === "ul" || tag === "ol") return `${[...node.children].map(walk).join("")}\n`;
      if (tag === "pre") return `\n\`\`\`text\n${node.textContent.trim()}\n\`\`\`\n\n`;
      if (tag === "div" || tag === "p") return `${text}\n\n`;
      if (tag === "br") return "\n";
      return text;
    };
    for (const child of root.childNodes) lines.push(walk(child));
    return lines.join("").replace(/\n{3,}/g, "\n\n").trim();
  }

  function formatSize(sizeKB) {
    const size = Number(sizeKB || 0);
    if (size >= 1024) return `${(size / 1024).toFixed(size >= 10240 ? 0 : 1)} MB`;
    return `${size} KB`;
  }

  function formatDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (isToday) return `今天 ${time}`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
  }

  function typeLabel(kind) {
    return ({ pdf: "PDF", doc: "DOC", img: "IMG", xls: "XLS", zip: "ZIP", file: "FILE" })[kind] || "FILE";
  }

  function fileIconClass(kind) {
    return ["pdf", "doc", "img", "xls", "zip"].includes(kind) ? kind : "file";
  }

  function activeNotes(includeDeleted = false) {
    return (state.data?.notes || []).filter(note => includeDeleted ? Boolean(note.deletedAt) : !note.deletedAt);
  }

  function activeFiles(includeDeleted = false) {
    return (state.data?.files || []).filter(file => includeDeleted ? Boolean(file.deletedAt) : !file.deletedAt);
  }

  function folders(includeDeleted = false) {
    return (state.data?.folders || []).filter(folder => includeDeleted ? Boolean(folder.deletedAt) : !folder.deletedAt);
  }

  function currentNote() {
    return activeNotes().find(note => note.id === state.data?.currentNoteId) || activeNotes()[0] || null;
  }

  function currentAttachments() {
    const note = currentNote();
    if (!note) return [];
    const files = new Map(activeFiles().map(file => [file.id, file]));
    return (state.data?.noteAttachments || [])
      .filter(item => item.noteId === note.id && !item.deletedAt)
      .map(item => ({ relation: item, file: files.get(item.fileId) }))
      .filter(item => item.file);
  }

  function setLastAction(text) {
    if (el.lastAction) el.lastAction.textContent = text;
  }

  function showToast(text) {
    if (!el.toast) return;
    el.toast.textContent = text;
    el.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.toast.classList.remove("show"), 2200);
  }

  function applyTheme(theme) {
    const next = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    if (el.themeToggleBtn) el.themeToggleBtn.textContent = next === "dark" ? "浅色" : "深色";
  }

  function updateLayoutChrome() {
    const wide = window.innerWidth >= 1280;
    const docked = wide && state.contextPanelPinned;
    el.mainLayout?.classList.toggle("context-docked", docked);
    el.mainLayout?.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
    const mobileOpen = !state.sidebarCollapsed && window.innerWidth <= 1120 && window.innerWidth > 760;
    el.mainLayout?.classList.toggle("sidebar-open-mobile", mobileOpen && !state.sidebarCollapsed);
    el.toggleSidebarBtn?.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
    el.contextPanelPinBtn?.setAttribute("aria-pressed", String(state.contextPanelPinned));
    if (el.contextPanelScrim) {
      const showScrim = state.contextPanelOpen && !docked;
      el.contextPanelScrim.hidden = !showScrim;
    }
  }

  function setContextPanel(open) {
    state.contextPanelOpen = Boolean(open);
    el.contextPanel?.classList.toggle("open", state.contextPanelOpen);
    el.contextPanel?.setAttribute("aria-hidden", String(!state.contextPanelOpen));
    el.contextPanelButton?.setAttribute("aria-expanded", String(state.contextPanelOpen));
    updateLayoutChrome();
  }

  function setSaveStatus(kind, text) {
    state.saveState = kind;
    if (!el.saveStatus) return;
    el.saveStatus.textContent = text;
    el.saveStatus.classList.toggle("is-dirty", kind === "dirty");
    el.saveStatus.classList.toggle("is-saved", kind === "saved");
  }

  function updateWordStats(text) {
    const raw = String(text || "").replace(/\s+/g, "");
    const chars = [...raw].length;
    const minutes = Math.max(1, Math.ceil(chars / 400));
    if (el.wordCount) el.wordCount.textContent = `${chars} 字`;
    if (el.readTime) el.readTime.textContent = chars ? `约 ${minutes} 分钟` : "约 0 分钟";
  }

  function closeTopMoreMenu() {
    const menu = $("#topMoreMenu");
    if (menu) menu.open = false;
  }

  function showProgress(title, text = "正在处理...") {
    openModal(title, `
      <div class="modal-stack">
        <p class="muted-text" id="progressText">${escapeHtml(text)}</p>
        <div class="upload-progress"><div id="progressBar"></div></div>
      </div>
    `);
  }

  function setProgress(percent, text) {
    const bar = $("#progressBar");
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    const box = $("#progressText");
    if (box && text) box.textContent = text;
  }

  function openModal(title, bodyHtml) {
    el.modalTitle.textContent = title;
    el.modalBody.innerHTML = bodyHtml;
    el.modalBackdrop.hidden = false;
  }

  function closeModal() {
    el.modalBackdrop.hidden = true;
    el.modalBody.innerHTML = "";
  }

  async function refresh(data) {
    if (data) state.data = data;
    else state.data = await api.loadApp();
    if (state.data?.locked) {
      clearNoteSecrets();
      return renderLocked();
    }
    renderAll();
    setupIdleLockWatcher();
  }

  function isAppLocked() {
    return Boolean(state.data?.locked);
  }

  function scrubSensitiveDom() {
    // Hide any note titles/bodies from the main shell while locked.
    if (el.workspaceSubline) el.workspaceSubline.textContent = "工作区已锁定";
    if (el.workspaceName) el.workspaceName.textContent = "已锁定";
    if (el.avatarText) el.avatarText.textContent = "锁";
    if (el.smartTags) el.smartTags.innerHTML = "";
    if (el.noteList) el.noteList.innerHTML = "";
    if (el.folderList) el.folderList.innerHTML = "";
    if (el.recentFiles) el.recentFiles.innerHTML = "";
    if (el.storageUsed) el.storageUsed.textContent = "—";
    if (el.totalFilesMirror) el.totalFilesMirror.textContent = "—";
    if (el.storageBar) el.storageBar.style.width = "0%";
    if (el.aiSuggestionText) el.aiSuggestionText.textContent = "";
    if (el.editorSurface) el.editorSurface.innerHTML = "";
    const tabs = $("#noteTabs");
    if (tabs) { tabs.innerHTML = ""; tabs.hidden = true; }
    const word = $("#wordCount");
    if (word) word.textContent = "";
    const read = $("#readTime");
    if (read) read.textContent = "";
    const save = $("#saveStatus");
    if (save) save.textContent = "";
    const last = $("#lastAction");
    if (last) last.textContent = "";
    if (el.globalSearch) {
      el.globalSearch.value = "";
      el.globalSearch.blur();
      el.globalSearch.disabled = true;
    }
    closeCommandPalette?.();
    hideWikiSuggest?.();
    state.openTabs = [];
    state.externalFile = null;
    clearNoteSecrets();
  }

  function ensureLockOverlay() {
    let overlay = $("#appLockOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "appLockOverlay";
      overlay.className = "app-lock-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "工作区已锁定");
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function setShellLocked(locked) {
    const shell = $("#appShell");
    if (shell) {
      if (locked) {
        shell.setAttribute("inert", "");
        shell.setAttribute("aria-hidden", "true");
        shell.classList.add("is-locked");
      } else {
        shell.removeAttribute("inert");
        shell.removeAttribute("aria-hidden");
        shell.classList.remove("is-locked");
        if (el.globalSearch) el.globalSearch.disabled = false;
      }
    }
    document.body.classList.toggle("app-locked", locked);
  }

  function renderLocked() {
    state.lockFailCount = Number(state.lockFailCount || 0);
    state.lockBusyUntil = Number(state.lockBusyUntil || 0);
    scrubSensitiveDom();
    setShellLocked(true);
    const overlay = ensureLockOverlay();
    overlay.hidden = false;
    overlay.innerHTML = `
      <div class="app-lock-card">
        <div class="logo lock-logo" aria-hidden="true">SN</div>
        <h1>工作区已锁定</h1>
        <input id="unlockPassword" type="password" placeholder="请输入密码" autocomplete="current-password" />
        <button class="btn primary" id="unlockBtn" type="button">解锁</button>
        <p class="lock-error" id="unlockError" hidden></p>
        <p class="lock-footnote">忘记启动密码将无法解锁本地工作区。密码仅以哈希保存在本机，不保存明文。</p>
      </div>
    `;
    const input = $("#unlockPassword");
    const btn = $("#unlockBtn");
    const showError = msg => {
      const box = $("#unlockError");
      if (!box) return;
      box.hidden = !msg;
      box.textContent = msg || "";
    };
    const tryUnlock = async () => {
      if (Date.now() < state.lockBusyUntil) {
        showError("尝试过于频繁，请稍后再试");
        return;
      }
      const password = input?.value || "";
      if (!password) {
        showError("请输入密码");
        input?.focus();
        return;
      }
      btn.disabled = true;
      showError("");
      try {
        const result = await api.unlock(password);
        if (!result?.ok) {
          state.lockFailCount = Number(state.lockFailCount || 0) + 1;
          const delayMs = Math.min(8000, 500 * (2 ** Math.min(4, state.lockFailCount - 1)));
          state.lockBusyUntil = Date.now() + delayMs;
          showError(`密码错误，请 ${Math.ceil(delayMs / 1000)} 秒后再试`);
          if (input) input.value = "";
          setTimeout(() => {
            btn.disabled = false;
            input?.focus();
          }, delayMs);
          return;
        }
        state.lockFailCount = 0;
        state.lockBusyUntil = 0;
        overlay.hidden = true;
        overlay.innerHTML = "";
        setShellLocked(false);
        await refresh(result.data);
        showToast("工作区已解锁");
      } catch (error) {
        showError(error.message || "解锁失败");
        btn.disabled = false;
      }
    };
    btn?.addEventListener("click", tryUnlock);
    input?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        tryUnlock();
      }
    });
    requestAnimationFrame(() => input?.focus());
  }

  async function unlockWorkspace() {
    // kept for compatibility; unlock is handled inside renderLocked
    const password = $("#unlockPassword")?.value || "";
    const result = await api.unlock(password);
    if (!result.ok) return showToast("密码错误");
    $("#appLockOverlay")?.setAttribute("hidden", "true");
    setShellLocked(false);
    await refresh(result.data);
    showToast("工作区已解锁");
  }

  function setView(view, filter = null) {
    // Compatibility: removed rail icons still accepted as aliases.
    if (view === "home") view = "notes";
    if (view === "favorites") {
      view = "notes";
      filter = filter || "favorite";
    }
    state.currentView = view;
    if (filter) state.currentFilter = filter;
    $$("#railNav .rail-item").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
    if (view === "notes") renderAll();
    else renderEditor();
  }

  function filteredNotes() {
    let notes = activeNotes();
    const filter = state.currentFilter;
    if (filter === "recent") notes = [...notes].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    if (filter === "attachments") {
      const attached = new Set((state.data.noteAttachments || []).filter(item => !item.deletedAt).map(item => item.noteId));
      notes = notes.filter(note => attached.has(note.id));
    }
    if (filter === "meeting") notes = notes.filter(note => `${note.title} ${(note.tags || []).join(" ")}`.includes("会议"));
    if (filter === "idea") notes = notes.filter(note => `${note.title} ${(note.tags || []).join(" ")}`.includes("灵感"));
    if (filter === "favorite") notes = notes.filter(note => note.isFavorite);
    if (state.selectedFolderId) notes = notes.filter(note => note.folderId === state.selectedFolderId);
    return [...notes].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function renderAll() {
    const settings = state.data.settings || {};
    const initials = (settings.userName || "YL").split(/\s+/).map(item => item[0]).join("").slice(0, 2).toUpperCase() || "YL";
    el.workspaceSubline.textContent = "超级记事本 · 本地写作台";
    applyTheme(settings.theme || "light");
    updateLayoutChrome();
    if (el.workspaceName) el.workspaceName.textContent = settings.workspaceName || "我的工作区";
    if (el.avatarText) el.avatarText.textContent = initials;
    renderSmartTags();
    renderNoteList();
    renderFolders();
    renderRecentFiles();
    renderStats();
    updateModeButtons();
    renderEditor();
  }

  function updateModeButtons() {
    $$("[data-mode]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.mode === state.editorMode);
    });
  }

  function switchEditorMode(mode) {
    state.editorMode = mode === "markdown" ? "markdown" : "rich";
    state.currentView = "notes";
    updateModeButtons();
    renderAll();
    showToast(state.editorMode === "markdown" ? "已切换到 Markdown 编辑" : "已切换到简易编辑");
  }

  function renderSmartTags() {
    const primary = [
      ["all", "全部"],
      ["recent", "最近"],
      ["favorite", "收藏"],
      ["attachments", "附件"]
    ];
    const extras = [
      ["meeting", "会议纪要"],
      ["idea", "灵感记录"]
    ];
    const bind = (root) => {
      root?.querySelectorAll("[data-filter]").forEach(btn => {
        btn.addEventListener("click", () => {
          state.selectedFolderId = null;
          state.currentFilter = btn.dataset.filter || "all";
          state.currentView = "notes";
          $$("#railNav .rail-item").forEach(item => item.classList.toggle("active", item.dataset.view === "notes"));
          renderAll();
        });
      });
    };
    if (el.smartTags) {
      el.smartTags.innerHTML = primary.map(([key, label]) => `
        <button class="filter-chip ${state.currentFilter === key ? "active" : ""}" data-filter="${key}" type="button" title="筛选：${label}">${label}</button>
      `).join("");
      bind(el.smartTags);
    }
    const extrasHost = $("#smartTagExtras");
    if (extrasHost) {
      extrasHost.innerHTML = extras.map(([key, label]) => `
        <button class="filter-chip ${state.currentFilter === key ? "active" : ""}" data-filter="${key}" type="button" title="筛选：${label}">${label}</button>
      `).join("");
      bind(extrasHost);
    }
    const more = $("#filterMoreTags");
    if (more) {
      const extraActive = extras.some(([key]) => state.currentFilter === key);
      more.open = extraActive;
      more.classList.toggle("has-active", extraActive);
    }
  }

  function notePreview(note) {
    return String(note.body || "").replace(/[#>*`\-\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "暂无正文内容。";
  }

  function renderNoteList() {
    const current = currentNote();
    const attachedCount = id => (state.data.noteAttachments || []).filter(item => item.noteId === id && !item.deletedAt).length;
    const notes = filteredNotes();
    el.noteList.innerHTML = notes.length ? notes.map(note => `
      <button class="note-item compact-note-item ${current?.id === note.id ? "active" : ""}" data-note-id="${note.id}" type="button" title="${escapeHtml(note.title)}">
        <strong>${note.isEncrypted ? "🔒 " : ""}${escapeHtml(note.title)}${note.isPinned ? " · 置顶" : ""}</strong>
        <div class="note-meta">
          <span>${formatDate(note.updatedAt)}</span>
          <span>${attachedCount(note.id) ? `${attachedCount(note.id)} 个附件` : ""}</span>
        </div>
      </button>
    `).join("") : `<div class="empty-state">没有符合条件的笔记。</div>`;
    el.noteList.querySelectorAll("[data-note-id]").forEach(btn => {
      btn.addEventListener("click", async () => openNoteInTab(btn.dataset.noteId));
    });
  }

  function renderStats() {
    const files = activeFiles();
    const total = files.reduce((sum, file) => sum + Number(file.sizeKB || 0), 0);
    el.storageUsed.textContent = formatSize(total);
    el.totalFilesMirror.textContent = String(files.length);
    el.storageBar.style.width = `${Math.min(100, (total / (1024 * 50)) * 100).toFixed(1)}%`;
  }

  function renderFolders() {
    const counts = new Map();
    for (const file of activeFiles()) counts.set(file.folderId, (counts.get(file.folderId) || 0) + 1);
    el.folderList.innerHTML = folders().map(folder => `
      <button class="folder-item ${state.selectedFolderId === folder.id ? "active" : ""}" data-folder-id="${folder.id}" type="button">
        <div class="folder-left">
          <div class="folder-badge ${folder.kind === "图片" ? "image-icon" : "folder-icon"}"><svg viewBox="0 0 24 24"><path d="M4 7h6l1.7 2H20v8.5a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5V7Z"/></svg></div>
          <div class="folder-name">
            <strong>${escapeHtml(folder.name)}</strong>
            <small>${counts.get(folder.id) || 0} 个文件</small>
          </div>
        </div>
        <span class="tiny-tag">${escapeHtml(folder.kind || "文档")}</span>
      </button>
    `).join("");
    el.folderList.querySelectorAll("[data-folder-id]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.selectedFolderId = state.selectedFolderId === btn.dataset.folderId ? null : btn.dataset.folderId;
        state.currentView = "files";
        renderAll();
      });
      ["dragenter", "dragover"].forEach(evt => btn.addEventListener(evt, event => {
        event.preventDefault();
        btn.classList.add("dragover");
      }));
      ["dragleave", "dragend"].forEach(evt => btn.addEventListener(evt, () => btn.classList.remove("dragover")));
      btn.addEventListener("drop", async event => {
        event.preventDefault();
        btn.classList.remove("dragover");
        const libraryFile = event.dataTransfer.getData("application/x-supernotepad-file");
        if (libraryFile) {
          await refresh(await api.updateFile(libraryFile, { folderId: btn.dataset.folderId }));
          return showToast("文件已移动到文件夹");
        }
        const paths = [...(event.dataTransfer?.files || [])].map(file => api.getPathForFile(file)).filter(Boolean);
        if (paths.length) {
          const result = await api.copyDroppedFiles(paths, { folderId: btn.dataset.folderId });
          await refresh(result.data);
          showToast(`已上传到文件夹：${result.files.length} 个文件`);
        }
      });
    });
  }

  function renderRecentFiles() {
    const recentFileIds = (state.data.recent || []).filter(item => item.type === "file").map(item => item.id);
    const fileMap = new Map(activeFiles().map(file => [file.id, file]));
    let files = recentFileIds.map(id => fileMap.get(id)).filter(Boolean);
    if (!files.length) files = activeFiles().slice(0, 6);
    el.recentFiles.innerHTML = files.slice(0, 6).map(file => `
      <button class="file-row" data-open-file="${file.id}" type="button">
        <div class="file-left">
          <div class="folder-badge">${typeLabel(file.kind)}</div>
          <div>
            <strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong>
            <small>${formatSize(file.sizeKB)} · ${formatDate(file.updatedAt || file.createdAt)}</small>
          </div>
        </div>
        <span class="tiny-tag">${escapeHtml(file.category)}</span>
      </button>
    `).join("") || `<div class="empty-state">暂无最近文件。</div>`;
    el.recentFiles.querySelectorAll("[data-open-file]").forEach(btn => {
      btn.addEventListener("click", () => openFile(btn.dataset.openFile));
    });
  }

  function renderEditor() {
    if (!state.data) return;
    if (state.currentView === "external") return renderExternalFileView();
    if (state.currentView === "files") return renderFilesView();
    if (state.currentView === "search") return renderSearchView();
    if (state.currentView === "ai") return renderAiView();
    if (state.currentView === "trash") return renderTrashView();
    if (state.currentView === "settings") return renderSettingsView();
    renderNoteEditor();
  }

  function renderTagChips(tags) {
    const list = (tags || []).map(tag => String(tag).trim()).filter(Boolean);
    if (!list.length) return `<span class="meta-quiet">无标签</span>`;
    return list.map(tag => `<span class="tag-chip" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}<button type="button" class="tag-chip-remove" data-remove-tag="${escapeHtml(tag)}" aria-label="移除标签">×</button></span>`).join("");
  }

  function syncTagInputFromChips() {
    const input = $("#tagInput");
    if (!input) return;
    const tags = $$("#tagChips .tag-chip").map(chip => chip.dataset.tag).filter(Boolean);
    input.value = tags.join(", ");
  }

  function renderNoteEditor() {
    const note = currentNote();
    if (!note) {
      el.editorSurface.innerHTML = `<div class="empty-state">还没有笔记，点击“新建笔记”开始。</div>`;
      renderNoteTabs();
      return;
    }
    ensureTab(note.id);
    renderNoteTabs();
    if (note.isEncrypted && state.unlockedBodies[note.id] == null) {
      el.editorSurface.innerHTML = `
        <div class="note-sheet encrypt-lock-sheet">
          <h2>🔒 ${escapeHtml(note.title || "加密笔记")}</h2>
          <p class="muted-text">此笔记已加密。列表与搜索不会泄露正文。忘记密码将无法找回。</p>
          <div class="settings-actions">
            <button class="btn primary" id="unlockPreviewBtn" type="button">输入密码查看</button>
            <button class="btn secondary" id="decryptNoteBtn2" type="button">永久解密</button>
          </div>
        </div>`;
      $("#unlockPreviewBtn")?.addEventListener("click", () => unlockEncryptedPreview(note.id));
      $("#decryptNoteBtn2")?.addEventListener("click", () => decryptCurrentNote());
      return;
    }
    const attachments = currentAttachments();
    const folder = folders().find(item => item.id === note.folderId);
    const attachSize = formatSize(attachments.reduce((sum, item) => sum + Number(item.file.sizeKB || 0), 0));
    el.aiSuggestionText.textContent = `当前笔记包含 ${attachments.length} 个附件。可用本地规则生成摘要、标签或大纲（非在线大模型）。`;
    el.editorSurface.innerHTML = `
      <div class="note-sheet">
        <input class="title-input" id="noteTitleInput" value="${escapeHtml(note.title)}" placeholder="标题" />
        <div class="note-meta-bar">
          <span class="meta-quiet">${formatDate(note.updatedAt)}</span>
          ${folder ? `<span class="meta-pill">${escapeHtml(folder.name)}</span>` : ""}
          <span class="tag-chips" id="tagChips">${renderTagChips(note.tags || [])}</span>
          <button class="meta-icon-btn" id="addTagBtn" type="button" title="添加标签">+</button>
          <input type="hidden" id="tagInput" value="${escapeHtml((note.tags || []).join(", "))}" />
          <span class="meta-spacer"></span>
          <button class="meta-text-btn" id="favoriteBtn" type="button">${note.isFavorite ? "★ 已收藏" : "☆ 收藏"}</button>
          <button class="meta-text-btn" id="pinBtn" type="button">${note.isPinned ? "📌 已置顶" : "📌 置顶"}</button>
          <button class="meta-text-btn" id="attachToggleBtn" type="button" aria-expanded="false">附件 ${attachments.length}</button>
          <details class="more-menu note-more-menu" id="noteMoreMenu">
            <summary class="meta-text-btn">更多</summary>
            <div class="more-menu-panel" role="menu">
              <button id="historyBtn" type="button" role="menuitem">历史版本</button>
              <button id="templateBtn" type="button" role="menuitem">模板</button>
              <button id="linksBtn" type="button" role="menuitem">双向链接</button>
              <button id="uploadBtn2" type="button" role="menuitem">上传附件</button>
              <button id="encryptNoteBtn" type="button" role="menuitem">加密笔记</button>
              <button id="decryptNoteBtn" type="button" role="menuitem">解密笔记</button>
              <button id="ocrNoteBtn" type="button" role="menuitem">OCR 识图</button>
              <button id="aiSummarizeBtn" type="button" role="menuitem">AI 总结选中</button>
              <button id="aiRewriteBtn" type="button" role="menuitem">AI 改写选中</button>
              <button id="aiContinueBtn" type="button" role="menuitem">AI 续写选中</button>
              <button id="deleteNoteBtn" type="button" role="menuitem">删除</button>
            </div>
          </details>
        </div>
        <div class="note-editor-pane" id="dropZone">${renderEditorBody(note)}</div>
        <details class="attachment-panel" id="attachmentPanel">
          <summary>
            <span>附件</span>
            <span class="attach-summary"><strong>${attachments.length}</strong> 个 · <strong>${attachSize}</strong></span>
          </summary>
          <div class="attachment-panel-body">
            <div class="attach-toolbar">
              <button class="btn secondary" id="chooseInCallout" type="button">添加附件</button>
              <span class="meta-quiet">也可直接把文件拖进正文区域</span>
            </div>
            <div class="attach-grid">${renderAttachmentCards(attachments)}</div>
          </div>
        </details>
      </div>
    `;
    bindNoteEditor(note);
    hydrateInlineImagePreviews();
    hydrateAttachmentThumbnails();
    bindDropTargets();
    applyPendingFocus();
    updateWordStats((note.isEncrypted && state.unlockedBodies[note.id] != null) ? state.unlockedBodies[note.id] : (note.body || ""));
    setSaveStatus("saved", "已保存");
    hydrateCodeBlocks();
    enhanceWikiLinksInEditor();
    renderBacklinks(note);
  }

  function applyPendingFocus() {
    if (!state.pendingFocus) return;
    const target = state.pendingFocus === "title" ? $("#noteTitleInput") : $("#noteBodyInput");
    state.pendingFocus = null;
    setTimeout(() => {
      target?.focus();
      if (target?.setSelectionRange) {
        const end = target.value.length;
        target.setSelectionRange(end, end);
      } else if (target?.isContentEditable) {
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(target);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }, 0);
  }

  function renderEditorBody(note) {
    const sourceBody = (note.isEncrypted && state.unlockedBodies[note.id] != null) ? state.unlockedBodies[note.id] : (note.body || "");
    const body = escapeHtml(sourceBody);
    if (state.editorMode === "markdown") {
      return `<textarea id="noteBodyInput" class="note-textarea" spellcheck="false" placeholder="开始写作…">${body}</textarea>`;
    }
    return `<div id="noteBodyInput" class="rich-editor-input note-rich-editor" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="false" data-placeholder="开始写作，可直接粘贴图片…">${renderRichEditorContent(note)}</div>`;
  }

  function renderRichEditorContent(note) {
    const source = String((note.isEncrypted && state.unlockedBodies[note.id] != null) ? state.unlockedBodies[note.id] : (note.body || ""))
      .replace(/^>\s*图片附件：\s*\[\[file:([^\]]+)\]\][^\n]*$/gm, "[[file:$1]]")
      .trim();
    if (!source) return "";
    return markdownToHtml(source).replace(/\[\[file:([^\]]+)\]\]/g, (_match, fileId) => renderInlineImageReference(fileId));
  }

  function renderInlineImageReference(fileId) {
    const file = activeFiles().find(item => item.id === fileId && item.kind === "img");
    if (!file) return escapeHtml(`[[file:${fileId}]]`);
    const id = escapeHtml(file.id);
    const name = escapeHtml(file.name);
    return `<span class="inline-image-block" contenteditable="false" data-inline-image-file="${id}">
      <button class="inline-image-preview" type="button" data-preview-file="${id}" aria-label="预览正文图片：${name}">
        <span class="inline-image-placeholder">正在加载图片...</span>
      </button>
      <span class="inline-image-caption">${name}</span>
    </span>`;
  }

  function renderAttachmentCards(items) {
    if (!items.length) return `<div class="empty-state">暂无附件，拖入文件或点击上传。</div>`;
    return items.map(({ file }) => {
      const isImage = file.kind === "img";
      return `
      <div class="attach-card ${isImage ? "image-attach-card" : ""}">
        ${isImage ? `
          <button class="attachment-thumbnail" type="button" data-preview-file="${escapeHtml(file.id)}" data-thumbnail-file="${escapeHtml(file.id)}" aria-label="预览图片：${escapeHtml(file.name)}">
            <span class="attachment-thumbnail-loading">正在加载缩略图...</span>
          </button>
        ` : ""}
        <div class="file-top">
          <div class="file-icon ${fileIconClass(file.kind)}">${typeLabel(file.kind)}</div>
          <div class="file-name">
            <strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong>
            <small>${formatSize(file.sizeKB)} · ${formatDate(file.createdAt)}</small>
          </div>
        </div>
        <div class="file-tags">
          <span class="tiny-tag">${escapeHtml(file.category)}</span>
          <span class="tiny-tag">${escapeHtml(file.kind)}</span>
        </div>
        <div class="attach-actions">
          <button class="mini-btn" type="button" data-preview-file="${file.id}">预览</button>
          <button class="mini-btn" type="button" data-reveal-file="${file.id}">定位</button>
          <button class="mini-btn" type="button" data-detach-file="${file.id}">移除</button>
        </div>
      </div>
    `;
    }).join("");
  }

  async function hydrateAttachmentThumbnails() {
    const placeholders = $$("#editorSurface [data-thumbnail-file]");
    if (!placeholders.length) return;

    await Promise.all(placeholders.map(async placeholder => {
      try {
        const thumbnail = await loadImagePreview(placeholder.dataset.thumbnailFile);
        if (!placeholder.isConnected) return;
        if (thumbnail?.dataUrl) {
          placeholder.innerHTML = `<img src="${thumbnail.dataUrl}" alt="" />`;
          placeholder.classList.add("is-ready");
        } else {
          placeholder.innerHTML = `<span class="attachment-thumbnail-loading">缩略图不可用</span>`;
          placeholder.classList.add("is-unavailable");
        }
      } catch (error) {
        if (!placeholder.isConnected) return;
        placeholder.innerHTML = `<span class="attachment-thumbnail-loading">缩略图加载失败</span>`;
        placeholder.classList.add("is-unavailable");
      }
    }));
  }

  async function hydrateInlineImagePreviews() {
    const images = $$("#editorSurface [data-inline-image-file]");
    if (!images.length) return;

    await Promise.all(images.map(async image => {
      const preview = image.querySelector(".inline-image-preview");
      if (!preview) return;
      try {
        const thumbnail = await loadImagePreview(image.dataset.inlineImageFile);
        if (!image.isConnected) return;
        if (thumbnail?.dataUrl) {
          preview.innerHTML = `<img src="${thumbnail.dataUrl}" alt="" />`;
          image.classList.add("is-ready");
        } else {
          preview.innerHTML = `<span class="inline-image-placeholder">图片预览不可用</span>`;
          image.classList.add("is-unavailable");
        }
      } catch (error) {
        if (!image.isConnected) return;
        preview.innerHTML = `<span class="inline-image-placeholder">图片加载失败</span>`;
        image.classList.add("is-unavailable");
      }
    }));
  }

  async function loadImagePreview(fileId) {
    let thumbnail = null;
    if (typeof api.thumbnailFile === "function") {
      try {
        thumbnail = await api.thumbnailFile(fileId);
        if (thumbnail?.dataUrl) return thumbnail;
      } catch (error) {
        console.warn("缩略图加载失败，尝试原图预览", error);
      }
    }
    if (typeof api.previewFile === "function") {
      const preview = await api.previewFile(fileId);
      if (preview?.dataUrl) return preview;
    }
    return thumbnail || {};
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        name: file.name || `粘贴图片_${Date.now()}.png`,
        type: file.type || "image/png",
        size: file.size || 0,
        dataUrl: reader.result
      });
      reader.onerror = () => reject(reader.error || new Error("读取剪贴板图片失败"));
      reader.readAsDataURL(file);
    });
  }

  async function pasteImagesIntoNote(event, note) {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const fromItems = [...(clipboard.items || [])]
      .filter(item => item.kind === "file" && item.type.startsWith("image/"))
      .map(item => item.getAsFile())
      .filter(Boolean);
    const fromFiles = [...(clipboard.files || [])].filter(file => file.type.startsWith("image/"));
    const candidates = fromItems.length ? fromItems : fromFiles;
    const seen = new Set();
    const imageFiles = candidates.filter(file => {
      const key = `${file.name}|${file.type}|${file.size}|${file.lastModified || 0}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!imageFiles.length) {
      if (event.currentTarget?.isContentEditable) {
        const text = clipboard.getData("text/plain");
        if (text) {
          event.preventDefault();
          insertTextAtSelection(event.currentTarget, text, true);
        }
      }
      return;
    }

    event.preventDefault();
    if (!note?.id) return showToast("当前没有可粘贴图片的笔记");
    if (state.pasteInFlight) return;
    state.pasteInFlight = true;
    try {
      clearTimeout(state.autosaveTimer);
      await saveCurrentNote(note.id, { silent: true });
      showProgress("粘贴图片", `正在保存 ${imageFiles.length} 张图片...`);
      const images = [];
      for (const [index, file] of imageFiles.entries()) {
        setProgress(20 + Math.round((index / imageFiles.length) * 50), `正在读取第 ${index + 1} 张图片...`);
        images.push(await readFileAsDataUrl(file));
      }
      setProgress(80, "正在写入本地文件库...");
      const result = await api.savePastedImages(images, { noteId: note.id, folderId: state.selectedFolderId || note.folderId });
      setProgress(100, `已粘贴 ${result.files?.length || 0} 张图片`);
      await refresh(result.data);
      closeModal();
      if (result.files?.length) showToast(`已粘贴 ${result.files.length} 张图片`);
    } catch (error) {
      closeModal();
      console.error(error);
      showToast(`粘贴图片失败：${error.message || error}`);
    } finally {
      state.pasteInFlight = false;
    }
  }

  function bindNoteEditor(note) {
    const title = $("#noteTitleInput");
    const body = $("#noteBodyInput");
    const tags = $("#tagInput");
    const save = () => scheduleNoteSave(note.id);
    title?.addEventListener("input", save);
    body?.addEventListener("input", () => {
      save();
      maybeWikiSuggest(body);
    });
    body?.addEventListener("keydown", event => handleWikiKeydown(event, body));
    body?.addEventListener("paste", event => pasteImagesIntoNote(event, note));
    tags?.addEventListener("input", save);
    $("#historyBtn")?.addEventListener("click", () => openHistoryModal(note.id));
    $("#templateBtn")?.addEventListener("click", openTemplateManager);
    $("#linksBtn")?.addEventListener("click", () => openLinksModal(note.id));
    $("#favoriteBtn")?.addEventListener("click", () => saveNotePatch(note.id, { isFavorite: !note.isFavorite }));
    $("#pinBtn")?.addEventListener("click", () => saveNotePatch(note.id, { isPinned: !note.isPinned }));
    $("#deleteNoteBtn")?.addEventListener("click", () => deleteCurrentNote(note.id));
    $("#encryptNoteBtn")?.addEventListener("click", () => encryptCurrentNote());
    $("#decryptNoteBtn")?.addEventListener("click", () => decryptCurrentNote());
    $("#ocrNoteBtn")?.addEventListener("click", () => runOcrIntoNote());
    $("#aiSummarizeBtn")?.addEventListener("click", () => runAiAction("summarize"));
    $("#aiRewriteBtn")?.addEventListener("click", () => runAiAction("rewrite"));
    $("#aiContinueBtn")?.addEventListener("click", () => runAiAction("continue"));
    $("#uploadBtn2")?.addEventListener("click", chooseFiles);
    $("#chooseInCallout")?.addEventListener("click", chooseFiles);
    $("#attachToggleBtn")?.addEventListener("click", () => {
      const panel = $("#attachmentPanel");
      if (!panel) return;
      panel.open = !panel.open;
      $("#attachToggleBtn")?.setAttribute("aria-expanded", String(panel.open));
    });
    $("#addTagBtn")?.addEventListener("click", () => {
      const value = prompt("添加标签", "");
      if (!value) return;
      const next = value.trim();
      if (!next) return;
      const input = $("#tagInput");
      const current = (input?.value || "").split(",").map(item => item.trim()).filter(Boolean);
      if (!current.includes(next)) current.push(next);
      if (input) input.value = current.join(", ");
      const chips = $("#tagChips");
      if (chips) chips.innerHTML = renderTagChips(current);
      $$("#tagChips [data-remove-tag]").forEach(btn => btn.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        const remove = btn.dataset.removeTag;
        const kept = (input?.value || "").split(",").map(item => item.trim()).filter(Boolean).filter(item => item !== remove);
        if (input) input.value = kept.join(", ");
        if (chips) chips.innerHTML = renderTagChips(kept);
        scheduleNoteSave(note.id);
        bindTagRemoveHandlers(note);
      }));
      scheduleNoteSave(note.id);
    });
    bindTagRemoveHandlers(note);
    $$("#editorSurface [data-preview-file]").forEach(btn => btn.addEventListener("click", () => previewFile(btn.dataset.previewFile)));
    $$("#editorSurface [data-reveal-file]").forEach(btn => btn.addEventListener("click", () => api.revealFile(btn.dataset.revealFile)));
    $$("#editorSurface [data-detach-file]").forEach(btn => btn.addEventListener("click", () => detachFile(note.id, btn.dataset.detachFile)));
  }

  function bindTagRemoveHandlers(note) {
    $$("#tagChips [data-remove-tag]").forEach(btn => btn.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const remove = btn.dataset.removeTag;
      const input = $("#tagInput");
      const kept = (input?.value || "").split(",").map(item => item.trim()).filter(Boolean).filter(item => item !== remove);
      if (input) input.value = kept.join(", ");
      const chips = $("#tagChips");
      if (chips) chips.innerHTML = renderTagChips(kept);
      scheduleNoteSave(note.id);
      bindTagRemoveHandlers(note);
    }));
  }

  function scheduleNoteSave(noteId) {
    setSaveStatus("dirty", "未保存");
    if (noteId) {
      state.dirtyTabIds[noteId] = true;
      renderNoteTabs();
    }
    updateWordStats(readEditorBody());
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(() => saveCurrentNote(noteId, { silent: true }), Number(state.data.settings.autoSaveMs || 700));
  }

  async function saveCurrentNote(noteId, options = {}) {
    const existing = activeNotes().find(item => item.id === noteId);
    const title = $("#noteTitleInput")?.value.trim() || "未命名笔记";
    const body = readEditorBody();
    const tags = ($("#tagInput")?.value || "").split(",").map(item => item.trim()).filter(Boolean);
    if (existing?.isEncrypted) {
      const password = state.notePasswords[noteId];
      if (!password || state.unlockedBodies[noteId] == null) {
        showToast("请先解锁加密笔记");
        return;
      }
      state.unlockedBodies[noteId] = body;
      const result = await api.saveEncryptedNote(noteId, password, { title, body, tags });
      if (!result?.ok) return showToast(result?.error || "加密保存失败");
      const nextData = result.data;
      if (options.silent) {
        state.data = nextData;
        renderNoteList();
        renderStats();
      } else {
        await refresh(nextData);
      }
      delete state.dirtyTabIds[noteId];
      renderNoteTabs();
      setSaveStatus("saved", "已保存（已重新加密）");
      updateWordStats(body);
      setLastAction("最近操作：加密保存笔记");
      return;
    }
    const nextData = await api.updateNote({ id: noteId, title, body, tags });
    if (options.silent) {
      state.data = nextData;
      renderNoteList();
      renderStats();
    } else {
      await refresh(nextData);
    }
    delete state.dirtyTabIds[noteId];
    renderNoteTabs();
    setSaveStatus("saved", "已保存");
    updateWordStats(body);
    setLastAction("最近操作：自动保存笔记");
  }

  async function saveNotePatch(noteId, patch) {
    const note = activeNotes().find(item => item.id === noteId);
    await refresh(await api.updateNote({ ...note, ...patch }));
    showToast("笔记已更新");
  }

  async function deleteCurrentNote(noteId) {
    if (!confirm("确认删除当前笔记？删除后可在回收站恢复。")) return;
    await refresh(await api.deleteNote(noteId));
    showToast("笔记已移入回收站");
  }

  function renderFilesView() {
    const files = activeFiles().filter(file => !state.selectedFolderId || file.folderId === state.selectedFolderId);
    const folderOptions = folders().map(folder => `<option value="${folder.id}">${escapeHtml(folder.name)}</option>`).join("");
    el.editorSurface.innerHTML = `
      <div class="view-head">
        <div>
          <h1>文件管理</h1>
          <p>管理本地文件库、文件夹、文件引用、收藏、重命名和内置预览。</p>
        </div>
        <div class="view-actions">
          <button class="btn secondary" id="toggleFileViewBtn" type="button">${state.fileViewMode === "grid" ? "列表视图" : "网格视图"}</button>
          <button class="btn secondary" id="reindexFilesBtn" type="button">OCR/PDF 索引</button>
          <button class="btn secondary" id="classifyFilesBtn" type="button">智能归类</button>
          <button class="btn secondary" id="createFolderInView" type="button">新建文件夹</button>
          <button class="btn primary" id="uploadInView" type="button">上传文件</button>
        </div>
      </div>
      <div class="file-table ${state.fileViewMode === "grid" ? "file-grid-view" : ""}">
        ${files.map(file => renderFileRow(file, folderOptions)).join("") || `<div class="empty-state">暂无文件，点击上传或拖拽到笔记区。</div>`}
      </div>
    `;
    $("#toggleFileViewBtn")?.addEventListener("click", () => {
      state.fileViewMode = state.fileViewMode === "grid" ? "list" : "grid";
      renderFilesView();
    });
    $("#createFolderInView")?.addEventListener("click", createFolder);
    $("#uploadInView")?.addEventListener("click", chooseFiles);
    $("#reindexFilesBtn")?.addEventListener("click", reindexFiles);
    $("#classifyFilesBtn")?.addEventListener("click", classifyFiles);
    bindFileActions();
  }

  function renderFileRow(file, folderOptions = "") {
    return `
      <div class="file-table-row ${state.fileViewMode === "grid" ? "file-card-row" : ""}" draggable="true" data-file-row="${file.id}">
        <div class="file-top">
          <div class="file-icon ${fileIconClass(file.kind)}">${typeLabel(file.kind)}</div>
          <div class="file-name">
            <strong>${file.isFavorite ? "★ " : ""}${escapeHtml(file.name)}</strong>
            <small>${formatSize(file.sizeKB)} · ${formatDate(file.createdAt)}${file.duplicateOf ? " · 可能重复" : ""}</small>
            <div class="file-tags">${(file.tags || []).map(tag => `<span class="tiny-tag">${escapeHtml(tag)}</span>`).join("")}</div>
          </div>
        </div>
        <div class="row-actions">
          <select class="mini-select" data-move-file="${file.id}">
            <option value="">移动到...</option>
            ${folderOptions}
          </select>
          <button class="mini-btn" data-preview-file="${file.id}" type="button">内置预览</button>
          <button class="mini-btn" data-attach-file="${file.id}" type="button">引用到笔记</button>
          <button class="mini-btn" data-rename-file="${file.id}" type="button">重命名</button>
          <button class="mini-btn" data-favorite-file="${file.id}" type="button">${file.isFavorite ? "取消收藏" : "收藏"}</button>
          <button class="mini-btn" data-open-file="${file.id}" type="button">系统打开</button>
          <button class="mini-btn" data-reveal-file="${file.id}" type="button">定位</button>
          <button class="mini-btn danger" data-delete-file="${file.id}" type="button">删除</button>
        </div>
      </div>
    `;
  }

  function renderSearchView() {
    const query = state.searchQuery || "";
    const f = state.searchFilters;
    el.editorSurface.innerHTML = `
      <div class="view-head">
        <div>
          <h1>搜索中心</h1>
          <p>支持全文、标签、文件类型、创建/修改时间和带附件筛选；最近搜索会自动记录。</p>
        </div>
      </div>
      <div class="search-filter-bar">
        <select id="searchType"><option value="all">全部</option><option value="note">只搜笔记</option><option value="file">只搜文件</option></select>
        <select id="searchKind"><option value="all">所有文件类型</option><option value="pdf">PDF</option><option value="doc">文档</option><option value="img">图片</option><option value="xls">表格</option><option value="zip">压缩包</option></select>
        <input id="searchTag" placeholder="标签筛选" value="${escapeHtml(f.tag || "")}" />
        <input id="searchFrom" type="date" value="${escapeHtml(f.from || "")}" />
        <input id="searchTo" type="date" value="${escapeHtml(f.to || "")}" />
        <label class="check-line"><input id="searchWithAttachments" type="checkbox" ${f.withAttachments ? "checked" : ""}> 带附件笔记</label>
        <label class="check-line"><input id="searchSemantic" type="checkbox" ${f.semantic ? "checked" : ""}> 语义搜索</label>
        <button class="btn secondary" id="runSearchBtn" type="button">筛选</button>
        <button class="btn secondary" id="similarNotesBtn" type="button">相似推荐</button>
      </div>
      <div class="recent-searches">${(state.data.recentSearches || []).map(item => `<button class="tiny-tag" data-recent-search="${escapeHtml(item.q)}" type="button">${escapeHtml(item.q)}</button>`).join("")}</div>
      <div class="search-results" id="searchResults"><div class="empty-state">输入关键词开始搜索。</div></div>
    `;
    $("#searchType").value = f.type;
    $("#searchKind").value = f.kind;
    $("#runSearchBtn")?.addEventListener("click", () => {
      state.searchFilters = {
        type: $("#searchType").value,
        kind: $("#searchKind").value,
        tag: $("#searchTag").value.trim(),
        from: $("#searchFrom").value,
        to: $("#searchTo").value,
        withAttachments: $("#searchWithAttachments").checked,
        semantic: $("#searchSemantic").checked
      };
      performSearch(state.searchQuery);
    });
    $("#similarNotesBtn")?.addEventListener("click", showSimilarNotes);
    $$("[data-recent-search]").forEach(btn => btn.addEventListener("click", () => {
      state.searchQuery = btn.dataset.recentSearch;
      el.globalSearch.value = state.searchQuery;
      performSearch(state.searchQuery);
    }));
    if (query) performSearch(query);
  }

  async function performSearch(query) {
    state.searchQuery = query;
    const results = await api.search({ q: query, ...state.searchFilters });
    const box = $("#searchResults");
    if (!box) return;
    const q = String(query || "").trim();
    const paint = text => {
      const raw = String(text || "");
      if (!q) return escapeHtml(raw);
      try {
        const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return escapeHtml(raw).replace(new RegExp(safe, "ig"), m => `<mark class="search-hit">${m}</mark>`);
      } catch (_) {
        return escapeHtml(raw);
      }
    };
    box.innerHTML = results.length ? results.map(item => `
      <button class="search-result" data-result-type="${item.type}" data-result-id="${item.id}" type="button">
        <strong>${paint(item.title)}</strong>
        <span>${paint(item.subline || "")}</span>
      </button>
    `).join("") : `<div class="empty-state">没有找到“${escapeHtml(query)}”。</div>`;
    box.querySelectorAll("[data-result-id]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (btn.dataset.resultType === "note") {
          state.currentView = "notes";
          await refresh(await api.selectNote(btn.dataset.resultId));
        } else {
          openFile(btn.dataset.resultId);
        }
      });
    });
  }

  async function showSimilarNotes() {
    const note = currentNote();
    if (!note) return showToast("当前没有可推荐的笔记");
    const results = await api.similarNotes(note.id);
    const box = $("#searchResults");
    if (!box) return;
    box.innerHTML = results.length ? results.map(item => `
      <button class="search-result" data-result-type="note" data-result-id="${item.id}" type="button">
        <strong>${escapeHtml(item.title)}</strong>
        <span>相似度 ${(item.score * 100).toFixed(0)}% · ${escapeHtml(item.subline || "")}</span>
      </button>
    `).join("") : `<div class="empty-state">当前笔记暂未找到相似内容。</div>`;
    box.querySelectorAll("[data-result-id]").forEach(btn => btn.addEventListener("click", async () => {
      state.currentView = "notes";
      await refresh(await api.selectNote(btn.dataset.resultId));
    }));
  }

  function renderAiView() {
    const note = currentNote();
    const result = state.aiResultNoteId === note?.id ? state.aiResult : null;
    el.editorSurface.innerHTML = `
      <div class="view-head">
        <div>
          <h1>本地整理</h1>
          <p>基于本地规则的摘要、关键词、附件提取和问答，不上传数据，也不是在线大模型。</p>
        </div>
        <div class="view-actions">
          <button class="btn secondary" id="runAllAiBtn" type="button">多笔记总结</button>
          <button class="btn primary" id="runAiInView" type="button">整理当前笔记</button>
        </div>
      </div>
      <div class="ai-output" id="aiOutput">${result ? renderAiResult(result) : `<div class="empty-state">点击“整理当前笔记”生成结果。</div>`}</div>
    `;
    $("#runAiInView")?.addEventListener("click", () => runAi(note?.id));
    $("#runAllAiBtn")?.addEventListener("click", runAllAi);
    bindAiResultButtons();
  }

  function renderAllAiResult(result) {
    return `
      <div class="content-card"><h4>全库摘要</h4><p>${escapeHtml(result.summary)}</p></div>
      <div class="content-card"><h4>关键词</h4><p>${(result.keywords || []).map(tag => `<span class="pill">${escapeHtml(tag)}</span>`).join(" ")}</p></div>
      <div class="content-card"><h4>最近笔记</h4><pre>${escapeHtml(result.notes || "")}</pre></div>
      <div class="content-card"><h4>建议行动</h4><pre>${escapeHtml(result.actions || "")}</pre><button class="mini-btn" id="writeAllAiBtn" type="button">写入当前笔记</button></div>
    `;
  }

  function renderAiResult(result) {
    return `
      <div class="content-card"><h4>标题建议</h4><p>${escapeHtml(result.titleSuggestion || "")}</p><button class="mini-btn" data-apply-ai="title" type="button">替换标题</button></div>
      <div class="content-card"><h4>摘要</h4><p>${escapeHtml(result.summary)}</p><button class="mini-btn" data-apply-ai="summary" type="button">写入笔记</button></div>
      <div class="content-card"><h4>建议标签</h4><p>${result.tags.map(tag => `<span class="pill">${escapeHtml(tag)}</span>`).join(" ")}</p><button class="mini-btn" data-apply-ai="tags" type="button">应用标签</button></div>
      <div class="content-card"><h4>行动项</h4><pre>${escapeHtml(result.actionItems || "")}</pre><button class="mini-btn" data-apply-ai="actions" type="button">追加行动项</button></div>
      <div class="content-card"><h4>附件提取</h4><pre>${escapeHtml(result.attachmentDigest)}</pre><button class="mini-btn" data-apply-ai="attachments" type="button">写入附件摘要</button></div>
      <div class="content-card"><h4>PRD 大纲</h4><pre>${escapeHtml(result.outline)}</pre><button class="mini-btn" data-apply-ai="outline" type="button">追加大纲</button></div>
      <div class="content-card"><h4>笔记问答</h4><div class="inline-form"><input id="aiQuestionInput" class="line-input" placeholder="针对当前笔记提问" /><button class="btn primary" id="askAiBtn" type="button">提问</button></div><p id="aiAnswerBox" class="muted-text"></p></div>
    `;
  }

  async function runAi(noteId = currentNote()?.id) {
    if (!noteId) return showToast("当前没有可整理的笔记");
    state.aiResult = await api.organizeNote(noteId);
    state.aiResultNoteId = noteId;
    renderAiView();
    showToast("本地整理完成");
  }

  async function runAllAi() {
    const result = await api.summarizeAllNotes();
    $("#aiOutput").innerHTML = renderAllAiResult(result);
    $("#writeAllAiBtn")?.addEventListener("click", async () => {
      const note = currentNote();
      if (!note) return;
      await refresh(await api.updateNote({ ...note, body: `${note.body || ""}\n\n## 多笔记总结\n${result.summary}\n\n## 全库行动项\n${result.actions}` }));
      showToast("多笔记总结已写入");
    });
    showToast("多笔记总结完成");
  }

  function bindAiResultButtons() {
    $$("[data-apply-ai]").forEach(btn => btn.addEventListener("click", () => applyAi(btn.dataset.applyAi)));
    $("#askAiBtn")?.addEventListener("click", async () => {
      const note = currentNote();
      const question = $("#aiQuestionInput")?.value.trim();
      if (!note || !question) return showToast("请输入问题");
      $("#aiAnswerBox").textContent = await api.askNote(note.id, question);
    });
  }

  async function applyAi(kind) {
    const note = currentNote();
    if (!note) return showToast("当前没有可整理的笔记");
    if (state.aiResultNoteId !== note.id) state.aiResult = null;
    const result = state.aiResult || await api.organizeNote(note.id);
    state.aiResult = result;
    state.aiResultNoteId = note.id;
    if (!note || !result) return;
    if (kind === "tags") {
      await refresh(await api.updateNote({ ...note, tags: [...new Set([...(note.tags || []), ...result.tags])] }));
      return showToast("标签已应用");
    }
    if (kind === "title") {
      await refresh(await api.updateNote({ ...note, title: result.titleSuggestion || note.title }));
      return showToast("标题已更新");
    }
    const chunks = {
      summary: `\n\n## 本地摘要\n${result.summary}`,
      actions: `\n\n## 行动项\n${result.actionItems || ""}`,
      attachments: `\n\n## 附件摘要\n${result.attachmentDigest}`,
      outline: `\n\n## PRD 大纲\n${result.outline}`
    };
    await refresh(await api.updateNote({ ...note, body: `${note.body || ""}${chunks[kind] || ""}` }));
    showToast("内容已写入笔记");
  }

  function renderTrashView() {
    const notes = activeNotes(true);
    const files = activeFiles(true);
    el.editorSurface.innerHTML = `
      <div class="view-head"><div><h1>回收站</h1><p>删除的笔记和文件可以在这里恢复。</p></div></div>
      <div class="trash-grid">
        <div class="content-card"><h4>已删除笔记</h4>${notes.map(note => `<div class="trash-row"><span>${escapeHtml(note.title)}</span><button class="mini-btn" data-restore-note="${note.id}" type="button">恢复</button></div>`).join("") || "暂无删除笔记。"}</div>
        <div class="content-card"><h4>已删除文件</h4>${files.map(file => `<div class="trash-row"><span>${escapeHtml(file.name)}</span><button class="mini-btn" data-restore-file="${file.id}" type="button">恢复</button></div>`).join("") || "暂无删除文件。"}</div>
      </div>
    `;
    $$("[data-restore-note]").forEach(btn => btn.addEventListener("click", async () => refresh(await api.restoreNote(btn.dataset.restoreNote))));
    $$("[data-restore-file]").forEach(btn => btn.addEventListener("click", async () => refresh(await api.restoreFile(btn.dataset.restoreFile))));
  }

  function renderSettingsView() {
    const s = state.data.settings || {};
    el.editorSurface.innerHTML = `
      <div class="view-head"><div><h1>设置</h1><p>本地工作区、自动保存、账号锁、加密备份和数据目录。</p></div></div>
      <div class="settings-grid">
        <label>工作区名称<input id="settingWorkspace" value="${escapeHtml(s.workspaceName || "")}" /></label>
        <label>用户名<input id="settingUser" value="${escapeHtml(s.userName || "")}" /></label>
        <label>自动保存间隔（毫秒）<input id="settingAutosave" type="number" min="300" max="5000" value="${Number(s.autoSaveMs || 700)}" /></label>
        <label>界面主题<select id="settingTheme"><option value="light" ${s.theme !== "dark" ? "selected" : ""}>浅色</option><option value="dark" ${s.theme === "dark" ? "selected" : ""}>深色</option></select></label>
        <label>整理模式<input value="本地规则整理（非在线大模型）" disabled /></label>
        <label>启动/锁屏密码（默认关闭）<input id="settingAuthEnabled" type="checkbox" ${s.authEnabled ? "checked" : ""} /></label>
        <label>设置/修改密码<input id="settingPassword" type="password" placeholder="${s.authConfigured ? "留空则不修改" : "首次启用请输入密码"}" /></label>
        <label>闲置自动锁定（分钟，0=关闭）<input id="settingIdleLock" type="number" min="0" max="240" value="${Number(s.idleLockMinutes || 0)}" /></label>
        <label>随手记全局快捷键<input id="settingQuickShortcut" value="${escapeHtml(s.quickNoteShortcut || "CommandOrControl+Alt+N")}" /></label>
        <label>每日备份保留份数<input id="settingDailyBackupKeep" type="number" min="3" max="60" value="${Number(s.dailyBackupKeep || 7)}" /></label>
        <label>每篇历史版本保留数<input id="settingNoteVersionKeep" type="number" min="10" max="200" value="${Number(s.noteVersionKeep || 40)}" /></label>
      </div>
      <p class="muted-text auth-warning">重要：忘记启动密码或笔记密码将无法找回，本地不保存明文密码。</p>
      <div class="settings-actions">
        <button class="btn primary" id="saveSettingsBtn" type="button">保存设置</button>
        <button class="btn secondary" id="backupBtn" type="button">备份数据</button>
        <button class="btn secondary" id="encryptedBackupBtn" type="button">加密备份</button>
        <button class="btn secondary" id="lockWorkspaceBtn" type="button">立即锁定</button>
        <button class="btn secondary" id="chooseDataFolderBtn" type="button">选择数据目录</button>
        <button class="btn secondary" id="resetDataFolderBtn" type="button">恢复默认目录</button>
        <button class="btn secondary" id="chooseSyncFolderBtn" type="button">选择同步目录</button>
        <button class="btn secondary" id="syncNowBtn" type="button">立即同步</button>
        <button class="btn secondary" id="syncMergeBtn" type="button">合并同步</button>
        <button class="btn secondary" id="openDataFolderBtn" type="button">打开数据目录</button>
      </div>
      <div class="content-card" id="aiSettingsCard">
        <h4>AI（OpenAI 兼容）</h4>
        <p class="muted-text">密钥使用 Electron safeStorage 加密保存。未配置时 AI 按钮会提示先去设置。忘记笔记密码无法找回。</p>
        <div class="settings-grid">
          <label>接口地址<input id="aiBaseUrl" placeholder="https://api.openai.com/v1" /></label>
          <label>模型名<input id="aiModel" placeholder="gpt-4o-mini" /></label>
          <label>API Key<input id="aiApiKey" type="password" placeholder="留空则不修改已保存密钥" /></label>
        </div>
        <div class="settings-actions">
          <button class="btn secondary" id="saveAiConfigBtn" type="button">保存 AI 配置</button>
        </div>
      </div>
      <div class="content-card">
        <h4>数据位置</h4>
        <p>${escapeHtml(state.data.dataPath || "")}</p>
        <p class="muted-text">当前目录：${escapeHtml(state.data.dataRootPath || "")}${state.data.dataLocationCustom ? "（自定义）" : "（默认）"}</p>
        <p class="muted-text">同步目录：${escapeHtml(s.syncDir || "未设置")} ${s.lastSyncAt ? `· 上次同步 ${formatDate(s.lastSyncAt)}` : ""}</p>
      </div>
    `;
    $("#saveSettingsBtn")?.addEventListener("click", saveSettings);
    $("#backupBtn")?.addEventListener("click", backupData);
    $("#encryptedBackupBtn")?.addEventListener("click", encryptedBackupData);
    $("#lockWorkspaceBtn")?.addEventListener("click", lockWorkspace);
    $("#chooseDataFolderBtn")?.addEventListener("click", chooseDataFolder);
    $("#resetDataFolderBtn")?.addEventListener("click", resetDataFolder);
    $("#chooseSyncFolderBtn")?.addEventListener("click", chooseSyncFolder);
    $("#syncNowBtn")?.addEventListener("click", syncNow);
    $("#syncMergeBtn")?.addEventListener("click", syncMergeNow);
    $("#openDataFolderBtn")?.addEventListener("click", () => api.openDataFolder());
    $("#saveAiConfigBtn")?.addEventListener("click", saveAiSettings);
    fillAiSettingsForm();
  }

  async function fillAiSettingsForm() {
    const cfg = await ensureAiConfig();
    if ($("#aiBaseUrl")) $("#aiBaseUrl").value = cfg.baseUrl || "";
    if ($("#aiModel")) $("#aiModel").value = cfg.model || "";
    if ($("#aiApiKey")) $("#aiApiKey").placeholder = cfg.hasKey ? "已保存密钥（留空不修改）" : "输入 API Key";
  }

  async function saveAiSettings() {
    const result = await api.saveAiConfig({
      baseUrl: $("#aiBaseUrl")?.value.trim() || "",
      model: $("#aiModel")?.value.trim() || "",
      apiKey: $("#aiApiKey")?.value || ""
    });
    state.aiConfig = result?.config || (await api.getAiConfig());
    if ($("#aiApiKey")) $("#aiApiKey").value = "";
    showToast("AI 配置已保存");
  }

  async function saveSettings() {
    const settings = {
      workspaceName: $("#settingWorkspace").value.trim() || "我的工作区",
      userName: $("#settingUser").value.trim() || "墨先生",
      autoSaveMs: Number($("#settingAutosave").value || 700),
      theme: $("#settingTheme")?.value === "dark" ? "dark" : "light",
      idleLockMinutes: Number($("#settingIdleLock")?.value || 0),
      quickNoteShortcut: $("#settingQuickShortcut")?.value.trim() || "CommandOrControl+Alt+N",
      dailyBackupKeep: Number($("#settingDailyBackupKeep")?.value || 7),
      noteVersionKeep: Number($("#settingNoteVersionKeep")?.value || 40)
    };
    await refresh(await api.saveSettings(settings));
    const shortcutResult = await api.registerQuickShortcut();
    if (shortcutResult && shortcutResult.conflict) showToast(`全局快捷键冲突：${shortcutResult.accelerator}`);
    setupIdleLockWatcher();
    const authEnabled = $("#settingAuthEnabled").checked;
    const password = $("#settingPassword").value;
    if (authEnabled !== Boolean(state.data.settings.authEnabled) || password) {
      if (authEnabled && !password && !state.data.settings.authConfigured) return showToast("首次启用账号锁需要设置密码");
      await refresh(await api.setAuth(password || "__keep__", authEnabled));
    }
    showToast("设置已保存");
  }

  async function backupData() {
    const target = await api.backup();
    showToast(`已备份：${target}`);
  }

  async function encryptedBackupData() {
    const password = prompt("请输入加密备份密码：", "");
    if (!password) return;
    const target = await api.backupEncrypted(password);
    showToast(`加密备份已生成：${target}`);
  }

  async function chooseDataFolder() {
    const result = await api.chooseDataFolder();
    if (result.canceled) return;
    await refresh(result.data);
    showToast("数据目录已切换，现有数据已迁移");
  }

  async function resetDataFolder() {
    if (!confirm("确认恢复默认数据目录？现有数据会复制回默认目录。")) return;
    await refresh(await api.resetDataFolder());
    showToast("已恢复默认数据目录");
  }

  async function chooseSyncFolder() {
    const result = await api.chooseSyncFolder();
    if (result.canceled) return;
    await refresh(result.data);
    showToast(`已同步到：${result.target}`);
  }

  async function syncNow() {
    const result = await api.syncNow();
    if (result.canceled) return showToast("请先选择同步目录");
    await refresh(result.data);
    showToast(`同步完成：${result.target}`);
  }

  async function lockWorkspace() {
    if (isAppLocked()) return;
    clearNoteSecrets();
    closeCommandPalette?.();
    const data = await api.lock();
    await refresh(data);
    showToast("工作区已锁定");
  }

  function touchActivity() {
    state.lastActivityAt = Date.now();
  }

  function setupIdleLockWatcher() {
    clearInterval(state.idleTimer);
    const minutes = Number(state.data?.settings?.idleLockMinutes || 0);
    if (!state.data?.settings?.authEnabled || minutes <= 0) return;
    state.idleTimer = setInterval(async () => {
      if (!state.data?.settings?.authEnabled) return;
      if (state.data?.locked) return;
      const idleMs = Date.now() - (state.lastActivityAt || Date.now());
      if (idleMs >= minutes * 60 * 1000) await lockWorkspace();
    }, 15000);
  }

  function bindFileActions() {
    $$("[data-open-file]").forEach(btn => btn.addEventListener("click", () => openFile(btn.dataset.openFile)));
    $$("[data-reveal-file]").forEach(btn => btn.addEventListener("click", () => api.revealFile(btn.dataset.revealFile)));
    $$("[data-preview-file]").forEach(btn => btn.addEventListener("click", () => previewFile(btn.dataset.previewFile)));
    $$("[data-attach-file]").forEach(btn => btn.addEventListener("click", () => attachFileToCurrentNote(btn.dataset.attachFile)));
    $$("[data-rename-file]").forEach(btn => btn.addEventListener("click", () => renameFile(btn.dataset.renameFile)));
    $$("[data-favorite-file]").forEach(btn => btn.addEventListener("click", async () => {
      const file = activeFiles().find(item => item.id === btn.dataset.favoriteFile);
      await refresh(await api.updateFile(file.id, { isFavorite: !file.isFavorite }));
      showToast("文件收藏状态已更新");
    }));
    $$("[data-move-file]").forEach(select => select.addEventListener("change", async () => {
      if (!select.value) return;
      await refresh(await api.updateFile(select.dataset.moveFile, { folderId: select.value }));
      showToast("文件已移动");
    }));
    $$("[data-file-row]").forEach(row => row.addEventListener("dragstart", event => {
      event.dataTransfer.setData("application/x-supernotepad-file", row.dataset.fileRow);
      event.dataTransfer.effectAllowed = "copy";
    }));
    $$("[data-delete-file]").forEach(btn => btn.addEventListener("click", async () => {
      if (!confirm("确认删除文件？删除后可在回收站恢复。")) return;
      await refresh(await api.deleteFile(btn.dataset.deleteFile));
      showToast("文件已移入回收站");
    }));
  }

  async function previewFile(fileId) {
    const preview = await api.previewFile(fileId);
    if (preview.error) return showToast(preview.error);
    const body = preview.dataUrl
      ? `<img class="preview-image" src="${preview.dataUrl}" alt="${escapeHtml(preview.name)}" />`
      : `<pre class="preview-text">${escapeHtml(preview.text || "该类型暂不支持完整内嵌渲染，可点击系统打开查看。")}</pre>`;
    openModal("文件预览", `
      <div class="modal-stack">
        <div class="manager-main"><strong>${escapeHtml(preview.name)}</strong><small>${typeLabel(preview.kind)} · ${formatSize(preview.sizeKB)} · ${escapeHtml(preview.localPath)}</small></div>
        ${body}
        <div class="row-actions">
          <button class="btn secondary" id="previewOpenBtn" type="button">系统打开</button>
          <button class="btn secondary" id="previewRevealBtn" type="button">定位文件</button>
        </div>
      </div>
    `);
    $("#previewOpenBtn")?.addEventListener("click", () => openFile(fileId));
    $("#previewRevealBtn")?.addEventListener("click", () => api.revealFile(fileId));
  }

  async function attachFileToCurrentNote(fileId) {
    const note = currentNote();
    if (!note) return showToast("当前没有可引用的笔记");
    await refresh(await api.attachFile(note.id, fileId, true));
    showToast("文件已引用到当前笔记");
  }

  async function renameFile(fileId) {
    const file = activeFiles().find(item => item.id === fileId);
    const name = prompt("请输入新的文件名：", file?.name || "");
    if (!name) return;
    const tagText = prompt("文件标签（用逗号分隔）：", (file?.tags || []).join(", "));
    await refresh(await api.updateFile(fileId, {
      name: name.trim() || file.name,
      tags: String(tagText || "").split(",").map(item => item.trim()).filter(Boolean)
    }));
    showToast("文件信息已更新");
  }

  async function reindexFiles() {
    showProgress("OCR/PDF 索引", "正在重建本地文件索引...");
    setProgress(45, "正在抽取 PDF/文档文本和图片 OCR 索引...");
    const result = await api.reindexFiles();
    setProgress(100, `已处理 ${result.updated} 个文件`);
    await refresh(result.data);
    closeModal();
    showToast(`索引已更新：${result.updated} 个文件`);
  }

  async function classifyFiles() {
    const result = await api.classifyFiles();
    await refresh(result.data);
    showToast(`智能归类完成：${result.updated} 个文件`);
  }

  async function openFile(fileId) {
    const error = await api.openFile(fileId);
    if (error) showToast(error);
    else {
      setLastAction("最近操作：打开文件");
      await refresh();
    }
  }

  async function detachFile(noteId, fileId) {
    await refresh(await api.detachFile(noteId, fileId));
    showToast("已从当前笔记移除附件");
  }

  async function chooseFiles() {
    const note = currentNote();
    showProgress("上传进度", "等待选择文件...");
    setProgress(20, "准备导入文件...");
    const result = await api.chooseFiles({ noteId: note?.id, folderId: state.selectedFolderId || note?.folderId });
    setProgress(100, `已导入 ${result.files?.length || 0} 个文件`);
    await refresh(result.data);
    closeModal();
    if (result.files?.length) showToast(`已上传 ${result.files.length} 个文件`);
  }

  function bindDropTargets() {
    const targets = [$("#dropZone"), el.editorSurface].filter(Boolean);
    targets.forEach(target => {
      ["dragenter", "dragover"].forEach(evt => target.addEventListener(evt, event => {
        event.preventDefault();
        event.stopPropagation();
        el.editorSurface.classList.add("dragover");
      }));
      ["dragleave", "dragend"].forEach(evt => target.addEventListener(evt, event => {
        event.preventDefault();
        event.stopPropagation();
        el.editorSurface.classList.remove("dragover");
      }));
      target.addEventListener("drop", async event => {
        event.preventDefault();
        event.stopPropagation();
        el.editorSurface.classList.remove("dragover");
        const libraryFile = event.dataTransfer.getData("application/x-supernotepad-file");
        if (libraryFile) {
          await attachFileToCurrentNote(libraryFile);
          return;
        }
        const files = [...(event.dataTransfer?.files || [])];
        const paths = files.map(file => api.getPathForFile(file)).filter(Boolean);
        if (!paths.length) return;
        const note = currentNote();
        showProgress("拖拽上传", `正在导入 ${paths.length} 个文件...`);
        setProgress(50, "正在复制到本地文件库...");
        const result = await api.copyDroppedFiles(paths, { noteId: note?.id, folderId: state.selectedFolderId || note?.folderId });
        setProgress(100, "导入完成");
        await refresh(result.data);
        closeModal();
        showToast(`已拖拽上传 ${result.files.length} 个文件`);
      });
    });
  }

  async function createNote(title = "") {
    const noteTitle = title || prompt("请输入笔记标题：", "未命名笔记");
    if (!noteTitle) return;
    state.currentView = "notes";
    state.currentFilter = "recent";
    state.pendingFocus = "body";
    await refresh(await api.createNote({ title: noteTitle, body: "", tags: [], folderId: state.selectedFolderId || state.data.settings.defaultFolderId }));
    showToast("笔记已创建");
  }

  async function createFolder() {
    const name = prompt("请输入文件夹名称：", "新建文件夹");
    if (!name) return;
    await refresh(await api.createFolder(name, "文档"));
    showToast("文件夹已创建");
  }

  function insertIntoBody(before, after = "") {
    const editor = $("#noteBodyInput");
    if (!editor) return;
    if (editor.isContentEditable) {
      const selection = window.getSelection();
      const selected = selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)
        ? selection.getRangeAt(0).toString()
        : "";
      insertTextAtSelection(editor, `${before}${selected}${after}`, Boolean(selected));
      return;
    }
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end);
    editor.setRangeText(`${before}${selected}${after}`, start, end, "end");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.focus();
  }

  function readEditorBody() {
    const editor = $("#noteBodyInput");
    if (!editor) return "";
    if (!editor.isContentEditable) return editor.value || "";
    const copy = editor.cloneNode(true);
    copy.querySelectorAll("[data-inline-image-file]").forEach(image => {
      image.replaceWith(document.createTextNode(`\n\n[[file:${image.dataset.inlineImageFile}]]\n\n`));
    });
    return htmlToMarkdown(copy.innerHTML);
  }

  function insertTextAtSelection(editor, text, replaceSelection = false) {
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    const hasSelection = selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer);
    if (hasSelection) {
      range.setStart(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
      range.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
      if (replaceSelection) range.deleteContents();
      else range.collapse(false);
    } else {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }


  async function hydrateCodeBlocks() {
    const nodes = $$("pre.hljs-pre code.hljs");
    for (const node of nodes) {
      const raw = node.textContent || "";
      if (!raw.trim()) continue;
      try {
        const colored = await api.highlightCode(raw, undefined);
        if (colored) node.innerHTML = colored;
      } catch (_) {}
    }
  }


  function maybeWikiSuggest(elInput) {
    if (!elInput) return;
    let text = "";
    let cursor = 0;
    if (elInput.tagName === "TEXTAREA") {
      text = elInput.value || "";
      cursor = elInput.selectionStart || 0;
    } else {
      // rich editor: skip complex caret for now; still support textarea/markdown mode
      hideWikiSuggest();
      return;
    }
    const before = text.slice(0, cursor);
    const m = before.match(/\[\[([^\]]*)$/);
    if (!m) return hideWikiSuggest();
    const q = m[1] || "";
    const start = cursor - m[0].length;
    const items = activeNotes()
      .filter(n => !n.deletedAt)
      .map(n => ({ id: n.id, title: n.title || "未命名笔记" }))
      .filter(n => !q || n.title.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 8);
    state.wikiSuggest = { open: true, items, index: 0, start, end: cursor };
    renderWikiSuggest(elInput);
  }

  function hideWikiSuggest() {
    state.wikiSuggest = { open: false, items: [], index: 0, start: -1, end: -1 };
    const box = $("#wikiSuggestBox");
    if (box) box.hidden = true;
  }

  function renderWikiSuggest(anchor) {
    let box = $("#wikiSuggestBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "wikiSuggestBox";
      box.className = "wiki-suggest";
      document.body.appendChild(box);
    }
    const items = state.wikiSuggest.items || [];
    if (!state.wikiSuggest.open || !items.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = items.map((item, i) => `<button type="button" class="wiki-suggest-item ${i === state.wikiSuggest.index ? "active" : ""}" data-wiki-i="${i}">${escapeHtml(item.title)}</button>`).join("");
    const rect = (anchor || $("#noteBodyInput"))?.getBoundingClientRect?.();
    if (rect) {
      box.style.left = `${Math.max(12, rect.left + 12)}px`;
      box.style.top = `${Math.min(window.innerHeight - 220, rect.top + 48)}px`;
    }
    box.querySelectorAll("[data-wiki-i]").forEach(btn => btn.addEventListener("click", () => applyWikiSuggest(Number(btn.dataset.wikiI))));
  }

  function applyWikiSuggest(index) {
    const item = state.wikiSuggest.items[index];
    const elInput = $("#noteBodyInput");
    if (!item || !elInput || elInput.tagName !== "TEXTAREA") return hideWikiSuggest();
    const text = elInput.value || "";
    const { start, end } = state.wikiSuggest;
    const next = `${text.slice(0, start)}[[${item.title}]]${text.slice(end)}`;
    elInput.value = next;
    const caret = start + item.title.length + 4;
    elInput.setSelectionRange(caret, caret);
    hideWikiSuggest();
    scheduleNoteSave(currentNote()?.id);
  }

  function handleWikiKeydown(event, elInput) {
    if (!state.wikiSuggest.open) return;
    const items = state.wikiSuggest.items || [];
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.wikiSuggest.index = Math.min(items.length - 1, state.wikiSuggest.index + 1);
      renderWikiSuggest(elInput);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      state.wikiSuggest.index = Math.max(0, state.wikiSuggest.index - 1);
      renderWikiSuggest(elInput);
    } else if (event.key === "Enter" && items.length) {
      event.preventDefault();
      applyWikiSuggest(state.wikiSuggest.index);
    } else if (event.key === "Escape") {
      hideWikiSuggest();
    }
  }

  function renderBacklinks(note) {
    const host = $("#backlinksPanel");
    const links = state.data?.noteLinks?.[note.id] || { outgoing: [], incoming: [] };
    let panel = host;
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "backlinksPanel";
      panel.className = "backlinks-panel";
      const sheet = $("#editorSurface .note-sheet") || $("#editorSurface");
      sheet?.appendChild(panel);
    }
    panel.innerHTML = `
      <div class="backlinks-title">反向链接 · ${(links.incoming || []).length}</div>
      <div class="backlinks-list">
        ${(links.incoming || []).map(item => `<button type="button" data-backlink="${item.id}">${escapeHtml(item.title || "")}</button>`).join("") || `<span class="meta-quiet">暂无反向链接</span>`}
      </div>
    `;
    panel.querySelectorAll("[data-backlink]").forEach(btn => btn.addEventListener("click", () => openNoteInTab(btn.dataset.backlink)));
  }

  function enhanceWikiLinksInEditor() {
    $$("#noteBodyInput .wiki-link, #editorSurface .wiki-link").forEach(node => {
      node.addEventListener("click", async event => {
        event.preventDefault();
        const title = node.dataset.wikiTitle || node.textContent || "";
        const note = activeNotes().find(n => (n.title || "") === title);
        if (note) await openNoteInTab(note.id);
        else showToast("未找到对应笔记");
      });
    });
  }

  async function openHistoryModal(noteId = currentNote()?.id) {
    if (!noteId) return showToast("当前没有笔记");
    const versions = await api.listNoteVersions(noteId);
    openModal("历史版本", `
      <div class="modal-stack">
        <p class="muted-text">保存时自动快照；加密笔记历史仅保留密文。可查看、对比、恢复。</p>
        <div class="manager-list">
          ${(versions || []).map(item => `
            <div class="manager-row history-row">
              <div class="manager-main"><strong>${escapeHtml(item.title || "")}</strong><small>${formatDate(item.createdAt)} · ${escapeHtml(item.reason || "历史版本")}${item.isEncrypted ? " · 密文" : ""}</small></div>
              <button class="mini-btn" data-compare-version="${item.id}" type="button">对比当前</button>
              <button class="mini-btn" data-restore-version="${item.id}" type="button">恢复</button>
            </div>
          `).join("") || `<div class="empty-state">暂无历史版本。</div>`}
        </div>
      </div>
    `);
    el.modalBody.querySelectorAll("[data-restore-version]").forEach(btn => btn.addEventListener("click", async () => {
      if (!confirm("确认恢复到该版本？当前内容会先进入历史。")) return;
      const result = await api.restoreNoteVersionSafe(noteId, btn.dataset.restoreVersion);
      if (!result?.ok) return showToast(result?.error || "恢复失败");
      clearNoteSecrets(noteId);
      closeModal();
      await refresh(result.data);
      showToast("已恢复版本");
    }));
    el.modalBody.querySelectorAll("[data-compare-version]").forEach(btn => btn.addEventListener("click", async () => {
      const result = await api.compareNoteVersions(noteId, btn.dataset.compareVersion, null);
      if (!result?.ok) return showToast(result?.error || "对比失败");
      openModal("版本对比", `
        <div class="compare-grid">
          <div class="content-card"><h4>历史 · ${escapeHtml(result.a.reason || "")}</h4><pre class="compare-pre">${escapeHtml(result.a.isEncrypted ? "（加密快照，不显示明文）" : (result.a.body || ""))}</pre></div>
          <div class="content-card"><h4>当前</h4><pre class="compare-pre">${escapeHtml(result.b.isEncrypted ? "（加密中）" : (result.b.body || ""))}</pre></div>
        </div>
      `);
    }));
  }

  async function exportCurrent(format) {
    const note = currentNote();
    if (!note) return showToast("没有可导出的笔记");
    let plain = null;
    if (note.isEncrypted) {
      if (state.unlockedBodies[note.id] == null) return showToast("请先解锁加密笔记再导出");
      plain = state.unlockedBodies[note.id];
    }
    if (format === "docx") {
      const result = await api.exportDocx(note.id, plain);
      if (result?.canceled) return showToast(result.error || "已取消");
      return showToast("已导出 Word");
    }
    const result = await api.exportNote(note.id, format, plain);
    if (result?.canceled) return showToast(result.error || "已取消");
    showToast(`已导出 ${format.toUpperCase()}`);
  }

  async function openExternalFiles(paths) {
    if (isAppLocked()) return showToast("请先解锁工作区");
    const list = Array.isArray(paths) ? paths : [];
    if (!list.length) {
      const picked = await api.openExternalDialog();
      if (picked?.canceled || !picked?.files?.length) return;
      return openExternalFiles(picked.files);
    }
    const filePath = list[0];
    const result = await api.readExternalFile(filePath);
    if (!result?.ok) return showToast(result?.error || "无法打开文件");
    const file = result.file;
    if (file.systemOnly) {
      if (file.isExecutable) {
        const go = confirm(`这是可执行文件（.${file.ext}），确定交给系统打开吗？`);
        if (!go) return;
      }
      const opened = await api.openPath(file.path);
      if (!opened?.ok) showToast(opened?.error || "系统打开失败");
      else showToast("已用系统默认程序打开");
      return;
    }
    state.externalFile = file;
    state.currentView = "external";
    renderAll();
  }

  function renderExternalFileView() {
    const file = state.externalFile;
    if (!file) {
      el.editorSurface.innerHTML = `<div class="empty-state">没有打开的文件</div>`;
      return;
    }
    let body = "";
    if (file.kind === "text" || file.kind === "csv" || file.kind === "html") {
      body = `<textarea id="externalEditor" class="note-textarea external-editor" spellcheck="false">${escapeHtml(file.content || "")}</textarea>`;
    } else if (file.kind === "image") {
      body = `<div class="media-preview"><img src="${escapeHtml(file.url)}" alt="${escapeHtml(file.name)}" /></div>`;
    } else if (file.kind === "pdf") {
      body = `<iframe class="pdf-frame" src="${escapeHtml(file.url)}"></iframe>`;
    } else if (file.kind === "audio") {
      body = `<div class="media-preview"><audio controls src="${escapeHtml(file.url)}"></audio></div>`;
    } else if (file.kind === "video") {
      body = `<div class="media-preview"><video controls src="${escapeHtml(file.url)}"></video></div>`;
    } else if (file.kind === "docx") {
      body = `<div class="docx-preview content-card">${file.html || "<p class='muted-text'>无法预览</p>"}</div>`;
    } else {
      body = `<div class="empty-state">请使用系统程序打开</div>`;
    }
    el.editorSurface.innerHTML = `
      <div class="view-head">
        <div>
          <h1>${escapeHtml(file.name)}</h1>
          <p>${escapeHtml(file.path)} · ${escapeHtml(file.kind)}${file.encoding ? " · " + escapeHtml(file.encoding) : ""}</p>
        </div>
        <div class="view-actions">
          ${(file.kind === "text" || file.kind === "csv" || file.kind === "html") ? `<button class="btn secondary" id="externalSaveBtn" type="button">保存</button>
          <button class="btn secondary" id="externalSaveAsBtn" type="button">另存为</button>
          <button class="btn primary" id="externalImportBtn" type="button">导入为笔记</button>` : ""}
          <button class="btn secondary" id="externalRevealBtn" type="button">在文件夹中显示</button>
          <button class="btn secondary" id="externalSystemBtn" type="button">系统打开</button>
          <button class="btn ghost" id="externalCloseBtn" type="button">关闭</button>
        </div>
      </div>
      ${body}
    `;
    $("#externalSaveBtn")?.addEventListener("click", async () => {
      const content = $("#externalEditor")?.value || "";
      const r = await api.saveExternalFile(file.path, content, file.encoding === "gbk" ? "gbk" : "utf8");
      showToast(r?.ok ? "已保存" : (r?.error || "保存失败"));
    });
    $("#externalSaveAsBtn")?.addEventListener("click", async () => {
      const content = $("#externalEditor")?.value || "";
      const r = await api.saveExternalFileAs(content, file.encoding === "gbk" ? "gbk" : "utf8", file.name);
      if (!r?.canceled) showToast("已另存为");
    });
    $("#externalImportBtn")?.addEventListener("click", async () => {
      const content = $("#externalEditor")?.value || file.content || "";
      const r = await api.importNoteFromFile({ title: file.name, content, path: file.path });
      if (!r?.ok) return showToast("导入失败");
      state.externalFile = null;
      await refresh(r.data);
      showToast("已导入为笔记");
    });
    $("#externalRevealBtn")?.addEventListener("click", () => api.revealPath(file.path));
    $("#externalSystemBtn")?.addEventListener("click", async () => {
      const r = await api.openPath(file.path);
      if (!r?.ok && !r?.canceled) showToast(r?.error || "打开失败");
    });
    $("#externalCloseBtn")?.addEventListener("click", () => {
      state.externalFile = null;
      state.currentView = "notes";
      renderAll();
    });
    if (file.kind === "text") {
      // highlight via async after paint
      hydrateCodeBlocks();
    }
  }

  function setRemindOnSelectedTodo() {
    const body = $("#noteBodyInput");
    if (!body || body.tagName !== "TEXTAREA") return showToast("请在 Markdown 模式下为待办添加提醒");
    const when = prompt("提醒时间（例如 2026-11-10 15:30）");
    if (!when) return;
    const start = body.selectionStart;
    const end = body.selectionEnd;
    let text = body.value;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const lineEndIdx = text.indexOf("\n", end);
    const lineEnd = lineEndIdx < 0 ? text.length : lineEndIdx;
    let line = text.slice(lineStart, lineEnd);
    if (!/^- \[[ xX]\]/.test(line)) {
      line = `- [ ] ${line || "待办"}`;
    }
    line = line.replace(/\s*@remind\([^)]*\)\s*$/, "") + ` @remind(${when.trim()})`;
    body.value = text.slice(0, lineStart) + line + text.slice(lineEnd);
    scheduleNoteSave(currentNote()?.id);
    showToast("已设置提醒（应用打开时会通知）");
  }

  function fuzzyScore(text, query) {
    const t = String(text || "").toLowerCase();
    const q = String(query || "").toLowerCase().trim();
    if (!q) return 1;
    if (t.includes(q)) return 100 - t.indexOf(q);
    let ti = 0, score = 0;
    for (const ch of q) {
      const found = t.indexOf(ch, ti);
      if (found < 0) return 0;
      score += 2;
      ti = found + 1;
    }
    return score;
  }

  function buildCommandItems(query) {
    const commands = [
      { id: "new-note", label: "新建笔记", hint: "Ctrl+N", run: () => createNote() },
      { id: "daily", label: "打开每日笔记", hint: "", run: () => openDailyNote() },
      { id: "search", label: "打开搜索", hint: "Ctrl+F", run: () => { state.currentView = "search"; setView("search"); el.globalSearch?.focus(); } },
      { id: "files", label: "打开文件库", hint: "", run: () => setView("files") },
      { id: "settings", label: "打开设置", hint: "", run: () => setView("settings") },
      { id: "theme-light", label: "切换浅色主题", hint: "", run: async () => { await refresh(await api.saveSettings({ theme: "light" })); showToast("已切换浅色"); } },
      { id: "theme-dark", label: "切换深色主题", hint: "", run: async () => { await refresh(await api.saveSettings({ theme: "dark" })); showToast("已切换深色"); } },
      { id: "export", label: "导出 Markdown", hint: "", run: () => exportCurrent("md") },
      { id: "export-pdf", label: "导出 PDF", hint: "", run: () => exportCurrent("pdf") },
      { id: "export-docx", label: "导出 Word", hint: "", run: () => exportCurrent("docx") },
      { id: "open-file", label: "打开文件", hint: "Ctrl+O", run: () => openExternalFiles() },
      { id: "quick-note", label: "随手记", hint: "Ctrl+Alt+N", run: () => api.openQuickNote() },
      { id: "lock", label: "锁定工作区", hint: "", run: () => lockWorkspace() },
      { id: "history", label: "历史版本", hint: "", run: () => openHistoryModal(currentNote()?.id) },
      { id: "remind", label: "为当前待办设置提醒", hint: "", run: () => setRemindOnSelectedTodo() },
      { id: "sync", label: "立即同步", hint: "", run: () => syncNow() },
      { id: "backup", label: "备份数据", hint: "", run: () => backupData() },
      { id: "daily-backup", label: "执行每日备份", hint: "", run: async () => { await api.dailyBackup(); showToast("每日备份完成"); } },
      { id: "encrypt", label: "加密当前笔记", hint: "", run: () => encryptCurrentNote() },
      { id: "ocr", label: "OCR 识别图片文字", hint: "", run: () => runOcrIntoNote() },
      { id: "ai-sum", label: "AI 总结选中文字", hint: "", run: () => runAiAction("summarize") },
      { id: "heading", label: "插入标题", hint: "", run: () => insertIntoBody("\n\n## ") },
      { id: "todo", label: "插入待办", hint: "", run: () => insertIntoBody("\n- [ ] ") },
      { id: "template", label: "笔记模板", hint: "", run: () => openTemplateManager() },
      { id: "history", label: "历史版本", hint: "", run: () => openHistoryModal(currentNote()?.id) }
    ];
    const noteItems = activeNotes().map(note => ({
      id: `note:${note.id}`,
      label: `${note.isEncrypted ? "🔒 " : ""}${note.title || "未命名笔记"}`,
      hint: "跳转笔记",
      run: async () => {
        state.currentView = "notes";
        await openNoteInTab(note.id);
      }
    }));
    return [...commands, ...noteItems]
      .map(item => ({ ...item, score: fuzzyScore(`${item.label} ${item.hint || ""}`, query) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);
  }

  function openCommandMenu() {
    if (isAppLocked()) return showToast("请先解锁工作区");
    state.commandOpen = true;
    state.commandQuery = "";
    state.commandIndex = 0;
    renderCommandPalette();
    requestAnimationFrame(() => $("#commandPaletteInput")?.focus());
  }

  function closeCommandPalette() {
    state.commandOpen = false;
    const pal = $("#commandPalette");
    if (pal) pal.hidden = true;
  }

  function renderCommandPalette() {
    const pal = $("#commandPalette");
    if (!pal) return;
    pal.hidden = !state.commandOpen;
    if (!state.commandOpen) return;
    const items = buildCommandItems(state.commandQuery);
    if (state.commandIndex >= items.length) state.commandIndex = Math.max(0, items.length - 1);
    const list = $("#commandPaletteList");
    const input = $("#commandPaletteInput");
    if (input && document.activeElement !== input) input.value = state.commandQuery;
    if (list) {
      list.innerHTML = items.length ? items.map((item, index) => `
        <button class="command-item ${index === state.commandIndex ? "active" : ""}" type="button" data-cmd-index="${index}">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${escapeHtml(item.hint || "")}</span>
        </button>
      `).join("") : `<div class="empty-state">无匹配命令</div>`;
      list.querySelectorAll("[data-cmd-index]").forEach(btn => {
        btn.addEventListener("click", () => runCommandItem(items[Number(btn.dataset.cmdIndex)]));
      });
    }
    pal._items = items;
  }

  async function runCommandItem(item) {
    if (!item) return;
    closeCommandPalette();
    try { await item.run(); } catch (error) { showToast(error.message || "命令执行失败"); }
  }

  function ensureTab(noteId) {
    if (!noteId) return;
    if (!state.openTabs.includes(noteId)) state.openTabs.push(noteId);
  }

  function renderNoteTabs() {
    const bar = $("#noteTabs");
    if (!bar) return;
    const notes = activeNotes();
    const byId = new Map(notes.map(n => [n.id, n]));
    state.openTabs = state.openTabs.filter(id => byId.has(id));
    const currentId = state.data?.currentNoteId;
    if (currentId && byId.has(currentId)) ensureTab(currentId);
    if (!state.openTabs.length) {
      bar.innerHTML = "";
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    bar.innerHTML = state.openTabs.map(id => {
      const note = byId.get(id);
      const dirty = state.dirtyTabIds[id] ? " •" : "";
      const active = id === currentId ? " active" : "";
      const lock = note?.isEncrypted ? "🔒 " : "";
      return `<div class="note-tab${active}" data-tab-id="${id}">
        <button class="note-tab-label" type="button" data-activate-tab="${id}">${lock}${escapeHtml((note?.title || "未命名").slice(0, 18))}${dirty}</button>
        <button class="note-tab-close" type="button" data-close-tab="${id}" aria-label="关闭标签">×</button>
      </div>`;
    }).join("");
    bar.querySelectorAll("[data-activate-tab]").forEach(btn => btn.addEventListener("click", () => openNoteInTab(btn.dataset.activateTab)));
    bar.querySelectorAll("[data-close-tab]").forEach(btn => btn.addEventListener("click", event => {
      event.stopPropagation();
      closeNoteTab(btn.dataset.closeTab);
    }));
  }

  async function openNoteInTab(noteId) {
    if (!noteId) return;
    const prev = state.data?.currentNoteId;
    if (prev && prev !== noteId) clearNoteSecrets(prev);
    ensureTab(noteId);
    state.currentView = "notes";
    state.externalFile = null;
    await refresh(await api.selectNote(noteId));
  }

  async function closeNoteTab(noteId) {
    const idx = state.openTabs.indexOf(noteId);
    if (idx < 0) return;
    if (state.dirtyTabIds[noteId]) {
      const ok = confirm("该标签有未保存更改，确定关闭？");
      if (!ok) return;
    }
    state.openTabs.splice(idx, 1);
    delete state.dirtyTabIds[noteId];
    delete state.unlockedBodies[noteId];
    if (state.data?.currentNoteId === noteId) {
      const next = state.openTabs[idx] || state.openTabs[idx - 1] || state.openTabs[0];
      if (next) await openNoteInTab(next);
      else renderAll();
    } else {
      renderNoteTabs();
    }
  }

  function cycleNoteTab(backward = false) {
    if (!state.openTabs.length) return;
    const cur = state.data?.currentNoteId;
    let idx = state.openTabs.indexOf(cur);
    if (idx < 0) idx = 0;
    idx = backward ? (idx - 1 + state.openTabs.length) % state.openTabs.length : (idx + 1) % state.openTabs.length;
    openNoteInTab(state.openTabs[idx]);
  }

  async function encryptCurrentNote() {
    const note = currentNote();
    if (!note) return showToast("当前没有笔记");
    if (note.isEncrypted) return showToast("笔记已加密");
    const password = prompt("设置笔记密码（忘记将无法找回）：");
    if (!password) return;
    const confirmPw = prompt("请再次输入密码确认：");
    if (password !== confirmPw) return showToast("两次密码不一致");
    const result = await api.encryptNote(note.id, password);
    if (!result?.ok) return showToast(result?.error || "加密失败");
    delete state.unlockedBodies[note.id];
    await refresh(result.data);
    showToast("笔记已加密。忘记密码无法找回。");
  }

  async function decryptCurrentNote() {
    const note = currentNote();
    if (!note?.isEncrypted) return showToast("笔记未加密");
    const password = prompt("输入密码以永久解密并保存明文：");
    if (!password) return;
    const result = await api.decryptNote(note.id, password);
    if (!result?.ok) return showToast(result?.error || "解密失败");
    delete state.unlockedBodies[note.id];
    await refresh(result.data);
    showToast("已解密");
  }

  async function unlockEncryptedPreview(noteId) {
    const password = prompt("输入密码解锁编辑（明文仅保存在内存，保存时自动重新加密；忘记密码无法找回）：");
    if (!password) return;
    const result = await api.unlockNotePreview(noteId, password);
    if (!result || result.ok === false || result.error) return showToast(result?.error || "密码错误或解锁失败");
    const body = result.body != null ? result.body : "";
    state.unlockedBodies[noteId] = body;
    state.notePasswords[noteId] = password;
    renderAll();
    showToast("已解锁，可编辑；保存时将自动重新加密");
  }

  function clearNoteSecrets(noteId) {
    if (noteId) {
      delete state.unlockedBodies[noteId];
      delete state.notePasswords[noteId];
      return;
    }
    state.unlockedBodies = {};
    state.notePasswords = {};
  }

  async function runOcrIntoNote() {
    const note = currentNote();
    if (!note) return showToast("请先打开笔记");
    if (note.isEncrypted && state.unlockedBodies[note.id] == null) return showToast("请先解锁加密笔记");
    const fromAttach = confirm("点“确定”从当前附件选图 OCR；点“取消”改为选择本地图片。");
    let payload = {};
    if (fromAttach) {
      const images = currentAttachments().filter(item => item.file.kind === "img");
      if (!images.length) return showToast("当前笔记没有图片附件");
      payload = { fileId: images[0].file.id, langs: "chi_sim+eng" };
    } else {
      const picked = await api.chooseFiles({ filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }] });
      if (picked?.canceled) return;
      await refresh(picked?.data || null);
      const imgs = activeFiles().filter(f => f.kind === "img" && !f.deletedAt).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      if (!imgs.length) return showToast("未选择到图片");
      payload = { fileId: imgs[0].id, langs: "chi_sim+eng" };
    }
    showToast("OCR 识别中…");
    const result = await api.ocrRecognize(payload);
    if (!result?.ok) return showToast(result?.error || "OCR 失败");
    const text = String(result.text || "").trim();
    if (!text) return showToast("未识别到文字");
    insertIntoBody(`\n\n${text}\n`);
    showToast("OCR 文字已插入");
  }

  async function ensureAiConfig() {
    if (!state.aiConfig) {
      try { state.aiConfig = await api.getAiConfig(); } catch (_) { state.aiConfig = { hasKey: false }; }
    }
    return state.aiConfig;
  }

  async function runAiAction(action) {
    const cfg = await ensureAiConfig();
    if (!cfg?.hasKey || !cfg?.baseUrl) return showToast("请先在设置中配置 AI 接口");
    const selected = getSelectedEditorText();
    if (!selected) return showToast("请先选中一段文字");
    const prompts = {
      summarize: "请用中文简洁总结以下内容：",
      rewrite: "请改写以下内容，保持原意，使表达更清晰：",
      continue: "请续写以下内容："
    };
    showToast("AI 处理中…");
    const result = await api.aiComplete({
      action,
      system: prompts[action] || prompts.summarize,
      user: selected,
      temperature: 0.4
    });
    if (!result?.ok) return showToast(result?.error || "AI 调用失败（可在设置中检查配置）");
    const text = String(result.text || result.content || "").trim();
    if (!text) return showToast("AI 无返回内容");
    insertIntoBody(`\n\n${text}\n`);
    showToast("AI 结果已插入");
  }

  function getSelectedEditorText() {
    const body = $("#noteBodyInput");
    if (!body) return "";
    if (body.tagName === "TEXTAREA") return body.value.slice(body.selectionStart, body.selectionEnd);
    return String(window.getSelection?.() || "");
  }

  async function exportCurrentNote() {
    const note = currentNote();
    if (!note) return showToast("没有可导出的笔记");
    const result = await api.exportNote(note.id, "markdown");
    if (result?.canceled) return;
    showToast("已导出");
  }

  async function syncMergeNow() {
    const result = await api.syncMerge();
    if (result?.canceled) return showToast("请先选择同步目录");
    await refresh(result.data);
    showToast(result.merged ? `合并同步完成：${result.target}` : `已导出到：${result.target}`);
  }


  async function openDailyNote() {
    state.currentView = "notes";
    state.currentFilter = "recent";
    state.pendingFocus = "body";
    await refresh(await api.createDailyNote());
    showToast("每日笔记已打开");
  }


  function openLinksModal(noteId = currentNote()?.id) {
    if (!noteId) return showToast("当前没有笔记");
    const links = state.data.noteLinks?.[noteId] || { outgoing: [], incoming: [] };
    const renderLink = item => `<button class="search-result" data-link-note="${item.id}" type="button"><strong>${escapeHtml(item.title)}</strong><span>点击打开关联笔记</span></button>`;
    openModal("双向链接", `
      <div class="modal-stack">
        <div class="content-card"><h4>当前笔记引用了</h4>${links.outgoing.map(renderLink).join("") || `<p class="muted-text">暂无出链，可在正文输入 [[笔记标题]] 创建链接。</p>`}</div>
        <div class="content-card"><h4>哪些笔记引用了当前笔记</h4>${links.incoming.map(renderLink).join("") || `<p class="muted-text">暂无反向链接。</p>`}</div>
      </div>
    `);
    el.modalBody.querySelectorAll("[data-link-note]").forEach(btn => btn.addEventListener("click", async () => {
      closeModal();
      state.currentView = "notes";
      await refresh(await api.selectNote(btn.dataset.linkNote));
    }));
  }

  function openTemplateManager() {
    const templates = (state.data.templates || []).filter(item => !item.deletedAt);
    openModal("笔记模板", `
      <div class="modal-stack">
        <div class="inline-form">
          <input id="tplName" class="line-input" placeholder="模板名称" />
          <input id="tplTags" class="line-input" placeholder="标签，逗号分隔" />
          <button class="btn primary" id="createTplBtn" type="button">保存模板</button>
        </div>
        <textarea id="tplBody" class="note-textarea small-textarea" placeholder="模板正文，支持 Markdown"></textarea>
        <div class="manager-list">
          ${templates.map(tpl => `
            <div class="manager-row">
              <div class="manager-main"><strong>${escapeHtml(tpl.name)}</strong><small>${(tpl.tags || []).join("，") || "无标签"}</small></div>
              <button class="mini-btn" data-use-template="${tpl.id}" type="button">使用</button>
              <button class="mini-btn" data-edit-template="${tpl.id}" type="button">编辑</button>
              <button class="mini-btn danger" data-delete-template="${tpl.id}" type="button">删除</button>
            </div>
          `).join("") || `<div class="empty-state">暂无模板。</div>`}
        </div>
      </div>
    `);
    $("#createTplBtn")?.addEventListener("click", async () => {
      const name = $("#tplName").value.trim();
      if (!name) return showToast("请输入模板名称");
      const editing = $("#createTplBtn").dataset.editTemplate || "";
      await refresh(await api.saveTemplate({
        id: editing || undefined,
        name,
        body: $("#tplBody").value,
        tags: $("#tplTags").value.split(",").map(item => item.trim()).filter(Boolean)
      }));
      showToast(editing ? "模板已更新" : "模板已保存");
      openTemplateManager();
    });
    el.modalBody.querySelectorAll("[data-use-template]").forEach(btn => btn.addEventListener("click", async () => {
      state.currentView = "notes";
      state.pendingFocus = "body";
      await refresh(await api.createNoteFromTemplate(btn.dataset.useTemplate));
      closeModal();
      showToast("已按模板创建笔记");
    }));
    el.modalBody.querySelectorAll("[data-edit-template]").forEach(btn => btn.addEventListener("click", () => {
      const tpl = templates.find(item => item.id === btn.dataset.editTemplate);
      $("#tplName").value = tpl.name;
      $("#tplTags").value = (tpl.tags || []).join(", ");
      $("#tplBody").value = tpl.body || "";
      $("#createTplBtn").textContent = "更新模板";
      $("#createTplBtn").dataset.editTemplate = tpl.id;
    }));
    el.modalBody.querySelectorAll("[data-delete-template]").forEach(btn => btn.addEventListener("click", async () => {
      if (!confirm("确认删除模板？")) return;
      await refresh(await api.deleteTemplate(btn.dataset.deleteTemplate));
      showToast("模板已删除");
      openTemplateManager();
    }));
  }

  function openExportMenu() {
    const note = currentNote();
    if (!note) return showToast("当前没有可导出的笔记");
    openModal("导出当前笔记", `
      <div class="modal-stack">
        <p class="muted-text">选择导出格式，系统会弹出本地保存位置。</p>
        <div class="command-grid">
          <button data-export-format="md" type="button">Markdown（.md）</button>
          <button data-export-format="txt" type="button">纯文本（.txt）</button>
          <button data-export-format="pdf" type="button">PDF 文档（.pdf）</button>
        </div>
      </div>
    `);
    el.modalBody.querySelectorAll("[data-export-format]").forEach(btn => btn.addEventListener("click", async () => {
      const result = await api.exportNote(note.id, btn.dataset.exportFormat);
      if (!result.canceled) {
        closeModal();
        showToast(`已导出：${result.path}`);
      }
    }));
  }

  function openAutosaveSettings() {
    const current = Number(state.data?.settings?.autoSaveMs || 700);
    openModal("自动保存设置", `
      <div class="modal-stack">
        <p class="muted-text">修改后立即生效，笔记标题、标签和正文都会按该间隔自动保存到本地数据库。</p>
        <label class="modal-field">
          <span>保存间隔（毫秒）</span>
          <input id="autosaveIntervalInput" type="number" min="300" max="10000" step="100" value="${current}" />
        </label>
        <div class="row-actions">
          <button class="btn primary" id="saveAutosaveIntervalBtn" type="button">保存间隔</button>
          <button class="btn secondary" id="resetAutosaveIntervalBtn" type="button">恢复 700ms</button>
        </div>
      </div>
    `);
    $("#resetAutosaveIntervalBtn")?.addEventListener("click", () => {
      $("#autosaveIntervalInput").value = 700;
    });
    $("#saveAutosaveIntervalBtn")?.addEventListener("click", async () => {
      const raw = Number($("#autosaveIntervalInput")?.value || 700);
      const autoSaveMs = Math.max(300, Math.min(10000, raw));
      clearTimeout(state.autosaveTimer);
      await refresh(await api.saveSettings({ autoSaveMs }));
      closeModal();
      showToast(`自动保存间隔已更新为 ${autoSaveMs}ms`);
    });
  }

  function folderUsage(folderId) {
    return {
      notes: activeNotes().filter(note => note.folderId === folderId).length,
      files: activeFiles().filter(file => file.folderId === folderId).length
    };
  }

  function folderKindOptions(kind) {
    return ["文档", "图片", "合同", "资料", "归档"].map(item => `<option value="${item}" ${item === kind ? "selected" : ""}>${item}</option>`).join("");
  }

  function openFolderManager() {
    const rows = folders().map(folder => {
      const usage = folderUsage(folder.id);
      return `
        <div class="manager-row" data-folder-row="${folder.id}">
          <div class="manager-main">
            <strong>${escapeHtml(folder.name)}</strong>
            <small>${usage.notes} 篇笔记 · ${usage.files} 个文件 · ${escapeHtml(folder.kind || "文档")}</small>
          </div>
          <select class="mini-select" data-folder-kind="${folder.id}">${folderKindOptions(folder.kind || "文档")}</select>
          <button class="mini-btn" data-rename-folder="${folder.id}" type="button">重命名</button>
          <button class="mini-btn danger" data-delete-folder="${folder.id}" type="button">删除</button>
        </div>
      `;
    }).join("");

    openModal("文件夹管理", `
      <div class="modal-stack">
        <div class="inline-form">
          <input id="managerFolderName" class="line-input" placeholder="输入新文件夹名称" />
          <select id="managerFolderKind" class="mini-select">${folderKindOptions("文档")}</select>
          <button class="btn primary" id="managerCreateFolder" type="button">新增</button>
        </div>
        <div class="manager-list">${rows || `<div class="empty-state">暂无文件夹，先新增一个。</div>`}</div>
      </div>
    `);

    $("#managerCreateFolder")?.addEventListener("click", async () => {
      const name = $("#managerFolderName")?.value.trim();
      const kind = $("#managerFolderKind")?.value || "文档";
      if (!name) return showToast("请输入文件夹名称");
      await refresh(await api.createFolder(name, kind));
      showToast("文件夹已新增");
      openFolderManager();
    });

    el.modalBody.querySelectorAll("[data-folder-kind]").forEach(select => select.addEventListener("change", async () => {
      await refresh(await api.updateFolder(select.dataset.folderKind, { kind: select.value }));
      showToast("文件夹类型已更新");
      openFolderManager();
    }));

    el.modalBody.querySelectorAll("[data-rename-folder]").forEach(btn => btn.addEventListener("click", async () => {
      const folder = folders().find(item => item.id === btn.dataset.renameFolder);
      const name = prompt("请输入新的文件夹名称：", folder?.name || "");
      if (!name) return;
      await refresh(await api.updateFolder(btn.dataset.renameFolder, { name: name.trim() || folder.name }));
      showToast("文件夹已重命名");
      openFolderManager();
    }));

    el.modalBody.querySelectorAll("[data-delete-folder]").forEach(btn => btn.addEventListener("click", async () => {
      const folder = folders().find(item => item.id === btn.dataset.deleteFolder);
      if (!confirm(`确认删除文件夹“${folder?.name || ""}”？笔记和文件不会删除，只会取消归属。`)) return;
      if (state.selectedFolderId === btn.dataset.deleteFolder) state.selectedFolderId = null;
      await refresh(await api.deleteFolder(btn.dataset.deleteFolder));
      showToast("文件夹已删除");
      openFolderManager();
    }));
  }

  function bindGlobalEvents() {
    $("#brandHome")?.addEventListener("click", () => setView("notes"));
    $("#brandHome")?.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setView("notes");
      }
    });
    $("#newNoteBtn")?.addEventListener("click", () => createNote());
    $("#dailyNoteBtn")?.addEventListener("click", () => { closeTopMoreMenu(); openDailyNote(); });
    $("#templatesBtn")?.addEventListener("click", () => { closeTopMoreMenu(); openTemplateManager(); });
    $("#quickNoteBtn")?.addEventListener("click", () => createNote("快速笔记"));
    $("#newFolderBtn")?.addEventListener("click", () => { closeTopMoreMenu(); createFolder(); });
    $("#commandBtnTop")?.addEventListener("click", () => { closeTopMoreMenu(); openCommandMenu(); });
    $("#contextPanelBtn")?.addEventListener("click", () => setContextPanel(!state.contextPanelOpen));
    $("#contextPanelCloseBtn")?.addEventListener("click", () => setContextPanel(false));
    $("#contextPanelPinBtn")?.addEventListener("click", () => {
      state.contextPanelPinned = !state.contextPanelPinned;
      if (state.contextPanelPinned) state.contextPanelOpen = true;
      setContextPanel(state.contextPanelOpen);
      showToast(state.contextPanelPinned ? "已固定文件面板" : "已取消固定文件面板");
    });
    $("#contextScrim")?.addEventListener("click", () => setContextPanel(false));
    $("#uploadBtn")?.addEventListener("click", () => { closeTopMoreMenu(); chooseFiles(); });
    $("#toggleSidebarBtn")?.addEventListener("click", () => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      updateLayoutChrome();
    });
    $("#themeToggleBtn")?.addEventListener("click", async () => {
      const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
      const settings = { ...(state.data?.settings || {}), theme: next };
      await refresh(await api.saveSettings(settings));
      showToast(next === "dark" ? "已切换到深色主题" : "已切换到浅色主题");
    });
    window.addEventListener("resize", () => updateLayoutChrome());
    $("#showAllNotesBtn")?.addEventListener("click", () => {
      state.selectedFolderId = null;
      state.currentFilter = "all";
      setView("notes");
    });
    $("#manageFoldersBtn")?.addEventListener("click", openFolderManager);
    $("#allFilesBtn")?.addEventListener("click", () => {
      state.currentView = "files";
      state.selectedFolderId = null;
      renderAll();
    });
    $("#globalSearch")?.addEventListener("input", event => {
      state.searchQuery = event.target.value.trim();
      state.currentView = "search";
      setView("search");
    });
    $("#railNav")?.addEventListener("click", event => {
      const btn = event.target.closest("[data-view]");
      if (btn) setView(btn.dataset.view);
    });
    $("#boldBtn")?.addEventListener("click", () => insertIntoBody("**", "**"));
    $("#headingBtn")?.addEventListener("click", () => insertIntoBody("\n\n## ", ""));
    $("#listBtn")?.addEventListener("click", () => insertIntoBody("\n- ", ""));
    $("#todoBtn")?.addEventListener("click", () => insertIntoBody("\n- [ ] "));
    $("#imageBtn")?.addEventListener("click", chooseFiles);
    $("#codeBtn")?.addEventListener("click", () => insertIntoBody("\n```text\n", "\n```\n"));
    $("#linkBtn")?.addEventListener("click", () => insertIntoBody("[", "](https://)"));
    $("#commandBtn")?.addEventListener("click", openCommandMenu);
    $$(".tool-chip[data-mode]").forEach(btn => btn.addEventListener("click", () => switchEditorMode(btn.dataset.mode)));
    $("#autosaveBtn")?.addEventListener("click", openAutosaveSettings);
    $("#exportBtn")?.addEventListener("click", openExportMenu);
    $("#aiOrganizeBtn")?.addEventListener("click", () => runAi());
    $$(".ai-actions [data-ai-action]").forEach(btn => btn.addEventListener("click", async () => {
      const note = currentNote();
      if (!note) return showToast("当前没有可整理的笔记");
      if (!state.aiResult || state.aiResultNoteId !== note.id) {
        state.aiResult = await api.organizeNote(note.id);
        state.aiResultNoteId = note.id;
      }
      applyAi(btn.dataset.aiAction === "summary" ? "summary" : btn.dataset.aiAction);
    }));
    $("#modalCloseBtn")?.addEventListener("click", closeModal);
    $("#modalBackdrop")?.addEventListener("click", event => {
      if (event.target === el.modalBackdrop) closeModal();
    });
    document.addEventListener("keydown", event => {
      const key = event.key.toLowerCase();
      if (isAppLocked()) {
        // Allow typing only inside the lock overlay password field.
        const target = event.target;
        const inLock = target && (target.id === "unlockPassword" || target.id === "unlockBtn" || target.closest?.("#appLockOverlay"));
        if (!inLock) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (state.commandOpen) {
        const items = $("#commandPalette")?._items || [];
        if (event.key === "Escape") {
          event.preventDefault();
          closeCommandPalette();
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          state.commandIndex = Math.min(Math.max(items.length - 1, 0), state.commandIndex + 1);
          renderCommandPalette();
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          state.commandIndex = Math.max(0, state.commandIndex - 1);
          renderCommandPalette();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          runCommandItem(items[state.commandIndex]);
          return;
        }
      }
      if (event.key === "Escape" && state.contextPanelOpen) {
        setContextPanel(false);
        return;
      }
      if (event.key === "Escape" && el.modalBackdrop && !el.modalBackdrop.hidden) {
        closeModal();
        return;
      }
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.shiftKey && key === "p") {
        event.preventDefault();
        openCommandMenu();
        return;
      }
      if (key === "o") {
        event.preventDefault();
        openExternalFiles();
        return;
      }
      if (key === "n") {
        event.preventDefault();
        createNote();
      }
      if (key === "s") {
        event.preventDefault();
        const note = currentNote();
        if (note) saveCurrentNote(note.id).then(() => showToast("笔记已保存"));
      }
      if (key === "f") {
        event.preventDefault();
        el.globalSearch?.focus();
        state.currentView = "search";
        setView("search");
      }
      if (key === "k") {
        event.preventDefault();
        openCommandMenu();
      }
      if (key === "w") {
        event.preventDefault();
        const id = state.data?.currentNoteId;
        if (id) closeNoteTab(id);
      }
      if (key === "tab") {
        event.preventDefault();
        cycleNoteTab(Boolean(event.shiftKey));
      }
      if (event.key === "\\" || key === "\\") {
        event.preventDefault();
        state.sidebarCollapsed = !state.sidebarCollapsed;
        updateLayoutChrome();
      }
    });

    document.addEventListener("input", event => {
      if (event.target && event.target.id === "commandPaletteInput") {
        state.commandQuery = event.target.value || "";
        state.commandIndex = 0;
        renderCommandPalette();
      }
    });
  }

  async function init() {
    bindGlobalEvents();
    ["mousemove", "keydown", "click", "scroll"].forEach(evt => document.addEventListener(evt, touchActivity, { passive: true }));
    api.onForceLock?.(() => lockWorkspace());
    api.onExternalOpen?.(files => openExternalFiles(files));
    api.onReminderOpenNote?.(noteId => openNoteInTab(noteId));
    api.onNotesChanged?.(data => refresh(data));
    window.addEventListener("dragover", event => { event.preventDefault(); });
    window.addEventListener("drop", async event => {
      event.preventDefault();
      if (isAppLocked()) return;
      const files = [...(event.dataTransfer?.files || [])]
        .map(file => api.getPathForFile?.(file))
        .filter(Boolean);
      if (files.length) openExternalFiles(files);
    });
    await refresh();
    setupIdleLockWatcher();
    api.tickReminders?.();
    const queued = await api.takeQueuedFiles?.();
    if (queued?.length) openExternalFiles(queued);
  }

  init().catch(error => {
    console.error(error);
    showToast(`启动失败：${error.message}`);
  });
})();
