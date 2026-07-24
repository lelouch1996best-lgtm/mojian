# 内置模型参数可编辑 + 用户自定义默认生成参数 + 模型列表刷新重构

## Summary

分 4 个任务执行：

1. **内置模型参数可编辑**：图片/视频的内置模型能力参数从只读改为可编辑；每个模型展开区内提供「初始化模型参数」按钮，仅重置当前展开模型为代码默认值。
2. **用户自定义默认生成参数**：原先写死的 `DEFAULT_ASSET_IMAGE_CONFIG` / `DEFAULT_SHOT_VIDEO_CONFIG` 改为用户可在设置页编辑的默认参数；每次打开图片生成弹框、每个新视频卡片（未记录过参数的）都使用这些默认参数；已记录参数的旧卡片行为不变。
3. **删除「初始化所有模型列表」**：删除设置页右上角入口及其底层实现。
4. **「初始化模型列表」→「刷新内置模型列表」**：四个 API 区域（对话/图片/视频/音频）的模型管理面板底部按钮改为合并式刷新：代码最新内置模型列表 + 保留用户自添加模型。

## Current State Analysis

### 模型体系核心：`lib/model-presets.ts`

- [ModelEntry](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts#L18-L30)：`value/label/hint/isDefault/capability/videoCapability/audioCapability`，能力矩阵内嵌在模型条目里。
- 内置列表：[DEFAULT_IMAGE_MODELS](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts#L83-L204)、[DEFAULT_VIDEO_MODELS](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts#L207-L398)（图片/视频条目均内嵌完整能力矩阵）、`DEFAULT_LLM_MODELS`、`DEFAULT_AUDIO_MODELS`。
- 能力注册表（当前为内置模型的权威来源）：[IMAGE_MODEL_CAPABILITIES](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts#L465-L535)、[IMAGE_MODEL_CAPABILITIES_BY_PROVIDER](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts#L539-L554)（仅图片有供应商级覆盖，如 `apimart:gpt-image-2`）、`VIDEO_MODEL_CAPABILITIES`（L626-771，**无**供应商级覆盖）、`FALLBACK_IMAGE_CAPABILITY` / `FALLBACK_CAPABILITY`。
- 查询函数 [getImageModelCapability](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts#L576-L592) / `getVideoModelCapability`（L794-805）：当前优先级 = 供应商覆盖 → 注册表 → 用户条目合并 FALLBACK，**内置模型忽略数据库值**。
- 读写：`get/save/resetImageModels`、`get/save/resetVideoModels`、`get/save/resetLLMModels`、`get/save/resetAudioModels`（按 provider 存服务端 setting `models_image` / `models_video` / `models_llm` / `models_audio`）。
- [initAllModels](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts#L1006-L1011)：用代码默认覆盖全部四类模型列表（任务3要删）。
- [DEFAULT_SHOT_VIDEO_CONFIG](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts#L843-L858)：写死的视频默认参数（任务2要改）。

### 写死的图片默认参数：`lib/image-client.ts`

- [DEFAULT_ASSET_IMAGE_CONFIG](file:///Users/hehuajiu/Workbuddy/mojian/lib/image-client.ts#L103-L114)：model/resolution/aspectRatio/outputFormat/watermark/responseFormat/webSearch/optimizePromptMode/quality。

### 设置页：`app/settings/page.tsx`

- 右上角入口：[L814-822](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx#L814-L822) 「初始化模型列表」按钮 → [handleInitModels](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx#L756-L790) → `initAllModels()`（任务3删除）。
- [ModelManagerPanel](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx#L1394-L1620)：四个区域共用（LLM L932 / 图片 L1041 / 视频 L1167 / 音频 L1271 的 `onReset`）。
  - 内置模型通过 `builtInValues` 判定，删除按钮禁用，能力编辑器 `readOnly`（[L1537-1542](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx#L1537-L1542) 提示"内置模型参数不可修改，仅查看"；[L1544-1558](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx#L1544-L1558) 编辑器传 `readOnly={isBuiltIn}`）。
  - 底部 [L1601-1617](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx#L1601-L1617)「初始化模型列表」按钮 → `onReset` → 各区域 `handleResetXModels` → `resetXModels`（覆盖式，清除自定义模型）（任务4改造）。
  - 能力编辑回调 `handleUpdateImageCapability`（L417-423）/ `handleUpdateVideoCapability` 已实现"合并 patch + saveImageModels/saveVideoModels 落库"，内置模型解禁后可直接复用。
- `ImageCapabilityEditor`（L1623+）/ `VideoCapabilityEditor` 已支持 `readOnly` 属性，底部有空间放「初始化模型参数」按钮。

### 默认参数使用点

图片（`DEFAULT_ASSET_IMAGE_CONFIG`）：
- [AssetPreparation.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx)：L245 state 初始化；[L509-513](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L509-L513) 打开弹框时 `{...DEFAULT_ASSET_IMAGE_CONFIG, model: getDefaultModelValue(imageModels) ?? ..., ...(asset.imageConfig ?? {})}`。
- [AssetLibrary.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx)：L736 state 初始化；L770-771 打开弹框。
- `app/series/[id]/characters/page.tsx` L39、`objects/page.tsx` L36、`scenes/page.tsx` L36：`useState(DEFAULT_ASSET_IMAGE_CONFIG)`，作弹框 `initialConfig`。
- [VideoGeneration.tsx L1649-1656](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L1649-L1656)：故事板弹框 `storyboardConfig`，在默认之上固定覆盖 `aspectRatio: "16:9", resolution: "3K"`（保留该覆盖，见决策）。

视频（`DEFAULT_SHOT_VIDEO_CONFIG`）：
- [VideoGeneration.tsx L590-596](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L590-L596)：`generateVideo` 缺省配置。
- [VideoGeneration.tsx L1611-1618](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L1611-L1618)：VideoCard 渲染回退 `shot.videoConfig ?? sanitizeConfig({...DEFAULT_SHOT_VIDEO_CONFIG, model: defaultVidModel}, cap)`。
- [VideoGeneration.tsx L1624-1637](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L1624-L1637)：供应商切换后模型失效的自动收敛。
- [app/episode/[id]/page.tsx L380-389](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/[id]/page.tsx#L380-L389)：`handleUpdateVideoConfig` 惰性写入，`base = s.videoConfig ?? DEFAULT_SHOT_VIDEO_CONFIG`。
- 新镜头由 `emptyShot()`（lib/utils.ts L16）创建，不带 `videoConfig`，渲染时走回退 → 新卡片自动使用默认参数。

## Proposed Changes

### 任务1：内置图片/视频模型参数可编辑 + 每模型「初始化模型参数」按钮

**1.1 `lib/model-presets.ts` — 能力查询优先级反转**

- `getImageModelCapability(modelValue, models?, provider?)` 改为：
  1. `models` 中找到条目且有条目级 `capability` → `{ ...FALLBACK_IMAGE_CAPABILITY, ...entry.capability }`（用户编辑生效，内置条目随列表落库后同样走此路径）；
  2. 否则 `IMAGE_MODEL_CAPABILITIES_BY_PROVIDER[${provider}:${modelValue}]`；
  3. 否则 `IMAGE_MODEL_CAPABILITIES[modelValue]`；
  4. 否则 FALLBACK。
- `getVideoModelCapability` 同理（无供应商覆盖层）：条目 `videoCapability` → `VIDEO_MODEL_CAPABILITIES` → FALLBACK。
- 更新两处函数注释：说明"用户列表中的能力矩阵优先；代码注册表作为无条目能力时的回退；代码更新能力矩阵后需通过「初始化模型参数」或「刷新内置模型列表」同步"。
- 新增辅助函数（供初始化按钮取代码默认值）：
  ```ts
  export function getCodeDefaultImageCapability(provider: string, modelValue: string): ImageModelCapability | undefined
  // 查找顺序：DEFAULT_IMAGE_MODELS[provider] 内嵌 capability → IMAGE_MODEL_CAPABILITIES_BY_PROVIDER → IMAGE_MODEL_CAPABILITIES
  export function getCodeDefaultVideoCapability(provider: string, modelValue: string): VideoModelCapability | undefined
  // 查找顺序：DEFAULT_VIDEO_MODELS[provider] 内嵌 videoCapability → VIDEO_MODEL_CAPABILITIES
  ```

**1.2 `app/settings/page.tsx` — 解禁内置模型编辑**

- `ModelManagerPanel`：
  - 删除 [L1537-1542](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx#L1537-L1542) 的"内置模型参数不可修改，仅查看"提示块；
  - `ImageCapabilityEditor` / `VideoCapabilityEditor` 的 `readOnly={isBuiltIn}` 改为 `readOnly={false}`（即移除该 prop 的绑定，编辑器保留 readOnly 属性本身）；
  - 内置模型仍不可删除（`builtInValues` 禁用删除按钮的逻辑保留）。
- 在 `ImageCapabilityEditor` / `VideoCapabilityEditor` 底部（或模型展开区底部）新增「初始化模型参数」按钮：
  - 仅当 `getCodeDefaultImageCapability(provider, m.value)` / `getCodeDefaultVideoCapability(provider, m.value)` 有值时显示（用户自添加且代码中无同名模型的不显示）；
  - 点击后经 `confirm` 确认（"确定要将该模型的参数恢复为代码默认值吗？"），调用新增的 `onInitCapability(value)` 回调。
- 页面新增 handler：
  ```ts
  async function handleInitImageModelCapability(value: string) {
    const cap = getCodeDefaultImageCapability(imgSettings.provider, value);
    if (!cap) return;
    const updated = imageModels.map((m) => m.value === value ? { ...m, capability: cap } : m);
    setImageModels(updated);
    await saveImageModels(imgSettings.provider, updated);
  }
  // handleInitVideoModelCapability 同理（videoCapability）
  ```
  通过 `ModelManagerPanel` 新 prop `onInitCapability?: (value: string) => void` 传入（图片/视频区域各传各的；LLM/音频不传则不显示按钮）。
- `ModelManagerPanel` 需要知道当前 provider 以判断有无代码默认值：新增 prop `provider?: string`，由四个区域分别传入 `provider` / `imgSettings.provider` / `vidSettings.provider` / `audSettings.provider`。

### 任务2：用户自定义默认生成参数

**2.1 持久化读写（新 setting key）**

- `lib/image-client.ts`（与 `DEFAULT_ASSET_IMAGE_CONFIG` 同文件）：
  ```ts
  /** 用户自定义的图片生成默认参数（缺省回退 DEFAULT_ASSET_IMAGE_CONFIG） */
  export async function getDefaultAssetImageConfig(): Promise<AssetImageConfig>
  export async function saveDefaultAssetImageConfig(cfg: AssetImageConfig): Promise<void>
  // setting key: "default_image_config"；读取时 { ...DEFAULT_ASSET_IMAGE_CONFIG, ...stored } 合并，容忍旧数据缺字段
  ```
- `lib/model-presets.ts`（与 `DEFAULT_SHOT_VIDEO_CONFIG` 同文件）：
  ```ts
  export async function getDefaultShotVideoConfig(): Promise<ShotVideoConfig>
  export async function saveDefaultShotVideoConfig(cfg: ShotVideoConfig): Promise<void>
  // setting key: "default_video_config"；读取时 { ...DEFAULT_SHOT_VIDEO_CONFIG, ...stored } 合并
  ```

**2.2 设置页编辑 UI（`app/settings/page.tsx`）**

- 图片区域（模型列表管理块之后、`初始化默认配置` 按钮之前）新增「默认生成参数」编辑块：
  - 字段：分辨率、宽高比、输出格式(png/jpeg)、水印、返回格式(url/b64_json)、联网搜索、提示词优化(standard/fast)、画质(low/medium/high/auto)；
  - **不含模型选择**（模型仍由模型列表的「默认」星标决定）与参考图；
  - 样式复用设置页现有紧凑控件（参考 `ImageConfigFields` 的按钮组风格，但不做能力门控，选项用静态全集：分辨率用面板已有的 `ALL_RESOLUTIONS`，宽高比用 `IMAGE_ASPECT_RATIOS`）；
  - state `defaultImageConfig` 随页面加载时 `getDefaultAssetImageConfig()` 读入，变更时自动保存（沿用页面现有 `persistImg` 式自动保存模式，或独立 `useEffect` 调 `saveDefaultAssetImageConfig`）。
- 视频区域同样位置新增「默认生成参数」编辑块：
  - 字段：模式(text2video/first-frame/first-last-frame/multimodal-ref)、分辨率、宽高比、时长(秒，-1=自动)、水印、有声、seed(-1=随机)、固定摄像头、返回尾帧、联网搜索、优先级(0-9)、样片模式；
  - 同样不含模型选择、不含参考素材类字段（firstFrameImageUrl 等）。

**2.3 消费方改用用户默认参数**

图片弹框（每次打开都以用户默认参数为基础）：
- [AssetPreparation.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx)：组件挂载/模型列表加载时 `getDefaultAssetImageConfig()` 存入 state；[openGenerateImageDialog L509-513](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L509-L513) 改为 `{ ...defaultImageConfig, model: getDefaultModelValue(imageModels) ?? defaultImageConfig.model, ...(asset.imageConfig ?? {}) }`；L245 的 `useState(DEFAULT_ASSET_IMAGE_CONFIG)` 保留作 SSR 初始值，加载后覆盖。
- [AssetLibrary.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx)：L736 / L770-771 同样改法。
- `app/series/[id]/characters/page.tsx`、`objects/page.tsx`、`scenes/page.tsx`：L36-39 的 `useState(DEFAULT_ASSET_IMAGE_CONFIG)` 保留作初始值，在各自已有的数据加载 effect 中 `getDefaultAssetImageConfig()` 后 `setImageConfig({ ...cfg, model: getDefaultModelValue(imageModels) ?? cfg.model })`（这几个页面已异步加载 imageModels，可挂在同一加载流程）。
- [VideoGeneration.tsx L1649-1656](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L1649-L1656) 故事板：`storyboardConfig` 基础改为用户默认图片参数，**保留** `aspectRatio: "16:9", resolution: "3K"` 覆盖在最上层（决策见下）；VideoGeneration 主组件加载用户默认图片参数后经 prop 传入 VideoCard（或 VideoCard 自行在 effect 中加载，优先沿用组件现有的 models 加载链路注入）。

视频卡片（缺省回退改用用户默认参数）：
- VideoGeneration 主组件加载 `getDefaultShotVideoConfig()` 存入 state（与 videoModels 同一加载链路），经 prop `defaultVideoConfig` 传给 VideoCard；
- [L590-596](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L590-L596)、[L1611-1618](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L1611-L1618)、[L1624-1637](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L1624-L1637) 三处的 `{ ...DEFAULT_SHOT_VIDEO_CONFIG, model: defaultVidModel }` 改为 `{ ...defaultVideoConfig, model: defaultVidModel }`（`defaultVidModel = getDefaultModelValue(videoModels) ?? defaultVideoConfig.model`）；
- [app/episode/[id]/page.tsx L385](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/[id]/page.tsx#L385)：`handleUpdateVideoConfig` 的 `base = s.videoConfig ?? defaultVideoConfig`；episode 页在加载 episode 时一并 `getDefaultShotVideoConfig()` 存 state（注意 effect 内 setState 避免水合问题，初始值仍用 `DEFAULT_SHOT_VIDEO_CONFIG`）。

**行为说明**：已记录 `videoConfig` / `imageConfig` 的卡片完全不变；未记录参数的旧卡片与新卡片一样按渲染时回退显示最新默认参数（惰性写入设计保持一致）。

### 任务3：删除「初始化所有模型列表」

- `app/settings/page.tsx`：删除右上角按钮（[L814-822](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx#L814-L822)）、`handleInitModels`（L756-790）、`initializing` state 及 `initAllModels` 的 import（若 `Button` 在该处无其他用途则保留 import，页内其他按钮仍在用）。
- `lib/model-presets.ts`：删除 [initAllModels](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts#L1006-L1011) 函数。

### 任务4：「初始化模型列表」→「刷新内置模型列表」（四个区域）

**4.1 `lib/model-presets.ts` 新增合并刷新函数**

```ts
/** 通用合并：代码最新内置列表 + 用户自添加模型（不在代码内置列表中的条目原样保留，含已被代码移除的旧内置模型） */
function mergeWithBuiltIn<T extends ModelEntry[]>(builtIn: T, current: T): T

export async function refreshBuiltInLLMModels(provider): Promise<ModelEntry[]>
export async function refreshBuiltInImageModels(provider): Promise<ModelEntry[]>
export async function refreshBuiltInVideoModels(provider): Promise<ModelEntry[]>
export async function refreshBuiltInAudioModels(provider): Promise<ModelEntry[]>
// 实现：const current = await getXModels(provider); merged = [...DEFAULT_X_MODELS[provider] ?? [], ...current.filter(m => !builtInValues.has(m.value))]; await saveXModels(provider, merged); return merged;
```

- 旧的 `resetLLMModels/resetImageModels/resetVideoModels/resetAudioModels` 删除（确认无其他调用方后；grep 确认仅 settings 页使用）。
- 注意：合并后内置条目整体被代码最新版替换 → 内置模型上手动改过的参数会恢复代码默认（与任务1的单模型「初始化模型参数」形成粒度互补），confirm 文案需说明。

**4.2 `app/settings/page.tsx`**

- 四个 `handleResetXModels` 改为 `handleRefreshXModels`，调用对应 `refreshBuiltInXModels`，刷新后保留当前选中模型（沿用现有"不在列表则切到第一个"逻辑；视频区域的 handler 参照图片的写法补齐该逻辑）。
- `ModelManagerPanel`：
  - prop `onReset` 改名 `onRefresh`（语义清晰）；
  - 底部按钮文案 [L1615](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx#L1615) 改为「刷新内置模型列表」；
  - confirm 文案改为："将用代码中最新的内置模型替换当前内置模型（内置模型上手动修改的参数会恢复默认），你添加的自定义模型会保留。确定刷新吗？"，confirmText「刷新」。

## Assumptions & Decisions

1. **默认参数不含模型选择**：图片/视频默认参数的 model 仍由模型列表中的「默认」星标（`getDefaultModelValue`）决定，设置页默认参数编辑块不提供模型下拉。
2. **数据库能力值优先于代码注册表**：这是任务1的必然结果——用户编辑内置模型参数必须生效。代价是代码后续更新能力矩阵时旧数据不会自动跟进，由「初始化模型参数」（单模型）和「刷新内置模型列表」（整表）两个手动入口兜底，注释中写明。
3. **音频模型不做参数编辑**：任务1只覆盖图片/视频（音频区本就没有能力编辑器）；但任务4的刷新按钮四个区域都应用。
4. **故事板弹框保留 16:9/3K 覆盖**：在用户默认图片参数之上叠加，与现状一致。
5. **刷新时被代码移除的旧内置模型**：视为用户模型保留在列表尾部（变为可删除、可编辑），与用户描述"代码最新列表 + 用户自己添加的列表"一致。
6. **未调整过参数的旧视频卡片**：修改默认参数后会随渲染回退显示新默认（惰性写入不变；已调整过的卡片有 `videoConfig` 落库，不受影响）。
7. **默认参数校验**：默认参数是跨模型的原始值，应用时在消费端按当前模型能力收敛（视频走现有 `sanitizeConfig`，图片走 `ImageConfigFields` 现有的能力收敛 effect），编辑 UI 不做能力门控。

## Verification

1. `npx tsc --noEmit` 类型检查通过（项目无 lint 脚本）。
2. `npm run build` 构建通过。
3. 手动验证：
   - 设置页展开内置图片/视频模型 → 参数可改、保存后生成端（弹框能力门控/视频卡片参数面板）生效；点「初始化模型参数」恢复代码默认。
   - 设置页修改图片/视频「默认生成参数」→ 打开图片生成弹框（资产准备/资产库/人物物品场景设定/故事板）、新增镜头卡片均使用新默认；已调过参数的旧卡片不变。
   - 设置页右上角不再有「初始化模型列表」按钮。
   - 各 API 区域点「刷新内置模型列表」→ 内置模型恢复代码最新（含参数）、自添加模型保留；代码里删掉一个内置模型再刷新，该模型保留为可删除的用户模型。
