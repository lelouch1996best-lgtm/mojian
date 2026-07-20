# 接入 APIMart 视频供应商（seedance-2.0）

## 概述

新增 APIMart 作为视频生成供应商，与已有的火山引擎（`ark` / `ark-plan`）并存。两者底层都是 seedance-2.0，但 API 契约差异较大（提交/查询端点、请求体结构、响应包络、状态值、无取消接口均不同）。本次改造在不动现有火山引擎链路的前提下，新增 `apimart` provider 分支，确保两端点都能正常生成与查询。

**两个已确认的关键决策：**
1. **取消任务**：APIMart 无取消接口，采用「本地取消」——停止本地轮询并把状态标记为「已取消」，不调用上游。
2. **任务恢复**：持久化「创建任务时使用的供应商」到 `Shot.videoTaskProvider`。切页/刷新回来恢复轮询时，按记录的供应商及其缓存凭证查询；即使用户在任务运行期间切换 ark↔apimart，两个供应商的任务都能正确恢复。

---

## 当前状态分析

### 现有视频生成链路（火山引擎 ark / ark-plan）

| 机制 | 文件 | 说明 |
|------|------|------|
| 供应商联合类型 | [types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts) L421-425 | `VideoGenSettings.provider: "ark" \| "ark-plan" \| "custom"` |
| 供应商预设 | [video-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts) L24-42 | `VIDEO_PROVIDER_PRESETS`，ark baseURL `https://ark.cn-beijing.volces.com/api/v3` |
| 模型能力注册表 | [model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts) L535-620 | `VIDEO_MODEL_CAPABILITIES`（按模型 value 索引），`getVideoModelCapability(modelValue, models)` |
| 默认模型列表 | [model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts) L195-335 | `DEFAULT_VIDEO_MODELS[provider]`，ark 模型 `doubao-seedance-2-0-260128` 等 |
| 上游请求体构造 | [video-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts) L165-196 | `buildVideoUpstreamPayload` 构造 ark 的 `content[]` 结构（snake_case） |
| 创建任务 | [video-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts) L209-249 | `createVideoTask` 透传 payload 到 `/api/video/create` |
| 查询任务 | [video-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts) L252-279 | `queryVideoTask` 透传到 `/api/video/query` |
| 轮询 | [video-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts) L289-318 | `pollVideoTask`，10s 间隔、10min 超时，终态 `succeeded/failed/expired` |
| 取消 | [video-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts) L324-348 | `cancelVideoTask` POST `/api/video/cancel` |
| 提交路由 | [api/video/create/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/video/create/route.ts) | POST `{base}/contents/generations/tasks`，解析 `data.id` |
| 查询路由 | [api/video/query/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/video/query/route.ts) | GET `{base}/contents/generations/tasks/{id}`，解析 `data.content.video_url` / `data.content.last_frame_url` |
| 取消路由 | [api/video/cancel/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/video/cancel/route.ts) | DELETE `{base}/contents/generations/tasks/{id}` |
| 恢复轮询 | [VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx) L301-326 | 进入 Step4 时遍历 `videoStatus=queued/running && videoTaskId` 的镜头，调 `pollAndFinalize` |
| 收尾 | [VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx) L505-542 | `pollAndFinalize`：成功转存 COS + 尾帧，失败/超时更新状态 |
| 创建后存 taskId | [VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx) L822-826 | `onUpdateShot(id,"videoTaskId",taskId)` 后 `pollAndFinalize` |
| 取消按钮 | [VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx) L857-866 | `cancelVideo` 调 `cancelVideoTask` 后置 `cancelled` |
| 配置收敛 | [VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx) L94-113 | `sanitizeConfig` 按 `cap` 收敛 duration/seed/cameraFixed/webSearch/priority/draft |
| 配置 UI | [VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx) L2376-2433 | 水印开关无能力门控；audio/seed/cameraFixed/webSearch/priority/draft 均 `cap.*` 门控 |
| 设置页 | [app/settings/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx) L1109-1157 | 按 `Object.keys(VIDEO_PROVIDER_PRESETS)` 动态枚举供应商按钮与模型 |

### 火山引擎（ark）与 APIMart 的关键 API 差异

