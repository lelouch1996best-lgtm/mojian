import type {
  ShotVideoConfig,
  VideoContentItem,
  VideoCreateProxyRequest,
  VideoCreateProxyResponse,
  VideoGenSettings,
  VideoQueryProxyRequest,
  VideoQueryProxyResponse,
  VideoUpstreamPayload,
  VideoApimartUpstreamPayload,
  ProviderCache,
  ProviderCacheEntry,
} from "./types";
import { getImageSettings } from "./image-client";
import { apiClient } from "./api-client";
import { getVideoModels, getDefaultShotVideoConfig, saveDefaultShotVideoConfig, type ModelOption } from "./model-presets";

/** 视频供应商预设 */
export interface VideoProviderPreset {
  baseURL: string;
  label: string;
  keyPrefix?: string;
  hint?: string;
}

export const VIDEO_PROVIDER_PRESETS: Record<VideoGenSettings["provider"], VideoProviderPreset> = {
  ark: {
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    label: "火山方舟",
    keyPrefix: "ark-",
    hint: "火山引擎方舟大模型服务平台。与图片 API 共用同一 API Key。",
  },
  "ark-plan": {
    baseURL: "https://ark.cn-beijing.volces.com/api/plan/v3",
    label: "火山引擎 Agent Plan",
    keyPrefix: "ark-plan-",
    hint: "火山引擎 Agent Plan 计费端点。使用计划制 API Key，与图片 API 共用同一 API Key，仅 baseURL 不同。",
  },
  apimart: {
    baseURL: "https://api.apib.ai/v1",
    label: "APIMart",
    keyPrefix: "apimart-",
    hint: "APIMart 视频生成 API。前往 apimart.ai/keys 获取 API Key。api域名变化比较快，如有变化请自行联系供应商的客服。支持文生/图生/首尾帧/多模态参考，480p~4k，4-15s。与图片 API 共用同一 API Key。无取消接口（取消为本地停止轮询）。",
  },
  custom: {
    baseURL: "",
    label: "自定义",
    hint: "自定义兼容火山引擎视频任务格式的 API 端点。",
  },
};

export const DEFAULT_VIDEO_SETTINGS: VideoGenSettings = {
  provider: "ark",
  apiKey: "",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
};

export async function getVideoSettings(): Promise<VideoGenSettings | null> {
  try {
    const s = await apiClient.getSetting<VideoGenSettings>("video");
    if (s) {
      return s;
    }
    // 未配置时，尝试复用图片 API 的 Key（当图片 provider 同为火山引擎系时）
    const img = await getImageSettings();
    if (img?.apiKey && (img.provider === "ark" || img.provider === "ark-plan")) {
      return { ...DEFAULT_VIDEO_SETTINGS, apiKey: img.apiKey, baseURL: img.baseURL };
    }
    // APIMart 图片与视频同平台同 Key：复用图片 Key + APIMart 视频 baseURL
    if (img?.apiKey && img.provider === "apimart") {
      return { provider: "apimart", apiKey: img.apiKey, baseURL: VIDEO_PROVIDER_PRESETS.apimart.baseURL };
    }
    return null;
  } catch { return null; }
}

export async function saveVideoSettings(s: VideoGenSettings): Promise<void> {
  const normalized: VideoGenSettings = {
    ...s,
    baseURL: s.baseURL.replace(/\/+$/, ""),
  };
  await apiClient.saveSetting("video", normalized);
}

export async function isVideoConfigured(): Promise<boolean> {
  return !!(await getVideoSettings())?.apiKey;
}

/** 获取各视频 provider 缓存的配置（切换供应商时自动恢复，含 baseURL） */
export async function getVideoProviderKeys(): Promise<ProviderCache> {
  try {
    const raw = await apiClient.getSetting<ProviderCache>("video_provider_keys");
    return raw ?? {};
  } catch {
    return {};
  }
}

/** 缓存某个视频 provider 的配置（合并写入，不覆盖未传入字段） */
export async function saveVideoProviderKey(provider: string, entry: ProviderCacheEntry): Promise<void> {
  const all = await getVideoProviderKeys();
  all[provider] = { ...all[provider], ...entry };
  await apiClient.saveSetting("video_provider_keys", all);
}

/** 清除某个视频 provider 的缓存配置（用于「初始化默认配置」时清空旧的缓存） */
export async function clearVideoProviderKey(provider: string): Promise<void> {
  const all = await getVideoProviderKeys();
  if (provider in all) {
    delete all[provider];
    await apiClient.saveSetting("video_provider_keys", all);
  }
}

