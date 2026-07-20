# 接入 APIMart 图片供应商（gpt-image-2）

## 概述

新增 APIMart 作为图片生成供应商，与已有的 65535（`openai` provider）并存。两者都使用 `gpt-image-2` 模型名，但 API 契约差异较大（提交/查询端点、响应包络、尺寸参数、参考图方式均不同）。本次改造在不动现有 65535 链路的前提下，新增 provider 级的能力覆盖与路由分支，确保所有图片生成入口（资产准备、故事板、人物/场景/物品设定页）均支持 APIMart，包括异步轮询与刷新恢复。

## 当前状态分析

### 现有图片生成链路（65535 / openai provider）

| 机制 | 文件 | 说明 |
|------|------|------|
| 供应商联合类型 | [types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts) L270-275 | `provider: "ark" \| "ark-plan" \| "openai" \| "custom"`，`openai` 即 65535 |
| 供应商预设 | [image-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/image-client.ts) L46-85 | `IMAGE_PROVIDER_PRESETS`，`openai.baseURL = https://img-cn.65535.space/v1` |
| 模型能力注册表 | [model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts) L403-472 | **按模型值索引**：`gpt-image-2` → `quality:true, supportsPolling:true, maxRefImages:10`，分辨率用像素串 |
| 能力查询 | [model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts) L493-504 | `getImageModelCapability(modelValue, models?)`：注册表优先，自定义模型回退 |
| 生成入口 | [image-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/image-client.ts) L170-250 | `generateImage`：`cap.supportsPolling` 时设 `asyncMode:true` → POST `/api/image` 拿 `jobId` → `pollImageTask` |
| 提交路由 | [api/image/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/../app/api/image/route.ts) L28-172 | `cap.quality && hasRefImages` → `/images/edits`(multipart)；否则 `/images/generations`(JSON)；异步加 `X-Async-Mode:true`；解析 `data.job_id` |
| 查询路由 | [api/image/query/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/image/query/route.ts) L24-105 | `GET {base}/images/async-generations/{jobId}`；解析 `{code,data:{status,result_urls}}`；`done/running/pending/failed` 映射 |
| 卡片配置 UI | [ImageConfigFields.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ImageConfigFields.tsx) L26 | `getImageModelCapability(value.model, imageModels)`，**当前 `void provider` 忽略 provider** |
| 调用方（5 处） | AssetPreparation / VideoGeneration / characters / scenes / objects | 均调 `generateImage` + `resumeImageGeneration`；均向 `ImageGenerationDialog` 传 `provider` prop |

### 65535 与 APIMart 的关键差异

| 维度 | 65535（现有 openai） | APIMart（新增） |
|------|------|------|
| Base URL | `https://img-cn.65535.space/v1` | `https://api.apimart.ai/v1` |
| 提交端点 | `POST /images/generations` + `X-Async-Mode:true` 头 | `POST /images/generations`（始终异步，无特殊头） |
| 提交响应 | `{job_id, status, status_url, created}`（202） | `{code:200, data:[{status:"submitted", task_id}]}`（**data 是数组**） |
| 查询端点 | `GET /images/async-generations/{job_id}` | `GET /tasks/{task_id}?language=zh` |
| 查询响应 | `{code:0, data:{status, result_urls:[...]}}` | `{code:200, data:{status, progress, result:{images:[{url:[...], expires_at}]}, error?:{code,message,type}}}` |
| 查询状态值 | pending/running/done/failed | pending/processing/completed/failed/cancelled（`submitted` 仅出现在提交响应，查询不返回） |
| 取图 | `data.result_urls[0]` | `data.result.images[0].url[0]` |
| 进度 | 无 | `data.progress`（0–100，可选用） |
| 错误结构 | `data.error_message`/`error_code` | `data.error:{code,message,type}`（仅 failed 时存在）；HTTP 错误体为 `{error:{code,message,type}}` |
| 尺寸 | `size` 像素串（`2048x2048`/`auto`） | `size` 比例（`16:9`）+ `resolution`（`1k`/`2k`/`4k`）正交 |
| 画质 | `quality`（low/medium/high/auto） | 不支持 `quality` |
| 参考图 | `/images/edits` multipart `image[]` | 同一 body 的 `image_urls` 数组（URL/base64 混填，≤16 张） |
| 返回格式 | `response_format` url/b64_json | 仅返回 url（`response_format`/`style` 被忽略） |

