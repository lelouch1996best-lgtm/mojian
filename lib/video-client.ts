import type {
  VideoCreateProxyRequest,
  VideoCreateProxyResponse,
  VideoGenSettings,
  VideoQueryProxyRequest,
  VideoQueryProxyResponse,
} from "./types";
import { getImageSettings } from "./image-client";
import { apiClient } from "./api-client";

const SETTINGS_KEY = "ai-script-video-settings";
const STORAGE_MODE = process.env.NEXT_PUBLIC_STORAGE_MODE;

/** Seedance 模型预设 */
export const VIDEO_MODEL_PRESETS: {
  value: string;
  label: string;
  hint?: string;
}[] = [
  {
    value: "doubao-seedance-2-0-260128",
    label: "Seedance 2.0（推荐）",
    hint: "最新旗舰，多模态参考生视频、有声，4-15s，720p",
  },
  {
    value: "doubao-seedance-2-0-fast-260128",
    label: "Seedance 2.0 fast",
    hint: "更快速度，多模态生视频，仅 480p/720p",
  },
  {
    value: "doubao-seedance-1-5-pro-250428",
    label: "Seedance 1.5 Pro",
    hint: "有声视频、adaptive 宽高比、Draft 样片模式",
  },
  {
    value: "doubao-seedance-1-0-pro-250328",
    label: "Seedance 1.0 Pro",
    hint: "首尾帧/首帧/文生视频，支持 1080p",
  },
  {
    value: "doubao-seedance-1-0-pro-fast-250328",
    label: "Seedance 1.0 Pro Fast",
    hint: "更快的生成速度，仅首帧/文生视频",
  },
];

export const DEFAULT_VIDEO_SETTINGS: VideoGenSettings = {
  apiKey: "",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  model: "doubao-seedance-2-0-260128",
  resolution: "720p",
  ratio: "16:9",
  duration: 5,
  watermark: false,
  generateAudio: false,
};

export async function getVideoSettings(): Promise<VideoGenSettings | null> {
  if (STORAGE_MODE === "server") {
    try {
      const s = await apiClient.getSetting<VideoGenSettings>("video");
      if (s) return s;
      // 未配置时，尝试复用图片 API 的 Key
      const img = await getImageSettings();
      if (img?.apiKey) return { ...DEFAULT_VIDEO_SETTINGS, apiKey: img.apiKey, baseURL: img.baseURL };
      return null;
    } catch { return null; }
  }
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      const img = await getImageSettings();
      if (img?.apiKey) {
        return { ...DEFAULT_VIDEO_SETTINGS, apiKey: img.apiKey, baseURL: img.baseURL };
      }
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<VideoGenSettings>;
    let merged = { ...DEFAULT_VIDEO_SETTINGS, ...parsed };
    if (!merged.apiKey) {
      const img = await getImageSettings();
      if (img?.apiKey) {
        merged = { ...merged, apiKey: img.apiKey, baseURL: merged.baseURL || img.baseURL };
      }
    }
    return merged;
  } catch {
    return null;
  }
}

export async function saveVideoSettings(s: VideoGenSettings): Promise<void> {
  const normalized: VideoGenSettings = {
    ...s,
    baseURL: s.baseURL.replace(/\/+$/, ""),
  };
  if (STORAGE_MODE === "server") {
    await apiClient.saveSetting("video", normalized);
    return;
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
}

export async function isVideoConfigured(): Promise<boolean> {
  return !!(await getVideoSettings())?.apiKey;
}

/**
 * 创建视频生成任务（异步）
 * @param prompt 视频提示词
 * @param imageUrls 参考图片 URL 列表（关联资产的图片）
 * @returns 任务 ID
 */
export async function createVideoTask(
  prompt: string,
  imageUrls: string[] = []
): Promise<VideoCreateProxyResponse> {
  const s = await getVideoSettings();
  if (!s || !s.apiKey) {
    throw new Error("未配置视频生成 API，请先在设置中填写");
  }
  const body: VideoCreateProxyRequest = {
    apiKey: s.apiKey,
    baseURL: s.baseURL,
    model: s.model,
    prompt,
    imageUrls,
    resolution: s.resolution,
    ratio: s.ratio,
    duration: s.duration,
    watermark: s.watermark,
    generateAudio: s.generateAudio,
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
