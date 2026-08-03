import type {
  MusicCreateProxyRequest,
  MusicCreateProxyResponse,
  MusicGenSettings,
  MusicQueryProxyRequest,
  MusicQueryProxyResponse,
  ProviderCache,
  ProviderCacheEntry,
} from "./types";
import { apiClient } from "./api-client";

/** 音乐供应商预设 */
export interface MusicProviderPreset {
  baseURL: string;
  label: string;
  keyPrefix?: string;
  hint?: string;
}

export const MUSIC_PROVIDER_PRESETS: Record<MusicGenSettings["provider"], MusicProviderPreset> = {
  apimart: {
    baseURL: "https://api.apib.ai/v1",
    label: "APIMart",
    keyPrefix: "sk-",
    hint: "APIMart 音乐生成 API，提供 suno 音乐生成模型。前往 apimart.ai/keys 获取 API Key。",
  },
  custom: {
    baseURL: "",
    label: "自定义",
    hint: "自定义兼容 Suno 格式的 API 端点。",
  },
};

export const DEFAULT_MUSIC_SETTINGS: MusicGenSettings = {
  provider: "apimart",
  apiKey: "",
  baseURL: "https://api.apib.ai/v1",
  model: "suno",
};

export async function getMusicSettings(): Promise<MusicGenSettings | null> {
  try {
    const s = await apiClient.getSetting<MusicGenSettings>("music");
    return s;
  } catch { return null; }
}

export async function saveMusicSettings(s: MusicGenSettings): Promise<void> {
  const normalized: MusicGenSettings = {
    ...s,
    baseURL: s.baseURL.replace(/\/+$/, ""),
  };
  await apiClient.saveSetting("music", normalized);
}

export async function isMusicConfigured(): Promise<boolean> {
  return !!(await getMusicSettings())?.apiKey;
}

/** 获取各音乐 provider 缓存的配置（切换供应商时自动恢复，含 baseURL） */
export async function getMusicProviderKey(): Promise<ProviderCache> {
  try {
    const raw = await apiClient.getSetting<ProviderCache>("music_provider_keys");
    return raw ?? {};
  } catch {
    return {};
  }
}

/** 缓存某个音乐 provider 的配置（合并写入，不覆盖未传入字段） */
export async function saveMusicProviderKey(provider: string, entry: ProviderCacheEntry): Promise<void> {
  const all = await getMusicProviderKey();
  all[provider] = { ...all[provider], ...entry };
  await apiClient.saveSetting("music_provider_keys", all);
}

/** 清除某个音乐 provider 的缓存配置（用于「初始化默认配置」时清空旧的缓存） */
export async function clearMusicProviderKey(provider: string): Promise<void> {
  const all = await getMusicProviderKey();
  if (provider in all) {
    delete all[provider];
    await apiClient.saveSetting("music_provider_keys", all);
  }
}

/**
 * 创建音乐生成任务（异步）
 * @param action 任务类型：generate / inspo / lyrics
 * @param payload 完整的上游请求体（前端构造，直接透传）
 * @returns 任务 ID
 */
export async function createMusicTask(
  action: MusicCreateProxyRequest["action"],
  payload: Record<string, unknown>
): Promise<string> {
  const settings = await getMusicSettings();
  if (!settings?.apiKey) {
    throw new Error("请先在设置页配置音乐生成 API");
  }
  const body: MusicCreateProxyRequest = {
    action,
    baseURL: settings.baseURL,
    apiKey: settings.apiKey,
    payload,
  };
  const res = await fetch("/api/music/create", {
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
  const data = (await res.json()) as MusicCreateProxyResponse;
  return data.taskId;
}

/**
 * 提交 createVoice 任务（从音频创建可复用音色）。
 * @param audioUrl 公开可访问的音频 URL（MP3 / WAV）
 * @returns 任务 ID
 */
export async function createVoiceTask(audioUrl: string): Promise<string> {
  return createMusicTask("createVoice", { model: "suno", audio_url: audioUrl });
}

/** 查询音乐生成任务状态 */
export async function queryMusicTask(
  taskId: string,
  signal?: AbortSignal
): Promise<MusicQueryProxyResponse> {
  const settings = await getMusicSettings();
  if (!settings?.apiKey) {
    throw new Error("请先在设置页配置音乐生成 API");
  }
  const body: MusicQueryProxyRequest = {
    baseURL: settings.baseURL,
    apiKey: settings.apiKey,
    taskId,
  };
  const res = await fetch("/api/music/query", {
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
  return (await res.json()) as MusicQueryProxyResponse;
}

/**
 * 轮询音乐任务直到完成（或超时）。
 * @param taskId 任务 ID
 * @param callbacks.onProgress 进行中状态更新回调
 * @param callbacks.onCompleted 完成回调（含音轨/歌词结果）
 * @param callbacks.onFailed 失败回调（含失败原因）
 * @param intervalMs 轮询间隔，默认 4 秒
 * @param timeoutMs 总超时，默认 10 分钟
 * @param signal 可选 AbortSignal，取消后立即返回（不抛错）
 */
export async function pollMusicTask(
  taskId: string,
  callbacks: {
    onProgress?: (result: MusicQueryProxyResponse) => void;
    onCompleted?: (result: MusicQueryProxyResponse) => void;
    onFailed?: (error: string) => void;
  } = {},
  intervalMs = 4000,
  timeoutMs = 10 * 60 * 1000,
  signal?: AbortSignal
): Promise<MusicQueryProxyResponse> {
  const { onProgress, onCompleted, onFailed } = callbacks;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) {
      onFailed?.("已取消");
      return { status: "failed", error: "已取消" };
    }
    const result = await queryMusicTask(taskId, signal);
    if (result.status === "completed") {
      onCompleted?.(result);
      return result;
    }
    if (result.status === "failed") {
      const err = result.error || "音乐生成失败";
      onFailed?.(err);
      return result;
    }
    onProgress?.(result);
    if (signal?.aborted) {
      onFailed?.("已取消");
      return { status: "failed", error: "已取消" };
    }
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
  onFailed?.("轮询超时");
  return { status: "failed", error: "轮询超时" };
}

export interface GeneratedLyrics {
  lyrics: string;
  title?: string;
  tags?: string;
}

/** AI 生成歌词：提交 lyrics 任务并轮询，返回歌词文本（含标题/风格标签） */
export async function generateLyrics(theme: string): Promise<GeneratedLyrics> {
  const taskId = await createMusicTask("lyrics", { prompt: theme });
  const result = await pollMusicTask(taskId);
  if (result.status === "failed") {
    throw new Error(result.error || "歌词生成失败");
  }
  if (result.lyrics) {
    return {
      lyrics: result.lyrics,
      title: result.lyricsTitle,
      tags: result.lyricsTags,
    };
  }
  const raw = result.rawResult === undefined ? "无" : JSON.stringify(result.rawResult);
  throw new Error(`歌词生成完成但未能解析结果（请联系开发者排查上游返回结构）：${raw.slice(0, 300)}`);
}