/**
 * 按指定 provider 解析查询/取消所需的凭证。
 * - 与当前设置一致：直接用当前设置的 apiKey/baseURL；
 * - 否则（任务创建时的供应商与当前不同）：从 video_provider_keys 缓存读取（切换供应商时已落盘）；
 * - 缓存也缺失时回退当前设置凭证（查询大概率鉴权失败，但无法在无凭证时查询）。
 * 用于切页/刷新/切供应商后，按「任务创建时的供应商」正确恢复轮询。
 */
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

/**
 * 聚合所有「已配置 API Key」的视频供应商的全部模型（供模型选择弹框使用）。
 * - 已配置 = 当前激活供应商有 apiKey，或在 video_provider_keys 缓存中有 apiKey 的供应商；
 * - 每个模型条目携带其供应商与供应商显示名，便于按供应商分组展示与生成时路由凭证。
 * 新增供应商 / 修改模型参数 / 新增模型后，调用本函数即可取到最新全集。
 */
export async function getAllConfiguredVideoModels(): Promise<ModelOption[]> {
  const current = await getVideoSettings();
  const cache = await getVideoProviderKeys();
  const configuredProviders = new Set<string>();
  if (current?.apiKey) configuredProviders.add(current.provider);
  for (const [p, entry] of Object.entries(cache)) {
    if (entry?.apiKey) configuredProviders.add(p);
  }
  const options: ModelOption[] = [];
  for (const p of Array.from(configuredProviders)) {
    const preset = VIDEO_PROVIDER_PRESETS[p as VideoGenSettings["provider"]];
    if (!preset) continue;
    const models = await getVideoModels(p as VideoGenSettings["provider"]);
    for (const entry of models) {
      options.push({ provider: p, providerLabel: preset.label, entry });
    }
  }
  return options;
}

/**
 * 若用户尚未设置默认视频模型（存储值 model 为空），则把当前生成所用模型+供应商持久化为默认。
 * 仅在「首次生成」时落盘一次；用户已在「默认生成参数」中主动选择模型时为空操作。
 */
export async function saveDefaultShotVideoConfigIfEmpty(config: ShotVideoConfig): Promise<void> {
  const current = await getDefaultShotVideoConfig();
  if (current.model) return;
  await saveDefaultShotVideoConfig({ ...current, model: config.model, provider: config.provider });
}

/**
 * 根据生成模式构造 Seedance API 的 content 数组
 */
function buildVideoContent(params: {
  prompt: string;
  mode: ShotVideoConfig["mode"];
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
}): VideoContentItem[] {
  const { prompt, mode } = params;
  const content: VideoContentItem[] = [{ type: "text", text: prompt }];

  if (mode === "first-frame") {
    content.push({
      type: "image_url",
      image_url: { url: params.firstFrameUrl! },
      role: "first_frame",
    });
  } else if (mode === "first-last-frame") {
    content.push({
      type: "image_url",
      image_url: { url: params.firstFrameUrl! },
      role: "first_frame",
    });
    content.push({
      type: "image_url",
      image_url: { url: params.lastFrameUrl! },
      role: "last_frame",
    });
  } else if (mode === "multimodal-ref") {
    // 参考图（role=reference_image，支持 asset:// 素材）
    (params.referenceImageUrls ?? []).forEach((u) => {
      content.push({ type: "image_url", image_url: { url: u }, role: "reference_image" });
    });
    // 参考视频（仅 2.0，role=reference_video，支持 asset:// 素材）
    (params.referenceVideoUrls ?? []).forEach((u) => {
      content.push({ type: "video_url", video_url: { url: u }, role: "reference_video" });
    });
    // 参考音频（仅 2.0，不可单独输入，role=reference_audio，支持 asset:// 素材）
    (params.referenceAudioUrls ?? []).forEach((u) => {
      content.push({ type: "audio_url", audio_url: { url: u }, role: "reference_audio" });
    });
  }
  // text2video：不加任何素材
  return content;
}

/** 判断是否为 APIMart Grok Imagine 1.5 视频模型（兼容别名 -ext） */
export function isGrokVideoModel(model: string): boolean {
  return model === "grok-imagine-1.5-video-apimart" || model === "grok-imagine-1.5-video-ext";
}

/** 判断是否为 APIMart MiniMax-H3 视频模型 */
export function isMinimaxH3VideoModel(model: string): boolean {
  return model === "MiniMax-H3";
}

