# 视频生成页面 · 镜头故事板生成功能

## 摘要

在「视频生成」(Step4) 页面每个镜头卡片的「输入素材」折叠区内、**参考音频**下方，新增「生成故事板」功能。点击后弹出可编辑提示词的图片生成弹框（复用 `ImageGenerationDialog`），根据当前镜头信息生成一张专业影视分镜故事板图片（多格分格铅笔线稿素描，黑白手绘速写，每格标注镜头时长/景别/光圈/运镜，含彩色箭头与手写构图思路）。生成结果持久化到镜头（`shot.storyboardUrl`）并自动转存 COS，刷新/重进页面后仍可查看与下载。仅在多模态参考（`multimodal-ref`）模式下可见。

---

## 当前状态分析

### 架构现状
- [components/VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx)：Step4 主组件，为每个镜头渲染 `VideoCard`。父组件已加载视频模型（`videoModels`）与视频配置（`videoConfigured`），但**未加载图片生成配置**。
- `VideoCard` 内「输入素材」折叠区（`config.mode !== "text2video"` 时渲染）按模式分块；`multimodal-ref` 模式依次渲染：参考图、参考视频（`MediaUploadArea`）、参考音频（`MediaUploadArea`）。
- 图片生成链路：`generateImage()`（[lib/image-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/image-client.ts)）→ `/api/image` → 返回 `imageUrl`（URL 或 data URI，24h 过期）→ 调用 `/api/cos/transfer` 转存 COS 持久 URL。
- 图片生成弹框：[components/ImageGenerationDialog.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx)，支持提示词编辑、参考图上传、风格模板开关、高级参数（`ImageConfigFields`）。AssetPreparation 已复用此弹框。
- `Shot` 类型（[lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts)）含 `duration`/`shotType`/`cameraMovement`/`visualDescription`/`lightingMood` 等字段，**无光圈字段**。
- [app/episode/[id]/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/[id]/page.tsx) 的 `handleUpdateShot(shotId, field, value)` 是泛型（`keyof Shot`），直接映射字段写入并持久化。shots 以 JSON TEXT 列存储于 episodes 表，**新增字段无需 DB 迁移**。

### 关键约束
- `Shot` 无「光圈」字段 → 故事板提示词中需指示模型根据景别/光影自行标注合理光圈值。
- 图片弹框配置（`AssetImageConfig`）默认 `1:1 / 2K`；故事板为多格竖版/横版分镜稿，应预置更合适的宽高比与更高分辨率。
- `VideoGeneration` 父组件当前不持有图片 API 状态，需新增加载逻辑并下传给 `VideoCard`。
- 项目无独立 lint/typecheck 脚本，验证依赖 `next build`（TS strict 模式）。

---

## 假设与决策

1. **持久化**：新增 `Shot.storyboardUrl?: string`，生成后写入并转存 COS（与资产图/视频一致）。无 DB 迁移。
2. **触发方式**：复用 `ImageGenerationDialog`，预填根据镜头字段构建的默认提示词，用户可编辑/优化/调整图片参数后确认生成。
3. **可见范围**：严格置于 `multimodal-ref` 模式的参考音频 `MediaUploadArea` 之后；其余模式不可见（与用户选择一致）。
4. **光圈处理**：`Shot` 无光圈字段，提示词指示模型按景别推断并标注（特写→大光圈如 f/1.4，远景→小光圈如 f/8）。
5. **默认图片配置**：宽高比 `16:9`、分辨率 `3K`（铅笔线稿需细节）、输出 `png`，其余沿用 `DEFAULT_ASSET_IMAGE_CONFIG`。用户可在弹框高级参数中修改。
6. **提示词构建**：在 [lib/prompts.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/prompts.ts) 新增 `buildStoryboardPrompt(shot)` 纯字符串构建函数（非 LLM 调用），与现有 prompt 构建器同文件。
7. **COS 转存**：复用 `/api/cos/transfer`，prefix 用 `ai-script/storyboards`。
8. **不引入新依赖**，沿用现有 `generateImage` / `ImageGenerationDialog` / `ImageLightbox` / `uploadRefBase64`。

---

## 实施步骤

### 1. 扩展 Shot 类型
**文件**：[lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts)
- 在 `Shot` 接口新增可选字段：
  ```ts
  /** 镜头故事板图片 URL（专业影视分镜，COS 持久 URL） */
  storyboardUrl?: string;
  ```
- 位置：紧随 `videoConfig?: ShotVideoConfig;` 之后。

