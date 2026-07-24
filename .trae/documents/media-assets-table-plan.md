# 独立媒体资产表设计与资产库改造计划

## 摘要

为墨间新增一张**独立的媒体资产记录表 `media_assets`**，作为所有生成媒体（图片/视频/音频）的统一账本。该表与 `series`/`episodes` **无外键关联**，仅作记录用途。后续生成图片/视频/音频时，在现有持久化逻辑之外**额外写入**这张表；资产库页面与 `AssetPicker` 改读这张表；并在资产库页面新增"添加资产"入口，支持上传本地文件或粘贴 URL 直接录入。

核心收益：资产库不再实时聚合两表 JSON、获得真实生成时间戳、删除只删账本不影响业务数据、支持独立添加资产。

---

## 关键假设与默认决策（用户跳过了澄清问题，以下为合理默认，Review 时可校正）

| 决策点 | 默认选择 | 依据 |
|--------|---------|------|
| 历史数据 | **一次性迁移**到新表（启动时检测执行） | 用户原话"需要记录现有的媒体" |
| 写入策略 | **双写**：业务表照旧存 URL 供生成/展示，资产表额外记录 | 用户原话"它只是个记录"，说明不替代业务表 |
| "从资产库添加" | 资产库页面新增"添加资产"按钮，上传/粘贴 URL 录入新表 | 用户说"实现"，而 AssetPicker 选用功能已存在无需实现 |
| 来源字段 | 保留 `series_id`/`series_title`/`episode_id`/`episode_title` 为**普通文本字段（无外键）** | "不关联"理解为无外键约束；保留来源以维持企划过滤体验 |
| 旧聚合接口 | 保留 `GET /api/data/assets` 作为迁移数据源，迁移完成后保留但不再被前端使用 | 避免破坏性删除，便于回退 |
| 旧 DELETE 接口 | 废弃原 `/api/data/assets` DELETE（清 JSON 字段逻辑），改用新表 DELETE | 新表独立，删除只删账本 |

---

## 当前状态分析

### 数据库现状（[lib/db.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/db.ts#L23-L59)）

仅有三张表：`series`、`episodes`、`settings`。所有媒体 URL 内嵌在 JSON 列：
- `series.character_settings[].imageUrl` / `voiceUrl`
- `series.object_settings[].imageUrl`
- `series.scene_settings[].imageUrl`
- `episodes.assets[].imageUrl`（`status==="ready"`）
- `episodes.shots[].videoUrl`（`videoStatus==="succeeded"`）

迁移模式为「try SELECT 列名，catch 则 ALTER TABLE ADD COLUMN」。

### 资产库现状（[app/api/data/assets/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/data/assets/route.ts)）

`GET /api/data/assets` 实时聚合 `series` + `episodes` 两表，`JSON.parse` 各 JSON 列抽取媒体 URL，拼成 `AssetLibraryItem[]`。问题：
- 每次全表扫 + 多次 JSON.parse，无分页无缓存
- `createdAt` 借用 `series.updated_at`/`episode.updated_at`，编辑即变
- 删除（DELETE）是反向改 JSON 字段置空 URL，元素仍残留
- 无法独立添加资产

### 生成与持久化链路

所有生成接口（`/api/image`、`/api/video/*`、`/api/audio`）**纯代理不写库**。前端拿到结果后 `transferAsset`/`uploadBase64` 转存 COS，再 `saveSeries`/`saveEpisode` 写入业务表 JSON 列。**这是双写的天然插入点**——在转存 COS 拿到持久 URL 后、写业务表的同时，额外调一个新接口记录到 `media_assets`。

### AssetPicker 现状（[components/AssetPicker.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPicker.tsx#L160-L170)）

调 `apiClient.listAssetLibrary()` 拉数据，按 `mediaType`/`seriesId`/`entityType` 过滤，确认时返回 `PickedAssetItem[]`（`{url, name}[]`）。改造时只需把数据源换成新表接口，返回结构不变。

### 相关类型（[lib/types.ts#L558-L578](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts#L558-L578)）

`AssetLibraryItem` 字段：`id`/`mediaType`/`url`/`seriesId`/`seriesTitle`/`episodeId?`/`episodeTitle?`/`entityType`/`entityName`/`source`/`prompt?`/`createdAt`。

---

## 表结构设计

新增 `media_assets` 表（[lib/db.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/db.ts) 建表段追加）：

