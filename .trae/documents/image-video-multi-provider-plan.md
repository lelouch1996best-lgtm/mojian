# 图片/视频生成 API 多供应商 + 图片参数下沉到卡片级

## 概述

当前对话 API（LLM）支持多供应商选择（DeepSeek/GLM/MiMo/火山方舟等），但图片生成 API 和视频生成 API 均硬编码为火山引擎单一供应商。本次改造：

1. **图片 API 多供应商**：参照 LLM 的 `provider` + `PROVIDER_PRESETS` 模式，为图片 API 增加 `ark`（火山引擎 Seedream）、`openai`（DALL-E）、`custom` 三个供应商选项。
2. **视频 API 多供应商**：为视频 API 增加 `ark`（火山引擎 Seedance）和 `custom` 两个供应商选项。
3. **图片参数下沉**：将 `ImageGenSettings` 中的 `size`/`outputFormat`/`watermark`/`responseFormat` 移除，改为在每个资产卡片上配置（参照视频的 `ShotVideoConfig` 模式），全局设置只保留 `provider`/`baseURL`/`apiKey`/`model`。

---

## 当前状态分析

### 对话 API（多供应商参照模板）

| 机制 | 文件 | 说明 |
|------|------|------|
| `provider` 联合类型 | [types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts) L3-L10 | `LLMSettings.provider` 有 7 个选项 |
| `PROVIDER_PRESETS` 注册表 | [llm-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/llm-client.ts) L17-L64 | 每个 provider 的 baseURL/默认模型/label/keyPrefix/hint |
| 供应商 API Key 缓存 | [llm-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/llm-client.ts) L76-L89 | `llm_provider_keys` 存 `Record<provider, key>`，切换时自动恢复 |
| 供应商级模型列表 | [model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts) L27-L67 | `DEFAULT_LLM_MODELS: Record<provider, ModelEntry[]>` |
| 供应商级模型 CRUD | [model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts) L186-L212 | `getLLMModels(provider)` / `saveLLMModels(provider, models)` |
| 供应商按钮网格 UI | [SettingsModal.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/SettingsModal.tsx) L504-L523 | 按钮网格 + `handleProviderChange` |
| API 路由 | [api/llm/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/llm/route.ts) | 供应商无关，只转发到 `{baseURL}/chat/completions` |

### 图片 API（当前：单供应商 + 全局参数）

| 机制 | 文件 | 当前状态 |
|------|------|---------|
| `ImageGenSettings` | [types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts) L221-L229 | 无 `provider`，含 `size`/`outputFormat`/`watermark`/`responseFormat` |
| 预设/默认值 | [image-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/image-client.ts) L9-L45 | `IMAGE_MODEL_PRESETS`（flat，已废弃未被引用）+ `SIZE_PRESETS` + `DEFAULT_IMAGE_SETTINGS` |
| 模型列表 | [model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts) L70-L75, L216-L237 | `DEFAULT_IMAGE_MODELS: ModelEntry[]`（flat），`getImageModels()` 返回 flat 列表 |
| 设置 UI | [SettingsModal.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/SettingsModal.tsx) L603-L730 | 含 Base URL/API Key/模型/尺寸/输出格式/返回格式/水印 |
| API 路由 | [api/image/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/image/route.ts) | 转发到 `{baseURL}/images/generations`，硬编码 `sequential_image_generation: "disabled"`（Volcano 专有） |
| 生成调用 | [image-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/image-client.ts) L64-L96 | `generateImage(prompt)` 从全局设置读取所有参数 |
| 调用方 | [AssetPreparation.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx) L336, [characters/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/page.tsx) L113, [scenes/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/scenes/page.tsx) L113, [objects/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/objects/page.tsx) L113 | 4 处调用 `generateImage(prompt)` |

### 视频 API（当前：单供应商 + 卡片级参数）

