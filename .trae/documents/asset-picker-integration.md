# 资产库资源选择器集成计划

## 摘要

新增一个通用的「资产选择器」组件 `AssetPicker`（Modal 形式），复用资产库数据（`GET /api/data/assets`），让用户在**图片生成弹框**和**视频生成卡片**中，从资产库挑选已生成的图片/视频作为参考素材，而不必每次从本地上传。

核心设计：
- **复用优先**：资产库项的 `url` 已是 COS 持久公网 URL，选中即用，**无需重新上传**。
- **单一组件**：一个 `AssetPicker` 组件，通过 props 约束可选的媒体类型（图片/视频）与多选/单选模式，适配不同槽位。
- **最小侵入**：在现有上传 UI 旁新增「从资产库选」入口，不改动既有本地上传逻辑与数据结构。

---

## 当前状态分析

### 图片生成 - ImageGenerationDialog
- 文件：[components/ImageGenerationDialog.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx)
- 参考图为受控状态：`images: string[]` + `onImagesChange`（由父组件持有）。
- 上传区位于 L370-435：已有缩略图网格 + "+ 添加"按钮（触发 `fileInputRef` 本地上传）。
- 数量上限 `maxRefImages` 来自模型能力（[L77](file:///Users/hehuajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx#L77)）。
- 该弹框被 Step3 资产准备（[AssetPreparation.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx)）与系列设定页（characters/objects/scenes）共用。
- 参考图最终是 URL 或 base64 data URI 混合存储；库内资源为 URL，可直接放入 `images`。

### 视频生成 - VideoGeneration.tsx
- 文件：[components/VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx)
- 4 类参考槽位，均只能本地上传（`handleUploadRef` -> `uploadRefFile` -> COS URL）：
  1. **首帧图** `config.firstFrameImageUrl`（单值，first-frame / first-last-frame 模式）- L1037-1063，`FrameImageUpload` 组件
  2. **尾帧图** `config.lastFrameImageUrl`（单值，first-last-frame 模式）- L1055-1061，`FrameImageUpload` 组件
  3. **参考图** `config.referenceImageAssetUrls`（数组，multimodal-ref 模式）- L1079-1088，琥珀色标签渲染；**目前无添加入口**（`handleAddAsset` 被注释隐藏）
  4. **参考视频** `config.referenceVideoUrls`（数组，multimodal-ref 模式）- L1091-1101，`MediaUploadArea` 组件
- 写入方式：`onUpdateVideoConfig(patch)` 增量合并到 `shot.videoConfig`。
- 关键约束：`generateVideo` 中参考图合并顺序为 `[...relatedImageUrls, ...config.referenceImageAssetUrls]`，编号与 `@资产名`->`图片N` 替换严格对应。

### 资产库数据
- 接口：`GET /api/data/assets`（[app/api/data/assets/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/data/assets/route.ts)），返回 `AssetLibraryItem[]`。
- 客户端：`apiClient.listAssetLibrary()`（[lib/api-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/api-client.ts#L50)）。
- 关键字段：`id`、`mediaType`（image/video）、`url`（COS 公网 URL）、`seriesTitle`、`entityType`、`entityName`、`source`、`createdAt`。
- 选择器可直接复用此方法拉取全量，客户端按 `mediaType` 过滤。

### 复用 UI 基础
- `components/ui/Modal.tsx`：已有模态组件，支持 `open`/`onClose`/`title`/`children`/`footer`，含 ESC 关闭 + 滚动锁定。
- `components/ui/Spinner.tsx`：加载指示。
- `components/ImageLightbox.tsx`：图片预览。
- 样式：Tailwind，与资产库一致的 `brand`/`warm`/`slate` 色阶。

---

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 选择器形态 | 通用 `AssetPicker` Modal 组件 | 单一组件按 props 适配图片/视频、单选/多选，避免重复实现 |
| 数据获取 | 复用 `apiClient.listAssetLibrary()`，组件内部加载 | 无需新后端接口；库数据量小，每次打开拉取保证最新 |
| 媒体过滤 | 通过 `mediaType` prop 约束（"image"/"video"） | 图片槽位只选图片，视频槽位只选视频，语义清晰 |
| 选择模式 | `multiple` prop（多选图片参考图/参考视频）/ 单选（首尾帧） | 匹配各槽位的数据结构（数组 vs 单值） |
| URL 处理 | 直接使用 `item.url`（COS URL） | 库内已是持久 URL，无需重新上传，与现有本地上传产物形态一致 |
| 去重 | 按 URL 去重，已选的不可重复添加 | 避免同一资源重复占用槽位 |
| 入口位置 | 在各上传区现有「+ 添加/上传」按钮旁新增「资产库」按钮 | 不改动本地上传逻辑，提供并行的库选择路径 |

---

## 实现变更

### 1. 新增 AssetPicker 组件 - `components/AssetPicker.tsx`（新文件）

通用资产选择器 Modal。

**Props 接口：**
```typescript
interface AssetPickerProps {
  open: boolean;
  onClose: () => void;
  /** 可选媒体类型约束 */
  mediaType: "image" | "video";
  /** 多选模式（参考图/参考视频）；false 为单选（首尾帧） */
  multiple?: boolean;
  /** 已选 URL 列表，用于去重与回显（单选时传单个 url 的数组） */
  selectedUrls: string[];
  /** 确认回调，返回本次新选中的 URL 列表（不含已选） */
  onConfirm: (urls: string[]) => void;
  /** 可选：单选模式下最大数量上限（多选时由调用方传入 maxRefImages 等） */
  max?: number;
}
```

**行为：**
- 挂载/打开时调用 `apiClient.listAssetLibrary()`，按 `mediaType` 过滤。
- 顶部过滤栏：企划下拉（从 items 派生）+ 实体类型 pill（图片时为人物/物品/场景；视频时禁用）。
- 网格布局：`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3`，每项为可点击卡片：
  - 缩略图（图片 `<img>` / 视频 `<video preload="metadata">` 首帧）
  - 选中态：边框高亮 `border-brand-500` + 右上角勾选图标
  - 已选（在 `selectedUrls` 中或本次已选）：灰显 + 角标「已选」
  - 点击预览：图片走 `ImageLightbox`，视频弹窗播放（复用资产库的视频模态逻辑）
  - 信息：`entityName` + `seriesTitle`（小字）
- 多选时受 `max` 约束（剩余可选数 = max - selectedUrls.length - 本次已选），达上限禁用其余项。
- 底部 footer：左侧显示「已选 N 项」，右侧「取消」+「确认（N）」按钮；单选时确认后立即关闭。
- 空状态与加载态处理（复用 `Spinner`）。

**复用资产库的过滤/渲染逻辑**，但为选择器定制：去掉下载/复制，增加选中态与去重。

### 2. 图片生成弹框集成 - `components/ImageGenerationDialog.tsx`

在参考图上传区（L378-422 的 `flex flex-wrap gap-2` 容器内），「+ 添加」按钮**之后**新增「资产库」按钮：

- 新增组件状态：`const [pickerOpen, setPickerOpen] = useState(false);`
- 在参考图数量未满（`images.length < maxRefImages`）时，显示一个与「+ 添加」同尺寸（h-16 w-16）的按钮，文案「资产库」+ 图库图标。
- 点击打开 `<AssetPicker mediaType="image" multiple selectedUrls={images} max={maxRefImages} onConfirm={...} />`。
- `onConfirm` 回调：`onImagesChange([...images, ...newUrls])`，关闭 picker。
- **不改动** `handleAddFiles`、`removeImage`、`@提及`等既有逻辑--库内 URL 与本地上传产物在 `images` 数组中自然混合，后续 `onConfirm`/`generateImage` 流程对 URL 的处理已兼容（AssetPreparation 中 `img.startsWith("http")` 直接保留）。

### 3. 视频生成卡片集成 - `components/VideoGeneration.tsx`

在 `VideoCard` 组件中新增选择器状态与 4 个集成点：

**新增状态（VideoCard 内）：**
```typescript
const [pickerTarget, setPickerTarget] = useState<"firstFrame" | "lastFrame" | "refImage" | "refVideo" | null>(null);
```

**集成点 A - 首帧图（FrameImageUpload 旁）**
- L1037-1045 的 `first-frame` 模式区块：在 `FrameImageUpload` 下方加一个「从资产库选」小按钮（`Button size="sm" variant="ghost"`）。
- 点击 `setPickerTarget("firstFrame")` 打开 picker（`mediaType="image"`, 单选, `selectedUrls={config.firstFrameImageUrl ? [config.firstFrameImageUrl] : []}`）。
- 确认后 `onUpdateVideoConfig({ firstFrameImageUrl: urls[0] })`。

**集成点 B - 尾帧图**
- L1055-1061 的 `first-last-frame` 模式：尾帧 `FrameImageUpload` 下方同样加按钮，`setPickerTarget("lastFrame")`，单选，确认后 `onUpdateVideoConfig({ lastFrameImageUrl: urls[0] })`。

**集成点 C - 参考图（multimodal-ref）**
- L1078-1088 的参考图区块：在「参考图：关联资产 N 张」文字旁，新增「+ 从资产库选」按钮（`Button size="sm" variant="ghost"`）。
- 点击 `setPickerTarget("refImage")` 打开 picker（`mediaType="image"`, 多选, `max` 取模型上限或固定值，`selectedUrls={config.referenceImageAssetUrls ?? []}`）。
- 确认后 `onUpdateVideoConfig({ referenceImageAssetUrls: [...(config.referenceImageAssetUrls ?? []), ...urls] })`。
- 这替代了被隐藏的 `asset://` 素材 ID 输入，提供更直观的库内图片选择。

**集成点 D - 参考视频（multimodal-ref）**
- L1091-1101 的 `MediaUploadArea` 旁：新增「+ 从资产库选」按钮。
- 点击 `setPickerTarget("refVideo")` 打开 picker（`mediaType="video"`, 多选, `max={3}`, `selectedUrls={config.referenceVideoUrls ?? []}`）。
- 确认后 `onUpdateVideoConfig({ referenceVideoUrls: [...(config.referenceVideoUrls ?? []), ...urls] })`。

**渲染 AssetPicker（VideoCard return 末尾）：**
```tsx
{pickerTarget && (
  <AssetPicker
    open={!!pickerTarget}
    onClose={() => setPickerTarget(null)}
    mediaType={pickerTarget === "refVideo" ? "video" : "image"}
    multiple={pickerTarget === "refImage" || pickerTarget === "refVideo"}
    max={(pickerTarget === "refImage" || pickerTarget === "refVideo") ? (pickerTarget === "refVideo" ? 3 : 10) : 1}
    selectedUrls={/* 根据 pickerTarget 取对应字段 */}
    onConfirm={(urls) => {
      // 根据 pickerTarget 写入对应 config 字段
      setPickerTarget(null);
    }}
  />
)}
```

> 参考图上限说明：multimodal-ref 参考图无硬性数量限制（关联资产图 + 手动图合并），此处 `max` 设为较大值（如 10）作软上限，防止过多。参考视频上限沿用现有 3。

### 4. 不需要改动的部分
- **后端**：无新接口，复用 `GET /api/data/assets`。
- **类型**：`AssetLibraryItem` 已存在，无需新增。
- **数据结构**：`AssetImageConfig.referenceImages` / `ShotVideoConfig.*` 字段均存储 URL 字符串，库内 URL 直接兼容。
- **生成流程**：`generateImage` / `createVideoTask` 接收的 URL 参数对库 URL 与本地上传 URL 一视同仁，无需修改。

---

## 假设与决策

1. **库内 URL 直接可用**：`AssetLibraryItem.url` 是 COS 公网 URL，与现有本地上传产物（经 `uploadRefFile`/`uploadRefBase64` 产生的 URL）形态一致，下游处理逻辑无需区分。
2. **去重依据**：以 URL 字符串完全匹配去重。库内同一资源的 URL 稳定唯一，可可靠去重。
3. **数据时效**：每次打开 picker 重新拉取资产库，保证显示最新生成内容；不缓存以避免脏数据。
4. **参考图上限**：multimodal-ref 参考图设软上限 10；参考视频沿用 3；首尾帧为单值（选即覆盖）。
5. **不动既有本地上传**：资产库选择与本地上传并行，用户可混用；`images`/`referenceImageAssetUrls` 等数组中两种来源 URL 共存。
6. **图片弹框共享**：ImageGenerationDialog 一处集成，Step3 与系列设定页自动生效（它们都通过该弹框管理参考图）。
7. **无新依赖**：全部复用现有技术栈与 UI 组件。

---

## 验证步骤

1. **类型检查**：`npx tsc --noEmit` 通过，无 TS 错误。
2. **构建**：`npm run build` 编译成功，lint/类型校验通过。
3. **图片生成弹框**：
   - `npm run dev`，进入 Step3 资产准备，打开某资产的图片生成弹框。
   - 参考图区出现「资产库」按钮；点击打开选择器，仅显示图片。
   - 选中 1-2 张库内图片 -> 确认 -> 参考图缩略图出现且计数增加。
   - 重复选同一张 -> 被标记「已选」不可重复添加。
   - 混合本地上传 + 库选择，生成图片成功（验证 URL 混用）。
4. **系列设定页**：进入人物/物品/场景设定，打开图片生成弹框，验证同样的资产库选择入口可用。
5. **视频生成 - 首尾帧**：
   - 进入 Step4，切换到 first-frame 模式，首帧图旁出现「从资产库选」。
   - 点击选一张库内图片 -> 确认 -> 首帧缩略图显示该图。
   - 切到 first-last-frame，首尾帧各自可从库选。
6. **视频生成 - multimodal-ref**：
   - 切到 multimodal-ref 模式。
   - 参考图区「+ 从资产库选」可多选图片，确认后琥珀色标签增加。
   - 参考视频区「+ 从资产库选」可多选库内视频（最多 3），确认后视频缩略图增加。
   - 生成视频成功，验证库内 URL 被正确传入 Seedance API。
7. **去重与上限**：参考视频达 3 个时 picker 禁用其余项；参考图达上限时禁用。
8. **空状态**：资产库无内容时 picker 显示「暂无生成的资产」。