| 维度 | 火山引擎（ark / ark-plan） | APIMart（新增） |
|------|------|------|
| Base URL | `https://ark.cn-beijing.volces.com/api/v3`（plan 为 `/api/plan/v3`） | `https://api.apimart.ai/v1` |
| 提交端点 | `POST /contents/generations/tasks` | `POST /videos/generations` |
| 提交请求体 | `content[]` 类型化数组（text/image_url/video_url/audio_url + role） | 扁平字段：`prompt` + `image_urls` / `image_with_roles` / `video_urls` / `audio_urls` |
| 宽高比字段 | `ratio`（16:9 等） | `size`（16:9 等，含 `adaptive`） |
| 分辨率字段 | `resolution`（480p/720p/1080p/4k） | `resolution`（同，4k 仅标准版） |
| 独有参数 | `watermark`、`camera_fixed`、`draft`、`priority` | 无这四个；支持 `duration`/`seed`/`generate_audio`/`return_last_frame`/`tools` |
| 模型名 | `doubao-seedance-2-0-260128` / `-fast-260128` / `-mini-260615`（带日期后缀） | `doubao-seedance-2.0` / `-fast` / `-mini`（点号，无后缀） |
| 提交响应 | `{ id: "task_id" }` | `{ code:200, data:[{ status:"submitted", task_id }] }`（**data 是数组**） |
| 查询端点 | `GET /contents/generations/tasks/{id}` | `GET /tasks/{task_id}?language=zh` |
| 查询响应 | `{ status, content:{ video_url, last_frame_url }, error:{ message } }` | `{ code:200, data:{ status, progress, result:{ videos:[...], images:[...] }, error:{ code,message,type } } }` |
| 查询状态值 | queued / running / succeeded / failed | pending / processing / completed / failed / cancelled |
| 视频 URL 取法 | `data.content.video_url` | `data.data.result.videos[0].url`（防御性兼容 string 与 array） |
| 尾帧 URL 取法 | `data.content.last_frame_url` | `data.data.result.images[0].url[0]`（`return_last_frame=true` 时） |
| 进度 | 无 | `data.progress`（0–100，可选用） |
| 取消接口 | `DELETE /contents/generations/tasks/{id}`（仅 queued 可取消） | **文档未提供取消接口** |
| 错误结构 | `data.error.message` | `data.data.error.message`；HTTP 错误体 `{error:{code,message,type}}` |

> 结论：差异显著，必须在客户端构造与路由层按 provider 分流；但因 APIMart 模型 value（`doubao-seedance-2.0` 等）与 ark 模型 value 不重叠，能力注册表无需 provider 级覆盖（与图片侧 gpt-image-2 不同），直接按模型 value 注册即可。

---

## 改动方案

### 步骤 1：类型层 — [lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts)

**1.1 `VideoGenSettings.provider` 增加 `"apimart"`**（L421-425）

```typescript
export interface VideoGenSettings {
  provider: "ark" | "ark-plan" | "apimart" | "custom";
  apiKey: string;
  baseURL: string;
}
```

**1.2 `Shot` 增加 `videoTaskProvider`**（L176-197，紧随 `videoTaskId`）

用于持久化创建任务时使用的供应商，切页/刷新/切供应商后仍能按正确端点与凭证恢复轮询。

```typescript
  videoTaskId: string;
  /** 创建该视频任务时使用的供应商（恢复轮询时按此选择查询端点与凭证；旧数据缺省时回退当前设置） */
  videoTaskProvider?: VideoGenSettings["provider"];
```

**1.3 新增 APIMart 上游请求体类型，并放宽 `VideoCreateProxyRequest.payload`**（L478-501）

```typescript
/** 发送给 APIMart 视频生成 API 的请求体（扁平结构） */
export interface VideoApimartUpstreamPayload {
  model: string;
  prompt: string;
  size?: string;            // 宽高比，如 "16:9"
  resolution?: string;      // 480p/720p/1080p/4k
  duration?: number;
  seed?: number;
  generate_audio?: boolean;
  return_last_frame?: boolean;
  tools?: Array<{ type: "web_search" }>;
  image_urls?: string[];
  image_with_roles?: Array<{ url: string; role: "first_frame" | "last_frame" | "reference_image" }>;
  video_urls?: string[];
  audio_urls?: string[];
}

export interface VideoCreateProxyRequest {
  provider: VideoGenSettings["provider"];
  apiKey: string;
  baseURL: string;
  payload: VideoUpstreamPayload | VideoApimartUpstreamPayload;
}
```