| 机制 | 文件 | 当前状态 |
|------|------|---------|
| `VideoGenSettings` | [types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts) L299-L303 | 无 `provider`，仅 `apiKey`/`baseURL` |
| 预设/默认值 | [video-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts) L12-L15 | `DEFAULT_VIDEO_SETTINGS` |
| 图片 Key 复用 | [video-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts) L17-L26 | 未配置时回退图片 API 的 key/baseURL |
| 模型列表 | [model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts) L78-L84, L241-L256 | `DEFAULT_VIDEO_MODELS: ModelEntry[]`（flat） |
| 模型能力矩阵 | [model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts) L107-L169 | `VIDEO_MODEL_CAPABILITIES: Record<modelValue, VideoModelCapability>` |
| 卡片级配置 | [types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts) L281-L297 | `ShotVideoConfig`，存在 `Shot.videoConfig` 上 |
| 设置 UI | [SettingsModal.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/SettingsModal.tsx) L732-L800 | 仅 Base URL/API Key/模型列表管理 |
| 卡片级配置 UI | [VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx) L558+ | `VideoCard` 组件含模型/模式/分辨率/宽高比/时长/水印/音频 |
| API 路由 | [api/video/create/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/video/create/route.ts) | 转发到 `{baseURL}/contents/generations/tasks`（Volcano 专有） |

---

## 改动方案

### 步骤 1：类型层改造 — [lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts)

#### 1.1 `ImageGenSettings` 增加 `provider`，移除生成参数

```typescript
export interface ImageGenSettings {
  provider: "ark" | "openai" | "custom";
  baseURL: string;
  apiKey: string;
  model: string;
}
```

移除 `size` / `outputFormat` / `watermark` / `responseFormat`（下沉到卡片级配置）。

#### 1.2 新增 `AssetImageConfig` 类型（卡片级图片生成配置）

```typescript
/** 单个资产的图片生成配置（卡片级，参照 ShotVideoConfig 模式） */
export interface AssetImageConfig {
  size: string;
  outputFormat: "png" | "jpeg";
  watermark: boolean;
  responseFormat: "url" | "b64_json";
}
```

#### 1.3 `Asset` 增加 `imageConfig` 字段

```typescript
export interface Asset {
  // ... 现有字段 ...
  /** 卡片级图片生成配置；缺省时回退 DEFAULT_ASSET_IMAGE_CONFIG */
  imageConfig?: AssetImageConfig;
}
```

#### 1.4 `VideoGenSettings` 增加 `provider`

```typescript
export interface VideoGenSettings {
  provider: "ark" | "custom";
  apiKey: string;
  baseURL: string;
}
```

#### 1.5 `ImageProxyRequest` 增加 `provider` 字段

```typescript
export interface ImageProxyRequest {
  provider: "ark" | "openai" | "custom";
  apiKey: string;
  baseURL: string;
  model: string;
  prompt: string;
  size?: string;
  outputFormat?: "png" | "jpeg";
  watermark?: boolean;
  responseFormat?: "url" | "b64_json";
}
```

---

### 步骤 2：图片客户端改造 — [lib/image-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/image-client.ts)

#### 2.1 新增 `IMAGE_PROVIDER_PRESETS` 注册表

```typescript
export interface ImageProviderPreset {
  baseURL: string;
  model: string;
  label: string;
  keyPrefix?: string;
  hint?: string;
  /** 该供应商支持的尺寸选项 */
  sizes: string[];
  /** 是否支持输出格式选择 */
  supportsOutputFormat: boolean;
  /** 是否支持水印 */
  supportsWatermark: boolean;
}

export const IMAGE_PROVIDER_PRESETS: Record<ImageGenSettings["provider"], ImageProviderPreset> = {
  ark: {
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seedream-5-0-260128",
    label: "火山方舟（Seedream）",
    keyPrefix: "ark-",
    hint: "火山引擎方舟大模型服务平台。前往 console.volcengine.com/ark 获取 API Key 并开通对应模型。",
    sizes: ["2K", "3K", "4K", "2048x2048", "2304x1728", "1728x2304", "2848x1600", "1600x2848"],
    supportsOutputFormat: true,
    supportsWatermark: true,
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    model: "dall-e-3",
    label: "OpenAI DALL-E",
    keyPrefix: "sk-",
    hint: "OpenAI 官方图片生成 API，支持 DALL-E 3 和 DALL-E 2。",
    sizes: ["1024x1024", "1792x1024", "1024x1792"],
    supportsOutputFormat: false,
    supportsWatermark: false,
  },
  custom: {
    baseURL: "",
    model: "",
    label: "自定义",
    sizes: [],
    supportsOutputFormat: true,
    supportsWatermark: true,
  },
};
```

#### 2.2 更新 `DEFAULT_IMAGE_SETTINGS`

```typescript
export const DEFAULT_IMAGE_SETTINGS: ImageGenSettings = {
  provider: "ark",
  apiKey: "",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  model: "doubao-seedream-5-0-260128",
};
```

