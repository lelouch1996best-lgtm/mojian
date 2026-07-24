/** 服务端 API 客户端 */

import type { AssetLibraryItem, MediaAsset, MediaAssetInput, PresetItem, PresetTag } from "@/lib/types";

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
  saveEpisode: (ep: any) =>
    request<any>("/data/episodes", { method: "POST", body: JSON.stringify(ep) }),
  deleteEpisode: (id: string) =>
    request<void>(`/data/episodes/${id}`, { method: "DELETE" }),
  getEpisodesBySeries: (seriesId: string) =>
    request<any[]>(`/data/episodes?seriesId=${encodeURIComponent(seriesId)}`),

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
};
