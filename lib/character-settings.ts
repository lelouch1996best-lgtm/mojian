import type { CharacterProfile } from "@/lib/types";
import { apiClient } from "@/lib/api-client";

const CHARACTER_KEY = "mojian_character_settings";
const STORAGE_MODE = process.env.NEXT_PUBLIC_STORAGE_MODE;

/** 创建空白人物档案 */
export function emptyCharacterProfile(): CharacterProfile {
  return {
    id: "",
    characterId: "",
    version: 1,
    versionLabel: "",
    name: "",
    role: "",
    genderAge: "",
    appearance: "",
    personality: "",
    background: "",
    relationships: "",
  };
}

export async function getCharacterSettings(): Promise<CharacterProfile[]> {
  if (STORAGE_MODE === "server") {
    try {
      return await apiClient.getSetting<CharacterProfile[]>("character");
    } catch {
      return [];
    }
  }
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CHARACTER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveCharacterSettings(c: CharacterProfile[]): Promise<void> {
  if (STORAGE_MODE === "server") {
    await apiClient.saveSetting("character", c);
    return;
  }
  if (typeof window === "undefined") return;
  localStorage.setItem(CHARACTER_KEY, JSON.stringify(c));
}

/**
 * 生成用于 LLM 上下文的人物设定文本片段。
 * 每个 characterId 只取最新版本（version 最大）。
 * 空数组或全空字段返回 ""。
 */
export function characterSettingsToText(c: CharacterProfile[] | null | undefined): string {
  if (!c || c.length === 0) return "";
  // 按 characterId 分组，取 version 最大的
  const latest = getLatestVersions(c);
  const blocks = latest
    .filter((ch) => ch.name?.trim())
    .map((ch, i) => {
      const lines: string[] = [`【人物${i + 1}：${ch.name.trim()}】`];
      if (ch.role?.trim()) lines.push(`角色定位：${ch.role.trim()}`);
      if (ch.genderAge?.trim()) lines.push(`性别年龄：${ch.genderAge.trim()}`);
      if (ch.appearance?.trim()) lines.push(`外貌：${ch.appearance.trim()}`);
      if (ch.personality?.trim()) lines.push(`性格：${ch.personality.trim()}`);
      if (ch.background?.trim()) lines.push(`背景故事：${ch.background.trim()}`);
      if (ch.relationships?.trim()) lines.push(`人物关系：${ch.relationships.trim()}`);
      return lines.join("\n");
    })
    .filter(Boolean);
  return blocks.length > 0 ? blocks.join("\n\n") : "";
}

/** 检查人物设定是否有任何有效条目（同步，接收数组） */
export function hasCharacterSettings(c: CharacterProfile[] | null | undefined): boolean {
  if (!c || c.length === 0) return false;
  return c.some((ch) => ch.name?.trim());
}

/**
 * 从人物列表中，按 characterId 分组，取每组 version 最大的。
 * 兼容旧数据（无 characterId 的视为各自独立）。
 */
export function getLatestVersions(c: CharacterProfile[]): CharacterProfile[] {
  if (!c || c.length === 0) return [];
  const groupMap = new Map<string, CharacterProfile[]>();
  for (const ch of c) {
    const gid = ch.characterId || ch.id;
    const arr = groupMap.get(gid);
    if (arr) arr.push(ch);
    else groupMap.set(gid, [ch]);
  }
  const result: CharacterProfile[] = [];
  groupMap.forEach((arr: CharacterProfile[]) => {
    arr.sort((a: CharacterProfile, b: CharacterProfile) => (b.version ?? 1) - (a.version ?? 1));
    result.push(arr[0]);
  });
  return result;
}
