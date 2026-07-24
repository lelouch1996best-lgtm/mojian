# 资产库「添加资产」功能改进

## 摘要

在资产库的「添加资产」弹窗（`AddAssetDialog`）中修复三个问题：
1. **上传文件点击范围过大**：改用「按钮 + 隐藏 input」方案，只有「选择文件」按钮可触发选文件，并单独展示已选文件名。
2. **提示词输入框无用**：移除该输入框（生成模式的提示词在生成弹窗内填写，上传/URL 模式不需要）。
3. **支持在此生成图片**：新增第三种来源方式「AI 生成」，复用现有完整 `ImageGenerationDialog`，确认后生成图片 → 转存 COS → 回填预览，再点「添加」入库。

## 当前状态分析

- 入口：[app/assets/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/assets/page.tsx) → [components/AssetLibrary.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx)
- 「添加资产」弹窗 `AddAssetDialog` 定义在 [AssetLibrary.tsx L691-L925](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx#L691-L925)
  - 来源方式 `mode: "upload" | "url"`（[L703](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx#L703)）
  - 上传文件用原生 `<input type="file">` + `flex-1`（[L819-L833](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx#L819-L833)）→ 整个 input 元素都可点，导致整行可触发选文件
  - 提示词 textarea 仅写入 `media_assets.prompt` 字段作记录，不触发生成（[L892-L901](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx#L892-L901)）
  - 提交逻辑 `handleSubmit`（[L714-L772](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx#L714-L772)）
- 完整图片生成链路已在 [AssetPreparation.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx) 实现（可复刻接线）：
  - 加载配置：`getImageSettings()` → `imageConfigured`/`imageProvider`；`getImageModels(provider)` → `imageModels`（[L117-L124](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L117-L124)）
  - 渲染 `ImageGenerationDialog`（[L999-L1041](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L999-L1041)）：传 `initialPrompt`/`initialConfig`/`images`/`onImagesChange`/`provider`/`imageModels`/`loading`/`onConfirm`
  - 生成 + 转存：`generateImage(prompt, config, images, imageModels, onJobCreated, signal)` → `transferAsset(result.imageUrl, "ai-script/assets")`（[L528-L575](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L528-L575)）
  - 卸载时取消轮询：`abortRef = useRef<AbortController>`（[L129-L134](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L129-L134)）
- 关键模块：
  - `generateImage` / `getImageSettings` / `DEFAULT_ASSET_IMAGE_CONFIG` 来自 [lib/image-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/image-client.ts)
  - `getImageModels` / `getDefaultModelValue` / `ModelEntry` 来自 [lib/model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts)
  - `transferAsset` / `isCosConfigured` / `uploadRefFile` 来自 [lib/cos-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/cos-client.ts)
  - `ImageGenerationDialog` / `ImageGenerationParams` 来自 [components/ImageGenerationDialog.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx)
- `MediaAsset.source` 可选值：`"asset" | "shot" | "profile-character" | "profile-object" | "profile-scene" | "manual" | "screenshot"`（[lib/types.ts L598](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts#L598)）→ 生成入库用 `"manual"`
- 校验命令：项目仅 `npm run build`（next build 含类型检查），开发用 `npm run dev`

## 决策（已与用户确认）

- 生成方式：**复用完整 `ImageGenerationDialog`**（支持 @ 引用参考图、风格模板、参数配置）
- 提示词框：**移除**（上传/URL 不需要；生成模式的提示词在生成弹窗内填写，生成所用提示词自动回填到入库记录的 `prompt` 字段）
- 生成来源资产 `source = "manual"`，`mediaType = "image"`（生成模式锁定为图片）

## 拟定修改

全部修改集中在 [components/AssetLibrary.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx) 的 `AddAssetDialog` 组件。

### 1. 新增 imports（文件顶部）

- `react` 的 import 增加 `useRef`
- `@/lib/cos-client`：在现有 `isCosConfigured, uploadRefFile` 基础上增加 `transferAsset`
- 新增 `import { generateImage, getImageSettings, DEFAULT_ASSET_IMAGE_CONFIG } from "@/lib/image-client";`
- 新增 `import { getImageModels, getDefaultModelValue, type ModelEntry } from "@/lib/model-presets";`
- 新增 `import { ImageGenerationDialog, type ImageGenerationParams } from "./ImageGenerationDialog";`
- `@/lib/types` 增加 `AssetImageConfig, ImageGenSettings`（与现有 `MediaAsset, MediaAssetInput` 并列）

### 2. 修复上传文件点击范围（问题 1）

位置：[L819-L833](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx#L819-L833)

- 在 `AddAssetDialog` 内新增 `const fileInputRef = useRef<HTMLInputElement>(null);`
- 将原生 `<input type="file">` 改为隐藏 input + 显式「选择文件」按钮 + 文件名展示：
  - 隐藏 `<input ref={fileInputRef} type="file" accept={accept} disabled={!cosReady} onChange={...} className="hidden" />`
  - `<button type="button" onClick={() => fileInputRef.current?.click()} disabled={!cosReady} className="rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-40">选择文件</button>`
  - 文件名：`{file ? <span className="truncate text-sm text-slate-600">{file.name}</span> : <span className="text-sm text-slate-400">未选择文件</span>}`
  - 保留 `{!cosReady && <span className="text-xs text-amber-600">需先配置存储方式</span>}` 提示
- 效果：只有「选择文件」按钮触发选文件对话框，整行不再可点。

### 3. 移除提示词输入框（问题 2）

位置：[L891-L901](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx#L891-L901)

- 删除整个「提示词」`<div>` 块及对应 `prompt` state（[L705](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx#L705) 的 `const [prompt, setPrompt] = useState("")`）
- `handleSubmit` 中不再读 `prompt`（改由生成模式回填，见下文）

### 4. 新增「AI 生成」来源方式（问题 3）

#### 4.1 扩展状态

- `mode` 类型扩展为 `"upload" | "url" | "generate"`
- 新增图片生成相关状态（参照 [AssetPreparation.tsx L114-L124](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L114-L124) 与 [L240-L246](file:///Users/heuhuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L240-L246)）：
  - `imageConfigured` / `imageProvider` / `imageModels`（`useEffect` 加载 `getImageSettings` + `getImageModels`）
  - `genOpen`（生成弹窗开关）/ `genInitialPrompt` / `genImageConfig`（默认 `{ ...DEFAULT_ASSET_IMAGE_CONFIG, model: getDefaultModelValue(imageModels) ?? DEFAULT_ASSET_IMAGE_CONFIG.model }`）/ `genRefImages`（参考图受控列表）
  - `generatedUrl`（生成并转存后的最终 URL）/ `generatedPrompt`（生成所用提示词，用于回填记录）
  - `generating`（生成中标志）
- 新增 `abortRef = useRef<AbortController | null>(null)`，同步初始化 + 卸载时 `abort()`（参照 [AssetPreparation.tsx L129-L134](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L129-L134)），用于取消轮询
- 切换 `mode` 时清空 `generatedUrl`/`generatedPrompt`（避免跨来源串数据）

#### 4.2 来源方式选择器新增第三个 pill

位置：[L806-L816](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx#L806-L816)

在「上传本地文件」「粘贴 URL」后新增：
```tsx
<FilterPill active={mode === "generate"} onClick={() => setMode("generate")}>
  AI 生成
</FilterPill>
```

#### 4.3 媒体类型锁定

位置：[L790-L803](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx#L790-L803)

- `mode === "generate"` 时强制 `mediaType = "image"`（切换进入该模式时 `setMediaType("image")`），并禁用媒体类型 pill（`disabled` + 视觉置灰），因为生成仅产出图片。

#### 4.4 文件/URL/生成 区块

位置：[L818-L844](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx#L818-L844)

- `mode === "generate"` 时不渲染文件/URL 行，改为渲染生成区块：
  - 若 `!imageConfigured`：提示「未配置图片生成 API，请先前往『图片 API 设置』页配置」
  - 「生成图片」按钮：`onClick={() => { setGenInitialPrompt(name.trim()); setGenImageConfig({...DEFAULT_ASSET_IMAGE_CONFIG, model: getDefaultModelValue(imageModels) ?? DEFAULT_ASSET_IMAGE_CONFIG.model}); setGenOpen(true); }}`，`disabled={!imageConfigured || generating}`
  - 生成中：显示 `<Spinner />` + 「生成中…」
  - 已生成（`generatedUrl`）：显示预览缩略图（`<img src={generatedUrl} />`，可复用 `ImageLightbox` 放大查看）+ 「重新生成」按钮（再次打开弹窗）
- 文件/URL 两个分支保持原有结构（仅上传分支按第 2 点改造）

#### 4.5 渲染 `ImageGenerationDialog`

在 `AddAssetDialog` return 的 JSX 末尾（与外层弹窗同级，通过 portal 渲染）追加：
```tsx
<ImageGenerationDialog
  open={genOpen}
  onClose={() => setGenOpen(false)}
  initialPrompt={genInitialPrompt}
  initialConfig={genImageConfig}
  images={genRefImages}
  onImagesChange={setGenRefImages}
  provider={imageProvider}
  imageModels={imageModels}
  loading={generating}
  onConfirm={async (params) => {
    setGenOpen(false);
    setGenerating(true);
    setError(null);
    try {
      const result = await generateImage(
        params.prompt,
        params.config,
        params.images.length > 0 ? params.images : undefined,
        imageModels,
        undefined,
        abortRef.current?.signal
      );
      let finalUrl = result.imageUrl;
      if (isCosConfigured()) {
        try {
          const { url } = await transferAsset(result.imageUrl, "ai-script/assets");
          finalUrl = url;
        } catch {
          finalUrl = result.imageUrl; // 转存失败回退原 URL
        }
      }
      setGeneratedUrl(finalUrl);
      setGeneratedPrompt(params.prompt);
    } catch (e) {
      const isAborted = abortRef.current?.signal.aborted || (e as Error)?.name === "AbortError";
      if (!isAborted) setError("图片生成失败：" + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  }}
/>
```
- 不传 `onUploadFiles`：参考图以 base64 data URI 形式传入 `generateImage`（与 `AssetPreparation` 一致，`generateImage` 支持 data URI）
- 不传 `imageLabels`：@ 引用回退「图片N」命名
- 不传 `styleTemplate`：库内无系列风格上下文，用户可在提示词中手写风格

#### 4.6 提交逻辑 `handleSubmit` 适配

位置：[L714-L772](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx#L714-L772)

- 新增 `mode === "generate"` 分支：
  - `if (!generatedUrl) { setError("请先生成图片"); return; }`
  - `url = generatedUrl`
  - 不走上传/URL 校验
- `MediaAssetInput` 构造：
  - `url` 按上述分支取值
  - `prompt: mode === "generate" ? generatedPrompt.trim() : ""`（生成模式回填所用提示词；上传/URL 不再记录提示词）
  - 其余字段（`mediaType`/`entityType`/`entityName`/`source: "manual"`/`seriesId`/`seriesTitle`）不变
- 「添加」按钮在 `mode === "generate"` 且（`generating` 或 `!generatedUrl`）时 `disabled`

#### 4.7 卸载取消轮询

`AddAssetDialog` 内：
```tsx
const abortRef = useRef<AbortController | null>(null);
if (abortRef.current === null) abortRef.current = new AbortController();
useEffect(() => {
  const ac = abortRef.current!;
  return () => ac.abort();
}, []);
```
- 关闭弹窗（组件卸载）时自动取消进行中的生成轮询，避免孤儿轮询。

## 假设与约束

- 生成模式仅支持图片（`mediaType` 锁定 `image`），不支持视频/音频生成。
- 生成期间若用户关闭「添加资产」弹窗，进行中的轮询会被 abort；已生成的结果因组件卸载而丢弃（可接受，资产尚未入库）。
- 参考图以 base64 传入生成接口（未传 `onUploadFiles`），与现有 `AssetPreparation` 行为一致。
- 转存 COS 失败时回退使用原始生成 URL（Seedream URL 24h 过期，但保证流程不中断并提示）。
- 生成入库的资产 `source` 用 `"manual"`（库内用户主动发起，无更细粒度的 "generated" 枚举）。
- 不改动 `app/assets/page.tsx`、`AssetPreparation.tsx`、`ImageGenerationDialog.tsx` 等其他文件。

## 验证步骤

1. `npm run build`：通过 next build 类型检查，无 TS 错误。
2. `npm run dev` 手动验证：
   - 上传模式：只有「选择文件」按钮可点，整行点击不再弹选文件框；选择后显示文件名；未配 COS 时按钮禁用并提示。
   - URL 模式：正常粘贴 URL 入库。
   - 提示词框已移除（上传/URL/生成模式均不再出现独立提示词框）。
   - AI 生成模式：媒体类型锁定为图片且不可切换；未配置图片 API 时提示并禁用「生成图片」；点击「生成图片」打开完整弹窗，可编辑提示词/参考图/参数；确认后弹窗关闭、显示「生成中…」、完成后显示预览缩略图；「添加」入库后资产列表出现新生成的图片资产，`prompt` 字段为生成所用提示词。
   - 生成中关闭「添加资产」弹窗：无控制台报错、无残留轮询。