### 2. 新增故事板提示词构建器
**文件**：[lib/prompts.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/prompts.ts)
- 新增导出函数 `buildStoryboardPrompt(shot: Pick<Shot, "duration" | "visualDescription" | "shotType" | "lightingMood" | "cameraMovement">): string`。
- 逻辑：拼接镜头信息 + 用户指定的完整风格要求。核心内容：
  - 主体：根据当前镜头生成一张专业影视分镜故事板图片，多格分格铅笔线稿素描，黑白手绘速写。
  - 每格标注：镜头时长（取 `shot.duration`）、景别（取 `shot.shotType`）、光圈（指示按景别推断：特写/近景→大光圈 f/1.4-2.8，中景→f/2.8-4，全景/远景→小光圈 f/5.6-11）、运镜（取 `shot.cameraMovement`）。
  - 每格下方文字描述（取 `shot.visualDescription` 分镜展开）。
  - 画面添加红/蓝/橙彩色箭头指示动作、视线、运镜；手写小字标注构图思路。
  - 风格：细腻排线阴影，分镜师手稿，干净线稿无上色，黑白铅笔速写。
  - 融入 `shot.lightingMood` 作为光影参考。
- 该函数为纯字符串拼接，供弹框预填（非 LLM 调用），用户可在弹框内用 `AiOptimizeButton` 进一步润色。

### 3. 在 VideoGeneration 父组件加载图片 API 状态
**文件**：[components/VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx)
- 顶部新增 import：`generateImage`, `getImageSettings`, `DEFAULT_ASSET_IMAGE_CONFIG` from `@/lib/image-client`；`getImageModels`, `getDefaultModelValue`, `ModelEntry`（已部分引入）from `@/lib/model-presets`；`ImageGenerationDialog`, `ImageGenerationParams` from `./ImageGenerationDialog`；`ImageLightbox`（已引入）；`buildStoryboardPrompt` from `@/lib/prompts`；`isCosConfigured`, `getCosSettings` from `@/lib/cos-client`（`uploadRefFile` 已引入）；`AssetImageConfig`, `ImageGenSettings` from `@/lib/types`。
- 在 `VideoGeneration` 函数体内新增状态（参照 AssetPreparation 模式）：
  ```ts
  const [imageConfigured, setImageConfigured] = useState(false);
  const [imageProvider, setImageProvider] = useState<ImageGenSettings["provider"]>("ark");
  const [imageModels, setImageModels] = useState<ModelEntry[]>([]);
  ```
- 新增 `useEffect` 加载图片配置（与现有视频配置 `useEffect` 并列，依赖 `[]`）：
  ```ts
  useEffect(() => {
    getImageSettings().then(async (s) => {
      setImageConfigured(!!s?.apiKey);
      const provider = s?.provider ?? "ark";
      if (s?.provider) setImageProvider(s.provider);
      setImageModels(await getImageModels(provider));
    });
  }, []);
  ```
- 将 `imageConfigured` / `imageProvider` / `imageModels` 作为 props 传入 `VideoCard`（在 `episode.shots.map` 处追加三个 prop）。

### 4. 在 VideoCard 内实现故事板 UI 与生成逻辑
**文件**：[components/VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx)（`VideoCard` 函数）

#### 4.1 扩展 VideoCard props
- 接口新增：`imageConfigured: boolean`、`imageProvider: ImageGenSettings["provider"]`、`imageModels: ModelEntry[]`。
- 解构对应参数。

#### 4.2 新增状态
```ts
const [storyboardOpen, setStoryboardOpen] = useState(false);
const [storyboardPrompt, setStoryboardPrompt] = useState("");
const [storyboardConfig, setStoryboardConfig] = useState<AssetImageConfig>(
  { ...DEFAULT_ASSET_IMAGE_CONFIG, model: getDefaultModelValue(imageModels) ?? DEFAULT_ASSET_IMAGE_CONFIG.model, aspectRatio: "16:9", resolution: "3K" }
);
const [storyboardRefImages, setStoryboardRefImages] = useState<string[]>([]);
const [generatingStoryboard, setGeneratingStoryboard] = useState(false);
```

#### 4.3 打开弹框函数
```ts
function openStoryboardDialog() {
  setStoryboardPrompt(buildStoryboardPrompt(shot));
  setStoryboardConfig(c => ({ ...c, model: getDefaultModelValue(imageModels) ?? c.model }));
  setStoryboardRefImages([]);
  setStoryboardOpen(true);
}
```