**1.4 `VideoCreateProxyResponse` 增加 `provider`**（L503-506）

创建后由路由回传实际使用的 provider，供组件持久化到 `Shot.videoTaskProvider`。

```typescript
export interface VideoCreateProxyResponse {
  taskId: string;
  provider?: VideoGenSettings["provider"];
}
```

**1.5 `VideoQueryProxyRequest` 增加 `provider`**（L508-513）

```typescript
export interface VideoQueryProxyRequest {
  provider: VideoGenSettings["provider"];
  apiKey: string;
  baseURL: string;
  taskId: string;
}
```

> 向后兼容：路由侧对缺 `provider` 的旧请求按 ark 路径处理。

---

### 步骤 2：模型能力 — [lib/model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts)

**2.1 `VideoModelCapability` 增加可选 `watermark`**（L506-532）

用于隐藏 APIMart（不支持水印）的水印开关；ark 模型不显式设置（undefined 视为支持），行为不变。

```typescript
export interface VideoModelCapability {
  // ... 现有字段 ...
  /** 是否支持水印（ark 支持；APIMart 不支持，false 时 UI 隐藏开关） */
  watermark?: boolean;
}
```

**2.2 `VIDEO_MODEL_CAPABILITIES` 新增 3 个 APIMart 模型**（紧随现有注册表，约 L620 前）

模型 value 与 ark 不重叠，直接注册即可，不影响 ark 路径。依据 docs/APIMart/seedance2.0.md：标准版支持 480p/720p/1080p/4k；fast/mini 仅 480p/720p；均支持 4 模式、4–15s、有声、联网搜索、返回尾帧、seed；不支持 camera_fixed/draft/priority/watermark；duration 无 -1 自动档（设 `durationAuto:false`，`sanitizeConfig` 会把 -1 收敛到 4）。

```typescript
  "doubao-seedance-2.0": {
    modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
    resolutions: ["480p", "720p", "1080p", "4k"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
    durationRange: [4, 15], durationAuto: false, audio: true, draft: false,
    seed: true, cameraFixed: false, webSearch: true, priority: false,
    returnLastFrame: true, watermark: false,
  },
  "doubao-seedance-2.0-fast": {
    modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
    resolutions: ["480p", "720p"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
    durationRange: [4, 15], durationAuto: false, audio: true, draft: false,
    seed: true, cameraFixed: false, webSearch: true, priority: false,
    returnLastFrame: true, watermark: false,
  },
  "doubao-seedance-2.0-mini": {
    modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
    resolutions: ["480p", "720p"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
    durationRange: [4, 15], durationAuto: false, audio: true, draft: false,
    seed: true, cameraFixed: false, webSearch: true, priority: false,
    returnLastFrame: true, watermark: false,
  },
```

**2.3 `DEFAULT_VIDEO_MODELS` 增加 `apimart` 供应商**（L195，与 `ark-plan` 同级）

```typescript
  apimart: [
    {
      value: "doubao-seedance-2.0", label: "Seedance 2.0（APIMart）",
      hint: "APIMart 标准版，音画同生，多模态参考，480p/720p/1080p/4k，4-15s",
      isDefault: true,
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
        resolutions: ["480p", "720p", "1080p", "4k"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
        durationRange: [4, 15], durationAuto: false, audio: true, draft: false,
        seed: true, cameraFixed: false, webSearch: true, priority: false,
        returnLastFrame: true, watermark: false,
      },
    },
    {
      value: "doubao-seedance-2.0-fast", label: "Seedance 2.0 fast（APIMart）",
      hint: "APIMart 快速版，仅 480p/720p，4-15s",
      videoCapability: { /* 同上，resolutions: ["480p","720p"] */ },
    },
    {
      value: "doubao-seedance-2.0-mini", label: "Seedance 2.0 mini（APIMart）",
      hint: "APIMart 迷你版，仅 480p/720p，4-15s",
      videoCapability: { /* 同上，resolutions: ["480p","720p"] */ },
    },
  ],
```

> inline `videoCapability` 仅供「能力编辑器」展示；实际生效能力来自步骤 2.2 注册表（`getVideoModelCapability` 优先命中注册表）。