#### 2.3 新增 `DEFAULT_ASSET_IMAGE_CONFIG`

```typescript
export const DEFAULT_ASSET_IMAGE_CONFIG: AssetImageConfig = {
  size: "2K",
  outputFormat: "png",
  watermark: false,
  responseFormat: "url",
};
```

#### 2.4 新增供应商级 API Key 缓存

参照 [llm-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/llm-client.ts) L76-L89 的 `getProviderKeys`/`saveProviderKey`：

```typescript
export async function getImageProviderKeys(): Promise<Record<string, string>> { ... }
export async function saveImageProviderKey(provider: string, key: string): Promise<void> { ... }
```

存储 key: `"image_provider_keys"`。

#### 2.5 更新 `generateImage()` 签名

```typescript
export async function generateImage(
  prompt: string,
  config?: Partial<AssetImageConfig>
): Promise<ImageProxyResponse>
```

内部读取全局 `ImageGenSettings`（获取 provider/baseURL/apiKey/model）+ 传入的 `config`（或 `DEFAULT_ASSET_IMAGE_CONFIG`），组合成 `ImageProxyRequest` 发送。

#### 2.6 更新 `testImageConnection()`

接受 `ImageGenSettings` + 使用 `DEFAULT_ASSET_IMAGE_CONFIG` 作为测试参数。

#### 2.7 删除遗留常量

删除 `IMAGE_MODEL_PRESETS`（已废弃未被引用）。保留 `SIZE_PRESETS` 但重命名为 `ARK_SIZE_PRESETS`，移入 `IMAGE_PROVIDER_PRESETS.ark.sizes`。

---

### 步骤 3：视频客户端改造 — [lib/video-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts)

#### 3.1 新增 `VIDEO_PROVIDER_PRESETS` 注册表

```typescript
export interface VideoProviderPreset {
  baseURL: string;
  label: string;
  keyPrefix?: string;
  hint?: string;
}

export const VIDEO_PROVIDER_PRESETS: Record<VideoGenSettings["provider"], VideoProviderPreset> = {
  ark: {
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    label: "火山方舟（Seedance）",
    keyPrefix: "ark-",
    hint: "火山引擎方舟大模型服务平台。与图片 API 共用同一 API Key。",
  },
  custom: {
    baseURL: "",
    label: "自定义",
    hint: "自定义兼容火山引擎视频任务格式的 API 端点。",
  },
};
```

#### 3.2 更新 `DEFAULT_VIDEO_SETTINGS`

```typescript
export const DEFAULT_VIDEO_SETTINGS: VideoGenSettings = {
  provider: "ark",
  apiKey: "",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
};
```

#### 3.3 更新图片 Key 复用逻辑

`getVideoSettings()` 中未配置时的回退逻辑：仅当图片 provider 也是 `ark` 时才复用其 key/baseURL（因为只有 ark 同时支持图片和视频）。

#### 3.4 新增供应商级 API Key 缓存

```typescript
export async function getVideoProviderKeys(): Promise<Record<string, string>> { ... }
export async function saveVideoProviderKey(provider: string, key: string): Promise<void> { ... }
```

存储 key: `"video_provider_keys"`。

---

### 步骤 4：模型预设改造 — [lib/model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts)

#### 4.1 图片模型改为供应商级

```typescript
export const DEFAULT_IMAGE_MODELS: Record<ImageGenSettings["provider"], ModelEntry[]> = {
  ark: [
    { value: "doubao-seedream-5-0-260128", label: "Seedream 5.0 lite", hint: "..." },
    { value: "doubao-seedream-4-5-251128", label: "Seedream 4.5", hint: "..." },
    // ...
  ],
  openai: [
    { value: "dall-e-3", label: "DALL-E 3", hint: "最高质量，支持 1024x1024/1792x1024/1024x1792" },
    { value: "dall-e-2", label: "DALL-E 2", hint: "更快速度，更低成本" },
  ],
  custom: [],
};
```

更新 `getImageModels(provider)` / `saveImageModels(provider, models)` / `resetImageModels(provider)` 为供应商级，存储 key 仍为 `"models_image"` 但结构改为 `Record<provider, ModelEntry[]>`。

**向后兼容**：读取时若发现旧格式（flat `ModelEntry[]`），自动包装为 `{ ark: [...] }`。