#### 4.4 生成 + 转存函数
```ts
async function handleGenerateStoryboard(params: ImageGenerationParams) {
  setStoryboardOpen(false);
  setStoryboardConfig(params.config);
  setGeneratingStoryboard(true);
  setUploadError(null);
  try {
    const result = await generateImage(params.prompt, params.config, params.images.length > 0 ? params.images : undefined, imageModels);
    onUpdateShot(shot.id, "storyboardUrl", result.imageUrl);
    // 转存 COS（24h 过期保护）
    if (await isCosConfigured()) {
      const cosSettings = await getCosSettings();
      if (cosSettings) {
        const res = await fetch("/api/cos/transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceUrl: result.imageUrl, settings: cosSettings, prefix: "ai-script/storyboards" }),
        });
        const data = await res.json();
        if (res.ok && data.url) onUpdateShot(shot.id, "storyboardUrl", data.url);
      }
    }
  } catch (e) {
    setUploadError(`故事板生成失败：${(e as Error).message}`);
  } finally {
    setGeneratingStoryboard(false);
  }
}
```

#### 4.5 UI：在参考音频下方插入故事板区块
- 定位：`config.mode === "multimodal-ref"` 的 `<div className="space-y-2">` 内，紧随参考音频 `MediaUploadArea`（约 1182-1192 行）之后、被注释的「添加素材ID」区块之前插入：
  ```tsx
  {/* 故事板 */}
  <div className="space-y-1.5 rounded-md border border-slate-200 bg-white p-2">
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-slate-500">📋 故事板</span>
      <Button size="sm" variant="ghost" onClick={openStoryboardDialog} disabled={!imageConfigured || generatingStoryboard} loading={generatingStoryboard}
        title={!imageConfigured ? "未配置图片生成 API，请先在设置中配置" : ""}>
        {shot.storyboardUrl ? "重新生成" : "生成故事板"}
      </Button>
    </div>
    {shot.storyboardUrl ? (
      <ImageLightbox src={shot.storyboardUrl} alt={`镜头${index + 1}故事板`} className="block">
        <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
          <img src={shot.storyboardUrl} alt={`镜头${index + 1}故事板`} className="h-32 w-full object-cover" />
        </div>
      </ImageLightbox>
    ) : (
      <p className="text-[11px] text-slate-400">根据当前镜头生成专业影视分镜故事板（多格铅笔线稿素描）</p>
    )}
  </div>
  ```

#### 4.6 渲染弹框
- 在 `VideoCard` return 的末尾（与 `pickerTarget` 的 `AssetPicker` 同级，`</div>` 闭合前）渲染：
  ```tsx
  <ImageGenerationDialog
    open={storyboardOpen}
    onClose={() => setStoryboardOpen(false)}
    initialPrompt={storyboardPrompt}
    initialConfig={storyboardConfig}
    images={storyboardRefImages}
    onImagesChange={setStoryboardRefImages}
    provider={imageProvider}
    imageModels={imageModels}
    title="生成故事板"
    confirmText="生成故事板"
    loading={generatingStoryboard}
    onConfirm={handleGenerateStoryboard}
  />
  ```
- 不传 `styleTemplate`（故事板不需要漫剧风格模板）。
- `onUploadFiles` 可选；为简化首版不传，参考图走 base64 data URI（弹框内部默认行为）。若需 COS 持久化参考图，后续可补传（非阻塞）。

### 5. 类型校验
- `onUpdateShot(shot.id, "storyboardUrl", ...)` 已是泛型 `keyof Shot`，新增字段后类型自动通过，无需改动 [app/episode/[id]/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/[id]/page.tsx)。

---

## 验证步骤

1. **类型检查**：运行 `npm run build`（`next build`，TS strict 模式），确认无类型错误。
2. **功能验证**（手动，需配置图片 API + COS）：
   - 进入某剧集 Step4，将某镜头视频参数「生成模式」切换为「多模态参考」。
   - 展开该镜头「输入素材」折叠区，确认「参考音频」下方出现「故事板」区块与「生成故事板」按钮。
   - 切换为「文生视频」/「首帧」/「首尾帧」模式，确认故事板区块消失。
   - 点击「生成故事板」→ 弹框预填含镜头时长/景别/运镜/光圈推断/铅笔素描风格的提示词 → 可编辑 → 确认生成 → 等待出图。
   - 出图后卡片显示故事板缩略图，点击可 `ImageLightbox` 放大预览/下载。
   - 刷新页面或切步骤再回来，确认故事板图片仍在（COS 持久 URL）。
3. **降级验证**：未配置图片 API 时按钮 disabled 且有 title 提示；未配置 COS 时仍能显示 24h 内的原始 URL。
4. **回归**：确认现有「参考音频」「参考视频」上传、视频生成、资产生成等功能未受影响。

---

## 影响范围
- 改动文件：[lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts)、[lib/prompts.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/prompts.ts)、[components/VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx)。
- 无 DB 迁移、无新依赖、无 API 路由改动、无其他组件改动。