---

### 步骤 3：视频客户端 — [lib/video-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts)

**3.1 `VIDEO_PROVIDER_PRESETS` 增加 `apimart`**（L24-42）

```typescript
  apimart: {
    baseURL: "https://api.apimart.ai/v1",
    label: "APIMart（Seedance 2.0）",
    keyPrefix: "apimart-",
    hint: "APIMart 视频生成 API。前往 apimart.ai/keys 获取 API Key。异步任务返回 task_id，通过 /v1/tasks/{task_id} 轮询。支持文生/图生/首尾帧/多模态参考，480p~4k，4-15s。无取消接口（取消为本地停止轮询）。",
  },
```

**3.2 `getVideoSettings` 增加 APIMart 图片 Key 复用**（L50-65）

APIMart 图片与视频同平台同 Key，沿用 ark 的复用逻辑：视频未配置且图片为 apimart 时，复用图片 Key + APIMart 视频 baseURL。

```typescript
    const img = await getImageSettings();
    if (img?.apiKey && (img.provider === "ark" || img.provider === "ark-plan")) {
      return { ...DEFAULT_VIDEO_SETTINGS, apiKey: img.apiKey, baseURL: img.baseURL };
    }
    if (img?.apiKey && img.provider === "apimart") {
      return { provider: "apimart", apiKey: img.apiKey, baseURL: VIDEO_PROVIDER_PRESETS.apimart.baseURL };
    }
    return null;
```

**3.3 新增 `resolveVideoCredentials` 辅助函数**（置于 `getVideoSettings` 之后）

按指定 provider 解析凭证：与当前设置一致则用当前设置；否则从 `video_provider_keys` 缓存读取（切换供应商时已落盘）。用于查询/取消时按「任务创建时的供应商」取凭证，确保跨供应商恢复。

```typescript
async function resolveVideoCredentials(
  provider?: VideoGenSettings["provider"]
): Promise<{ provider: VideoGenSettings["provider"]; apiKey: string; baseURL: string } | null> {
  const current = await getVideoSettings();
  const p = provider ?? current?.provider;
  if (!p) return null;
  let apiKey = current?.apiKey;
  let baseURL = current?.baseURL;
  if (current && p !== current.provider) {
    const cache = await getVideoProviderKeys();
    apiKey = cache[p]?.apiKey ?? apiKey;
    baseURL = cache[p]?.baseURL ?? baseURL;
  }
  if (!apiKey || !baseURL) return null;
  return { provider: p, apiKey, baseURL };
}
```

**3.4 `buildVideoUpstreamPayload` 增加 provider 分支**（L165-196）

签名增加 `provider`，apimart 分支构造扁平 body（`size`←ratio、`image_with_roles`/`image_urls`/`video_urls`/`audio_urls` 按模式映射、omit watermark/camera_fixed/draft/priority；duration=-1 时省略让其用默认 5）。

```typescript
export function buildVideoUpstreamPayload(params: {
  prompt: string;
  config: ShotVideoConfig;
  provider: VideoGenSettings["provider"];
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
}): VideoUpstreamPayload | VideoApimartUpstreamPayload {
  const { prompt, config, provider } = params;

  if (provider === "apimart") {
    const p: VideoApimartUpstreamPayload = { model: config.model, prompt, size: config.ratio };
    if (config.resolution) p.resolution = config.resolution;
    if (typeof config.duration === "number" && config.duration !== -1) p.duration = config.duration;
    if (typeof config.generateAudio === "boolean") p.generate_audio = config.generateAudio;
    if (typeof config.seed === "number" && config.seed !== -1) p.seed = config.seed;
    if (typeof config.returnLastFrame === "boolean") p.return_last_frame = config.returnLastFrame;
    if (config.webSearch) p.tools = [{ type: "web_search" }];
    if (config.mode === "first-frame" && params.firstFrameUrl) {
      p.image_with_roles = [{ url: params.firstFrameUrl, role: "first_frame" }];
    } else if (config.mode === "first-last-frame" && params.firstFrameUrl && params.lastFrameUrl) {
      p.image_with_roles = [
        { url: params.firstFrameUrl, role: "first_frame" },
        { url: params.lastFrameUrl, role: "last_frame" },
      ];
    } else if (config.mode === "multimodal-ref") {
      if (params.referenceImageUrls?.length) p.image_urls = params.referenceImageUrls;
      if (params.referenceVideoUrls?.length) p.video_urls = params.referenceVideoUrls;
      if (params.referenceAudioUrls?.length) p.audio_urls = params.referenceAudioUrls;
    }
    return p;
  }

  // ---- ark / ark-plan / custom：现有 content[] 逻辑保持不变 ----
  const content = buildVideoContent({ ...params, mode: config.mode });
  const payload: VideoUpstreamPayload = { model: config.model, content, watermark: config.watermark ?? false };
  // ... 现有 resolution/ratio/duration/generate_audio/seed/camera_fixed/return_last_frame/draft/priority/tools 赋值不变 ...
  return payload;
}
```

