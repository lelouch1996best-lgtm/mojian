# 图片生成弹框：参考图持久化 + 提示词 @ 引用

## 概述

在图片生成弹框（ImageGenerationDialog）中实现两个功能：
1. **参考图持久化**：用户上传的参考图刷新后不丢失，通过上传 COS 存 URL 到资产配置实现持久化
2. **提示词 @ 引用**：在提示词 textarea 中输入 @ 时，弹出已上传参考图的下拉列表（图片1/图片2/...），选中后插入「图片N」到提示词中，方便在提示词中引用参考图

## 当前状态分析

### 参考图持久化问题
- `ImageGenerationDialog` 的 `images` state 存储参考图（base64 data URI），每次弹框打开时 `useEffect` 重置为 `[]`（[ImageGenerationDialog.tsx:65](file:///Users/hehuajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx#L65)）
- `onConfirm` 回调中，`params.images` 仅传给 `generateImageForAsset` 用于本次生成，**未持久化**（[AssetPreparation.tsx:954-962](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L954-L962)）
- `AssetImageConfig` 接口（[types.ts:238-252](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts#L238-L252)）无参考图字段
- Asset 通过 `imageConfig?: AssetImageConfig` 持久化到 Episode 数据

### @ 功能现状
- 弹框使用原生 `<textarea>`，无 @ 能力（[ImageGenerationDialog.tsx:165-171](file:///Users/hehuajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx#L165-L171)）
- 代码库中 @ 提及逻辑内联在 `EditableCell.tsx`（非独立组件），包含触发检测、下拉定位、键盘导航、选中插入等完整逻辑
- `VideoGeneration.tsx` 是 @ 提及的唯一使用方，候选来自 `episode.assets`
- Seedream API 支持在提示词中用「图片1」「图片2」引用参考图

### 弹框使用场景（4处）
1. `AssetPreparation.tsx` — 资产准备（imageConfig 按 Asset 持久化）
2. `app/series/[id]/characters/page.tsx` — 人物设定（imageConfig 为共享 state，不持久化到 DB）
3. `app/series/[id]/objects/page.tsx` — 物品设定（同上）
4. `app/series/[id]/scenes/page.tsx` — 场景设定（同上）

### COS 上传能力
- `cos-client.ts` 的 `uploadRefFile(file: File, nameHint: string)` 处理 File -> COS 上传（[cos-client.ts:53-82](file:///Users/hehuajiu/Workbuddy/mojian/lib/cos-client.ts#L53-L82)）
- `/api/cos/upload` 路由接受 base64 data URI，返回 COS URL（[api/cos/upload/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/cos/upload/route.ts)）
- AssetPreparation 已有 `cosConfigured` 状态和 `getCosSettings()` 调用模式

## 改动方案

### 1. types.ts — AssetImageConfig 新增 referenceImages 字段

**文件**: `lib/types.ts`

在 `AssetImageConfig` 接口末尾新增可选字段：
```typescript
/** 参考图 URL 列表（COS URL，用于持久化） */
referenceImages?: string[];
```

可选字段确保向后兼容，旧数据不受影响。`DEFAULT_ASSET_IMAGE_CONFIG` 无需修改（缺省时为 undefined）。

### 2. cos-client.ts — 新增 uploadRefBase64 函数

**文件**: `lib/cos-client.ts`

新增函数，接受 base64 data URI，上传到 COS 返回 URL。复用现有 `/api/cos/upload` 路由：

```typescript
export async function uploadRefBase64(base64: string, nameHint: string): Promise<string> {
  const settings = await getCosSettings();
  if (!settings) throw new Error("未配置 COS 存储");
  const ext = base64.match(/data:image\/(\w+)/)?.[1] ?? "png";
  const res = await fetch("/api/cos/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64, fileName: `${nameHint}.${ext}`, settings }),
  });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error ?? "上传失败");
  return data.url as string;
}
```

### 3. ImageGenerationDialog.tsx — 参考图初始化 + @ 提及

**文件**: `components/ImageGenerationDialog.tsx`

#### 3a. 新增 prop：initialReferenceImages
```typescript
initialReferenceImages?: string[];
```

#### 3b. 参考图初始化
`useEffect` 中将 `setImages([])` 改为 `setImages(initialReferenceImages ?? [])`，使弹框打开时预填已保存的参考图 URL。

#### 3c. @ 提及逻辑（内联实现）
在弹框组件中内联 @ 提及逻辑（参照 EditableCell.tsx 的实现模式）：

**新增 state**:
- `mentionOpen: boolean` — 下拉是否显示
- `mentionIndex: number` — 当前选中项索引
- `mentionQuery: string` — @ 后的查询文本
- `dropdownPos: { top: number; left: number }` — 下拉定位
- `textareaRef: useRef<HTMLTextAreaElement>` — textarea 引用

**@ 候选选项**（动态，基于已上传参考图）:
```typescript
const mentionOptions = images.map((_, i) => ({
  label: `图片${i + 1}`,
  value: `图片${i + 1}`,
}));
```

**触发检测**（onChange 中）:
从光标位置往前找最近的 `@`，正则匹配 `@` 后的输入作为查询词：
```
/@([^\s@，。、,\.！？!?\n：:；;）)、】"'`（）\[\]{}｜|《》〈〉…-·]*)$/
```
匹配成功则显示下拉，否则关闭。

**下拉定位**: `fixed` 定位，紧贴 textarea 下方（`rect.bottom + 4`）。

**键盘导航**: ArrowDown/Up 移动选中项，Enter/Tab 确认，Escape 关闭。

**选中插入**: 将 `@query` 替换为 `图片N `（带尾随空格），光标移到插入位置后。

**blur 延迟**: 160ms 延迟关闭下拉，确保点击下拉项时 textarea 不失焦。

**渲染**: 在 textarea 下方渲染下拉列表（仅 `mentionOpen && mentionOptions.length > 0` 时显示）。每个选项显示「图片N」标签，并显示对应的缩略图。

### 4. AssetPreparation.tsx — 持久化参考图

**文件**: `components/AssetPreparation.tsx`

#### 4a. 打开弹框时传入已保存参考图
在 `openGenerateImageDialog` 中，设置一个新的 state `genInitialReferenceImages`：
```typescript
setGenInitialReferenceImages(asset.imageConfig?.referenceImages ?? []);
```
传给弹框的 `initialReferenceImages` prop。

#### 4b. onConfirm 时上传 base64 到 COS 并持久化
```typescript
onConfirm={async (params) => {
  setGenConfigOpen(false);
  setGenImageConfig(params.config);

  // 上传 base64 参考图到 COS，获取 URL
  let refUrls: string[] = [];
  if (params.images.length > 0) {
    if (cosConfigured) {
      refUrls = await Promise.all(
        params.images.map(async (img, i) => {
          if (img.startsWith("http")) return img;  // 已是 URL
          try {
            return await uploadRefBase64(img, `ref-${asset.name}-${i + 1}`);
          } catch { return img; }  // 上传失败保留 base64
        })
      );
    } else {
      refUrls = params.images;  // COS 未配置，保留 base64（不持久化）
    }
  }

  if (genTargetAssetId) {
    const configWithRefs = { ...params.config, referenceImages: refUrls };
    onUpdateAsset(genTargetAssetId, "imageConfig" as keyof Asset, configWithRefs as unknown as string);
  }
  const asset = episode.assets.find((a) => a.id === genTargetAssetId);
  if (asset) void generateImageForAsset(asset, params);
}}
```

注意：`generateImageForAsset` 仍使用 `params.images`（包含 base64 和 URL 混合），API 均可处理。

### 5. 设定页面（characters/objects/scenes）— 会话级参考图

**文件**: `app/series/[id]/characters/page.tsx`, `app/series/[id]/objects/page.tsx`, `app/series/[id]/scenes/page.tsx`

三个页面做相同改动：
- 传 `initialReferenceImages={imageConfig.referenceImages}` 给弹框
- onConfirm 时 `setImageConfig({ ...params.config, referenceImages: params.images })`
- 由于设定页 imageConfig 是共享 state（不持久化到 DB），参考图仅会话级保留，刷新后丢失（与现有 imageConfig 行为一致）

## 假设与决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 参考图存储方式 | COS URL | 避免 base64 膨胀数据，与视频流程一致 |
| COS 未配置时 | 保留 base64 不持久化 | 不阻断生图流程，但无法持久化 |
| @ 候选范围 | 已上传的参考图 | 用户明确要求，非外部资产 |
| @ 插入文本 | 「图片N」 | 与 Seedream API 的图片引用格式一致 |
| @ 实现方式 | 内联在弹框中 | 避免创建新文件，候选逻辑简单 |
| 设定页持久化 | 仅会话级 | 设定页 imageConfig 本身不持久化到 DB，保持一致 |
| AssetImageConfig.referenceImages | 可选字段 | 向后兼容旧数据 |

## 验证步骤

1. `npx tsc --noEmit` 类型检查通过
2. 在资产准备中：上传参考图 -> 生成图片 -> 刷新页面 -> 重新打开弹框 -> 参考图仍在
3. 在资产准备中：上传参考图 -> 在提示词中输入 @ -> 出现下拉（图片1/图片2...）-> 选中 -> 提示词中插入「图片N」
4. 在资产准备中：移除已保存的参考图 -> 生成 -> 刷新 -> 参考图已被移除
5. COS 未配置时：上传参考图 -> 生成成功 -> 刷新 -> 参考图丢失（预期行为）
6. 在人物设定页：上传参考图 -> 关闭弹框 -> 重新打开 -> 参考图仍在（会话级）
