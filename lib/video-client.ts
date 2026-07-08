import type {
  ShotVideoConfig,
  VideoCreateProxyRequest,
  VideoCreateProxyResponse,
  VideoGenSettings,
  VideoQueryProxyRequest,
  VideoQueryProxyResponse,
} from "./types";
import { getImageSettings } from "./image-client";
import { apiClient } from "./api-client";

export const DEFAULT_VIDEO_SETTINGS: VideoGenSettings = {
  apiKey: "",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
};

export async function getVideoSettings(): Promise<VideoGenSettings | null> {
  try {
    const s = await apiClient.getSetting<VideoGenSettings>("video");
    if (s) return s;
    // 未配置时，尝试复用图片 API 的 Key
    const img = await getImageSettings();
    if (img?.apiKey) return { ...DEFAULT_VIDEO_SETTINGS, apiKey: img.apiKey, baseURL: img.baseURL };
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

/**
 * 创建视频生成任务（异步）
 * @param params.prompt 视频提示词
 * @param params.config 卡片级视频配置（模型/模式/分辨率等）
 * @param params.firstFrameUrl 首帧图片 URL（first-frame / first-last-frame）
 * @param params.lastFrameUrl 尾帧图片 URL（first-last-frame）
 * @param params.referenceImageUrls 参考图片列表（multimodal-ref → reference_image）
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
  const { prompt, config } = params;
  const s = await getVideoSettings();
  if (!s || !s.apiKey) {
    throw new Error("未配置视频生成 API，请先在设置中填写");
  }
  const body: VideoCreateProxyRequest = {
    apiKey: s.apiKey,
    baseURL: s.baseURL,
    model: config.model,
    prompt,
    mode: config.mode,
    firstFrameUrl: params.firstFrameUrl,
    lastFrameUrl: params.lastFrameUrl,
    referenceImageUrls: params.referenceImageUrls,
    referenceVideoUrls: params.referenceVideoUrls,
    referenceAudioUrls: params.referenceAudioUrls,
    resolution: config.resolution,
    ratio: config.ratio,
    duration: config.duration,
    watermark: config.watermark,
    generateAudio: config.generateAudio,
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
export async function queryVideoTask(taskId: string): Promise<VideoQueryProxyResponse> {
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
 */
export async function pollVideoTask(
  taskId: string,
  onUpdate: (status: VideoQueryProxyResponse) => void,
  intervalMs = 10000,
  timeoutMs = 10 * 60 * 1000
): Promise<VideoQueryProxyResponse> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await queryVideoTask(taskId);
    onUpdate(result);
    if (result.status === "succeeded" || result.status === "failed" || result.status === "expired") {
      return result;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
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