**3.5 `createVideoTask` 写入 provider 并回传**（L209-249）

```typescript
  const payload = buildVideoUpstreamPayload({ ...params, provider: s.provider });
  const body: VideoCreateProxyRequest = { provider: s.provider, apiKey: s.apiKey, baseURL: s.baseURL, payload };
  // ... fetch /api/video/create ...
  return (await res.json()) as VideoCreateProxyResponse;  // 含 provider
```

**3.6 `queryVideoTask` 改为按 provider 解析凭证**（L252-279）

```typescript
export async function queryVideoTask(
  taskId: string,
  provider: VideoGenSettings["provider"] | undefined,
  signal?: AbortSignal
): Promise<VideoQueryProxyResponse> {
  const creds = await resolveVideoCredentials(provider);
  if (!creds) throw new Error("未配置视频生成 API");
  const body: VideoQueryProxyRequest = { provider: creds.provider, apiKey: creds.apiKey, baseURL: creds.baseURL, taskId };
  // ... fetch /api/video/query ...
}
```

**3.7 `pollVideoTask` 增加 provider 透传 + `cancelled` 终态**（L289-318）

签名加 `provider?: VideoGenSettings["provider"]`，内部 `queryVideoTask(taskId, provider, signal)`；终态判断增加 `cancelled`：

```typescript
  if (result.status === "succeeded" || result.status === "failed" || result.status === "expired" || result.status === "cancelled") {
    return result;
  }
```

**3.8 `cancelVideoTask` 增加 provider：apimart 本地取消**（L324-348）

```typescript
export async function cancelVideoTask(
  taskId: string,
  provider: VideoGenSettings["provider"] | undefined
): Promise<void> {
  if (provider === "apimart") {
    // APIMart 无取消接口：本地取消，不调用上游
    return;
  }
  const creds = await resolveVideoCredentials(provider);
  if (!creds) throw new Error("未配置视频生成 API");
  // ... 现有 POST /api/video/cancel（用 creds.apiKey/baseURL） ...
}
```

---

### 步骤 4：提交路由 — [app/api/video/create/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/video/create/route.ts)

读取 `body.provider`，在现有 ark 逻辑前增加 APIMart 分支（早返回，不污染 ark 路径）。

```typescript
  const base = body.baseURL.replace(/\/+$/, "");

  // ---- APIMart：POST /videos/generations，解析 data[0].task_id ----
  if (body.provider === "apimart") {
    const ap = body.payload as VideoApimartUpstreamPayload;
    if (!ap.model || !ap.prompt) {
      return Response.json({ error: "payload 缺少必要字段（model / prompt）" }, { status: 400 });
    }
    const url = `${base}/videos/generations`;
    // fetch POST（JSON + Bearer）-> 复用现有 !upstream.ok / 非 JSON / 错误解析逻辑
    const data = await upstream.json();
    const arr = data?.data;
    const taskId = Array.isArray(arr) && arr.length > 0 ? arr[0].task_id : undefined;
    if (!taskId) return Response.json({ error: "APIMart 未返回 task_id" }, { status: 502 });
    return Response.json({ taskId, provider: "apimart" } satisfies VideoCreateProxyResponse);
  }

  // ---- ark / ark-plan / custom：现有逻辑不变 ----
  const { model, content } = body.payload as VideoUpstreamPayload;
  if (!model || !Array.isArray(content) || content.length === 0) { /* 400 */ }
  const url = `${base}/contents/generations/tasks`;
  // ... 现有透传 + 解析 data.id ...
  return Response.json({ taskId, provider: body.provider ?? "ark" } satisfies VideoCreateProxyResponse);
```

