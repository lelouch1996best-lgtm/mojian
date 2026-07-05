import type { CharacterProfile, Episode, ObjectProfile, SceneProfile, Series } from "@/lib/types";
import { normalizeEpisode } from "@/lib/utils";
import { apiClient } from "@/lib/api-client";

const EPISODES_KEY = "ai-script-episodes";
const SERIES_KEY = "mojian_series";
const STORAGE_MODE = process.env.NEXT_PUBLIC_STORAGE_MODE;

/** 兼容旧 Series 数据：补全缺失字段（worldSettings / characterSettings / objectSettings / styleSettings 等） */
export function normalizeSeries(s: Series): Series {
  return {
    ...s,
    worldSettings: s.worldSettings ?? { background: "", theme: "", style: "" },
    characterSettings: (s.characterSettings ?? []).map(normalizeCharacterProfile),
    objectSettings: (s.objectSettings ?? []).map(normalizeObjectProfile),
    sceneSettings: (s.sceneSettings ?? []).map(normalizeSceneProfile),
    styleSettings: s.styleSettings ?? { selectedStyleId: "realistic", overrides: {} },
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

// ========== Episode 底层读写 ==========

function safeReadEpisodes(): Record<string, Episode> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(EPISODES_KEY);
    if (!raw) return {};
    const map = JSON.parse(raw) as Record<string, Episode>;
    for (const k of Object.keys(map)) {
      map[k] = normalizeEpisode(map[k]);
    }
    return map;
  } catch {
    return {};
  }
}

function safeWriteEpisodes(map: Record<string, Episode>): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: false };
  try {
    localStorage.setItem(EPISODES_KEY, JSON.stringify(map));
    return { ok: true };
  } catch (e) {
    const msg =
      e instanceof DOMException && e.name === "QuotaExceededError"
        ? "本地存储已满，请删除部分旧剧集后再保存"
        : "保存失败";
    return { ok: false, error: msg };
  }
}

// ========== Series 底层读写 ==========

function safeReadSeries(): Record<string, Series> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SERIES_KEY);
    if (!raw) return {};
    const map = JSON.parse(raw) as Record<string, Series>;
    for (const k of Object.keys(map)) {
      map[k] = normalizeSeries(map[k]);
    }
    return map;
  } catch {
    return {};
  }
}

function safeWriteSeries(map: Record<string, Series>): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: false };
  try {
    localStorage.setItem(SERIES_KEY, JSON.stringify(map));
    return { ok: true };
  } catch (e) {
    const msg =
      e instanceof DOMException && e.name === "QuotaExceededError"
        ? "本地存储已满，请删除部分旧剧集后再保存"
        : "保存失败";
    return { ok: false, error: msg };
  }
}

// ========== Episode 公开 API ==========

export async function getEpisode(id: string): Promise<Episode | null> {
  if (STORAGE_MODE === "server") return apiClient.getEpisode(id);
  return safeReadEpisodes()[id] ?? null;
}

export async function saveEpisode(ep: Episode): Promise<{ ok: boolean; error?: string }> {
  if (STORAGE_MODE === "server") {
    try { await apiClient.saveEpisode(ep); return { ok: true }; } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
  const map = safeReadEpisodes();
  map[ep.id] = { ...ep, updatedAt: Date.now() };
  return safeWriteEpisodes(map);
}

export async function deleteEpisode(id: string): Promise<void> {
  if (STORAGE_MODE === "server") { await apiClient.deleteEpisode(id); return; }
  const map = safeReadEpisodes();
  delete map[id];
  safeWriteEpisodes(map);
}

/** 获取某系列下的所有剧集，按 Series.episodeOrder 排序 */
export async function getEpisodesBySeries(seriesId: string): Promise<Episode[]> {
  if (STORAGE_MODE === "server") return apiClient.getEpisodesBySeries(seriesId);
  const series = getSeriesLocal(seriesId);
  const map = safeReadEpisodes();
  if (!series) return [];
  const ordered: Episode[] = [];
  const seen = new Set<string>();
  for (const epId of series.episodeOrder) {
    const ep = map[epId];
    if (ep && ep.seriesId === seriesId && !seen.has(ep.id)) {
      seen.add(ep.id);
      ordered.push(ep);
    }
  }
  for (const ep of Object.values(map)) {
    if (ep.seriesId === seriesId && !seen.has(ep.id)) {
      ordered.push(ep);
    }
  }
  return ordered;
}

// ========== Series 公开 API ==========

export async function listSeries(): Promise<Series[]> {
  if (STORAGE_MODE === "server") {
    const list = await apiClient.listSeries();
    return list.map(normalizeSeries).sort((a, b) => a.order - b.order);
  }
  return Object.values(safeReadSeries()).sort((a, b) => a.order - b.order);
}

export async function getSeries(id: string): Promise<Series | null> {
  if (STORAGE_MODE === "server") {
    const s = await apiClient.getSeries(id);
    return s ? normalizeSeries(s) : null;
  }
  return safeReadSeries()[id] ?? null;
}

/** localStorage 模式下的同步版 getSeries（内部用） */
function getSeriesLocal(id: string): Series | null {
  return safeReadSeries()[id] ?? null;
}

export async function saveSeries(s: Series): Promise<{ ok: boolean; error?: string }> {
  if (STORAGE_MODE === "server") {
    try { await apiClient.saveSeries(s); return { ok: true }; } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
  const map = safeReadSeries();
  map[s.id] = { ...s, updatedAt: Date.now() };
  return safeWriteSeries(map);
}

export async function deleteSeries(id: string): Promise<void> {
  if (STORAGE_MODE === "server") { await apiClient.deleteSeries(id); return; }
  const map = safeReadSeries();
  delete map[id];
  safeWriteSeries(map);
}
