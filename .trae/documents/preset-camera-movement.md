# 运镜预设类型与占位符填充功能

## 摘要

在预设库新增独立的「运镜」类型（本质为文本 + `{{占位符}}`），并在视频生成提示词区的「添加提示词」下拉中新增「添加镜头」项（仅多模态模式可用）。选择运镜后弹出占位符填充对话框，让用户从当前卡片已添加的参考图中选资产填入对应占位符（替换为 `@参考图名`），生成提示词追加到视频提示词。多模态提交时复用现有 `@引用 → 图片N` 转换机制，自动关联参考图。

## 当前状态分析

- **预设库**：按媒体形态分 4 类 `PresetType = "image" | "video" | "audio" | "text"`，存储复用 `content`（文本）/`url`（媒体）字段。后端 `ALLOWED_TYPES` 白名单 + POST 校验（text 查 content、媒体查 url）。组件：`PresetLibrary.tsx`（管理页，含 `PresetEditDialog`/`PresetCard`）、`PresetPicker.tsx`（选择弹窗，按 `type` 过滤，text 走 content 逻辑）。
- **提示词区**：`VideoGeneration.tsx` 3365-3448 行，右上角已有「添加提示词」悬停下拉（4 项：镜头组信息/关联音效/故事板/从预设库获取）。`presetPickerTarget` 状态（2193 行）驱动 `PresetPicker`，现有 refImage/refVideo/refAudio/promptText 四种目标。
- **多模态**：`config.mode === "multimodal-ref"`。参考图 = 关联资产图（`relatedAssets` 中 `imageUrl` 非空，名 `a.name`）+ 手动参考图（`config.referenceImageAssetUrls`，名 `getRefImgName(config.referenceImageAssetNames, i)`）。
- **@引用→图片N 机制**：提交前（1099 行）`replaceAssetTagsWithImageNos(finalVideoPrompt, assetImageNo)`，`assetImageNo` 按「关联资产图 → 手动参考图」顺序编号，键为参考图名。只要提示词中 `@参考图名` 与参考图名一致，即可正确匹配与编号。

## 实现方案

### 1. 数据层

#### `lib/types.ts`（第 892 行）
`PresetType` 新增 `"camera"`：
```ts
export type PresetType = "image" | "video" | "audio" | "text" | "camera";
```
`PresetItem` 无需改字段——camera 复用 `content` 存运镜文本（含占位符），`url` 为空。

#### `app/api/data/presets/route.ts`
- 第 5 行 `ALLOWED_TYPES` 新增 `"camera"`。
- 第 72-80 行 POST 校验：`if (type === "text")` → `if (type === "text" || type === "camera")`（camera 走 content 必填、url 允许空）。

#### `lib/db.ts`
无需改动（`content` 字段复用，type 列为自由文本已支持）。

### 2. 预设库 UI

#### `components/PresetLibrary.tsx`
- 第 15-35 行三处常量新增 camera 项（label「运镜」）：`TYPE_OPTIONS`、`PRESET_TYPE_LABELS`、`ADD_TYPE_OPTIONS`。
- `PresetEditDialog`（562-833 行）：
  - 第 674 行 `isMedia`：`type !== "text" && type !== "camera"`（camera 走文本编辑路径）。
  - 第 622-626 行校验：`if (type === "text" || type === "camera")` 检查 `content`。
  - 第 658-659 行保存：`url: (type === "text" || type === "camera") ? "" : url`，`content: (type === "text" || type === "camera") ? content : ""`。
  - 文本编辑 textarea（760 行之后 isMedia 为 false 分支）：camera 复用同一 textarea，placeholder 增加占位符用法提示，如「输入运镜文本，可用 {{人物1}}、{{运镜参考图}} 等占位符，使用时从参考图中选择资产填入」。
- `PresetCard`（425-559 行）：
  - 第 446 行新增 `const isCamera = item.type === "camera";`，`isText` 分支扩展为 `isText || isCamera` 走文本预览。
  - camera 卡片用区分样式（如 `bg-sky-50 text-sky-500` + 摄像机图标），与文本的 amber 色调区分。
  - 第 533 行点击查看内容：camera 也走 `onPreviewText`。
- 检查文本预览模态（`textPreview` state）：若内部有 `type === "text"` 判断，扩展兼容 camera（camera 同样展示 content）。

#### `components/PresetPicker.tsx`
- 第 21-26 行 `TYPE_LABEL` 新增 `camera: "运镜"`。
- 第 208 行 `togglePick` 去重判断：`type !== "text"` → `type !== "text" && type !== "camera"`（camera 不按 url 去重，按 id 多选控制）。
- 第 226-231 行 `handleConfirm`：`if (type === "text" || type === "camera")` 返回 `{ id, name, content }`。
- `PresetPickCard`（395-519 行）：第 412 行 `isText` 扩展 `isCamera`，走文本卡片渲染（camera 用 sky 色调区分）。

### 3. 视频生成集成