---

### 步骤 5：查询路由 — [app/api/video/query/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/video/query/route.ts)

`VideoQueryProxyRequest` 现含 `provider`。参数校验改为 `baseURL/apiKey/taskId` 必填（`provider` 可选，缺省按 ark）。在现有 ark 解析前增加 APIMart 分支：

```typescript
  const base = body.baseURL.replace(/\/+$/, "");

  // ---- APIMart：GET /tasks/{task_id}?language=zh ----
  if (body.provider === "apimart") {
    const url = `${base}/tasks/${encodeURIComponent(body.taskId)}?language=zh`;
    // fetch GET（Bearer）-> 复用现有 !upstream.ok / 非 JSON / 错误解析逻辑
    const parsed = await upstream.json();
    const task = parsed?.data ?? parsed;
    const rawStatus = String(task.status ?? "failed").toLowerCase();
    let status: VideoStatus;
    if (rawStatus === "completed") status = "succeeded";
    else if (rawStatus === "processing") status = "running";
    else if (rawStatus === "pending") status = "queued";
    else if (rawStatus === "cancelled") status = "cancelled";
    else status = "failed";
    const result: VideoQueryProxyResponse = { status };
    if (status === "succeeded") {
      const videos = task.result?.videos;
      const v = Array.isArray(videos) && videos.length > 0 ? videos[0] : undefined;
      let videoUrl: string | undefined;
      if (v) {
        if (typeof v.url === "string") videoUrl = v.url;
        else if (Array.isArray(v.url) && v.url.length > 0) videoUrl = v.url[0];
        else if (typeof v.video_url === "string") videoUrl = v.video_url;
      }
      if (videoUrl) result.videoUrl = videoUrl;
      else { result.status = "failed"; result.error = "任务完成但未返回视频 URL"; }
      // 尾帧（return_last_frame=true 时落在 result.images）
      const imgs = task.result?.images;
      const img = Array.isArray(imgs) && imgs.length > 0 ? imgs[0] : undefined;
      const imgUrls = img?.url;
      if (Array.isArray(imgUrls) && imgUrls.length > 0) result.lastFrameUrl = imgUrls[0];
      else if (typeof imgUrls === "string") result.lastFrameUrl = imgUrls;
    } else if (status === "failed") {
      result.error = task.error?.message || "视频生成失败";
    }
    return Response.json(result);
  }

  // ---- ark：现有解析逻辑不变 ----
```

> 视频 URL 结构文档未完整给出（仅图像示例为 `url:[...]`），故对 `videos[0].url` 做防御性兼容（string / array / `video_url` 兜底）。

---

### 步骤 6：取消路由 — [app/api/video/cancel/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/video/cancel/route.ts)

`apimart` 本地取消：直接返回成功，不调上游 DELETE。

```typescript
export async function POST(req: Request) {
  // ... 解析 body（含 provider）...
  if (body.provider === "apimart") {
    return Response.json({ ok: true });  // 本地取消，无上游接口
  }
  // ---- ark：现有 DELETE 逻辑不变 ----
}
```

> 客户端 `cancelVideoTask` 已在 apimart 时提前 return（不发起请求），路由此分支为双保险。

---

### 步骤 7：前端组件 — [components/VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx)

**7.1 `pollAndFinalize` 增加 `provider` 透传 + `cancelled` 收尾**（L505-542）

```typescript
  async function pollAndFinalize(
    shot: Shot, taskId: string, signal: AbortSignal,
    opts?: { silent?: boolean; provider?: VideoGenSettings["provider"] }
  ) {
    // ...
    const final = await pollVideoTask(taskId, onUpdate, 10000, 10 * 60 * 1000, signal, opts?.provider);
    if (signal.aborted) return;
    if (final.status === "succeeded" && final.videoUrl) { /* 现有：写 videoUrl + 转存 COS + 尾帧 */ }
    else if (final.status === "cancelled") {
      onUpdateVideoStatus(shot.id, "cancelled");
    } else {
      /* 现有失败/超时分支 */
    }
  }
```

**7.2 创建后持久化 `videoTaskProvider` 并透传 provider**（L813-826）