#### 4.2 视频模型改为供应商级

```typescript
export const DEFAULT_VIDEO_MODELS: Record<VideoGenSettings["provider"], ModelEntry[]> = {
  ark: [
    { value: "doubao-seedance-2-0-260128", label: "Seedance 2.0（推荐）", hint: "..." },
    // ...
  ],
  custom: [],
};
```

更新 `getVideoModels(provider)` / `saveVideoModels(provider, models)` / `resetVideoModels(provider)` 为供应商级。

`VIDEO_MODEL_CAPABILITIES` 保持不变（按 model value 索引，与 provider 无关）。

**向后兼容**：同上。

#### 4.3 更新 `initAllModels()`

```typescript
export async function initAllModels(): Promise<void> {
  await apiClient.saveSetting("models_llm", DEFAULT_LLM_MODELS);
  await apiClient.saveSetting("models_image", DEFAULT_IMAGE_MODELS);
  await apiClient.saveSetting("models_video", DEFAULT_VIDEO_MODELS);
}
```

---

### 步骤 5：图片 API 路由改造 — [app/api/image/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/image/route.ts)

增加 `provider` 字段，按供应商条件构造上游请求体：

```typescript
const upstreamBody: Record<string, unknown> = {
  model: body.model,
  prompt: body.prompt,
  response_format: body.responseFormat ?? "url",
};

if (body.provider === "ark") {
  upstreamBody.watermark = body.watermark ?? false;
  if (body.size) upstreamBody.size = body.size;
  if (body.outputFormat) upstreamBody.output_format = body.outputFormat;
  upstreamBody.sequential_image_generation = "disabled";
} else if (body.provider === "openai") {
  if (body.size) upstreamBody.size = body.size;
  // OpenAI 不支持 output_format / watermark / sequential_image_generation
} else {
  // custom: 透传所有提供的参数
  if (body.size) upstreamBody.size = body.size;
  if (body.outputFormat) upstreamBody.output_format = body.outputFormat;
  if (typeof body.watermark === "boolean") upstreamBody.watermark = body.watermark;
  upstreamBody.sequential_image_generation = "disabled";
}
```

---

### 步骤 6：设置 UI 改造 — [components/SettingsModal.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/SettingsModal.tsx)

#### 6.1 图片区域增加供应商按钮网格

参照 LLM 区域 L504-L523 的按钮网格模式：
- 在图片 fieldset 顶部增加供应商按钮网格（`ark` / `openai` / `custom`）
- 新增 `handleImageProviderChange(p)` 处理器（参照 `handleProviderChange` L187-L205）：缓存当前 key → 切换 provider → 填充预设 baseURL/model → 恢复目标 key → 重载模型列表
- 新增 `imageProviderKeys` state

#### 6.2 图片区域移除生成参数字段

移除以下 UI 元素（L676-L709）：
- 生成尺寸 `<select>`
- 输出格式按钮组（png/jpeg）
- 返回格式按钮组（url/b64_json）
- 水印 checkbox

图片 fieldset 仅保留：供应商网格 / Base URL / API Key / 模型选择器 + 管理 / 测试连接。

#### 6.3 视频区域增加供应商按钮网格

- 在视频 fieldset 顶部增加供应商按钮网格（`ark` / `custom`）
- 新增 `handleVideoProviderChange(p)` 处理器
- 新增 `videoProviderKeys` state
- 模型列表管理根据当前 video provider 加载

#### 6.4 更新 `handleSaveAll()` 和初始化逻辑

- `handleSaveAll()` 中增加图片/视频的 provider key 缓存保存
- 初始化 `useEffect` 中加载 `imageProviderKeys` / `videoProviderKeys`
- 图片/视频模型列表根据当前 provider 加载

---

### 步骤 7：资产卡片图片配置 UI — [components/AssetPreparation.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx)

#### 7.1 `AssetCard` 增加图片参数配置面板

参照 [VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx) 的视频参数面板模式，在 `AssetCard` 组件（L895+）中增加可折叠的「图片参数」面板：

- 新增 `onUpdateImageConfig?: (patch: Partial<AssetImageConfig>) => void` prop
- 新增 `imageProvider: ImageGenSettings["provider"]` prop（用于决定显示哪些配置项）
- 折叠面板内容：
  - 尺寸 `<select>`：选项来自 `IMAGE_PROVIDER_PRESETS[provider].sizes`（custom 时为文本输入）
  - 输出格式按钮组：仅当 `supportsOutputFormat` 时显示
  - 水印 checkbox：仅当 `supportsWatermark` 时显示
  - 返回格式按钮组：始终显示