```sql
CREATE TABLE IF NOT EXISTS media_assets (
  id            TEXT PRIMARY KEY,          -- UUID（crypto.randomUUID()）
  media_type    TEXT NOT NULL,             -- 'image' | 'video' | 'audio'
  url           TEXT NOT NULL,             -- COS 持久 URL
  entity_type   TEXT NOT NULL,             -- 'character'|'scene'|'object'|'shot'|'screenshot'|'storyboard'|'other'
  entity_name   TEXT NOT NULL DEFAULT '',  -- 资产名称
  prompt        TEXT NOT NULL DEFAULT '',  -- 生成提示词（可选）
  source        TEXT NOT NULL DEFAULT '',  -- 'asset'|'shot'|'profile-character'|'profile-object'|'profile-scene'|'manual'|'screenshot'
  series_id     TEXT NOT NULL DEFAULT '',  -- 来源企划 ID（纯文本，非外键）
  series_title  TEXT NOT NULL DEFAULT '',
  episode_id    TEXT NOT NULL DEFAULT '',
  episode_title TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,          -- 记录创建时间（媒体真实入库时间）
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_assets_created_at ON media_assets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_series_id ON media_assets(series_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_media_type ON media_assets(media_type);
CREATE INDEX IF NOT EXISTS idx_media_assets_entity_type ON media_assets(entity_type);
```

设计要点：
- **无外键**：`series_id`/`episode_id` 仅作来源标注，企划/剧集删除不影响本表记录（符合"只是个记录"）
- **真实时间戳**：`created_at` 用插入时的 `Date.now()`，不再借用业务表 updatedAt
- **`source` 新增 `manual`**：标识从资产库页面手动添加的资产
- **`entity_type` 新增 `other`**：手动添加时允许泛类型
- 索引覆盖资产库的排序（created_at）与过滤（series_id/media_type/entity_type）

---

## 实现变更

### 1. 数据库建表与迁移 — [lib/db.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/db.ts)

**1.1 建表**：在 `db.exec(...)` 的建表 SQL 段（L23-59）末尾追加 `media_assets` 建表语句（含 4 个索引）。

