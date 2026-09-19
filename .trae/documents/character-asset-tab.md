# 人物设定详情页新增「人物资产」Tab

## 概述

在人物设定详情弹框（`CharacterDetailModal`）的「基础信息」和「关联」之间新增「人物资产」页签。该页签展示一组人物资产图片，支持：

- **上传**本地图片（复用现有 COS 上传链路）
- **生成**图片：点击生成打开已有的 `ImageGenerationDialog`，自动把详情页主图（`character.imageUrl`）作为参考图带入，提示词可编辑（弹框已支持，通过 `initialPrompt` 参数控制）
- **删除**单张资产图片、点击放大预览（复用 `ImageLightbox`）

## 现状分析

- 详情弹框 [CharacterDetailModal.tsx](e:\code\mojian\components\CharacterDetailModal.tsx) 目前只有 `basic` / `relations` 两个 tab；所有生图/上传动作通过 props 回调交给父页面 [characters/page.tsx](e:\code\mojian\app\series\[id]\characters\page.tsx) 处理。
- 父页面已有一个共享的 `ImageGenerationDialog` 实例（`configOpen` / `genTargetId` / `refImages` / `genInitialPrompt` 等状态），确认后走 `handleGenerateImage` 把结果写入 `character.imageUrl`。
- `CharacterProfile`（[types.ts L38](e:\code\mojian\lib\types.ts)）已有 `imageUrl`、`referenceImages`、`imageTaskId` 等字段；数据整存整取于 series，自动保存机制（防抖 persist）会自动携带新增字段，无需改存储层。
- `generateImage`（[image-client.ts L247](e:\code\mojian\lib\image-client.ts)）的 `onJobCreated` 为可选参数，不传即不落 `imageTaskId`（主图恢复轮询逻辑不受影响）。
- 弹框确认时会过滤「未在提示词中 @ 提及」的参考图，因此自动带入主图时需在初始提示词里包含 `@图片1` 以确保主图参与生成。

## 改动方案

### 1. `lib/types.ts` — 新增字段

`CharacterProfile` 增加可选字段：

```ts
/** 人物资产图 URL 列表（详情页「人物资产」tab 管理，可上传或生成） */
assetImages?: string[];
/** 进行中的资产图生成任务（jobId + provider，切页/刷新后可恢复轮询；同一人物可多个并发） */
assetImageTasks?: { jobId: string; provider: ImageGenSettings["provider"] }[];
```

存储层无需改动（series 整体序列化，旧数据缺省为 undefined，兼容）。

### 2. `app/series/[id]/characters/page.tsx` — 生成/上传/删除逻辑

新增状态与函数：

- `genMode: "main" | "asset"` 状态：区分弹框确认结果是写主图还是追加资产图。
- `generatingAssetIds: Set<string>`、`uploadingAssetIds: Set<string>`：资产生成/上传的 loading 跟踪（与主图的 `generatingImageIds` / `uploadingImageIds` 分开，避免主图区域误显示 loading）。
- `openGenerateAssetImageDialog(char)`：
  - 校验 `imageConfigured`（同主图流程）；
  - 加载风格模板 `getAssetTemplate("character", ...)` / `getAssetReferenceImage`（同 `openGenerateImageDialog`）；
  - `setGenInitialPrompt(char.imageUrl ? "参考@图片1中的人物，" : (char.appearance.trim() || char.name.trim()))` —— 自动 @ 主图，保证确认时主图不被过滤；
  - `setRefImages(char.imageUrl ? [char.imageUrl] : [])` —— 自动带上详情页主图；
  - `setGenMode("asset")`、`setGenTargetId(char.id)`、`setConfigOpen(true)`。
- `handleGenerateAssetImage(char, params)`：结构参考 `handleGenerateImage`，差异：
  - **传 `onJobCreated`**：任务创建后把 `{ jobId, provider }` **追加**到 `char.assetImageTasks`，并用 keepalive fetch 同步落库（同主图流程，避免 SPA 路由切换丢 jobId）；
  - 成功后从 `assetImageTasks` 移除该任务、`assetImages: [...(char.assetImages ?? []), imageUrl]` 追加（不覆盖主图 `imageUrl`）；
  - `recordMediaAsset` 的 `source` 用 `"generated"`（MediaAsset.source 枚举既有值），其余字段同主图流程；
  - loading 用 `generatingAssetIds`；
  - catch 中 AbortError（切页/卸载）**保留任务条目**待恢复，真实失败才移除任务并提示错误（同主图语义）。