### 核心设计挑战

两个供应商共享模型名 `gpt-image-2`，而能力注册表按模型值索引。若不做 provider 级覆盖，APIMart 会命中 65535 的能力（像素尺寸 + quality），导致参数错配。因此需引入 **provider 级能力覆盖**，并在提交/查询路由中按 provider 分流。

---

## 改动方案

### 步骤 1：类型层 — [lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts)

**1.1 `ImageGenSettings.provider` 增加 `"apimart"`**（L271）

```typescript
export interface ImageGenSettings {
  provider: "ark" | "ark-plan" | "openai" | "apimart" | "custom";
  baseURL: string;
  apiKey: string;
  model: string;
}
```

**1.2 `ImageProxyRequest` 增加 `resolution` 字段**（L299-319）

APIMart 的 `resolution`（1k/2k/4k）需独立于 `size`（比例）传输。新增可选字段：

```typescript
export interface ImageProxyRequest {
  // ... 现有字段 ...
  size?: string;
  /** APIMart 分辨率档位（1k/2k/4k），与 size(比例) 正交 */
  resolution?: string;
  // ...
}
```

**1.3 `ImageQueryProxyRequest` 增加 `provider` 字段**（L337-341）

查询路由需按 provider 选择端点与解析方式：

```typescript
export interface ImageQueryProxyRequest {
  provider: ImageGenSettings["provider"];
  apiKey: string;
  baseURL: string;
  jobId: string;
}
```

> 向后兼容：路由侧对缺 `provider` 的旧请求按 `openai`（65535）路径处理。

---

### 步骤 2：模型能力 — [lib/model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts)

**2.1 新增 provider 级能力覆盖注册表**（紧随 `IMAGE_MODEL_CAPABILITIES` 之后，约 L472）

```typescript
/** 供应商级模型能力覆盖（键格式 `${provider}:${modelValue}`）。
 *  用于同一模型名在不同供应商下能力不同的情况（如 gpt-image-2 在 65535 与 APIMart 下参数不同）。 */
export const IMAGE_MODEL_CAPABILITIES_BY_PROVIDER: Record<string, ImageModelCapability> = {
  "apimart:gpt-image-2": {
    resolutions: ["1K", "2K", "4K"],
    outputFormat: false,
    webSearch: false,
    optimizePrompt: false,
    optimizePromptFast: false,
    sequentialImageGen: false,
    watermark: false,
    responseFormat: false,
    quality: false,
    supportsPolling: true,
    maxRefImages: 16,
  },
};
```

**2.2 `getImageModelCapability` 增加 `provider?` 参数**（L493-504）

provider 级覆盖优先于全局注册表，保证 APIMart 命中自己的能力，65535 路径完全不变：

```typescript
export function getImageModelCapability(
  modelValue: string,
  models?: ModelEntry[],
  provider?: string
): ImageModelCapability {
  if (provider) {
    const override = IMAGE_MODEL_CAPABILITIES_BY_PROVIDER[`${provider}:${modelValue}`];
    if (override) return override;
  }
  const registry = IMAGE_MODEL_CAPABILITIES[modelValue];
  if (registry) return registry;
  const base = FALLBACK_IMAGE_CAPABILITY;
  if (!models) return base;
  const entry = models.find((m) => m.value === modelValue);
  if (!entry?.capability) return base;
  return { ...base, ...entry.capability };
}
```

**2.3 `DEFAULT_IMAGE_MODELS` 增加 `apimart` 供应商**（L83，与 `openai` 同级）

```typescript
apimart: [
  {
    value: "gpt-image-2", label: "GPT-Image-2",
    hint: "APIMart gpt-image-2，异步任务模式，支持 15 种比例 + 1K/2K/4K 分辨率，参考图最多 16 张",
    isDefault: true,
    capability: {
      resolutions: ["1K", "2K", "4K"], outputFormat: false, webSearch: false,
      optimizePrompt: false, optimizePromptFast: false, sequentialImageGen: false,
      watermark: false, responseFormat: false, quality: false, supportsPolling: true, maxRefImages: 16,
    },
  },
],
```

