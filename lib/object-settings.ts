import type { ObjectProfile } from "@/lib/types";

/** 创建空白物品档案 */
export function emptyObjectProfile(): ObjectProfile {
  return {
    id: "",
    objectId: "",
    version: 1,
    versionLabel: "",
    name: "",
    category: "",
    appearance: "",
    purpose: "",
    origin: "",
  };
}

/**
 * 生成用于 LLM 上下文的物品设定文本片段。
 * 每个 objectId 只取最新版本（version 最大）。
 * 空数组或全空字段返回 ""。
 */
export function objectSettingsToText(o: ObjectProfile[] | null | undefined): string {
  if (!o || o.length === 0) return "";
  const latest = getLatestObjectVersions(o);
  const blocks = latest
    .filter((ob) => ob.name?.trim())
    .map((ob, i) => {
      const lines: string[] = [`【物品${i + 1}：${ob.name.trim()}】`];
      if (ob.category?.trim()) lines.push(`分类：${ob.category.trim()}`);
      if (ob.appearance?.trim()) lines.push(`外观：${ob.appearance.trim()}`);
      if (ob.purpose?.trim()) lines.push(`功能：${ob.purpose.trim()}`);
      if (ob.origin?.trim()) lines.push(`来源：${ob.origin.trim()}`);
      return lines.join("\n");
    })
    .filter(Boolean);
  return blocks.length > 0 ? blocks.join("\n\n") : "";
}

/** 检查物品设定是否有任何有效条目（同步，接收数组） */
export function hasObjectSettings(o: ObjectProfile[] | null | undefined): boolean {
  if (!o || o.length === 0) return false;
  return o.some((ob) => ob.name?.trim());
}

/** 检查单个物品档案是否有任何有效内容（名称/文本字段/图片/参考图/生图任务任一存在）。
 *  用于自动保存时过滤完全空白的占位记录，避免只上传图片未填名称时记录被误删。 */
export function isObjectProfileValid(o: ObjectProfile | null | undefined): boolean {
  if (!o) return false;
  return Boolean(
    o.name?.trim() ||
      o.category?.trim() ||
      o.appearance?.trim() ||
      o.purpose?.trim() ||
      o.origin?.trim() ||
      o.versionLabel?.trim() ||
      o.imageUrl ||
      (o.referenceImages && o.referenceImages.length > 0) ||
      o.imageTaskId
  );
}

/** 从物品列表中，按 objectId 分组，取每组 version 最大的 */
export function getLatestObjectVersions(o: ObjectProfile[]): ObjectProfile[] {
  if (!o || o.length === 0) return [];
  const groupMap = new Map<string, ObjectProfile[]>();
  for (const ob of o) {
    const gid = ob.objectId;
    const arr = groupMap.get(gid);
    if (arr) arr.push(ob);
    else groupMap.set(gid, [ob]);
  }
  const result: ObjectProfile[] = [];
  groupMap.forEach((arr: ObjectProfile[]) => {
    arr.sort((a: ObjectProfile, b: ObjectProfile) => b.version - a.version);
    result.push(arr[0]);
  });
  return result;
}
