# 超级记事本技术架构方案

## 1. 总体架构目标

要支撑“记事 + 文件管理 + 拖拽上传 + 搜索 + AI 整理”这条主线，技术架构必须满足：

1. 编辑体验流畅
2. 文件上传与预览稳定
3. 搜索可扩展
4. AI 能异步处理
5. 支持后续多端同步

---

## 2. 推荐技术栈

## 2.1 前端

### 推荐
- **Next.js**
- **React**
- **TypeScript**
- **Tailwind CSS** 或 CSS Modules
- **TanStack Query**：服务端状态管理
- **Zustand**：本地 UI 状态
- **TipTap** 或 **Lexical**：笔记编辑器

### 原因
- Next.js 适合 Web 应用和未来 SEO 官网统一管理
- TipTap / Lexical 适合做块编辑、附件块、引用块和拖拽能力
- TanStack Query 可以很好处理笔记、文件、搜索结果等异步数据

---

## 2.2 后端

### 推荐
- **NestJS**（Node.js + TypeScript）

### 原因
- 模块化清晰
- 适合拆分 Note / File / Search / AI 模块
- 团队协作友好
- 与前端 TypeScript 共享类型方便

---

## 2.3 数据层

- **PostgreSQL**：主业务数据
- **Redis**：缓存、会话、任务队列
- **S3 / MinIO**：文件对象存储
- **OpenSearch / Meilisearch**：全文搜索
- **pgvector（可选）**：语义搜索向量存储

---

## 2.4 异步任务

- **BullMQ**（基于 Redis）
- 可处理：
  - 文件转码
  - 缩略图生成
  - OCR
  - 文本抽取
  - 搜索索引更新
  - AI 摘要 / 标签任务

---

## 3. 高层架构图

```text
[ Web App / Mobile App ]
          |
          v
[ API Gateway / BFF ]
          |
   -------------------------
   |     |      |     |    |
   v     v      v     v    v
[Auth][Note][File][Search][AI]
   |     |      |     |    |
   --------- Data Layer -------
   |           |         |
   v           v         v
[PostgreSQL] [Redis] [S3/MinIO]
                    |
                    v
          [OpenSearch / Meilisearch]
```

---

## 4. 核心服务拆分

## 4.1 Auth Service
职责：
- 登录 / 注册
- Token 鉴权
- 用户资料
- 工作区权限

## 4.2 Note Service
职责：
- 笔记 CRUD
- 标签 / 收藏 / 置顶
- 笔记版本
- 笔记与附件关联
- 笔记搜索基础数据

## 4.3 File Service
职责：
- 文件上传
- 文件夹管理
- 文件元数据
- 文件预览
- 文件与笔记的关联关系
- 拖拽上传流程

## 4.4 Search Service
职责：
- 全文索引
- 文件名索引
- 标签搜索
- 筛选器
- OCR / 语义搜索扩展

## 4.5 AI Service
职责：
- 自动摘要
- 自动标签
- 自动标题
- 附件文本提取后总结
- 多笔记归纳总结

---

## 5. 核心数据模型

## 5.1 user
```text
id
name
email
avatar
plan
created_at
updated_at
```

## 5.2 workspace
```text
id
owner_id
name
storage_limit
created_at
updated_at
```

## 5.3 notebook
```text
id
workspace_id
name
icon
sort_order
created_at
updated_at
```

## 5.4 note
```text
id
workspace_id
notebook_id
title
content_json
content_text
status
is_favorite
is_pinned
created_by
created_at
updated_at
deleted_at
```

## 5.5 tag
```text
id
workspace_id
name
color
created_at
```

## 5.6 note_tag
```text
id
note_id
tag_id
```

## 5.7 file_asset
```text
id
workspace_id
folder_id
file_name
file_ext
mime_type
size
storage_key
preview_key
ocr_text
created_by
created_at
updated_at
deleted_at
```

## 5.8 note_attachment
```text
id
note_id
file_id
display_type
sort_order
created_at
```

## 5.9 file_folder
```text
id
workspace_id
parent_id
name
created_at
updated_at
```

## 5.10 note_version
```text
id
note_id
version_no
content_json
created_by
created_at
```

## 5.11 ai_job
```text
id
workspace_id
target_type
target_id
job_type
status
result_json
created_at
updated_at
```

---

## 6. 拖拽上传技术流程

## 6.1 文件拖到当前笔记

```text
用户拖拽文件
   ->
前端识别 drop 事件
   ->
请求后端获取 presigned URL
   ->
前端直传 S3 / MinIO
   ->
上传成功后回调 File Service
   ->
创建 file_asset 记录
   ->
创建 note_attachment 记录
   ->
异步触发预览 / OCR / 索引任务
   ->
前端显示附件卡片
```

### 关键点
1. 上传本体走对象存储，减轻 API 压力
2. 附件关系单独存 note_attachment
3. 预览与 OCR 走异步任务，不阻塞主流程