> 注：因 `gpt-image-2` 在全局注册表中，inline `capability` 不会被 `getImageModelCapability` 使用（注册表优先）；这里保留 inline 仅供 `ModelManagerPanel` 的「能力编辑器」展示与文档说明。实际生效能力来自步骤 2.1 的 provider 覆盖（通过传入 `provider` 触发）。

---

### 步骤 3：图片客户端 — [lib/image-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/image-client.ts)

**3.1 `IMAGE_PROVIDER_PRESETS` 增加 `apimart`**（L46-85）

```typescript
apimart: {
  baseURL: "https://api.apimart.ai/v1",
  model: "gpt-image-2",
  label: "APIMart（GPT-Image-2）",
  hint: "APIMart 图片生成 API。前往 apimart.ai/keys 获取 API Key。基于 OpenAI Images 兼容协议，异步处理返回 task_id，通过 /v1/tasks/{task_id} 轮询。支持 15 种比例 + 1K/2K/4K 分辨率档位，参考图最多 16 张（image_urls，支持 URL/base64 混填）。",
  sizes: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"],
  supportsOutputFormat: false,
  supportsWatermark: false,
},
```

**3.2 `generateImage` 改为 provider 感知的 body 构造**（L170-250）

- 能力查询传入 provider：`const cap = getImageModelCapability(model, models, s.provider);`
- APIMart 映射：`size = 宽高比`、`resolution = 分辨率档位.toLowerCase()`、**不**把宽高比拼进提示词
- 其余 provider 维持现状（宽高比拼提示词、`size = 分辨率`）

```typescript
const isApimart = s.provider === "apimart";
const body: ImageProxyRequest = {
  provider: s.provider,
  apiKey: s.apiKey,
  baseURL: s.baseURL,
  model,
  prompt: isApimart ? prompt : appendAspectRatioToPrompt(prompt, cfg.aspectRatio),
  size: isApimart ? (cfg.aspectRatio === "auto" ? "1:1" : cfg.aspectRatio) : cfg.resolution,
  responseFormat: cfg.responseFormat,
};
if (isApimart) body.resolution = cfg.resolution.toLowerCase();
// 现有 cap.* 条件分支保持不变（APIMart 下 quality/outputFormat/watermark/webSearch 均为 false，不会附加）
if (images && images.length > 0) body.images = images;
```

轮询调用传入 provider：
```typescript
const final = await pollImageTask(created.jobId, s.apiKey, s.baseURL, undefined, 3000, 5 * 60 * 1000, signal, s.provider);
```

**3.3 `queryImageTask` 增加 `provider` 参数并写入请求体**（L256-276）

```typescript
export async function queryImageTask(
  jobId: string, apiKey: string, baseURL: string, provider: ImageGenSettings["provider"]
): Promise<ImageQueryProxyResponse> {
  const reqBody: ImageQueryProxyRequest = { provider, apiKey, baseURL, jobId };
  // ... 其余不变 ...
}
```

**3.4 `pollImageTask` 增加 `provider` 参数透传**（L288-317）

签名加 `provider: ImageGenSettings["provider"]`，内部 `queryImageTask(...)` 透传。

**3.5 `resumeImageGeneration` 读取 provider 并透传**（L326-340）

```typescript
const final = await pollImageTask(jobId, s.apiKey, s.baseURL, onUpdate, 3000, 5 * 60 * 1000, signal, s.provider);
```

**3.6 `isPollingSupported` 增加 `provider?` 参数**（L345-347）

```typescript
export function isPollingSupported(model: string, models?: ModelEntry[], provider?: string): boolean {
  return getImageModelCapability(model, models, provider).supportsPolling ?? false;
}
```

> 对 `gpt-image-2`，65535 与 APIMart 的 `supportsPolling` 均为 true，故即便不传 provider 也正确；传 provider 仅为未来扩展与一致性。

**3.7 `testImageConnection` 支持异步轮询供应商**（L350-386）

APIMart 始终异步，现有同步测试拿不到 `imageUrl`。改为：当模型 `supportsPolling` 时走「异步提交 + 轮询至完成」：