/** 判断是否为 APIMart wan2.7 视频模型 */
export function isWan27VideoModel(model: string): boolean {
  return model === "wan2.7";
}

/**
 * 构造发送给视频生成 API 的完整请求体（按 provider 选择 ark content[] 或 APIMart 扁平结构）
 */
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

  // ---- APIMart：扁平结构，size=宽高比，image_with_roles/image_urls/video_urls/audio_urls ----
  if (provider === "apimart") {
    const isGrok = isGrokVideoModel(config.model);
    const isH3 = isMinimaxH3VideoModel(config.model);
    const isWan27 = isWan27VideoModel(config.model);
    const p: VideoApimartUpstreamPayload = { model: config.model, prompt, size: config.ratio };
    // 分辨率/质量：Grok 用 quality（480p/720p），Seedance/MiniMax-H3/wan2.7 用 resolution
    if (isGrok) {
      if (config.resolution) p.quality = config.resolution;
    } else {
      if (config.resolution) p.resolution = config.resolution;
    }
    // APIMart 无 duration=-1 自动档：-1 时省略，用上游默认
    if (typeof config.duration === "number" && config.duration !== -1) p.duration = config.duration;
    // generate_audio / return_last_frame 仅 Seedance 系列支持；wan2.7 无此参数，发送会被忽略故省略
    if (!isWan27 && typeof config.generateAudio === "boolean") p.generate_audio = config.generateAudio;
    if (typeof config.seed === "number" && config.seed !== -1) p.seed = config.seed;
    if (!isWan27 && typeof config.returnLastFrame === "boolean") p.return_last_frame = config.returnLastFrame;
    if (config.webSearch) p.tools = [{ type: "web_search" }];
    // MiniMax-H3 / wan2.7 支持 AIGC 水印（其余 APIMart 视频模型不支持）
    if ((isH3 || isWan27) && typeof config.watermark === "boolean") p.watermark = config.watermark;
    if (config.mode === "first-frame" && params.firstFrameUrl) {
      // Grok 图生视频用普通 image_urls（不支持角色）；Seedance 用 image_with_roles
      if (isGrok) {
        p.image_urls = [params.firstFrameUrl];
      } else {
        p.image_with_roles = [{ url: params.firstFrameUrl, role: "first_frame" }];
      }
    } else if (config.mode === "first-last-frame" && params.firstFrameUrl && params.lastFrameUrl) {
      p.image_with_roles = [
        { url: params.firstFrameUrl, role: "first_frame" },
        { url: params.lastFrameUrl, role: "last_frame" },
      ];
    } else if (config.mode === "multimodal-ref") {
      // 多图参考：Seedance 支持 图/视频/音频；Grok 仅支持 image_urls（最多 7 张），不发送 video_urls/audio_urls
      if (params.referenceImageUrls?.length) p.image_urls = params.referenceImageUrls;
      if (!isGrok) {
        if (params.referenceVideoUrls?.length) p.video_urls = params.referenceVideoUrls;
        if (params.referenceAudioUrls?.length) p.audio_urls = params.referenceAudioUrls;
      }
    }
    // text2video：仅 prompt，不加素材
    return p;
  }

  // ---- ark / ark-plan / custom：content[] 类型化数组（snake_case） ----
  const content = buildVideoContent({ ...params, mode: config.mode });

  const payload: VideoUpstreamPayload = {
    model: config.model,
    content,
    watermark: config.watermark ?? false,
  };
  if (config.resolution) payload.resolution = config.resolution;
  if (config.ratio) payload.ratio = config.ratio;
  if (typeof config.duration === "number") payload.duration = config.duration;
  if (typeof config.generateAudio === "boolean") payload.generate_audio = config.generateAudio;
  if (typeof config.seed === "number") payload.seed = config.seed;
  if (typeof config.cameraFixed === "boolean") payload.camera_fixed = config.cameraFixed;
  if (typeof config.returnLastFrame === "boolean") payload.return_last_frame = config.returnLastFrame;
  if (typeof config.draft === "boolean") payload.draft = config.draft;
  if (typeof config.priority === "number") payload.priority = config.priority;
  // 联网搜索工具（仅 Seedance 2.0 系列）
  if (config.webSearch) {
    payload.tools = [{ type: "web_search" }];
  }
  return payload;
}

