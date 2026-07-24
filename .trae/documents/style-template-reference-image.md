# 风格模板参考图功能实现计划

## Summary

为风格模板的人物/场景/物品提示词模板新增「参考图」能力：每类模板可上传图片、粘贴 URL 或用生成图片弹框生成一张风格参考图。在人物设定、场景设定、物品设定和资产准备中生成图片时，若当前风格模板配有参考图，则默认以该图作为风格参考，提示词自动拼接固定句 `请严格参考此@图片1风格。生成图片。`，参考图作为 `图片1` 一并提交给生图 API。文字模板与参考图可同时启用（非互斥），用户也可单独关闭参考图模式（兼容不支持图参考的模型）。故事板模板暂不接入。

## Current State Analysis

- `StylePreset`（[types.ts:158-170](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts#L158-L170)）仅含四类**文字**模板，无参考图字段。
- 风格模板页 [style-templates/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/style-templates/page.tsx) 仅提供文本编辑，自动保存到全局存储；无图片处理能力。
- `getAssetTemplate(type, seriesSettings)`（[style-settings.ts:133](file:///Users/hehuajiu/Workbuddy/mojian/lib/style-settings.ts#L133)）按类型返回文字模板字符串。
- `ImageGenerationDialog`（[ImageGenerationDialog.tsx:72](file:///Users/hehuajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx#L72)）接收 `styleTemplate`（文字）和受控 `images`/`imageLabels`；通过 `mentionValues`（`图片N`）实现 `@图片N` 提及；`handleConfirm` 做未使用参考图检测与重编号。当前 4 个调用方（人物/场景/物品/资产准备）均不传 `imageLabels`，故参考图统一用 `图片N` 位置标签。
- 生图 API（[image/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/image/route.ts)）将参考图放入 `image`（Seedream）/ `image_urls`（APIMart），模型按提示词中 `图片N` 按上传顺序指代（见 [sd2.0prompt.md](file:///Users/hehuajiu/Workbuddy/mojian/docs/sd2.0prompt.md)）。
- 调用方在 `onConfirm` 中仅将 `params.images` 用于本次生图（`generateImage`），不会写回角色 `referenceImages`；`onImagesChange` 才持久化到角色设定。因此模板参考图若只在弹框内部组合、不经由 `onImagesChange`，就不会污染角色设定数据。

## Proposed Changes

### 1. `lib/types.ts` — 扩展 StylePreset

在 `StylePreset` 接口新增三个可选字段（单张参考图 URL，COS 持久 URL）：

```typescript
/** 人物参考图 URL（风格参考，生图时作为图片1引用） */
characterReferenceImage?: string;
/** 场景参考图 URL */
sceneReferenceImage?: string;
/** 物品参考图 URL */
objectReferenceImage?: string;
```

故事板不接入，不加字段。字段可选，旧数据自动兼容（`undefined` 即无参考图）。

### 2. `lib/style-settings.ts` — 新增取值函数

- `createEmptyTemplate`（[style-settings.ts:48](file:///Users/hehuajiu/Workbuddy/mojian/lib/style-settings.ts#L48)）：复制 source 时带上三个新字段（`source?.characterReferenceImage ?? undefined` 等），新建时为 `undefined`。
- 新增 `getAssetReferenceImage(type, seriesSettings?)`，与 `getAssetTemplate` 对称，返回 `Promise<string | undefined>`：

```typescript
export async function getAssetReferenceImage(
  type: AssetType,
  seriesSettings?: StyleSettings | null
): Promise<string | undefined> {
  const style = await getActiveStyle(seriesSettings);
  switch (type) {
    case "character": return style.characterReferenceImage;
    case "scene": return style.sceneReferenceImage;
    case "object": return style.objectReferenceImage;
    default: return undefined;
  }
}
```

- `styleToText` / `styleTemplateForType` 不变（参考图不影响 LLM 文本上下文）。

### 3. `app/style-templates/page.tsx` — 模板页参考图管理

为人物/场景/物品三个模板字段各增加一个「参考图」区域（故事板不加）。每区域支持三种来源 + 移除：

**新增依赖与状态**（参照 characters 页）：
- `getImageSettings, getAllConfiguredImageModels, DEFAULT_ASSET_IMAGE_CONFIG, getDefaultAssetImageConfig, generateImage` from `@/lib/image-client`
- `isCosConfigured, transferAsset, uploadRefFile` from `@/lib/cos-client`
- `ImageGenerationDialog` 组件
- 状态：`imageConfigured`, `cosConfigured`, `imageOptions`, `defaultImageConfig`（初始化逻辑同 characters 页）
- 生成弹框状态：`genField`（`"characterReferenceImage" | "sceneReferenceImage" | "objectReferenceImage" | null`）、`genOpen`、`genInitialPrompt`、`genConfig`、`genImages`、`generatingRef`

**参考图区域 UI**（每个模板字段 textarea 下方）：
- 有图：显示缩略图 + 「风格参考」标记 + 按钮「重新生成 / 上传 / 替换URL / 移除」
- 无图：按钮「上传图片 / 添加URL / 生成图片」

**三种来源处理**：
- 上传图片：`uploadRefFile(file, "style-ref-" + field)` → `updateField(field, url)`
- 添加URL：内联 input + 确认按钮，直接 `updateField(field, url)`（不做 COS 转存，baseUrl 假定为持久 URL）
- 生成图片：点击后 `setGenField(field)`，`setGenInitialPrompt(对应文字模板)`，`setGenOpen(true)`；弹框 `onConfirm` 中调用 `generateImage` → 成功后 `transferAsset` 转存 COS → `updateField(genField, url)`
  - 弹框不传 `templateReferenceImage`、不传 `styleTemplate`（纯生成一张新图）
  - `genImages` 受控为空数组（生成参考图本身不需要再带参考图）

**`updateField` 调整**：当前签名 `updateField(field: keyof Omit<StylePreset, "id">, value: string)` 已能覆盖新字段，无需改类型。

### 4. `components/ImageGenerationDialog.tsx` — 核心弹框逻辑

**新增 prop**：`templateReferenceImage?: string`

**新增常量**：
```typescript
const STYLE_REFERENCE_PHRASE = "请严格参考此@图片1风格。生成图片。";
```

**新增状态**：`useImageRef`（boolean），表示是否启用模板参考图模式。

**关键派生值**（用「有效图片」概念，模板参考图不进入父组件 `images`，仅在弹框内组合）：
```typescript
const baseLabels = imageLabels ?? images.map(() => "");
const effectiveImages = useImageRef && templateReferenceImage
  ? [templateReferenceImage, ...images]
  : images;
const effectiveLabels = useImageRef && templateReferenceImage
  ? ["图片1", ...baseLabels]
  : baseLabels;
const mentionValues = effectiveImages.map((_, i) => effectiveLabels[i] || `图片${i + 1}`);
```
- 全文将原 `images`/`mentionValues` 用于展示/提及/确认处，改为 `effectiveImages`/`mentionValues`（派生）。
- `maxRefImages` 限额检查基于 `effectiveImages.length`。

**打开时初始化**（修改 `[open, ...]` effect）：
- 若 `templateReferenceImage` 存在：`useImageRef=true`、`useTemplate=false`、`prompt = initialPrompt + "，" + STYLE_REFERENCE_PHRASE`
- 否则若 `styleTemplate` 存在：维持原逻辑（`useTemplate=true`，`prompt = initialPrompt + "，" + styleTemplate`）
- 否则：`prompt = initialPrompt`

**互斥切换 UI**（在提示词下方，原「附带风格设定模板」checkbox 相邻位置）：
- 当 `templateReferenceImage` 存在时，显示「使用参考图（风格参考）」checkbox，`checked={useImageRef}`。
- 切换 `useImageRef=true`：`setUseTemplate(false)` → 移除 prompt 末尾 `，${styleTemplate}`（若存在）→ 追加 `，${STYLE_REFERENCE_PHRASE}`（若不存在）。
- 切换 `useImageRef=false`：移除 prompt 末尾 `，${STYLE_REFERENCE_PHRASE}`（若存在）。
- 原「附带风格设定模板」checkbox 的 onChange 增加：勾选时 `setUseImageRef(false)` → 移除 `，${STYLE_REFERENCE_PHRASE}` → 追加 `，${styleTemplate}`。（即两者互斥）
- 后缀增删复用现有「判断是否已 endWith 后缀」的写法，保证可重复切换不重复拼接。

**参考图缩略图区**（参考图上传 UI）：
- 遍历 `effectiveImages`：当 `useImageRef && i===0` 时，该格为模板参考图，显示「风格参考」角标、**不渲染移除按钮**（移除由 toggle 控制）；其余格保留原移除按钮。
- 移除逻辑 `removeImage(effectiveIndex)`：若 `useImageRef && effectiveIndex===0` 直接 return；否则映射到父组件 `images` 的下标（`useImageRef ? effectiveIndex-1 : effectiveIndex`）后过滤 `images`/`imageLabels`。
- 上传/资产库追加仍 append 到父组件 `images`（`appendImages` 不变），有效图片自动含模板图。
- `images.length < maxRefImages` 的上传/资产库按钮可见性判断改为 `effectiveImages.length < maxRefImages`。

**`handleConfirm`**：
- `base = keepMentionPrefix ? prompt : resolveMentions(prompt, mentionValues)`（已用派生 `mentionValues`，`@图片1` → `图片1`）。
- 未使用检测、重编号均基于 `effectiveImages`/`mentionValues`。
- `onConfirm` 回传 `images: effectiveImages`（含模板参考图），`imageLabels: effectiveLabels`。
- 模板参考图固定为 `图片1` 且固定句中含 `图片1`，故默认被判定为「已使用」。

### 5. 四个调用方 — 传递 templateReferenceImage

**`app/series/[id]/characters/page.tsx`**（[characters/page.tsx:270](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/page.tsx#L270)）：
- `openGenerateImageDialog` 中除 `getAssetTemplate` 外，再 `const refImage = await getAssetReferenceImage("character", series?.styleSettings ?? null)`，存入新状态 `templateReferenceImage`。
- `<ImageGenerationDialog>` 增加 `templateReferenceImage={templateReferenceImage ?? undefined}`。

**`app/series/[id]/objects/page.tsx`**、**`app/series/[id]/scenes/page.tsx`**：同上，type 分别为 `"object"` / `"scene"`。

**`components/AssetPreparation.tsx`**（[AssetPreparation.tsx:585](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L585) `openGenerateImageDialog`）：
- 同样 `getAssetReferenceImage(asset.type, seriesStyleSettings)`，存入新状态 `genTemplateReferenceImage`。
- `<ImageGenerationDialog>` 增加 `templateReferenceImage={genTemplateReferenceImage ?? undefined}`。
- `onConfirm` 中上传 base64 参考图到 COS 的逻辑不变（`params.images` 现可能含模板参考图 URL，已是 http URL 会被 `img.startsWith("http")` 直接保留，无需转存）。

## Assumptions & Decisions

1. **固定句**：`请严格参考此@图片1风格。生成图片。`，参考图作为 `图片1`（标准 API 约定，用户已确认）。
2. **非互斥共存**：参考图模式与文字模板模式可同时启用（用户已确认）；有参考图时默认两者同时勾选，用户可单独关闭参考图模式。
3. **单张参考图**：每类模板最多一张参考图（用户已确认）。
4. **故事板不接入**：不新增 `storyboardReferenceImage`，故事板生成流程不变（用户已确认）。
5. **设定库取消**：不实现「从设定库添加」，仅保留 上传/URL/生成 三种来源（用户已确认）。
6. **数据隔离**：模板参考图不写入角色/资产 `referenceImages`，仅在弹框内组合为有效图片用于本次生图；`onConfirm` 的 `params.images` 含模板图但仅用于生图，不持久化到设定。
7. **URL 来源不转存**：粘贴的 baseUrl 直接存为参考图 URL（假定持久）；生成来源经 COS 转存（24h 保护）；上传来源经 `uploadRefFile` 落 COS。
8. **向后兼容**：新增字段均可选，旧 `StylePreset` 数据无参考图字段时按 `undefined` 处理，行为等同现有文字模板流程。

## Verification Steps

1. **类型检查**：`npx tsc --noEmit`（或项目既有 typecheck 命令）无报错。
2. **模板页**：
   - 为某模板上传/粘贴URL/生成一张人物参考图，刷新页面后仍在。
   - 移除参考图后字段清空。
3. **生成弹框（有参考图模板）**：
   - 在人物设定点「生成图片」，弹框默认勾选「使用参考图」，提示词含 `，请严格参考此@图片1风格。生成图片。`，缩略图首位显示「风格参考」图且不可单独移除。
   - 切换到「附带风格设定模板」，参考图与固定句消失，文字模板后缀出现；切回则还原。
   - 确认生图，请求体 `image`/`image_urls` 含模板参考图，提示词含 `图片1`。
4. **生成弹框（无参考图模板）**：行为与现状一致（仅文字模板 checkbox）。
5. **资产准备**：同上验证人物/场景/物品三类资产生图均能使用模板参考图。
6. **数据隔离**：生图后角色 `referenceImages` 不含模板参考图 URL。
7. **旧数据兼容**：未配置参考图的既有模板，生成流程不受影响。