```typescript
const cap = getImageModelCapability(s.model, undefined, s.provider);
if (cap.supportsPolling) {
  const isApimart = s.provider === "apimart";
  const body: ImageProxyRequest = {
    provider: s.provider, apiKey: s.apiKey, baseURL: s.baseURL.replace(/\/+$/, ""),
    model: s.model || "gpt-image-2", prompt: "一只可爱的小猫，写实风格",
    size: isApimart ? "1:1" : "1024x1024", asyncMode: true,
  };
  if (isApimart) body.resolution = "1k";
  const createRes = await fetch("/api/image", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
  if (!createRes.ok) { /* 解析错误，返回 ok:false */ }
  const created = (await createRes.json()) as ImageAsyncCreateResponse;
  const final = await pollImageTask(created.jobId, s.apiKey, s.baseURL, undefined, 3000, 5 * 60 * 1000, undefined, s.provider);
  if (final.status === "done" && final.imageUrl) return { ok:true, message:"连接成功，已生成测试图片", imageUrl: final.imageUrl };
  return { ok:false, message:`连接失败：${final.error || "图片生成失败"}` };
}
// 非 polling 供应商：保留现有同步逻辑
```

---

### 步骤 4：提交路由 — [app/api/image/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/image/route.ts)

在现有逻辑前增加 APIMart 独立分支（早返回，不污染 65535 路径）。能力查询传入 provider：

```typescript
const cap = getImageModelCapability(body.model, undefined, body.provider);

// ---- APIMart 供应商：始终异步，image_urls 参考图，task_id 返回格式 ----
if (body.provider === "apimart") {
  const upstreamBody: Record<string, unknown> = { model: body.model, prompt: body.prompt, n: 1 };
  if (body.size) upstreamBody.size = body.size;            // 比例，如 "16:9"
  if (body.resolution) upstreamBody.resolution = body.resolution;  // "1k"/"2k"/"4k"
  if (body.images && body.images.length > 0) {
    upstreamBody.image_urls = body.images.slice(0, 16);    // URL/base64 混填
  }
  const url = `${base}/images/generations`;
  // fetch（JSON，无 X-Async-Mode 头）→ 复用现有 !upstream.ok / 非 JSON / 错误解析逻辑
  // 解析提交响应：{ code: 200, data: [{ status, task_id }] }
  const arr = (data as { data?: Array<{ task_id?: string; status?: string }> })?.data;
  const taskId = Array.isArray(arr) && arr.length > 0 ? arr[0].task_id : undefined;
  if (!taskId) return Response.json({ error: "APIMart 未返回 task_id" }, { status: 502 });
  return Response.json({ jobId: taskId, status: arr[0].status ?? "submitted" } satisfies ImageAsyncCreateResponse);
}

// ---- 以下保持现有 65535/ark 逻辑不变 ----
```

> APIMart 分支始终返回 `ImageAsyncCreateResponse`（客户端对 polling 模型必带 `asyncMode:true`），不涉及同步 `imageUrl` 解析。错误处理（`!upstream.ok`、非 JSON、上游错误 message 提取）复用现有片段。

---

### 步骤 5：查询路由 — [app/api/image/query/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/image/query/route.ts)

`ImageQueryProxyRequest` 现含 `provider`。参数校验改为 `baseURL/apiKey/jobId` 必填（`provider` 可选，缺省按 65535）。在现有 65535 解析前增加 APIMart 分支：