/**
 * 创建视频生成任务（异步）
 * @param params.prompt 视频提示词
 * @param params.config 卡片级视频配置（模型/模式/分辨率等）
 * @param params.firstFrameUrl 首帧图片 URL（first-frame / first-last-frame）
 * @param params.lastFrameUrl 尾帧图片 URL（first-last-frame）
 * @param params.referenceImageUrls 参考图片列表（multimodal-ref -> reference_image）
 * @param params.referenceVideoUrls 参考视频列表（multimodal-ref，仅 2.0）
 * @param params.referenceAudioUrls 参考音频列表（multimodal-ref，仅 2.0）
 * @returns 任务 ID
 */
export async function createVideoTask(params: {
  prompt: string;
  config: ShotVideoConfig;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
}): Promise<VideoCreateProxyResponse> {
  const { config } = params;
  // 未选择模型（且无任何已配置供应商可回退）时，明确提示先配置，避免发出空 model 的请求
  if (!config.model) {
    throw new Error("未选择视频生成模型，请先在「设置 -> 默认生成参数」中选择默认模型，或先配置视频生成 API");
  }
  // 首次生成时把当前选用模型落盘为默认（用户未主动设置默认模型时生效一次）
  await saveDefaultShotVideoConfigIfEmpty(config);
  // 按所选模型所属供应商解析凭证（跨供应商生成）；缺省回退当前激活供应商
  const creds = await resolveVideoCredentials(config.provider);
  if (!creds || !creds.apiKey) {
    throw new Error("未配置视频生成 API，请先在设置中填写");
  }

  // 前端构造完整上游请求体（可在控制台核对参数是否与文档一致）
  const payload = buildVideoUpstreamPayload({ ...params, provider: creds.provider });
  console.log("[VideoGeneration] 上游请求 payload：", payload);

  const body: VideoCreateProxyRequest = {
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    payload,
  };
  const res = await fetch("/api/video/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const response = (await res.json()) as VideoCreateProxyResponse;
  // 始终回传实际使用的供应商，供调用方持久化到 Shot.videoTaskProvider（恢复轮询时按此路由凭证）
  return { ...response, provider: creds.provider };
}

/** 查询视频生成任务状态（按任务创建时的供应商解析凭证，支持跨供应商恢复） */
export async function queryVideoTask(
  taskId: string,
  provider?: VideoGenSettings["provider"],
  signal?: AbortSignal
): Promise<VideoQueryProxyResponse> {
  const creds = await resolveVideoCredentials(provider);
  if (!creds) {
    throw new Error("未配置视频生成 API");
  }
  const body: VideoQueryProxyRequest = {
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    taskId,
  };
  const res = await fetch("/api/video/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as VideoQueryProxyResponse;
}

/**
 * 轮询视频任务直到完成（或超时）。
 * @param taskId 任务 ID
 * @param onUpdate 状态更新回调
 * @param intervalMs 轮询间隔，默认 10 秒
 * @param timeoutMs 总超时，默认 10 分钟
 * @param signal 可选 AbortSignal，取消后立即返回（不抛错）
 */
export async function pollVideoTask(
  taskId: string,
  onUpdate: (status: VideoQueryProxyResponse) => void,
  intervalMs = 10000,
  timeoutMs = 10 * 60 * 1000,
  signal?: AbortSignal,
  provider?: VideoGenSettings["provider"]
): Promise<VideoQueryProxyResponse> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) return { status: "expired", error: "已取消" };
    const result = await queryVideoTask(taskId, provider, signal);
    onUpdate(result);
    if (
      result.status === "succeeded" ||
      result.status === "failed" ||
      result.status === "expired" ||
      result.status === "cancelled"
    ) {
      return result;
    }
    if (signal?.aborted) return { status: "expired", error: "已取消" };
    await new Promise((r) => {
      const t = setTimeout(r, intervalMs);
      if (signal) {
        const onAbort = () => {
          clearTimeout(t);
          r(undefined);
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }
  return { status: "expired", error: "轮询超时" };
}

/**
 * 取消视频生成任务。
 * - ark / ark-plan / custom：仅排队中且未被取走的任务可取消。
 *   API: DELETE /api/v3/contents/generations/tasks/{id}
 * - apimart：无取消接口，本地取消（停止轮询），不调用上游。
 */
export async function cancelVideoTask(
  taskId: string,
  provider?: VideoGenSettings["provider"]
): Promise<void> {
  // APIMart 无取消接口：本地取消，不调用上游
  if (provider === "apimart") {
    return;
  }
  const creds = await resolveVideoCredentials(provider);
  if (!creds) {
    throw new Error("未配置视频生成 API");
  }
  const res = await fetch("/api/video/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: creds.provider,
      apiKey: creds.apiKey,
      baseURL: creds.baseURL,
      taskId,
    }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}
