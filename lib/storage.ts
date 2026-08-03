import type { Episode, MediaAssetInput, Music, MusicModeParams, Series, VoicePersona } from "@/lib/types";
import { apiClient } from "@/lib/api-client";
import { uuid } from "@/lib/utils";

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

// ========== Music API ==========

const DEFAULT_MODE_PARAMS: MusicModeParams = { version: "v5", instrumental: false };

/** 创建空 Music */
export function emptyMusic(seriesId = "", title = "未命名音乐"): Music {
  const now = Date.now();
  return {
    id: uuid(),
    seriesId,
    title,
    mode: "inspiration",
    status: "idle",
    params: {
      inspiration: { ...DEFAULT_MODE_PARAMS, prompt: "" },
      custom: { ...DEFAULT_MODE_PARAMS },
      remix: { ...DEFAULT_MODE_PARAMS },
    },
    tracks: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 获取某系列下的所有音乐，按创建时间升序 */
export async function getMusicsBySeries(seriesId: string): Promise<Music[]> {
  return apiClient.listMusics(seriesId);
}

/** 获取单个音乐，不存在时返回 null */
export async function getMusic(id: string): Promise<Music | null> {
  try {
    return await apiClient.getMusic(id);
  } catch {
    return null;
  }
}

export async function saveMusic(music: Music): Promise<{ ok: boolean; error?: string }> {
  try {
    await apiClient.saveMusic(music);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteMusic(id: string): Promise<void> {
  await apiClient.deleteMusic(id);
}

// ========== Voice Persona API ==========

/** 创建空 VoicePersona */
export function emptyVoicePersona(
  name = "未命名音色",
  sourceType: VoicePersona["sourceType"] = "upload",
  sourceAudioUrl = ""
): VoicePersona {
  const now = Date.now();
  return {
    id: uuid(),
    name,
    personaId: "",
    sourceType,
    sourceAudioUrl,
    status: "idle",
    createdAt: now,
    updatedAt: now,
  };
}

/** 获取全部音色，按创建时间降序 */
export async function getVoicePersonas(): Promise<VoicePersona[]> {
  return apiClient.listVoicePersonas();
}

/** 获取单个音色，不存在时返回 null */
export async function getVoicePersona(id: string): Promise<VoicePersona | null> {
  try {
    const all = await apiClient.listVoicePersonas();
    return all.find((v) => v.id === id) ?? null;
  } catch {
    return null;
  }
}

export async function saveVoicePersona(
  vp: VoicePersona
): Promise<{ ok: boolean; error?: string }> {
  try {
    await apiClient.saveVoicePersona(vp);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteVoicePersona(id: string): Promise<void> {
  await apiClient.deleteVoicePersona(id);
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