```typescript
const base = body.baseURL.replace(/\/+$/, "");

// ---- APIMart：GET /tasks/{task_id}?language=zh，解析 result.images[0].url[0] ----
if (body.provider === "apimart") {
  // language=zh 使错误/状态文案为中文，与 App UI 语言一致
  const url = `${base}/tasks/${encodeURIComponent(body.jobId)}?language=zh`;
  // fetch GET -> 复用现有 !upstream.ok / 非 JSON / 错误解析逻辑
  //   HTTP 错误体：{ error: { code, message, type } }（400 无效任务ID / 401 / 402 / 403 / 429 / 500 / 502）
  //   成功体：{ code: 200, data: { id, status, progress, result?: { images: [{ url: [...], expires_at }] }, error?: { code, message, type } } }
  const task = (parsed as { data?: Record<string, unknown> })?.data ?? parsed;
  const rawStatus = String(task.status ?? "failed").toLowerCase();
  let status: ImageTaskStatus;
  if (rawStatus === "completed") status = "done";
  else if (rawStatus === "processing") status = "running";
  else if (rawStatus === "pending" || rawStatus === "submitted") status = "pending"; // submitted 兜底
  else status = "failed"; // failed / cancelled / 未知 -> failed
  const result: ImageQueryProxyResponse = { status };
  if (status === "done") {
    const imgs = (task as { result?: { images?: Array<{ url?: string[] }> } }).result?.images;
    const urls = imgs && imgs.length > 0 ? imgs[0].url : undefined;
    if (Array.isArray(urls) && urls.length > 0) result.imageUrl = urls[0];
    else { result.status = "failed"; result.error = "任务完成但未返回图片 URL"; }
  } else if (status === "failed") {
    // failed 或 cancelled：优先取 data.error.message；cancelled 无 error 时给明确文案
    const errMsg = (task as { error?: { message?: string } }).error?.message;
    result.error = errMsg || (rawStatus === "cancelled" ? "任务已取消" : "图片生成失败");
  }
  return Response.json(result);
}

// ---- 以下保持现有 65535 解析逻辑不变 ----
```

> 状态映射要点（参照 docs/APIMart/taskQuery.md）：`completed->done / processing->running / pending->pending / failed|cancelled->failed`。查询接口不返回 `submitted`（它仅出现在提交响应），此处保留 `submitted->pending` 仅作兜底。`cancelled` 为用户取消的终态，按 failed 处理并给出「任务已取消」文案。`progress`(0–100) 字段 APIMart 会返回，当前 `ImageQueryProxyResponse` 未承载进度，如需 UI 进度条可后续在类型加 `progress?: number` 并透传（非本次必需）。

---

### 步骤 6：卡片配置 UI — [components/ImageConfigFields.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ImageConfigFields.tsx)

L25-26：移除 `void provider;`，把 provider 传入能力查询：

```typescript
const cap = getImageModelCapability(value.model, imageModels, provider);
```

效果：APIMart 下「分辨率」按钮组显示 `1K/2K/4K`，「画质」「输出格式」「返回格式」「水印」「联网搜索」「提示词优化」均隐藏（cap 对应字段为 false）；「宽高比」组复用 `IMAGE_ASPECT_RATIOS`（8 个常用比例，是 APIMart 15 种的子集）。65535/ark 下渲染完全不变。

---

### 步骤 7：弹框能力引用 — [components/ImageGenerationDialog.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx)

L258：`maxRefImages` 查询传入 provider（APIMart 为 16，65535 为 10）：

```typescript
const maxRefImages = getImageModelCapability(config.model, imageModels, provider).maxRefImages;
```

> 该组件已接收 `provider` prop（L85/L111），各调用方均已传入（见步骤 8 验证），无需改 props 透传链。

---

### 步骤 8：调用方适配（5 个生成入口）

各入口已向 `ImageGenerationDialog` 传 `provider={imageProvider}`，且 `generateImage`/`resumeImageGeneration` 内部读取 settings 自带 provider，故主体无需改动。仅一处显式调用 `isPollingSupported` 需补 provider：

- [AssetPreparation.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx) L176：
  ```typescript
  if (!isPollingSupported(model, imageModels, imageProvider)) continue;
  ```
  （`imageProvider` 为组件级 state，已在 L998 使用，作用域内可用）

其余入口（VideoGeneration、characters、scenes、objects）的恢复轮询通过 `resumeImageGeneration` 内部读取 provider 完成，无需改动；`ImageGenerationDialog` 已透传 provider，`ImageConfigFields` 渲染自动正确。

---

### 步骤 9：设置页 — [app/settings/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx)

**无需显式改动**。供应商按钮网格（L991 `Object.keys(IMAGE_PROVIDER_PRESETS)`）与模型管理 `builtInValues`（L1033 `DEFAULT_IMAGE_MODELS[imgSettings.provider]`）均按 key 动态枚举，步骤 3.1/2.3 加完 `apimart` 后自动出现按钮与默认模型。`handleImageProviderChange`/`handleInitImageProvider` 为通用逻辑，对 `apimart` 同样生效（切换时填预设 baseURL/model、恢复缓存 key、重载模型列表）。

