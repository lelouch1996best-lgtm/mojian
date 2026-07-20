import type {
  ShotVideoConfig,
  VideoContentItem,
  VideoCreateProxyRequest,
  VideoCreateProxyResponse,
  VideoGenSettings,
  VideoQueryProxyRequest,
  VideoQueryProxyResponse,
  VideoUpstreamPayload,
  ProviderCache,
  ProviderCacheEntry,
} from "./types";
import { getImageSettings } from "./image-client";
import { apiClient } from "./api-client";

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
    label: "火山方舟（Seedance）",
    keyPrefix: "ark-",
    hint: "火山引擎方舟大模型服务平台。与图片 API 共用同一 API Key。",
  },
  "ark-plan": {
    baseURL: "https://ark.cn-beijing.volces.com/api/plan/v3",
    label: "火山引擎 Agent Plan（Seedance）",
    keyPrefix: "ark-plan-",
    hint: "火山引擎 Agent Plan 计费端点。使用计划制 API Key，与图片 API 共用同一 API Key，仅 baseURL 不同。",
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
      // 向后兼容：旧数据缺少 provider 字段时默认 ark
      if (!s.provider) return { ...DEFAULT_VIDEO_SETTINGS, ...s, provider: "ark" };
      return s;
    }
    // 未配置时，尝试复用图片 API 的 Key（当图片 provider 同为火山引擎系时）
    const img = await getImageSettings();
    if (img?.apiKey && (img.provider === "ark" || img.provider === "ark-plan")) {
      return { ...DEFAULT_VIDEO_SETTINGS, apiKey: img.apiKey, baseURL: img.baseURL };
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
    const raw = await apiClient.getSetting<Record<string, unknown>>("video_provider_keys");
    if (!raw) return {};
    const result: ProviderCache = {};
    for (const [k, v] of Object.entries(raw)) {
      // 向后兼容：旧数据是 Record<string, string>（仅 apiKey）
      if (typeof v === "string") result[k] = { apiKey: v };
      else if (v && typeof v === "object") result[k] = v as ProviderCacheEntry;
    }
    return result;
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

/**
 * 构造发送给 Seedance API 的完整请求体（snake_case，可直接对照官方文档）
 */
export function buildVideoUpstreamPayload(params: {
  prompt: string;
  config: ShotVideoConfig;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
}): VideoUpstreamPayload {
  const { prompt, config } = params;
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
  const s = await getVideoSettings();
  if (!s || !s.apiKey) {
    throw new Error("未配置视频生成 API，请先在设置中填写");
  }

  // 前端构造完整上游请求体（可在控制台核对参数是否与文档一致）
  const payload = buildVideoUpstreamPayload(params);
  console.log("[VideoGeneration] 上游请求 payload：", payload);

  const body: VideoCreateProxyRequest = {
    apiKey: s.apiKey,
    baseURL: s.baseURL,
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
  return (await res.json()) as VideoCreateProxyResponse;
}

/** 查询视频生成任务状态 */
export async function queryVideoTask(taskId: string, signal?: AbortSignal): Promise<VideoQueryProxyResponse> {
  const s = await getVideoSettings();
  if (!s || !s.apiKey) {
    throw new Error("未配置视频生成 API");
  }
  const body: VideoQueryProxyRequest = {
    apiKey: s.apiKey,
    baseURL: s.baseURL,
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
  signal?: AbortSignal
): Promise<VideoQueryProxyResponse> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) return { status: "expired", error: "已取消" };
    const result = await queryVideoTask(taskId, signal);
    onUpdate(result);
    if (result.status === "succeeded" || result.status === "failed" || result.status === "expired") {
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
 * 取消视频生成任务（仅排队中且未被取走的任务可取消）。
 * API: DELETE /api/v3/contents/generations/tasks/{id}
 */
export async function cancelVideoTask(taskId: string): Promise<void> {
  const s = await getVideoSettings();
  if (!s || !s.apiKey) {
    throw new Error("未配置视频生成 API");
  }
  const res = await fetch("/api/video/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: s.apiKey,
      baseURL: s.baseURL,
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
