# 统一图片/视频默认供应商与默认模型操作动线

## Summary

将图片和视频的「默认供应商 + 默认模型」选择流程从当前的「默认参数编辑器里跨供应商 ModelPicker 选择」改为与对话 API 一致的「供应商按钮 + 模型列表星标」模式。同时移除首次生成时自动落盘默认模型的逻辑。

## Current State Analysis

### 对话 API（基准流程，[page.tsx](file:///c:/code/mojian/app/settings/page.tsx)）
- **默认供应商**：供应商按钮点击切换，`DefaultProviderStar` 星标显示在当前供应商上（[L1193-1210](file:///c:/code/mojian/app/settings/page.tsx#L1193-1210)）
- **默认模型**：`ModelManagerPanel` 内星标按钮设定，限当前供应商（[L2045-2063](file:///c:/code/mojian/app/settings/page.tsx#L2045-2063)），`canSetDefault` 为 true（[L1975](file:///c:/code/mojian/app/settings/page.tsx#L1975)））
- **切换供应商时**：`handleProviderChange`（[L357-389](file:///c:/code/mojian/app/settings/page.tsx#L357-389)）调用 `getDefaultModelValue` 解析默认模型，写回 `isDefault` 标记，同步 `model` 状态
- **设默认模型**：`handleSetDefaultLLMModel`（[L433-438](file:///c:/code/mojian/app/settings/page.tsx#L433-438)）标记 `isDefault` + 保存 + `setModel(value)` 同步当前模型

### 图片（不一致流程）
- **默认供应商**：星标仅表示「当前编辑的供应商」，与默认模型所属供应商解耦（[L1317-1334](file:///c:/code/mojian/app/settings/page.tsx#L1317-1334)）
- **默认模型**：在独立的 `DefaultImageConfigEditor` 里通过 `ModelPicker` 跨供应商选择（[L2540-2546](file:///c:/code/mojian/app/settings/page.tsx#L2540-2546)）
- **切换供应商时**：`handleImageProviderChange`（[L469-494](file:///c:/code/mojian/app/settings/page.tsx#L469-494)）直接 `setImageModels`，**无 `isDefault` 标记**，无 `getDefaultModelValue` 调用
- **无 `handleSetDefaultImageModel`**：`canSetDefault` 为 false（[L1975](file:///c:/code/mojian/app/settings/page.tsx#L1975)），模型管理面板无星标按钮

### 视频（与图片同构）
- 与图片一样：星标仅表示当前编辑供应商，默认模型在 `DefaultVideoConfigEditor` 里跨供应商选（[L2660-2666](file:///c:/code/mojian/app/settings/page.tsx#L2660-2666)）
- `handleVideoProviderChange`（[L591-614](file:///c:/code/mojian/app/settings/page.tsx#L591-614)）无 `isDefault` 标记，视频无 `vidSettings.model` 字段，默认模型仅存于 `defaultVideoConfig.model`

### 首次生成自动落盘（需移除）
- 图片：`saveDefaultAssetImageConfigIfEmpty`（[image-client.ts L125-133](file:///c:/code/mojian/lib/image-client.ts#L125-133)），调用点 [L252-253](file:///c:/code/mojian/lib/image-client.ts#L252-253)
- 视频：`saveDefaultShotVideoConfigIfEmpty`（[video-client.ts L165-173](file:///c:/code/mojian/lib/video-client.ts#L165-173)），调用点 [L350](file:///c:/code/mojian/lib/video-client.ts#L350)

### 关键差异
| 维度 | 对话/音频/音乐 | 图片/视频 |
|---|---|---|
| 供应商星标含义 | 默认模型所属供应商 | 仅当前编辑供应商 |
| 默认模型选择入口 | ModelManagerPanel 星标（限当前供应商） | 独立编辑器 + 跨供应商 ModelPicker |
| 切换供应商时标记默认 | 是（`getDefaultModelValue` + `isDefault`） | 否 |
| `canSetDefault` | true | false |
| 首次生成自动落盘 | 无 | 有（`saveDefault...IfEmpty`） |

### 生成流程对默认模型的消费
- 图片：`AssetPreparation.tsx` [L600](file:///c:/code/mojian/components/AssetPreparation.tsx#L600) 读取 `defaultImageConfig`（含 `.model` + `.provider`）作为生成配置基座
- 视频：`VideoGeneration.tsx` [L694-701](file:///c:/code/mojian/components/VideoGeneration.tsx#L694-701) 读取 `defaultVideoConfig.model` + `.provider` 解析能力并构建配置

## Proposed Changes

### 文件 1：`app/settings/page.tsx`

#### 1.1 `handleImageProviderChange`（[L469-494](file:///c:/code/mojian/app/settings/page.tsx#L469-494)）— 对齐对话 API

参照 `handleProviderChange`（[L357-389](file:///c:/code/mojian/app/settings/page.tsx#L357-389)）与 `handleAudioProviderChange`（[L690-711](file:///c:/code/mojian/app/settings/page.tsx#L690-711)）的模式：

- 保留：provider 缓存落盘（L474-476）、setImgSettings 切换 provider/baseURL/apiKey
- **修改模型解析逻辑**：将 `model: cached?.model ?? fbModel`（L481）改为对话 API 模式：
  ```ts
  const loadedModels = await getImageModels(p);
  const cachedModel = cached?.model;
  const resolvedModel =
    (cachedModel && loadedModels.some((m) => m.value === cachedModel))
      ? cachedModel
      : (getDefaultModelValue(loadedModels) ?? fbModel);
  const modelsWithDefault = loadedModels.map((m) => ({ ...m, isDefault: m.value === resolvedModel }));
  ```
- **写回带 `isDefault` 标记的模型列表**：`setImageModels(modelsWithDefault)`
- **同步 `defaultImageConfig`**：调用 `updateDefaultImageConfig({ model: resolvedModel, provider: p })` 使默认生成参数跟随当前供应商+默认模型
- 保留 `setImageOptions(await getAllConfiguredImageModels())`（生成流程仍需聚合列表）

#### 1.2 新增 `handleSetDefaultImageModel`（在图片模型管理区，参照 `handleSetDefaultLLMModel` [L433-438](file:///c:/code/mojian/app/settings/page.tsx#L433-438) 与 `handleSetDefaultAudioModel` [L766-769](file:///c:/code/mojian/app/settings/page.tsx#L766-769)）

```ts
async function handleSetDefaultImageModel(value: string) {
  const updated = imageModels.map((m) => ({ ...m, isDefault: m.value === value }));
  setImageModels(updated);
  await saveImageModels(imgSettings.provider, updated);
  updateImg("model", value);
  await updateDefaultImageConfig({ model: value, provider: imgSettings.provider });
}
```

#### 1.3 `handleVideoProviderChange`（[L591-614](file:///c:/code/mojian/app/settings/page.tsx#L591-614)）— 对齐对话 API

视频无 `vidSettings.model`，以 `defaultVideoConfig.model` + `.provider` 作为默认模型唯一来源：

- 保留：provider 缓存落盘（L596-598）、setVidSettings 切换 provider/baseURL/apiKey
- **新增模型解析**：
  ```ts
  const loadedModels = await getVideoModels(p);
  const cachedModel = defaultVideoConfig.provider === p ? defaultVideoConfig.model : undefined;
  const resolvedModel =
    (cachedModel && loadedModels.some((m) => m.value === cachedModel))
      ? cachedModel
      : getDefaultModelValue(loadedModels) ?? "";
  const modelsWithDefault = loadedModels.map((m) => ({ ...m, isDefault: m.value === resolvedModel }));
  setVideoModels(modelsWithDefault);
  ```
- **同步 `defaultVideoConfig`**：`await updateDefaultVideoConfig({ model: resolvedModel, provider: p })`
- 保留 `setVideoOptions(await getAllConfiguredVideoModels())`

#### 1.4 新增 `handleSetDefaultVideoModel`

```ts
async function handleSetDefaultVideoModel(value: string) {
  const updated = videoModels.map((m) => ({ ...m, isDefault: m.value === value }));
  setVideoModels(updated);
  await saveVideoModels(vidSettings.provider, updated);
  await updateDefaultVideoConfig({ model: value, provider: vidSettings.provider });
}
```

#### 1.5 `ModelManagerPanel` 的 `canSetDefault`（[L1975](file:///c:/code/mojian/app/settings/page.tsx#L1975)）

```ts
// 旧
const canSetDefault = (modelType === "llm" || modelType === "audio" || modelType === "music") && !!onSetDefault;
// 新
const canSetDefault = (modelType === "llm" || modelType === "audio" || modelType === "music" || modelType === "image" || modelType === "video") && !!onSetDefault;
```

#### 1.6 「默认」文字徽标条件（[L2025](file:///c:/code/mojian/app/settings/page.tsx#L2025)）

```ts
// 旧
{m.isDefault && (modelType === "audio" || modelType === "music") && (
// 新
{m.isDefault && (modelType === "audio" || modelType === "music" || modelType === "image" || modelType === "video") && (
```

#### 1.7 图片 `ModelManagerPanel` 调用（[L1359-1373](file:///c:/code/mojian/app/settings/page.tsx#L1359-1373)）

新增 `onSetDefault` 与 `currentModel` props：
```tsx
<ModelManagerPanel
  models={imageModels}
  modelType="image"
  provider={imgSettings.provider}
  currentModel={imgSettings.model}          // 新增
  builtInValues={...}
  ...
  onSetDefault={handleSetDefaultImageModel}  // 新增
  ...
/>
```

#### 1.8 视频 `ModelManagerPanel` 调用（[L1508-1523](file:///c:/code/mojian/app/settings/page.tsx#L1508-1523)）

```tsx
<ModelManagerPanel
  models={videoModels}
  modelType="video"
  provider={vidSettings.provider}
  currentModel={defaultVideoConfig.model}    // 新增
  builtInValues={...}
  ...
  onSetDefault={handleSetDefaultVideoModel}  // 新增
  ...
/>
```

#### 1.9 移除 `DefaultImageConfigEditor` 的「默认模型」行（[L2538-2547](file:///c:/code/mojian/app/settings/page.tsx#L2538-2547)）

删除整个「默认模型」`ModelPicker` 行（保留分辨率、宽高比、画质等其他参数行）。

同步移除组件签名中的 `imageOptions` prop 及其 JSDoc（[L2484-2489](file:///c:/code/mojian/app/settings/page.tsx#L2484-2489)），以及调用处传入的 `imageOptions={imageOptions}`。

#### 1.10 移除 `DefaultVideoConfigEditor` 的「默认模型」行（[L2658-2667](file:///c:/code/mojian/app/settings/page.tsx#L2658-2667)）

删除整个「默认模型」`ModelPicker` 行。同步移除组件签名中的 `videoOptions` prop 及调用处传入。

#### 1.11 `handleDeleteImageModel`（[L526-533](file:///c:/code/mojian/app/settings/page.tsx#L526-533)）联动同步

当被删除的模型是当前默认模型时，切换到第一个模型并同步 `defaultImageConfig`：
```ts
async function handleDeleteImageModel(value: string) {
  const updated = imageModels.filter((m) => m.value !== value);
  setImageModels(updated);
  await saveImageModels(imgSettings.provider, updated);
  if (imgSettings.model === value && updated.length > 0) {
    const nextModel = getDefaultModelValue(updated) ?? updated[0].value;
    updateImg("model", nextModel);
    await updateDefaultImageConfig({ model: nextModel, provider: imgSettings.provider });
  }
}
```
（注：将 `updated[0].value` 改为 `getDefaultModelValue(updated)` 以优先尊重残留的 `isDefault` 标记）

#### 1.12 `handleRefreshImageModels`（[L554-560](file:///c:/code/mojian/app/settings/page.tsx#L554-560)）联动同步

刷新内置模型后，若当前模型不在列表中，同步 `defaultImageConfig`：
```ts
if (!merged.some((m) => m.value === imgSettings.model) && merged.length > 0) {
  const nextModel = getDefaultModelValue(merged) ?? merged[0].value;
  updateImg("model", nextModel);
  await updateDefaultImageConfig({ model: nextModel, provider: imgSettings.provider });
}
```

#### 1.13 `handleDeleteVideoModel`（[L633-637](file:///c:/code/mojian/app/settings/page.tsx#L633-637)）联动同步

视频当前无 `vidSettings.model`，以 `defaultVideoConfig.model` 判断：
```ts
async function handleDeleteVideoModel(value: string) {
  const updated = videoModels.filter((m) => m.value !== value);
  setVideoModels(updated);
  await saveVideoModels(vidSettings.provider, updated);
  if (defaultVideoConfig.model === value && updated.length > 0) {
    const nextModel = getDefaultModelValue(updated) ?? updated[0].value;
    await updateDefaultVideoConfig({ model: nextModel, provider: vidSettings.provider });
  }
}
```

#### 1.14 `handleRefreshVideoModels`（[L658-660](file:///c:/code/mojian/app/settings/page.tsx#L658-660)）联动同步

```ts
async function handleRefreshVideoModels() {
  const merged = await refreshBuiltInVideoModels(vidSettings.provider);
  setVideoModels(merged);
  if (!merged.some((m) => m.value === defaultVideoConfig.model) && merged.length > 0) {
    const nextModel = getDefaultModelValue(merged) ?? merged[0].value;
    await updateDefaultVideoConfig({ model: nextModel, provider: vidSettings.provider });
  }
}
```

#### 1.15 页面载入时为图片/视频模型列表标记 `isDefault`

在初始化加载（[L286](file:///c:/code/mojian/app/settings/page.tsx#L286) 图片、[L305](file:///c:/code/mojian/app/settings/page.tsx#L305) 视频）后，为模型列表写入 `isDefault` 标记，确保星标在首次进入页面时正确显示：

```ts
// 图片（L286 附近）
const imgModels = await getImageModels(imgProvider);
const imgDefault = imgSettings.model || getDefaultModelValue(imgModels) || "";
setImageModels(imgModels.map((m) => ({ ...m, isDefault: m.value === imgDefault })));

// 视频（L305 附近）
const vidModels = await getVideoModels(vidProvider);
const vidDefault = defaultVideoConfig.model || getDefaultModelValue(vidModels) || "";
setVideoModels(vidModels.map((m) => ({ ...m, isDefault: m.value === vidDefault })));
```

#### 1.16 清理：`imageOptions` / `videoOptions` 状态

若 `imageOptions` / `videoOptions` 在移除 ModelPicker 后不再被设置页其他地方引用，可移除其 state 声明及所有 `setImageOptions` / `setVideoOptions` 调用。执行前先 Grep 确认无其他引用。

### 文件 2：`lib/image-client.ts`

#### 2.1 移除 `saveDefaultAssetImageConfigIfEmpty`（[L125-133](file:///c:/code/mojian/lib/image-client.ts#L125-133)）

删除函数定义及其 JSDoc。

#### 2.2 移除调用点（[L252-253](file:///c:/code/mojian/lib/image-client.ts#L252-253)）

删除 `generateImage` 内的调用：
```ts
// 删除这两行
// 首次生成时把当前选用模型落盘为默认（用户未主动设置默认模型时生效一次）
await saveDefaultAssetImageConfigIfEmpty(cfg);
```

#### 2.3 更新 `getDefaultAssetImageConfig` 的 JSDoc（[L108-112](file:///c:/code/mojian/lib/image-client.ts#L108-112)）

移除「模型字段仍优先取模型列表中的「默认」星标」的过时注释（模型现在由供应商面板星标驱动，编辑器内不再选模型）。

### 文件 3：`lib/video-client.ts`

#### 3.1 移除 `saveDefaultShotVideoConfigIfEmpty`（[L165-173](file:///c:/code/mojian/lib/video-client.ts#L165-173)）

删除函数定义及其 JSDoc。

#### 3.2 移除调用点（[L350](file:///c:/code/mojian/lib/video-client.ts#L350)）

删除视频创建流程内的 `await saveDefaultShotVideoConfigIfEmpty(...)` 调用及其注释。

## Assumptions & Decisions

1. **默认模型来源**：图片用 `imgSettings.model`（已缓存 per-provider，与对话 API `model` 状态同构）；视频无 `vidSettings.model`，用 `defaultVideoConfig.model` + `.provider` 作为唯一来源。
2. **`defaultImageConfig.model` + `.provider` 保留为存储字段**：生成流程（AssetPreparation / VideoGeneration）继续读这两个字段，无需改动生成侧。在供应商切换/星标变更时由设置页主动同步。
3. **保留 `getDefaultModelValue` 的 `models[0]` 兜底**：与对话 API 一致，切换到无星标模型的供应商时取列表首个为默认。
4. **`imageOptions` / `videoOptions`**：设置页内仅 ModelPicker 使用；生成侧自行调用 `getAllConfiguredImageModels()` / `getAllConfiguredVideoModels()` 获取，不依赖设置页 state。移除后不影响生成流程。
5. **`ModelPicker` 组件**：若移除两处使用后无其他引用，可保留组件定义不删除（避免过度清理）。
6. **跨供应商默认模型能力丢失**：统一后默认模型绑定当前供应商，不再支持「供应商 A 的模型作为供应商 B 的默认」——这与对话 API 行为一致，符合用户「统一操作动线」诉求。

## Verification

1. **TypeScript 类型检查**：`npx tsc --noEmit` 无报错
2. **设置页交互验证**：
   - 图片/视频供应商按钮星标随切换移动（与对话 API 一致）
   - 图片/视频 `ModelManagerPanel` 出现星标按钮，点击可切换默认模型
   - 默认模型切换后，「默认」徽标 + 星标跟随移动
   - `DefaultImageConfigEditor` / `DefaultVideoConfigEditor` 不再有「默认模型」行，其他参数行正常
3. **生成流程验证**：
   - 图片生成弹框打开时，使用当前星标默认模型（非空）
   - 视频镜头生成时，使用当前星标默认模型
4. **首次生成不再自动落盘**：删除 `saveDefault...IfEmpty` 后，生成时不再触发默认模型自动持久化（默认模型仅由用户在设置页星标设定）
5. **切换供应商后默认模型正确**：切换到已有缓存的供应商恢复缓存模型；切换到新供应商取 `getDefaultModelValue` 兜底
6. **删除/刷新模型联动**：删除当前默认模型或刷新内置列表后，默认模型自动切换并同步 `defaultImageConfig` / `defaultVideoConfig`
