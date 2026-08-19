/** 服务端 API 客户端 */

import type { ApiCallLog, ApiCallLogListResponse, AssetLibraryItem, ImageTaskRecord, MediaAsset, MediaAssetInput, PresetItem, PresetTag, VoicePersona } from "@/lib/types";
import { findNonSerializablePath } from "@/lib/utils";

const TOKEN = process.env.NEXT_PUBLIC_STORAGE_TOKEN ?? "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const apiClient = {
  // Episodes
  getEpisode: (id: string) => request<any>(`/data/episodes/${id}`),
  saveEpisode: (ep: any) => {
    const badPath = findNonSerializablePath(ep);
    if (badPath) {
      // eslint-disable-next-line no-console
      console.error("Episode contains non-serializable value at:", badPath, ep);
      return Promise.resolve({
        ok: false,
        error: `保存失败：数据包含无法序列化的对象（路径：${badPath}）。请刷新页面后重试，若仍出现请反馈。`,
      });
    }
    return request<any>("/data/episodes", { method: "POST", body: JSON.stringify(ep) });
  },
  deleteEpisode: (id: string) =>
    request<void>(`/data/episodes/${id}`, { method: "DELETE" }),
  getEpisodesBySeries: (seriesId: string) =>
    request<any[]>(`/data/episodes?seriesId=${encodeURIComponent(seriesId)}`),

  // Musics
  getMusic: (id: string) => request<any>(`/data/musics/${id}`),
  listMusics: (seriesId: string) =>
    request<any[]>(`/data/musics?seriesId=${encodeURIComponent(seriesId)}`),
  saveMusic: (music: any) =>
    request<any>("/data/musics", { method: "POST", body: JSON.stringify(music) }),
  deleteMusic: (id: string) =>
    request<void>(`/data/musics/${id}`, { method: "DELETE" }),

  // Series
  listSeries: () => request<any[]>("/data/series"),
  getSeries: (id: string) => request<any>(`/data/series/${id}`),
  saveSeries: (s: any) =>
    request<any>("/data/series", { method: "POST", body: JSON.stringify(s) }),
  deleteSeries: (id: string) =>
    request<void>(`/data/series/${id}`, { method: "DELETE" }),

  // Settings
  getSetting: <T = any>(key: string) =>
    request<{ value: T }>(`/settings/${key}`).then((r) => r.value),
  saveSetting: (key: string, value: any) =>
    request<any>(`/settings/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),

  // Asset Library
  listAssetLibrary: () => request<AssetLibraryItem[]>("/data/assets"),
  deleteAssetLibraryItems: (ids: string[]) =>
    request<{ ok: boolean; deleted: number }>("/data/assets", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),

  // Media Assets（独立媒体资产账本表）
  listMediaAssets: () => request<MediaAsset[]>("/data/media-assets"),
  addMediaAsset: (input: MediaAssetInput) =>
    request<{ ok: boolean; asset: MediaAsset }>("/data/media-assets", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteMediaAssets: (ids: string[]) =>
    request<{ ok: boolean; deleted: number }>("/data/media-assets", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),

  // Voice Personas（Suno 歌手音色，按企划分类）
  listVoicePersonas: (seriesId?: string) =>
    request<VoicePersona[]>(seriesId ? `/data/voice-personas?seriesId=${encodeURIComponent(seriesId)}` : "/data/voice-personas"),
  saveVoicePersona: (vp: VoicePersona) =>
    request<{ ok: boolean }>("/data/voice-personas", {
      method: "POST",
      body: JSON.stringify(vp),
    }),
  deleteVoicePersona: (id: string) =>
    request<void>(`/data/voice-personas/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  // Preset Library
  listPresets: () => request<PresetItem[]>("/data/presets"),
  savePreset: (p: PresetItem) =>
    request<{ ok: boolean; preset: PresetItem }>("/data/presets", {
      method: "POST",
      body: JSON.stringify(p),
    }),
  deletePresets: (ids: string[]) =>
    request<{ ok: boolean; deleted: number }>("/data/presets", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),
  getPreset: (id: string) => request<PresetItem>(`/data/presets/${id}`),
  deletePreset: (id: string) =>
    request<void>(`/data/presets/${id}`, { method: "DELETE" }),

  // Preset Tags
  listPresetTags: () => request<PresetTag[]>("/data/preset-tags"),
  savePresetTag: (name: string) =>
    request<{ ok: boolean; tag: PresetTag }>("/data/preset-tags", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  deletePresetTags: (ids: string[]) =>
    request<{ ok: boolean; deleted: number }>("/data/preset-tags", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),
  deletePresetTag: (id: string) =>
    request<void>(`/data/preset-tags/${id}`, { method: "DELETE" }),

  // Image Tasks（服务端图片任务中心）
  getImageTasks: (ids: string[]) =>
    request<{ tasks: ImageTaskRecord[] }>(
      `/image-tasks?ids=${encodeURIComponent(ids.join(","))}`
    ),
  attachImageTask: (input: {
    jobId: string;
    provider: string;
    apiKey: string;
    baseURL: string;
    model?: string;
    cosPrefix?: string;
  }) =>
    request<{ task: ImageTaskRecord }>("/image-tasks", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  retryImageTask: (jobId: string) =>
    request<{ task: ImageTaskRecord }>(
      `/image-tasks/${encodeURIComponent(jobId)}/retry`,
      { method: "POST" }
    ),

  // API Call Logs（第三方调用日志）
  listApiLogs: (params: {
    type?: string;
    provider?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params.type) q.set("type", params.type);
    if (params.provider) q.set("provider", params.provider);
    if (params.status) q.set("status", params.status);
    q.set("limit", String(params.limit ?? 50));
    q.set("offset", String(params.offset ?? 0));
    return request<ApiCallLogListResponse>(`/data/api-logs?${q.toString()}`);
  },
  clearApiLogs: (ids?: string[]) =>
    request<{ ok: boolean; deleted: number }>("/data/api-logs", {
      method: "DELETE",
      body: JSON.stringify(ids && ids.length ? { ids } : {}),
    }),
  finalizeApiCallLog: (taskId: string, finalStatus: "done" | "failed" | "expired", finalResult: string) =>
    request<{ ok: boolean }>("/data/api-logs", {
      method: "POST",
      body: JSON.stringify({ taskId, finalStatus, finalResult }),
    }),
};
