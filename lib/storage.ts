import type { Episode, MediaAssetInput, Series } from "@/lib/types";
import { apiClient } from "@/lib/api-client";

// ========== Episode API ==========

export async function getEpisode(id: string): Promise<Episode | null> {
  try {
    return await apiClient.getEpisode(id);
  } catch {
    return null;
  }
}

export async function saveEpisode(ep: Episode): Promise<{ ok: boolean; error?: string }> {
  try {
    await apiClient.saveEpisode(ep);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteEpisode(id: string): Promise<void> {
  await apiClient.deleteEpisode(id);
}

/** 获取某系列下的所有剧集，按 Series.episodeOrder 排序 */
export async function getEpisodesBySeries(seriesId: string): Promise<Episode[]> {
  return apiClient.getEpisodesBySeries(seriesId);
}

// ========== Series API ==========

export async function listSeries(): Promise<Series[]> {
  const list = await apiClient.listSeries();
  return list.sort((a, b) => a.order - b.order);
}

export async function getSeries(id: string): Promise<Series | null> {
  try {
    return await apiClient.getSeries(id);
  } catch {
    return null;
  }
}

export async function saveSeries(s: Series): Promise<{ ok: boolean; error?: string }> {
  try {
    await apiClient.saveSeries(s);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteSeries(id: string): Promise<void> {
  await apiClient.deleteSeries(id);
}

// ========== Media Asset Recorder ==========

/**
 * 把生成的媒体记录到独立账本表 media_assets。
 * 失败仅 warn，不阻断主流程（业务表照常写入）。
 */
export async function recordMediaAsset(input: MediaAssetInput): Promise<void> {
  try {
    await apiClient.addMediaAsset(input);
  } catch (e) {
    console.warn("[media-assets] 记录失败，不影响主流程:", e);
  }
}
