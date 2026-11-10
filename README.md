# 超级记事本

本地优先的 Windows 桌面笔记应用：把写作、文件归档和检索放在同一个窗口里，数据默认只存在你的电脑上。

## 功能

- **笔记编辑**：Markdown 与富文本切换，支持标题、列表、待办、代码块、图片和链接；自动保存，状态栏显示字数与阅读时间。
- **笔记本与整理**：文件夹、标签、收藏、置顶、多标签页、命令菜单，以及会议纪要等内置模板、每日笔记。
- **文件库**：拖拽或粘贴文件进入当前笔记，自动归档到文件库；支持预览、缩略图、从文件库引用到笔记、分类与回收站。
- **搜索**：搜索笔记标题、正文、标签和附件（含 OCR 文本），也可查看相似笔记。
- **笔记加密**：为单篇笔记设置密码，使用 AES-256-GCM 加密正文；忘记密码无法找回。解锁后可编辑，保存时自动重新加密。
- **启动密码与自动锁定**：可为工作区设置启动密码；支持按闲置时长自动锁定，也可从托盘菜单立即锁定。锁定后界面不展示笔记内容。
- **历史版本**：编辑前自动记录版本，可对比与恢复；可配置每篇笔记保留的版本数量。
- **全局随手记**：默认快捷键 `Ctrl+Alt+N`（可在设置中修改），从托盘或快捷键打开快速记录窗口，保存到「随手记」文件夹。
- **待办提醒**：在 Markdown 待办行中设置提醒时间，应用打开时会弹出系统通知。
- **笔记互链**：在正文中使用 `[[笔记标题]]` 建立双向链接，可查看出链与反向链接。
- **导出**：将当前笔记导出为 Markdown、纯文本、PDF 或 Word（`.docx`）。加密笔记需先解锁再导出。
- **OCR**：基于 Tesseract，对附件或本地图片识别中英文（`chi_sim+eng`），并将文字插入笔记。
- **本地整理与可选 AI**：内置基于规则的摘要、标签和大纲建议；也可在设置中配置 OpenAI 兼容接口。API Key 使用系统安全存储保存，不会写入仓库。
- **备份与同步**：手动备份、加密备份、每日备份，以及将工作区同步/合并到指定文件夹。可自定义数据目录。
- **外观**：浅色 / 深色主题。

首次启动会写入若干示例笔记和模板，便于熟悉界面，可直接删除或改写。

## 安装与运行

需要已安装 [Node.js](https://nodejs.org/) 18 或更高版本（建议 18/20 LTS）。在项目根目录执行：

```bash
npm install
npm start
```

## 打包

在 Windows 上构建安装包和便携版：

```bash
npm run build
```

产物输出到 `dist/`：

- `Super Notepad-Setup-1.0.0-x64.exe`：NSIS 安装包，可选安装目录，并创建桌面和开始菜单快捷方式
- `Super Notepad-Portable-1.0.0-x64.exe`：便携版

打包由 `electron-builder` 完成，配置见 `package.json` 的 `build` 字段。

## 技术栈

- **运行时**：[Electron](https://www.electronjs.org/) 31
- **界面**：原生 HTML / CSS / JavaScript，无前端框架
- **OCR**：[Tesseract.js](https://tesseract.projectnaptha.com/)，语言模型位于 `vendor/tessdata/`（简体中文、英语）
- **代码高亮**：[highlight.js](https://highlightjs.org/)
- **文档**：[docx](https://www.npmjs.com/package/docx) 导出 Word，[mammoth](https://www.npmjs.com/package/mammoth) 预览 Word，[iconv-lite](https://www.npmjs.com/package/iconv-lite) 识别本地文本编码
- **加密**：Node.js `crypto`（scrypt 派生密钥 + AES-256-GCM）；工作区密码使用 PBKDF2-SHA256

`项目大纲.md` 和 `ARCHITECTURE.md` 是早期产品与架构设想（面向 Web 服务），与当前桌面实现并不相同，请以本说明和源码为准。`demo.html` 是早期静态原型，可直接用浏览器打开预览布局，但不包含桌面端功能。

## 目录结构

```text
.
├── main.js              # Electron 主进程：窗口、数据存储、IPC
├── preload.js           # 主窗口预加载桥
├── preload-quick.js     # 随手记窗口预加载桥
├── index.html           # 主界面
├── styles.css           # 样式
├── app.js               # 渲染进程逻辑
├── extra-features.js    # 随手记、托盘、提醒、版本、Word 导出等
├── full-features.js     # 笔记加密、OCR、可选 AI、合并同步
├── quick-note.html      # 随手记窗口
├── ocr-worker.js        # OCR 子进程
├── ocr-selftest.js      # OCR 自检脚本
├── vendor/
│   ├── highlight/       # highlight.js 主题样式
│   └── tessdata/        # Tesseract 中英语言模型
├── package.json
├── LICENSE
└── README.md
```

笔记和附件默认存放在 Electron 的用户数据目录，而不是源码仓库里。不要把 `data.json`、`uploads/`、备份目录或 `ai-config.bin` 提交到 Git。

## 许可证

本项目以 [MIT](LICENSE) 许可证发布。

`vendor/tessdata/` 中的 Tesseract 训练数据通常遵循 [Apache License 2.0](https://github.com/tesseract-ocr/tessdata/blob/main/LICENSE)；`vendor/highlight/` 中的样式来自 highlight.js（BSD-3-Clause）。使用这些文件时请一并遵守其原始许可证。