---

## 7. 搜索架构

## 7.1 搜索内容
- note.title
- note.content_text
- tag.name
- file_asset.file_name
- file_asset.ocr_text
- 关联笔记名称

## 7.2 索引同步
- 笔记保存后：更新 note 索引
- 文件上传后：更新 file 索引
- OCR 完成后：回写 file_asset.ocr_text 并更新索引
- AI 标签完成后：更新 note_tag 索引

## 7.3 推荐方案
### MVP
- Meilisearch：轻量、快、开发成本低

### 规模化
- OpenSearch：适合更复杂的检索和聚合

---

## 8. AI 架构

## 8.1 输入源
- 笔记正文
- 选中片段
- 附件抽取文本
- 多篇笔记集合

## 8.2 输出能力
- 摘要
- 自动标题
- 标签建议
- PRD 大纲
- 行动项提取
- 问答

## 8.3 调用方式
- 用户点击触发
- 或部分轻任务在保存后后台触发

## 8.4 任务流程
```text
创建 ai_job
  ->
调用 LLM 服务
  ->
返回结构化结果
  ->
存 result_json
  ->
由前端选择是否写回笔记
```

---

## 9. 前端项目结构建议

```text
apps/
  web/
    src/
      app/
      components/
        layout/
        notes/
        files/
        search/
        ai/
      features/
        note-editor/
        file-manager/
        global-search/
      hooks/
      services/
      stores/
      styles/
      types/
packages/
  ui/
  shared-types/
```

### 前端模块说明
- `layout`：工作区外壳
- `notes`：笔记列表、笔记卡片、标签
- `files`：文件列表、文件夹树、文件预览
- `note-editor`：编辑器、附件块、拖拽区
- `search`：搜索面板、筛选器
- `ai`：AI 抽屉、结果建议卡片

---

## 10. 后端项目结构建议

```text
apps/
  api/
    src/
      modules/
        auth/
        users/
        workspaces/
        notebooks/
        notes/
        tags/
        files/
        folders/
        search/
        ai/
        uploads/
      common/
      config/
      jobs/
      db/
```

---

## 11. API 设计示例

## 11.1 笔记
```text
POST   /api/notes
GET    /api/notes
GET    /api/notes/:id
PATCH  /api/notes/:id
DELETE /api/notes/:id
POST   /api/notes/:id/restore
```

## 11.2 文件
```text
POST   /api/files/presign
POST   /api/files/complete
GET    /api/files
GET    /api/files/:id
PATCH  /api/files/:id
DELETE /api/files/:id
```

## 11.3 附件关系
```text
POST   /api/notes/:id/attachments
DELETE /api/notes/:id/attachments/:attachmentId
```

## 11.4 搜索
```text
GET    /api/search?q=关键词&type=all
GET    /api/search/notes?q=关键词
GET    /api/search/files?q=关键词
```

## 11.5 AI
```text
POST   /api/ai/notes/:id/summary
POST   /api/ai/notes/:id/tags
POST   /api/ai/notes/:id/outline
POST   /api/ai/files/:id/extract
```

---

## 12. 文件预览与处理

### 图片
- 缩略图
- 原图预览

### PDF
- 首屏缩略图
- 文本抽取

### Office 文档
- 文件图标 + 基础元数据
- 后期接入在线预览服务

### 压缩包
- 文件类型识别
- 不直接解压预览，先保留下载能力

---

## 13. 安全与稳定性

### 安全
- JWT / Session 鉴权
- 文件类型白名单
- 文件大小限制
- 病毒扫描（可选）
- 对象存储签名 URL
- 删除采用软删除 + 回收站

### 稳定性
- 自动保存
- 定时备份
- 上传失败重试
- AI 异步回调
- 索引重建机制

---

## 14. 部署建议

### MVP
- 前端：Vercel / Netlify
- 后端：Docker 部署
- 数据库：PostgreSQL
- 文件：MinIO / S3
- 搜索：Meilisearch
- 缓存 / 队列：Redis

### 成熟阶段
- Kubernetes
- OpenSearch
- 多环境部署
- 监控告警（Prometheus / Grafana）

---

## 15. 推荐开发优先级

### 第一优先级
1. 工作区壳子
2. 笔记列表
3. 编辑器
4. 文件上传
5. 拖拽到笔记
6. 附件卡片
7. 文件管理页

### 第二优先级
1. 搜索
2. 文件预览
3. AI 摘要
4. 标签 / 收藏 / 回收站

### 第三优先级
1. OCR
2. 语义搜索
3. 版本历史
4. 多端同步增强

---

## 16. 一句话总结

技术上最关键的不是“把笔记做出来”，而是把这条链路打通：

**编辑器 -> 拖拽上传 -> 文件归档 -> 笔记关联 -> 搜索索引 -> AI 整理**

这条链路一旦打通，产品就具备了明显差异化。