---

## 假设与决策

1. **APIMart 作为独立 provider `apimart`**：与 `openai`(65535) 并列，互不影响。用户明确要求「不破坏现有、两者都能用」，独立 provider 是唯一不侵入 65535 链路的方式。
2. **provider 级能力覆盖**：因 65535 与 APIMart 共享模型名 `gpt-image-2`，全局注册表无法区分，故引入 `IMAGE_MODEL_CAPABILITIES_BY_PROVIDER`（键 `${provider}:${model}`），覆盖优先于全局注册表。65535 路径不传 provider 或传 `openai`，命中全局注册表，行为不变。
3. **尺寸映射（用户已确认）**：宽高比 → APIMart `size`（比例），分辨率档位(1K/2K/4K) → APIMart `resolution`（小写 1k/2k/4k）。APIMart 不再把宽高比拼进提示词。
4. **`official_fallback`（用户已确认）**：暂不暴露，始终默认 `false`，保持 UI 简洁。
5. **参考图**：APIMart 用同一 body 的 `image_urls`（URL/base64 混填，≤16），不走 `/images/edits`。客户端 `body.images` 复用现有字段，路由按 provider 决定如何发送。
6. **返回格式**：APIMart 仅返回 url（`response_format` 被忽略），故 APIMart 能力 `responseFormat:false`，UI 不显示返回格式选项；`generateImage` 仍传 `responseFormat`，路由 APIMart 分支忽略它。
7. **轮询参数**：复用现有 `pollImageTask`（3s 间隔、5min 超时、AbortSignal），APIMart 状态映射 `completed→done / processing→running / pending→pending / failed|cancelled→failed`（`submitted` 仅出现在提交响应，查询不返回，保留兜底）；查询加 `?language=zh` 使文案中文化；`cancelled` 终态按 failed 处理并提示「任务已取消」。
8. **向后兼容**：`ImageQueryProxyRequest.provider` 为新增可选字段，路由对缺省值按 65535 处理；旧设置数据无 `apimart` provider 不受影响。
9. **默认分辨率**：`DEFAULT_ASSET_IMAGE_CONFIG.resolution = "2K"`，APIMart 支持 `2k`，用户切到 APIMart 后若当前分辨率不在 `["1K","2K","4K"]`，`ImageConfigFields` 的 useEffect（L29-47）会收敛到第一个支持值。

---

## 验证步骤

1. **编译检查**：`npm run build`（或 `npm run lint` + `tsc --noEmit`）无类型错误
2. **设置页**：图片区域供应商网格出现「APIMart（GPT-Image-2）」按钮；点击切换后 baseURL 自动填 `https://api.apimart.ai/v1`、模型为 `gpt-image-2`；填入 APIMart Key 后「测试连接」走异步提交+轮询，返回测试图片
3. **65535 回归**：切回「OpenAI（65535.space中转）」供应商，原有 baseURL/模型/Key 恢复，测试连接与生成均正常（确认未被破坏）
4. **卡片配置 UI**：APIMart 下「分辨率」显示 1K/2K/4K，无「画质/输出格式/返回格式/水印」；65535 下「分辨率」显示像素串 + auto，有「画质」
5. **文生图（APIMart）**：资产准备/故事板/人物/场景/物品 5 个入口分别用 APIMart 生成单图，成功返回 url 并转存 COS
6. **图生图（APIMart）**：弹框加 1~2 张参考图（URL/base64），生成成功（路由走 `image_urls`，非 `/images/edits`）
7. **轮询恢复（APIMart）**：APIMart 生成中切页/刷新，`imageTaskId` 已持久化；重新挂载后 `resumeImageGeneration` 通过 `GET /tasks/{task_id}` 恢复轮询至完成
8. **轮询恢复（65535 回归）**：同样场景下 65535 任务恢复仍走 `/images/async-generations/{jobId}`，正常完成
9. **错误路径**：APIMart Key 错误（401）/余额不足（402）/限流（429）时，前端收到可读错误信息；任务 `failed` 时显示 `error.message`
