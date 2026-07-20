import type { CharacterProfile, Episode, ObjectProfile, SceneProfile, Series } from "@/lib/types";
import { apiClient } from "@/lib/api-client";
import { normalizeStyleSettings } from "@/lib/style-settings";

/** 兼容旧 Series 数据：补全缺失字段（worldSettings / characterSettings / objectSettings / styleSettings 等） */
export function normalizeSeries(s: Series): Series {
  return {
    ...s,
    worldSettings: s.worldSettings ?? { background: "", theme: "", style: "" },
    characterSettings: (s.characterSettings ?? []).map(normalizeCharacterProfile),
    objectSettings: (s.objectSettings ?? []).map(normalizeObjectProfile),
    sceneSettings: (s.sceneSettings ?? []).map(normalizeSceneProfile),
    styleSettings: normalizeStyleSettings(s.styleSettings),
    episodeOrder: s.episodeOrder ?? [],
    order: s.order ?? 0,
  };
}

/** 兼容旧 CharacterProfile 数据：补全 characterId / version / versionLabel */
function normalizeCharacterProfile(c: CharacterProfile): CharacterProfile {
  return {
    ...c,
    characterId: c.characterId || c.id,
    version: c.version ?? 1,
    versionLabel: c.versionLabel ?? "",
  };
}

/** 兼容旧 ObjectProfile 数据：补全 objectId / version / versionLabel */
function normalizeObjectProfile(o: ObjectProfile): ObjectProfile {
  return {
    ...o,
    objectId: o.objectId || o.id,
    version: o.version ?? 1,
    versionLabel: o.versionLabel ?? "",
  };
}

/** 兼容旧 SceneProfile 数据：补全 sceneId / version / versionLabel */
function normalizeSceneProfile(s: SceneProfile): SceneProfile {
  return {
    ...s,
    sceneId: s.sceneId || s.id,
    version: s.version ?? 1,
    versionLabel: s.versionLabel ?? "",
  };
}

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
  return list.map(normalizeSeries).sort((a, b) => a.order - b.order);
}

export async function getSeries(id: string): Promise<Series | null> {
  try {
    const s = await apiClient.getSeries(id);
    return normalizeSeries(s);
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
