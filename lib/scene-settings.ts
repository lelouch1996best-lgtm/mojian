import type { SceneProfile } from "@/lib/types";

/** 创建空白场景档案 */
export function emptySceneProfile(): SceneProfile {
  return {
    id: "",
    sceneId: "",
    version: 1,
    versionLabel: "",
    name: "",
    category: "",
    appearance: "",
    lightingMood: "",
    origin: "",
  };
}

/**
 * 生成用于 LLM 上下文的场景设定文本片段。
 * 每个 sceneId 只取最新版本（version 最大）。
 * 空数组或全空字段返回 ""。
 */
export function sceneSettingsToText(s: SceneProfile[] | null | undefined): string {
  if (!s || s.length === 0) return "";
  const latest = getLatestSceneVersions(s);
  const blocks = latest
    .filter((sc) => sc.name?.trim())
    .map((sc, i) => {
      const lines: string[] = [`【场景${i + 1}：${sc.name.trim()}】`];
      if (sc.category?.trim()) lines.push(`分类：${sc.category.trim()}`);
      if (sc.appearance?.trim()) lines.push(`外观：${sc.appearance.trim()}`);
      if (sc.lightingMood?.trim()) lines.push(`光影：${sc.lightingMood.trim()}`);
      if (sc.origin?.trim()) lines.push(`来源：${sc.origin.trim()}`);
      return lines.join("\n");
    })
    .filter(Boolean);
  return blocks.length > 0 ? blocks.join("\n\n") : "";
}

/** 检查场景设定是否有任何有效条目（同步，接收数组） */
export function hasSceneSettings(s: SceneProfile[] | null | undefined): boolean {
  if (!s || s.length === 0) return false;
  return s.some((sc) => sc.name?.trim());
}

/** 检查单个场景档案是否有任何有效内容（名称/文本字段/图片/参考图/生图任务任一存在）。
 *  用于自动保存时过滤完全空白的占位记录，避免只上传图片未填名称时记录被误删。 */
export function isSceneProfileValid(s: SceneProfile | null | undefined): boolean {
  if (!s) return false;
  return Boolean(
    s.name?.trim() ||
      s.category?.trim() ||
      s.appearance?.trim() ||
      s.lightingMood?.trim() ||
      s.origin?.trim() ||
      s.versionLabel?.trim() ||
      s.imageUrl ||
      (s.referenceImages && s.referenceImages.length > 0) ||
      s.imageTaskId
  );
}

/** 从场景列表中，按 sceneId 分组，取每组 version 最大的 */
export function getLatestSceneVersions(s: SceneProfile[]): SceneProfile[] {
  if (!s || s.length === 0) return [];
  const groupMap = new Map<string, SceneProfile[]>();
  for (const sc of s) {
    const gid = sc.sceneId;
    const arr = groupMap.get(gid);
    if (arr) arr.push(sc);
    else groupMap.set(gid, [sc]);
  }
  const result: SceneProfile[] = [];
  groupMap.forEach((arr: SceneProfile[]) => {
    arr.sort((a: SceneProfile, b: SceneProfile) => b.version - a.version);
    result.push(arr[0]);
  });
  return result;
}