```typescript
  const createResult = await createVideoTask({ prompt: finalVideoPrompt, config, firstFrameUrl, lastFrameUrl, referenceImageUrls, referenceVideoUrls: config.referenceVideoUrls, referenceAudioUrls: mergedAudioUrls });
  onUpdateShot(shot.id, "videoTaskId", createResult.taskId);
  onUpdateShot(shot.id, "videoTaskProvider", createResult.provider);  // 新增
  onUpdateVideoStatus(shot.id, "running");
  await pollAndFinalize(shot, createResult.taskId, abortRef.current!.signal, { provider: createResult.provider });
```

**7.3 恢复轮询时透传 `shot.videoTaskProvider`**（L301-326）

```typescript
  for (const shot of episode.shots) {
    if (shot.videoStatus !== "queued" && shot.videoStatus !== "running") continue;
    if (shot.videoTaskId) {
      setVideoGeneratingIds((prev) => new Set(prev).add(shot.id));
      pollAndFinalize(shot, shot.videoTaskId, signal, { silent: true, provider: shot.videoTaskProvider }).finally(() => { /* 现有 */ });
    } else {
      onUpdateVideoStatus(shot.id, "idle");
    }
  }
```

> `queryVideoTask` 内部 `resolveVideoCredentials(provider)` 会按记录的供应商从 `video_provider_keys` 缓存取凭证，确保切供应商后仍能查询原供应商任务。

**7.4 取消按钮透传 provider**（L857-866）

```typescript
  async function cancelVideo(shot: Shot) {
    if (!shot.videoTaskId) return;
    try {
      await cancelVideoTask(shot.videoTaskId, shot.videoTaskProvider);
      onUpdateVideoStatus(shot.id, "cancelled");
    } catch (e) {
      showError(`取消失败：${(e as Error).message}`);
    }
  }
```

**7.5 水印开关按能力门控**（L2376）

`VideoModelCapability.watermark` 为 `false` 时隐藏水印开关（APIMart 不支持）；ark（undefined）保持显示。

```typescript
  {cap.watermark !== false && (
    <label className="...">
      <input type="checkbox" checked={config.watermark} onChange={(e) => onUpdateVideoConfig({ watermark: e.target.checked })} ... />
      ...
    </label>
  )}
```

并在 `sanitizeConfig` 增加收敛（L108-113 旁）：

```typescript
  if (cap.watermark === false && next.watermark) next.watermark = false;
```

---

### 步骤 8：设置页 - [app/settings/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx)

**无需显式改动**。供应商按钮网格（L1109 `Object.keys(VIDEO_PROVIDER_PRESETS)`）与模型管理 `builtInValues`（L1157 `DEFAULT_VIDEO_MODELS[vidSettings.provider]`）均按 key 动态枚举，步骤 3.1/2.3 加完 `apimart` 后自动出现按钮与默认模型。`handleVideoProviderChange`/`handleInitVideoProvider` 为通用逻辑（切换时填预设 baseURL、恢复缓存 Key、重载模型列表），对 `apimart` 同样生效。

---

## 假设与决策