- 恢复轮询：现有恢复 effect（依赖 `[dataReady, imageConfigured, imageOptions]`）扩展——entries 在主图条目（key = `c.id`）之外，追加资产任务条目，key 用复合键 `${c.id}::${jobId}`（`recoverImageTasks` 的 key 原样透传回调，支持复合）：
  - 恢复开始时把有待恢复任务的人物加入 `generatingAssetIds`（网格显示占位）；
  - `onDone`：读最新 `charactersRef`，去重判断（该 jobId 仍在 `assetImageTasks` 中，被新数据覆盖则丢弃），移除任务 + 追加 `assetImages` + `saveSeries` + `recordMediaAsset`；
  - `onFailed`：移除该任务并提示错误（取消/切页静默，任务保留待下次恢复）。
- `handleUploadAssetImage(char, file)`：结构参考 `handleUploadImage`，成功后追加到 `assetImages`，`recordMediaAsset` source 用 `"manual"`（枚举既有值）；loading 用 `uploadingAssetIds`。
- `handleRemoveAssetImage(char, url)`：`assetImages` 过滤掉该 url，交给自动保存持久化（无需手动 saveSeries）。
- `handleAddVersion`：新建版本时重置 `assetImages: []`、`assetImageTasks: undefined`（与 `imageUrl` / `referenceImages` 重置行为一致）。
- `handleRefImagesChange`：仅 `genMode === "main"` 时同步到 `character.referenceImages`（资产模式的参考图是临时生成输入，不落设定数据）。
- `lib/character-settings.ts` 的 `isCharacterProfileValid`：有效内容判定补充 `assetImages?.length` 与 `assetImageTasks?.length`。
- `ImageGenerationDialog` 的 `onConfirm` 与 `loading`：按 `genMode` 分支：
  - `asset` 模式调 `handleGenerateAssetImage`，`loading` 看 `generatingAssetIds`；
  - `main` 模式保持现状。
- `CharacterDetailModal` 传入新 props。

### 3. `components/CharacterDetailModal.tsx` — 新增「人物资产」tab

- `type Tab = "basic" | "assets" | "relations"`；页签顺序：基础信息 → **人物资产** → 关联。
- 新 props：
  - `onGenerateAssetImage: () => void`（打开生成弹框）
  - `isGeneratingAsset: boolean`
  - `onUploadAssetImage: (file: File) => void`
  - `isUploadingAsset: boolean`
  - `onRemoveAssetImage: (url: string) => void`
- 「人物资产」面板 UI：
  - 顶部操作行：「生成图片」按钮（副标题提示“自动以主图为参考图”）+「上传图片」按钮 + 隐藏 file input（accept 同主图 png/jpg/webp/gif/bmp）；
  - 图片网格：`grid grid-cols-3 gap-2`，每格 `ImageLightbox` 包裹缩略图（`object-cover`、固定高度如 h-28、圆角边框），hover 右上角显示删除按钮（×）；
  - 生成中：网格末尾显示一个带 `Spinner` 的占位格；
  - 空状态：居中提示“暂无人物资产图，可上传或点击生成”；
  - 未配置图片 API / COS 时沿用父页面的顶部黄条提示，不在弹框内重复校验提示（生成入口在父页面 `openGenerateAssetImageDialog` 已校验）。

## 假设与决策

- **资产图按「版本」存储**（挂在 `CharacterProfile` 记录上，与 `imageUrl` / `referenceImages` 同级），不做 characterId 组级共享 —— 与现有字段模式一致，改动最小。
- 资产生成**做切页恢复**：任务以 `{ jobId, provider }` 列表形式持久化在 `assetImageTasks`，复用 `recoverImageTasks` / `resumeImageGeneration` 恢复链路；`isCharacterProfileValid` 同步纳入 `assetImages` / `assetImageTasks`，避免只有资产图未填名称的记录被自动保存过滤掉。
- 生成弹框自动带入主图采用「初始提示词含 `@图片1` + refImages=[主图]」方式，而非 `templateReferenceImage`（那是风格模板固定句“请严格参考此@图片1风格”，语义不符）。
- 上传的资产图同时记入资产库（`recordMediaAsset`），与现有上传行为一致。

## 验证

1. `npx tsc --noEmit`（或项目等价 type-check）通过（qiniu 既有报错除外）。
2. 手动验证：
   - 打开人物详情 → 三页签顺序为 基础信息 / 人物资产 / 关联；
   - 资产 tab 上传图片 → 网格出现缩略图，可放大、可删除，刷新后仍在（自动保存）；
   - 点生成 → 弹框提示词默认含 `@图片1`，参考图列表第一张是主图，可追加/删除参考图、可改提示词与参数；
   - 确认生成 → 资产网格末尾出现 loading 占位，完成后追加新图，主图未被覆盖；
   - 新建版本 → 资产图为空。