#### `components/VideoGeneration.tsx`
- **状态**（2193 行）：`presetPickerTarget` 类型新增 `"camera"`；新增 `const [cameraPresetContent, setCameraPresetContent] = useState<string | null>(null)`（非 null 时渲染占位符填充弹窗）。
- **参考图名列表**（新增 useMemo，逻辑复用 `cardMentionOptions` 参考图部分，约 2283 行附近）：
  ```ts
  const refImageNameOptions = useMemo(() => {
    if (config.mode !== "multimodal-ref") return [];
    const names: string[] = [];
    relatedAssets.forEach((a) => { if (a.imageUrl) names.push(a.name); });
    (config.referenceImageAssetUrls ?? []).forEach((_, i) => {
      names.push(getRefImgName(config.referenceImageAssetNames, i));
    });
    return names;
  }, [config.mode, relatedAssets, config.referenceImageAssetUrls, config.referenceImageAssetNames]);
  ```
- **「添加镜头」下拉项**（3386-3417 行菜单内新增）：仅 `config.mode === "multimodal-ref"` 时渲染：
  ```tsx
  {config.mode === "multimodal-ref" && (
    <button type="button"
      onClick={() => setPresetPickerTarget("camera")}
      className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-brand-50 hover:text-brand-700">
      添加镜头
    </button>
  )}
  ```
- **PresetPicker 渲染**（3686-3772 行）新增 camera 分支：
  - `type` 映射：`presetPickerTarget === "camera" ? "camera" : ...`
  - `multiple={false}`（单选运镜）
  - `onConfirm` camera 分支：取 `items[0].content`；用 `/\{\{(.+?)\}\}/g` 解析占位符，去重保序。若无占位符 → 直接追加 content 到 finalPrompt（`${current.trim()}\n\n${content}`）；若有占位符 → `setCameraPresetContent(content)` 触发弹窗。
- **渲染 CameraPlaceholderDialog**（与 PresetPicker 同级）：
  ```tsx
  {cameraPresetContent !== null && (
    <CameraPlaceholderDialog
      open
      content={cameraPresetContent}
      refImageOptions={refImageNameOptions}
      onClose={() => setCameraPresetContent(null)}
      onConfirm={(generated) => {
        const current = shot.finalPrompt ?? "";
        const next = current.trim() ? `${current.trim()}\n\n${generated}` : generated;
        onUpdatePrompt(next);
        setCameraPresetContent(null);
      }}
    />
  )}
  ```

#### 新建 `components/CameraPlaceholderDialog.tsx`
- Props：`{ open: boolean; content: string; refImageOptions: string[]; onClose: () => void; onConfirm: (generated: string) => void; }`
- 用 `fixed inset-0` modal（参考 `PresetEditDialog` 676-681 行样式）。
- 占位符解析：`const placeholders = Array.from(content.matchAll(/\{\{(.+?)\}\}/g), m => m[1])`，去重保序。
- 每个占位符一行：标签 `{{xxx}}` + `<select>` 下拉（选项为 `refImageOptions`，默认空「请选择参考图」）。
- `refImageOptions` 为空时显示提示「请先在参考图区添加图片资产」。
- 实时预览：遍历占位符，用所选名称替换 `{{xxx}}` → `@选中名`（未选的保留原 `{{xxx}}`）。
- 确认按钮：全部占位符均已选择时可用；点击 `onConfirm(替换后文本)`。
- 替换逻辑（确定性，非 LLM）：对每个占位符 `const re = new RegExp("\\{\\{" + escaped + "\\}\\}", "g")` 替换为 `@${selectedName}`。

## 假设与决策

1. **运镜为独立类型 `camera`**，与 text 并列（用户已确认）。复用 `content` 字段，不改数据库表结构。
2. **占位符统一为参考图类型**（多模态下人物/运镜参考图均通过参考图传入），均从已添加参考图中选资产（用户已确认）。
3. **占位符替换为 `@参考图名`**，复用现有 `@引用 → 图片N` 转换机制（用户已确认）。提交时自动与参考图资产关联。
4. **资产来源仅限已添加参考图**（关联资产图 + 手动参考图），不临时从资产库新选（用户已确认）。无参考图时弹窗提示。
5. **仅 multimodal-ref 模式**显示「添加镜头」下拉项；非多模态不渲染。
6. **运镜无占位符时**直接追加 content 到视频提示词，不弹占位符填充对话框。
7. **追加方式**与 `addShotInfoToPrompt` 一致：`${current.trim()}\n\n${block}`。
8. **占位符必须全部填充**才能确认（确认按钮禁用未填状态），避免生成含裸 `{{xxx}}` 的提示词。
9. 占位符解析与替换为**确定性代码**（正则），不依赖 LLM（遵循项目约束）。

## 验证步骤

1. **预设库**：新增运镜（填含占位符文本）→ 列表显示 sky 色调卡片 → 点击预览内容 → 编辑/删除正常 → 类型筛选「运镜」生效 → 标签管理正常。
2. **非多模态模式**：「添加提示词」下拉不显示「添加镜头」项。
3. **多模态模式**：
   - 添加镜头 → PresetPicker 仅显示运镜 → 选择运镜确认。
   - 运镜有占位符 → 弹占位符填充对话框 → 列出参考图名选项 → 逐个选择 → 预览替换为 `@名` → 确认追加到提示词。
   - 运镜无占位符 → 直接追加 content。
   - 无已添加参考图 → 弹窗提示。
4. **提交校验**：提示词中 `@参考图名` 正确转换为「图片N」，对应参考图 URL 正确传入 `referenceImageUrls`，未被 @ 的参考图被过滤。
5. **类型回归**：image/video/audio/text 预设的增删改查与选择不受影响。
