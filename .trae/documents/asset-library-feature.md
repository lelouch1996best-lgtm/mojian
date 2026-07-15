# 资产库功能实现计划

## 摘要

为墨间新增一个**全局资产库**页面（`/assets`），聚合所有企划下生成的图片与视频，支持按「企划」「媒体类型（图片/视频）」「实体类型（人物/物品/场景）」三维过滤，并提供灯箱预览、下载等只读浏览能力。

采用**查询时聚合（query-on-demand）**方案——不新建数据库表、不迁移数据、不修改现有生成流程，而是新增一个后端接口读取现有 `series` + `episodes` 数据，提取所有媒体 URL 及其上下文（所属企划/剧集/实体类型/名称），返回扁平列表；前端做客户端过滤。这与现有「企划为聚合根、设定内嵌 JSON」的架构一致，且无数据同步风险。

---

## 当前状态分析

### 媒体存储现状（无独立资产表）

生成的媒体分散存储在三处，均为 JSON 内嵌：

| 来源 | 存储位置 | 字段 | 媒体类型 |
|------|---------|------|---------|
| 剧集资产图 | `episodes.assets[]` | `imageUrl` + `type`(character/scene/object) + `name` + `status` + `imagePrompt` | 图片 |
| 分镜视频 | `episodes.shots[]` | `videoUrl` + `videoStatus` + `finalPrompt` + `visualDescription` | 视频 |
| 企划设定形象图 | `series.character_settings/object_settings/scene_settings[]` | `imageUrl` + `name` | 图片 |

> 用户上传的参考图（`referenceImages[]`）不计入资产库（非生成内容）。

### 相关现有文件