**1.2 一次性历史数据迁移**：在建表后、`return db` 前，新增迁移函数 `migrateMediaAssets(db)`：
- 读取 `settings` 表中 `media_assets_migrated` 标记位；若为 `"1"` 则跳过
- 复用 [app/api/data/assets/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/data/assets/route.ts#L13-L151) 的聚合逻辑（抽 series 的 character/object/scene、episodes 的 assets/shots），但改为 `INSERT INTO media_assets`
- ID 派生规则与现有一致（`profile-character-{id}`、`asset-{epId}-{assetId}` 等），保证迁移后 ID 稳定
- `created_at` 取 `series.updated_at`/`episode.updated_at`（历史数据无真实生成时间，借用是合理 fallback）
- 用事务批量插入，避免重复（INSERT OR IGNORE 按 id 去重）
- 完成后 `INSERT OR REPLACE INTO settings(key, value, updated_at) VALUES('media_assets_migrated', '1', ?)`

> 注意：迁移放在 `getDb()` 内执行，首次访问数据库时触发。由于 better-sqlite3 同步执行，无并发问题。

### 2. 类型定义 — [lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts)

在 `AssetLibraryItem` 之后新增 `MediaAsset` 接口，字段与表结构一一对应：

```typescript
/** 媒体资产记录（独立账本，与业务表无外键关联） */
export interface MediaAsset {
  id: string;
  mediaType: "image" | "video" | "audio";
  url: string;
  entityType: "character" | "scene" | "object" | "shot" | "screenshot" | "storyboard" | "other";
  entityName: string;
  prompt: string;
  source: "asset" | "shot" | "profile-character" | "profile-object" | "profile-scene" | "manual" | "screenshot";
  seriesId: string;
  seriesTitle: string;
  episodeId: string;
  episodeTitle: string;
  createdAt: number;
  updatedAt: number;
}
```

`AssetLibraryItem` 保留不动（旧接口仍返回），新增 `MediaAsset` 供新接口。前端组件统一改用 `MediaAsset`。

### 3. 后端接口 — 新建 `app/api/data/media-assets/route.ts`

仿 [app/api/data/series/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/data/series/route.ts) 的鉴权 + `rowToX` 模式：

**GET**（列表查询）：
- `validateAuth` -> `getDb()`
- `SELECT * FROM media_assets ORDER BY created_at DESC`
- 逐行映射为 `MediaAsset`（snake_case -> camelCase）
- 返回 `Response.json(items)`
- 行级过滤（media_type/entity_type/series_id）由前端做，保持接口简单；如需服务端过滤可后续加 query 参数

**POST**（新增记录，供生成流程双写 + 资产库手动添加）：
- `validateAuth` -> 解析 body
- body 结构：`{ mediaType, url, entityType, entityName?, prompt?, source, seriesId?, seriesTitle?, episodeId?, episodeTitle? }`
- `id` 由后端 `crypto.randomUUID()` 生成；`createdAt`/`updatedAt` 取 `Date.now()`
- `INSERT INTO media_assets (...) VALUES (...)`
- 返回 `{ ok: true, asset: MediaAsset }`

**DELETE**（批量删除）：
- `validateAuth` -> 解析 body `{ ids: string[] }`
- `DELETE FROM media_assets WHERE id IN (...)`（占位符批量）
- 返回 `{ ok: true, deleted: number }`（用 `stmt.changes` 取实际删除数）
- **只删 media_assets 记录，不动业务表**（与旧 DELETE 行为不同）

### 4. 前端 API 客户端 — [lib/api-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/api-client.ts)

在 `apiClient` 对象内新增（保留旧 `listAssetLibrary`/`deleteAssetLibraryItems` 不删，避免破坏性改动）：

```typescript
// Media Assets (新独立资产表)
listMediaAssets: () => request<MediaAsset[]>("/data/media-assets"),
addMediaAsset: (input: {
  mediaType: MediaAsset["mediaType"];
  url: string;
  entityType: MediaAsset["entityType"];
  entityName?: string;
  prompt?: string;
  source: MediaAsset["source"];
  seriesId?: string;
  seriesTitle?: string;
  episodeId?: string;
  episodeTitle?: string;
}) => request<{ ok: boolean; asset: MediaAsset }>("/data/media-assets", {
  method: "POST",
  body: JSON.stringify(input),
}),
deleteMediaAssets: (ids: string[]) =>
  request<{ ok: boolean; deleted: number }>("/data/media-assets", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  }),
```

并在顶部 import `MediaAsset`。

### 5. 生成流程双写（核心改动，6 处插入点）

**原则**：在拿到 COS 持久 URL、更新业务表 state 的**同一时机**，额外调 `apiClient.addMediaAsset(...)`。双写失败不应阻断主流程（catch 后 console.warn，不抛错）。

封装一个共享 helper 减少重复（放 [lib/storage.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/storage.ts) 或新建 `lib/media-asset-recorder.ts`）：

```typescript
/** 记录媒体资产到独立账本（失败不抛错，仅 warn） */
export async function recordMediaAsset(input: {
  mediaType: "image" | "video" | "audio";
  url: string;
  entityType: MediaAsset["entityType"];
  entityName?: string;
  prompt?: string;
  source: MediaAsset["source"];
  seriesId?: string;
  seriesTitle?: string;
  episodeId?: string;
  episodeTitle?: string;
}): Promise<void> {
  try {
    await apiClient.addMediaAsset(input);
  } catch (e) {
    console.warn("[media-assets] 记录失败，不影响主流程:", e);
  }
}
```

**插入点清单**：

| 文件 | 位置 | 触发场景 | 录入字段 |
|------|------|---------|---------|
| [app/series/[id]/characters/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/page.tsx#L350-L365) | 形象图生成成功（transferAsset 后） | 图片 | mediaType=image, entityType=character, source=profile-character, seriesId/seriesTitle, entityName=c.name, prompt=c.imagePrompt 或描述 |
| 同上 L433-464 | 音色生成成功 | 音频 | mediaType=audio, entityType=character, source=profile-character, entityName=c.name |
| [app/series/[id]/characters/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/page.tsx#L386-L420) | 本地上传形象图 | 图片 | 同形象图，source=profile-character |
| [app/series/[id]/objects/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/objects/page.tsx) | 物品形象图生成/上传成功 | 图片 | mediaType=image, entityType=object, source=profile-object |
| [app/series/[id]/scenes/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/scenes/page.tsx) | 场景形象图生成/上传成功 | 图片 | mediaType=image, entityType=scene, source=profile-scene |
| [app/episode/[id]/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/[id]/page.tsx) Step3 | 剧集资产图生成成功（`handleUpdateAsset` imageUrl + status=ready 时） | 图片 | mediaType=image, entityType=asset.type, source=asset, seriesId/episodeId, entityName=asset.name, prompt=asset.imagePrompt |
| 同上 Step4 | 分镜视频生成成功（`handleUpdateShot` videoUrl + videoStatus=succeeded 时） | 视频 | mediaType=video, entityType=shot, source=shot, entityName=shot.visualDescription 截断, prompt=shot.finalPrompt |
| 同上 截屏 | `handleAddScreenshot` 时 | 图片 | mediaType=image, entityType=screenshot, source=screenshot, episodeId, entityName=asset.name |

> **实现注意**：episode 页面用的是防抖 `saveEpisode` + `update(mut)` 模式，没有单一的"生成成功"回调点。最干净的做法是在 `AssetPreparation` 和 `VideoGeneration` 组件内部生成成功后、调 `onUpdateAsset`/`onUpdateShot` 的旁边，额外调 `recordMediaAsset`。需确认这些子组件能拿到 seriesId/seriesTitle/episodeId/episodeTitle（通过 props 传入或从 episode 上下文取）。

### 6. 资产库页面改造 — [components/AssetLibrary.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx)

**6.1 数据源切换**：
- `refresh` 改调 `apiClient.listMediaAssets()`，state 类型改为 `MediaAsset[]`
- `performDelete` 改调 `apiClient.deleteMediaAssets(ids)`
- 字段映射：`MediaAsset` 与 `AssetLibraryItem` 字段名基本一致（`mediaType`/`url`/`seriesId`/`entityType`/`entityName`/`source`/`prompt`/`createdAt`），只需把 `episodeId`/`episodeTitle`/`seriesTitle` 从可选变必填（后端返回空字符串而非 undefined）
- `sourceLabel`/`entityTypeLabel` 等工具函数保持兼容

**6.2 新增"添加资产"功能**：
- 过滤栏右侧"多选"按钮旁新增"添加资产"按钮
- 点击打开新增弹窗（自建 Modal 或复用 `components/ui/Modal`），表单字段：
  - **媒体类型**：单选（图片/视频/音频）
  - **来源方式**：上传本地文件 / 粘贴 URL（切换）
  - **上传本地文件**：走 `uploadRefFile`/`uploadRefBase64`（[lib/cos-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/cos-client.ts)）上传 COS 拿 URL
  - **粘贴 URL**：直接输入（需校验为有效 URL，建议是 COS 持久 URL 但不强制）
  - **名称**：必填
  - **实体类型**：下拉（人物/物品/场景/截屏/故事板/其他），默认"其他"
  - **所属企划**：下拉（可选，从 series 列表取；选了就填 seriesId/seriesTitle，不选留空）
  - **提示词**：可选文本框
- 提交时调 `apiClient.addMediaAsset({ mediaType, url, entityType, entityName, prompt, source: "manual", seriesId?, seriesTitle? })`
- 成功后关闭弹窗 + `refresh()`

### 7. AssetPicker 改造 — [components/AssetPicker.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPicker.tsx)

- `loadData` 改调 `apiClient.listMediaAssets()`，state 类型改为 `MediaAsset[]`
- 过滤逻辑（`seriesId`/`entityType`/`mediaType`）字段名一致，无需改动
- `handleConfirm` 返回 `{url, name}` 不变（`PickedAssetItem` 结构保持）
- `entityTypeLabel` 等兼容

### 8. 旧接口处理

- `GET /api/data/assets`：**保留**（作为迁移数据源已用完，但删除会破坏向后兼容；保留无害，前端不再调用）
- `DELETE /api/data/assets`：**保留但前端不再调用**（资产库改用新 DELETE）
- `apiClient.listAssetLibrary`/`deleteAssetLibraryItems`：**保留**（避免删引用导致编译错误），标注 `@deprecated`

---

## 数据流（改造后）

```
生成成功 → transferAsset/uploadBase64 → COS 持久 URL
  ├→ saveSeries/saveEpisode → 业务表 JSON 列（供生成/展示）  [原有，不变]
  └→ recordMediaAsset → POST /api/data/media-assets → media_assets 表  [新增双写]

资产库页面 / AssetPicker
  → GET /api/data/media-assets → media_assets 表  [替换原聚合接口]

资产库删除
  → DELETE /api/data/media-assets → 只删 media_assets 记录  [替换原清 JSON 逻辑]

资产库添加
  → 上传 COS / 粘贴 URL → POST /api/data/media-assets  [全新功能]
```

---

## 边界与失败模式

1. **双写失败**：`recordMediaAsset` 内部 try/catch，失败仅 `console.warn`，不阻断生成主流程。代价：该资产不会出现在资产库，但业务表正常。可接受。
2. **迁移重复执行**：靠 `settings.media_assets_migrated` 标记位防止；即使标记丢失，`INSERT OR IGNORE` 按 id 去重也安全。
3. **URL 重复**：同一媒体可能被记录多次（如重新生成覆盖 URL）。新表不做 URL 唯一约束（允许同一 URL 多条记录，因 entityName/source 可能不同）。如需去重可在资产库展示层按 URL 去重，但会丢失不同来源标注，**默认不去重**。
4. **手动添加的 URL 非 COS**：粘贴 URL 模式不强制 COS，若填了临时 URL（24h 失效），资产库会展示失效链接。**在弹窗文案提示"建议粘贴 COS 持久 URL"**，不强制校验。
5. **删除不影响业务表**：资产库删除某条图片记录，业务表（如 series.character_settings）的 imageUrl 仍在。这是预期行为（账本与业务解耦）。需在删除确认弹窗文案调整说明，去掉"会同时删除本地文件"的表述。
6. **企划/剧集删除**：业务表删除后，`media_assets` 里 `series_id`/`episode_id` 指向已不存在的记录（孤儿数据）。符合"独立账本"定位，资产库仍能展示这些历史资产（seriesTitle 已冗余存储）。可接受。

---

## 验证步骤

1. **类型检查**：`npm run build`（或项目 typecheck 命令）通过，无 TS 错误。
2. **迁移**：删除 `data/mojian-dev.db`（或保留旧库），启动 `npm run dev`：
   - 首次启动触发迁移，检查 `media_assets` 表行数 = 现有 series/episodes 媒体总数
   - `settings` 表出现 `media_assets_migrated = "1"`
   - 重启不重复迁移
3. **资产库读取**：访问 `/assets`，列表内容与改造前一致（迁移数据），排序按 `created_at` 降序。
4. **生成双写**：
   - 在人物设定页生成形象图 → 资产库出现该图片（refresh 后）
   - 在剧集 Step3 生成资产图 → 资产库出现
   - 在剧集 Step4 生成视频 → 资产库出现视频
   - 生成音色 → 资产库出现音频
   - 检查 `created_at` 为真实生成时间，非借用 updatedAt
5. **资产库添加**：
   - 点"添加资产" → 上传本地图片 → 资产库出现，source 标记为 manual
   - 粘贴一个已有 COS URL → 资产库出现
   - 不选企划 → seriesId/seriesTitle 为空，资产库"全部企划"下可见
6. **资产库删除**：
   - 单删/多删 → `media_assets` 记录删除，业务表对应 URL **仍在**（验证解耦）
7. **AssetPicker**：
   - 图片生成弹框"从资产库选" → 能拉到新表数据，选中后 URL 正确写入参考图
   - 视频卡片首帧/参考图从资产库选 → 正常
8. **过滤**：企划/媒体类型/实体类型三维过滤正常工作。
9. **桌面端**：`npm run electron:dev` 确认 Electron 环境同样可用。

---

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `lib/db.ts` | 修改 | 建表 + 迁移函数 |
| `lib/types.ts` | 修改 | 新增 `MediaAsset` 接口 |
| `lib/api-client.ts` | 修改 | 新增 `listMediaAssets`/`addMediaAsset`/`deleteMediaAssets` |
| `lib/media-asset-recorder.ts` | **新建** | `recordMediaAsset` helper（或并入 storage.ts） |
| `app/api/data/media-assets/route.ts` | **新建** | GET/POST/DELETE 接口 |
| `app/series/[id]/characters/page.tsx` | 修改 | 形象图/音色/上传成功后双写 |
| `app/series/[id]/objects/page.tsx` | 修改 | 物品形象图双写 |
| `app/series/[id]/scenes/page.tsx` | 修改 | 场景形象图双写 |
| `app/episode/[id]/page.tsx` 或子组件 | 修改 | Step3 资产图/Step4 视频/截屏双写 |
| `components/AssetLibrary.tsx` | 修改 | 数据源切换 + "添加资产"弹窗 |
| `components/AssetPicker.tsx` | 修改 | 数据源切换 |
| `app/api/data/assets/route.ts` | 不动 | 保留作回退 |

> 如偏好把 `recordMediaAsset` 并入现有 `lib/storage.ts` 而非新建文件，可在实现时调整（减少文件数）。