1. **APIMart 作为独立 provider `apimart`**：与 `ark`/`ark-plan` 并列，互不影响。独立 provider 是不侵入火山引擎链路的唯一方式（用户要求「不破坏现有、两者都能用」）。
2. **能力注册表按模型 value 直接注册**：APIMart 模型 value（`doubao-seedance-2.0` 点号）与 ark（`doubao-seedance-2-0-260128` 连字符+日期）不重叠，无需图片侧那套 provider 级覆盖，直接加注册表项即可，ark 查询路径完全不变。
3. **取消采用本地取消（用户已确认）**：APIMart 无取消接口，`cancelVideoTask` 在 apimart 时直接 return，组件置 `cancelled` 状态；任务在 APIMart 侧仍会跑完，但前端不再轮询。
4. **持久化任务供应商（用户已确认）**：`Shot.videoTaskProvider` 记录创建时所用供应商；恢复与取消时按此 provider 通过 `resolveVideoCredentials` 取凭证（当前设置或 `video_provider_keys` 缓存），确保切页/刷新/切供应商后两个供应商的任务都能正确恢复。
5. **凭证回退**：若记录的供应商既非当前设置、缓存也缺失（极端情况），`resolveVideoCredentials` 回退到当前设置凭证，查询大概率鉴权失败并显示可读错误——可接受，无法在无凭证时查询。
6. **参数映射**：`ratio`→APIMart `size`；`resolution` 同名直传；`duration=-1` 时省略（APIMart 无自动档，用默认 5，`durationAuto:false` + `sanitizeConfig` 收敛）；`watermark`/`camera_fixed`/`draft`/`priority` 对 APIMart 省略；`seed`/`generate_audio`/`return_last_frame`/`tools` 直传。
7. **模式映射**：first-frame→`image_with_roles:[{role:"first_frame"}]`；first-last-frame→`[{first_frame},{last_frame}]`；multimodal-ref→`image_urls`+`video_urls`+`audio_urls`（对应 APIMart 场景 9）；text2video→仅 prompt。`image_urls` 与 `image_with_roles` 互斥，按模式二选一。
8. **状态映射**：pending→queued、processing→running、completed→succeeded、failed→failed、cancelled→cancelled；`cancelled` 纳入 `pollVideoTask` 终态并在 `pollAndFinalize` 单独置 `cancelled`。
9. **视频 URL 防御性解析**：APIMart 查询响应未完整给出视频对象结构，对 `videos[0].url` 兼容 string/array，并以 `video_url` 兜底；尾帧取 `result.images[0].url`（string/array 兼容）。
10. **向后兼容**：`videoTaskProvider` 为可选新字段，旧 Shot 缺省时恢复回退当前设置 provider；`VideoQueryProxyRequest.provider` 缺省时路由按 ark 处理；ark/ark-plan/custom 全链路行为不变。
11. **APIMart 视频 URL 同样转存 COS**：复用现有 `transferVideoToCos`（APIMart 结果有 `expires_at`，URL 可能过期），成功后用 COS 持久 URL 覆盖 `videoUrl`。
12. **图片 Key 复用**：视频未配置且图片为 apimart 时复用图片 Key + APIMart 视频 baseURL，与 ark 复用图片 Key 的既有体验一致。

---

## 验证步骤

1. **编译检查**：`npm run build`（或 `npm run lint` + `tsc --noEmit`）无类型错误
2. **设置页**：视频区域供应商网格出现「APIMart（Seedance 2.0）」按钮；点击切换后 baseURL 自动填 `https://api.apimart.ai/v1`、模型为 `doubao-seedance-2.0`；填入 APIMart Key 可生成
3. **火山引擎回归**：切回「火山方舟」供应商，原有 baseURL/模型/Key 恢复，生成与查询正常（确认未被破坏）
4. **卡片配置 UI**：APIMart 下「分辨率」显示 480p/720p/1080p/4k（fast/mini 仅 480p/720p），无「水印/固定摄像头/样片/优先级」开关，有「seed/联网搜索/音频/尾帧」；火山引擎下渲染完全不变
5. **文生视频（APIMart）**：单个镜头用 APIMart 文生视频，成功返回 url 并转存 COS
6. **图生视频/首尾帧（APIMart）**：first-frame 与 first-last-frame 模式生成成功（路由走 `image_with_roles`）
7. **多模态参考（APIMart）**：参考图+参考视频+参考音频生成成功（路由走 `image_urls`+`video_urls`+`audio_urls`）
8. **切页恢复（APIMart）**：APIMart 生成中切到 Step3 再回 Step4，`videoTaskId`+`videoTaskProvider` 已持久化；重新挂载后 `pollAndFinalize` 按 apimart provider 走 `GET /tasks/{task_id}?language=zh` 恢复轮询至完成
9. **切页恢复（火山引擎回归）**：同样场景下火山引擎任务恢复仍走 `/contents/generations/tasks/{id}`，正常完成
10. **跨供应商恢复**：APIMart 任务运行中切换到火山引擎供应商再回 Step4，恢复时按 `videoTaskProvider=apimart` + 缓存凭证查询 APIMart 任务，正常完成；反向亦然
11. **取消（APIMart）**：APIMart 任务排队/运行中点「取消」，前端置 `cancelled`、停止轮询，不调用上游（无 DELETE 请求）
12. **取消（火山引擎回归）**：火山引擎任务取消仍走 DELETE，正常
13. **错误路径**：APIMart Key 错误（401）/余额不足（402）/限流（429）时前端收到可读错误；任务 `failed` 时显示 `error.message`