- 数据库 schema 与迁移：[lib/db.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/db.ts)（`series` / `episodes` / `settings` 三表，`getDb()` 单例，含列迁移模式）
- 类型定义：[lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts)（`Asset` L183、`Shot` L158、`CharacterProfile/ObjectProfile/SceneProfile`、`Series`/`Episode`）
- 后端数据路由（鉴权 + row→对象 模式）：[app/api/data/series/route.ts](file:///Users/heju/Workbuddy/mojian/app/api/data/series/route.ts)、[app/api/data/episodes/route.ts](file:///Users/heju/Workbuddy/mojian/app/api/data/episodes/route.ts)
- 鉴权：[lib/auth.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/auth.ts)（`validateAuth` / `authError`，开发模式跳过）
- 前端 API 客户端：[lib/api-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/api-client.ts)（`apiClient`，Bearer Token）
- 存储封装：[lib/storage.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/storage.ts)（`normalizeSeries` 等）
- 工具函数：[lib/utils.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/utils.ts)（`formatTime`、`ASSET_TYPE_LABELS`）
- 首页（头部导航模式）：[app/home/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/home/page.tsx)
- 列表网格样式参考：[components/SeriesList.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/SeriesList.tsx)
- 图片灯箱（含下载逻辑，可复用）：[components/ImageLightbox.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ImageLightbox.tsx)
- UI 基础组件：`components/ui/`（`Button`、`Modal`、`Spinner`、`Textarea`、`AiOptimizeButton`）

---

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 数据模型 | 查询时聚合，不建新表 | 只读浏览场景；本地工具数据量小；与聚合根架构一致；无数据漂移风险；无需迁移 |
| 资产范围 | 剧集资产图 + 分镜视频 + 企划设定形象图；排除参考图 | 贴合"生成的图片、视频"；参考图为用户上传，非生成 |
| 操作能力 | 只读：预览/下载/复制 URL | 用户表述为"查询/过滤"，只读最简且无一致性风险 |
| 过滤维度 | 企划（下拉）+ 媒体类型（全部/图片/视频）+ 实体类型（全部/人物/物品/场景） | 覆盖用户所述企划/人物/物品/场景，并区分图片视频 |
| 过滤执行 | 客户端过滤 | 数据量小，接口返回全量后前端筛选，交互即时 |
| 入口位置 | 首页头部新增"资产库"按钮 → `/assets` | 与现有"设置"按钮并列，改动最小，无需引入侧边栏 |
| 视频缩略图 | `<video muted preload="metadata">` 显示首帧 + 播放图标覆盖 | 真实预览；点击后在弹窗内 `<video controls>` 播放 |

> 实体类型过滤说明：视频（分镜）的 `entityType` 为 `shot`，不匹配人物/物品/场景，因此选中具体实体类型时视频自动隐藏，仅在"全部"时展示。这是自然行为。

---

## 实现变更

### 1. 新增类型 — `lib/types.ts`

在文件末尾追加 `AssetLibraryItem` 接口：

```typescript
/** 资产库聚合项 — 由后端从 series/episodes 聚合而来，供全局资产库展示 */
export interface AssetLibraryItem {
  id: string;                       // 唯一键，由来源派生（如 `asset-{epId}-{assetId}`）
  mediaType: "image" | "video";
  url: string;                      // 图片/视频 URL（COS 持久 URL）
  seriesId: string;
  seriesTitle: string;
  episodeId?: string;               // 剧集级媒体才有
  episodeTitle?: string;
  entityType: "character" | "scene" | "object" | "shot";
  entityName: string;               // 人物/物品/场景名，或分镜画面描述
  source: "asset" | "shot" | "profile-character" | "profile-object" | "profile-scene";
  prompt?: string;                  // imagePrompt / finalPrompt
  createdAt: number;                // 排序用，取所在 episode/series 的 updatedAt
}
```

### 2. 新增后端聚合接口 — `app/api/data/assets/route.ts`（新文件）

仿照 [app/api/data/series/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/data/series/route.ts) 的鉴权 + `rowToX` 模式：

- `GET`：`validateAuth` → `getDb()`
- 查询全部 `series`，构建 `seriesMap: Map<seriesId, {title, updatedAt}>`
- 遍历每个 series 的 `character_settings` / `object_settings` / `scene_settings`（JSON.parse），对存在 `imageUrl` 的设定生成 `AssetLibraryItem`（`mediaType:"image"`，`entityType` 对应 character/object/scene，`source` 为 `profile-*`，`createdAt` 取 `series.updated_at`）
- 查询全部 `episodes`，遍历：
  - `assets`（JSON.parse）：`status==="ready" && imageUrl` 的项 → 图片项（`source:"asset"`，`entityType` 取 `asset.type`，`entityName` 取 `asset.name`，`prompt` 取 `imagePrompt||description`，`createdAt` 取 `episode.updated_at`）
  - `shots`（JSON.parse）：`videoStatus==="succeeded" && videoUrl` 的项 → 视频项（`source:"shot"`，`entityType:"shot"`，`entityName` 取 `visualDescription` 截断或"镜头"，`prompt` 取 `finalPrompt`，`createdAt` 取 `episode.updated_at`）
- 按 `createdAt` 降序排序
- `return Response.json(items)`

ID 派生规则保证稳定唯一：`profile-{type}-{profileId}`、`asset-{epId}-{assetId}`、`shot-{epId}-{shotId}`。

### 3. 前端 API 客户端 — `lib/api-client.ts`

在 `apiClient` 对象内追加：

```typescript
listAssetLibrary: () => request<AssetLibraryItem[]>("/data/assets"),
```

并在文件顶部 import `AssetLibraryItem` 类型。

### 4. 资产库页面 — `app/assets/page.tsx`（新文件）

"use client" 页面，结构仿 [app/home/page.tsx](file:///Users/heju/Workbuddy/mojian/app/home/page.tsx) 头部：

- 头部：墨间 logo + 分隔线 + "资产库"标题/副标题 + 右侧"返回首页"按钮（`router.push("/")`）
- 主体渲染 `<AssetLibrary />` 组件

### 5. 资产库主组件 — `components/AssetLibrary.tsx`（新文件）

核心交互组件，包含：

**状态**
- `items: AssetLibraryItem[]`、`loading: boolean`
- 过滤状态：`seriesId: string`（"全部"=空）、`mediaType: "all"|"image"|"video"`、`entityType: "all"|"character"|"scene"|"object"`
- 预览状态：`previewItem: AssetLibraryItem | null`（图片走 ImageLightbox，视频走自建模态）

**数据加载**
- `useEffect` 挂载时调用 `apiClient.listAssetLibrary()` 填充 `items`
- 从 `items` 派生去重的企划选项列表 `{id, title}[]`（用于下拉）

**过滤栏**（ sticky 顶部）
- 企划：原生 `<select>`，选项为"全部企划" + 各企划
- 媒体类型：pill 按钮组（全部/图片/视频）
- 实体类型：pill 按钮组（全部/人物/物品/场景）；当 `mediaType==="video"` 时禁用（灰显），因视频无实体类型
- 右侧显示"共 N 项"计数

**网格**
- `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4`
- 每张卡片：
  - 缩略图区：`aspect-square` 容器
    - 图片项：`<img>` + 包裹 `ImageLightbox`（复用现有灯箱，自带下载）
    - 视频项：`<video muted preload="metadata" src={url}>`（首帧）+ 居中播放图标覆盖；点击打开视频模态
  - 信息区：实体名（`line-clamp-1`）+ 类型徽章（人物/物品/场景/镜头，用 `ASSET_TYPE_LABELS` + "镜头"）+ 企划名（`line-clamp-1`，小字灰）+ 来源（"第N集"或"企划设定"）+ `formatTime(createdAt)`
  - 悬停显示「下载」「复制链接」小按钮（复用 ImageLightbox 的下载逻辑思路；视频下载同理 fetch blob）

**视频预览模态**
- 复用 `components/ui/Modal` 或自建固定层：`<video controls autoPlay src={url} className="max-h-[85vh]">` + 关闭按钮 + 下载按钮
- ESC 关闭、禁止滚动（参考 ImageLightbox 实现）

**空状态**
- 无数据：居中提示"暂无生成的资产"
- 有数据但过滤无结果：提示"没有匹配的资产，试试调整筛选条件"

### 6. 首页导航入口 — `app/home/page.tsx`

在头部右侧"设置"按钮**之前**新增"资产库"按钮（`variant="ghost"`，同设置按钮样式），点击 `router.push("/assets")`。图标用一个简洁的网格/图库 SVG。

---

## 假设与决策

1. **只读**：资产库不修改源数据，删除/重生成仍在各编辑步骤内进行。
2. **聚合一致性**：接口实时读取数据库，资产库始终反映最新状态，无需手动刷新表。
3. **性能**：本地 SQLite + 个人数据量（预计数十企划、数百剧集），全量聚合 + 客户端过滤性能足够。
4. **形象图纳入**：企划设定形象图（`imageUrl`）可能由生成或上传而来，统一纳入并以"企划设定"来源标注区分；若后续需严格区分，可扩展 `source` 字段。
5. **视频缩略图**：依赖浏览器 `<video preload="metadata">` 渲染首帧；COS 视频支持 range 请求，可正常取首帧。
6. **不引入新依赖**：全部使用现有技术栈（原生 select、自建 pill 按钮、现有 UI 组件）。

---

## 验证步骤

1. **类型检查**：`npm run build`（或项目已有的 typecheck 命令）通过，无 TS 错误。
2. **启动开发**：`npm run dev`，访问 `http://localhost:3000/home`，确认头部出现"资产库"按钮。
3. **入口**：点击"资产库"跳转 `/assets`，页面正常渲染。
4. **数据聚合**：
   - 在已有含生成图片/视频的企划中，确认资产库列出对应媒体。
   - 确认图片项来源标注"第N集"或"企划设定"，视频项标注"镜头"。
5. **过滤**：
   - 切换企划下拉，仅显示该企划媒体。
   - 切换媒体类型为"图片"→ 只见图片；"视频"→ 只见视频，且实体类型筛选禁用。
   - 切换实体类型为"人物"→ 仅人物图片（视频隐藏）；"物品"/"场景"同理。
6. **预览**：
   - 点击图片→ ImageLightbox 放大，可下载、ESC 关闭。
   - 点击视频→ 模态播放，controls 可用，可下载、ESC 关闭。
7. **空状态**：新建空企划后访问资产库，或选择无媒体的企划，显示友好空状态。
8. **桌面端**：`npm run electron:dev` 确认 Electron 环境下同样可用（鉴权在开发模式跳过）。