#### 7.2 更新 `generateImageForAsset()` 传递卡片配置

```typescript
const result = await generateImage(finalPrompt, asset.imageConfig ?? DEFAULT_ASSET_IMAGE_CONFIG);
```

#### 7.3 批量生成也使用卡片级配置

`handleGenerateAllImages()` 中每个 asset 使用各自的 `asset.imageConfig ?? DEFAULT_ASSET_IMAGE_CONFIG`。

#### 7.4 加载图片全局设置传递 provider 给卡片

`AssetPreparation` 组件加载 `getImageSettings()` 获取 provider，传递给每个 `AssetCard`。

---

### 步骤 8：人物/场景/物品设定页面适配

[characters/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/page.tsx)、[scenes/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/scenes/page.tsx)、[objects/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/objects/page.tsx) 中的 `generateImage(finalPrompt)` 调用改为 `generateImage(finalPrompt)`（不传 config，使用 `DEFAULT_ASSET_IMAGE_CONFIG` 默认值）。这些页面不需要卡片级配置 UI，使用默认参数即可。

---

### 步骤 9：视频卡片模型列表适配 — [components/VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx)

更新模型加载逻辑：`getVideoModels()` → `getVideoModels(videoProvider)`，其中 `videoProvider` 来自 `getVideoSettings()` 的 provider 字段。

```typescript
useEffect(() => {
  (async () => {
    const settings = await getVideoSettings();
    const provider = settings?.provider ?? "ark";
    setVideoModels(await getVideoModels(provider));
    setVideoConfigured(!!settings?.apiKey);
  })();
}, []);
```

---

## 假设与决策

1. **图片供应商选择 `ark` / `openai` / `custom`**：用户要求"火山引擎 + OpenAI + 其他"。`custom` 覆盖其他兼容 OpenAI 图片格式的供应商（如阿里通义万相、SiliconFlow 等），用户自行填写 baseURL。
2. **视频供应商选择 `ark` / `custom`**：用户要求"火山引擎 + 自定义"。视频 API 为火山引擎专有异步任务格式，`custom` 选项适用于兼容该格式的自定义端点。
3. **图片卡片配置使用默认值**：`Asset` 的 `imageConfig` 为可选字段，缺省时回退 `DEFAULT_ASSET_IMAGE_CONFIG`，确保旧数据兼容。
4. **人物/场景/物品设定页不增加卡片级配置 UI**：这些页面的图片生成频率低，使用默认参数即可，保持 UI 简洁。
5. **向后兼容**：读取旧格式设置时自动迁移——`ImageGenSettings` 缺少 `provider` 时默认为 `"ark"`；`models_image`/`models_video` 为 flat 数组时自动包装为 `{ ark: [...] }`。
6. **视频 Key 复用逻辑收紧**：仅当图片和视频的 provider 均为 `ark` 时才自动复用图片 API Key（因为只有 ark 同时支持图片和视频）。
7. **`IMAGE_MODEL_PRESETS` 删除**：该常量在 `image-client.ts` 中定义但全局未被引用（模型列表实际来自 `model-presets.ts`），可直接删除。

---

## 验证步骤

1. **编译检查**：`npm run build` 无 TypeScript 类型错误
2. **设置 UI**：打开设置弹窗，图片区域出现供应商按钮网格（火山方舟/OpenAI/自定义），切换供应商时 baseURL/模型/Key 自动联动；视频区域出现供应商按钮网格（火山方舟/自定义）
3. **图片设置简化**：图片区域不再显示尺寸/格式/水印/返回格式字段，仅保留供应商/Base URL/API Key/模型管理
4. **资产卡片图片配置**：第三步资产准备页面，每个资产卡片有可展开的「图片参数」面板，可配置尺寸/格式/水印/返回格式（按供应商条件显示）
5. **图片生成**：选择不同供应商后，资产卡片上选择对应参数，生成图片成功
6. **视频生成**：选择不同视频供应商后，视频卡片模型列表正确加载，生成视频成功
7. **向后兼容**：已有数据库中的旧格式设置和模型列表能正常读取，不报错
8. **人物/场景/物品设定页**：图片生成使用默认参数，功能正常
