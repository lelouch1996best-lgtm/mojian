import type { Asset, AssetType, CharacterProfile, Episode, RawShot, Series, Shot } from "./types";

/** 简易 uuid（无需严格，本地用） */
export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 创建空 Shot */
export function emptyShot(): Shot {
  return {
    id: uuid(),
    duration: "",
    visualDescription: "",
    shotType: "",
    lightingMood: "",
    dialogueVoiceover: "",
    soundEffects: "",
    cameraMovement: "",
    finalPrompt: "",
    videoUrl: "",
    videoStatus: "idle",
    videoTaskId: "",
    relatedAssetIds: [],
  };
}

/** 创建空 Episode */
export function emptyEpisode(seriesId = "", title = "未命名剧集"): Episode {
  const now = Date.now();
  return {
    id: uuid(),
    title,
    seriesId,
    createdAt: now,
    updatedAt: now,
    step: 1,
    originalContent: "",
    expandedContent: "",
    shots: [],
    assets: [],
  };
}

/** 创建空 Series */
export function emptySeries(order = 1, title = "未命名企划"): Series {
  const now = Date.now();
  return {
    id: uuid(),
    title,
    description: "",
    order,
    createdAt: now,
    updatedAt: now,
    worldSettings: { background: "", theme: "", style: "" },
    characterSettings: [],
    objectSettings: [],
    sceneSettings: [],
    styleSettings: { selectedStyleId: "realistic", overrides: {}, customPresets: [] },
    episodeOrder: [],
  };
}

/** 创建空 Asset */
export function emptyAsset(name: string, type: AssetType = "character"): Asset {
  return {
    id: uuid(),
    name,
    type,
    description: "",
    imagePrompt: "",
    imageUrl: "",
    status: "pending",
  };
}

/** 从 RawShot 构造 Shot（补全缺失字段） */
export function toShot(raw: RawShot): Shot {
  return {
    id: uuid(),
    duration: raw.duration ?? "",
    visualDescription: raw.visualDescription ?? "",
    shotType: raw.shotType ?? "",
    lightingMood: raw.lightingMood ?? "",
    dialogueVoiceover: raw.dialogueVoiceover ?? "",
    soundEffects: raw.soundEffects ?? "",
    cameraMovement: raw.cameraMovement ?? "",
    finalPrompt: "",
    videoUrl: "",
    videoStatus: "idle",
    videoTaskId: "",
    relatedAssetIds: [],
  };
}

/**
 * 从 LLM 返回文本中提取分镜数组。
 * 兼容：纯 JSON 数组、{"shots":[...]} 对象、带 markdown 代码块。
 */
export function extractShots(text: string): RawShot[] {
  if (!text) return [];
  const trimmed = text.trim();

  // 1) 直接整体 parse
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed as RawShot[];
    if (parsed && Array.isArray(parsed.shots)) return parsed.shots as RawShot[];
    if (parsed && Array.isArray(parsed.data)) return parsed.data as RawShot[];
  } catch {
    /* 继续尝试正则 */
  }

  // 2) 去掉 markdown 代码块再 parse
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) return parsed as RawShot[];
      if (parsed && Array.isArray(parsed.shots)) return parsed.shots as RawShot[];
    } catch {
      /* 继续 */
    }
  }

  // 3) 正则匹配首个 [ ... ] 块
  const arrMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]);
      if (Array.isArray(parsed)) return parsed as RawShot[];
    } catch {
      /* 放弃 */
    }
  }

  // 4) 匹配 {"shots":[...]}
  const objMatch = trimmed.match(/\{[\s\S]*"shots"[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (parsed && Array.isArray(parsed.shots)) return parsed.shots as RawShot[];
    } catch {
      /* 放弃 */
    }
  }

  return [];
}

/** 简易防抖 */
export function debounce<T extends (...args: never[]) => void>(fn: T, wait = 300): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  }) as T;
}

/** 下载 JSON 文件 */
export function downloadJSON(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 格式化时间戳 */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 从单段文本中提取 @名称 标签名（单个 @ 前缀），按出现顺序，不去重 */
export function extractTags(text: string): string[] {
  if (!text) return [];
  // 匹配 @ 后面的连续字符，到空格、标点、或非中文/非字母/非数字为止
  // 先尝试匹配纯中文名（2-4字），再尝试匹配字母数字混合
  const tags: string[] = [];
  // 方案：抓取 @ 后的连续字符，再按合理规则截取到中文词边界
  const re = /@([^\s@，。、,\.！？!?\n：:；;）)、】"'`（）\[\]{}｜|《》〈〉…—·]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let name = m[1].trim();
    if (!name) continue;
    // 如果末尾是纯字母数字 + 中文混排，从最后一个中文字符处截断可能需要，
    // 但对于 @咖啡馆里拿着 — 期望的标签是"咖啡馆"，不是"咖啡馆里拿着"
    // 策略：如果末尾字符是中文且后面紧跟中文但不属于同一词，尝试识别
    // 保守策略：不做额外截断，由 LLM prompt 保证标签后有空格/标点
    tags.push(name);
  }
  return tags;
}

/** 从所有镜头的画面描述中提取去重标签（保持首次出现顺序） */
export function extractAllTags(shots: Shot[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const s of shots) {
    for (const tag of extractTags(s.visualDescription)) {
      if (!seen.has(tag)) {
        seen.add(tag);
        result.push(tag);
      }
    }
  }
  return result;
}

/**
 * 从文本中移除指定标签的 @ 前缀（保留名称文字）。
 * 处理所有出现位置，仅匹配完整标签（@ + tagName + 边界字符）。
 * 同时吸收标签后的一个分隔空格（LLM 标注时按规则在标签后加的空格，
 * 中文文本中多余，删除时一并去掉；标签后是标点/行尾则不动）。
 * 如「@小明 走进 @咖啡馆」移除「小明」后变为「小明走进 @咖啡馆」。
 */
export function removeTagPrefix(text: string, tagName: string): string {
  if (!text || !tagName) return text ?? "";
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 标签边界字符集（与 extractTags 一致）+ @；- 转义为字面量避免被当作范围符
  const boundary = "[\\s，。、,\\.！？!?\\n：:；;）)、】\"'`（）\\[\\]{}｜|《》〈〉…\\-·@]";
  // @tagName + lookahead(边界|$) 确保完整匹配，再消耗一个可选尾随空格
  const re = new RegExp(`@${escaped}(?=${boundary}|$) ?`, "g");
  return text.replace(re, tagName);
}

/**
 * 解析提示词中的 @资产名称（发送给 Seedance API 前的确定性替换，不依赖 LLM）。
 * - 有参考图的资产：@资产名称 -> 图片N（N 与参考图上传顺序一致）
 * - 无参考图的资产：@资产名称 -> 资产名称（去掉 @ 和尾随空格）
 * 与 removeTagPrefix 使用相同的边界匹配逻辑。
 * 按名称长度降序替换，避免短名称是长名称子串时误匹配（如「李」vs「李华」）。
 * @param text 原始提示词
 * @param assetImageNo 资产名称 -> 图片编号映射；值为 null 表示该资产无参考图，仅去掉 @
 */
export function replaceAssetTagsWithImageNos(
  text: string,
  assetImageNo: Map<string, number | null>
): string {
  if (!text || assetImageNo.size === 0) return text ?? "";
  const boundary = "[\\s，。、,\\.！？!?\\n：:；;）)、】\"'`（）\\[\\]{}｜|《》〈〉…\\-·@]";
  let result = text;
  const entries = Array.from(assetImageNo.entries()).sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [name, no] of entries) {
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (no == null) {
      // 无参考图：去掉 @ 并吸收前后的空格（中文文本中多余，名称应与上下文相连）
      const re = new RegExp(` ?@${escaped}(?=${boundary}|$) ?`, "g");
      result = result.replace(re, name);
    } else {
      // 有参考图：替换为 图片N，仅吸收尾随空格（图片N 是独立标记，前面留空格更清晰）
      const re = new RegExp(`@${escaped}(?=${boundary}|$) ?`, "g");
      result = result.replace(re, `图片${no}`);
    }
  }
  return result;
}

/** 兼容旧 Episode 数据：补全缺失字段（assets / shot 视频字段 等） */
export function normalizeEpisode(ep: Episode, defaultSeriesId = ""): Episode {
  return {
    ...ep,
    seriesId: ep.seriesId || defaultSeriesId,
    step: ep.step ?? 1,
    assets: ep.assets ?? [],
    shots: (ep.shots ?? []).map((s) => ({
      ...s,
      finalPrompt: s.finalPrompt ?? "",
      videoUrl: s.videoUrl ?? "",
      videoStatus: s.videoStatus ?? "idle",
      videoTaskId: s.videoTaskId ?? "",
      relatedAssetIds: s.relatedAssetIds ?? [],
    })),
  };
}

/** 从 LLM 返回文本中提取标注 items：{index, text}[] */
export interface TagItem {
  index: number;
  text: string;
}

export function extractTagItems(text: string): TagItem[] {
  if (!text) return [];
  const trimmed = text.trim();
  const tryParse = (s: string): TagItem[] | null => {
    try {
      const parsed = JSON.parse(s);
      if (parsed && Array.isArray(parsed.items)) {
        return parsed.items as TagItem[];
      }
      if (Array.isArray(parsed)) {
        return parsed as TagItem[];
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  // 1) 直接 parse
  const direct = tryParse(trimmed);
  if (direct) return direct;

  // 2) 去掉 markdown 代码块
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlock) {
    const r = tryParse(codeBlock[1].trim());
    if (r) return r;
  }

  // 3) 匹配 {...}
  const objMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const r = tryParse(objMatch[0]);
    if (r) return r;
  }
  return [];
}

/** 资产类型的中文标签 */
export const ASSET_TYPE_LABELS: Record<string, string> = {
  character: "人物",
  scene: "场景",
  object: "物品",
  screenshot: "截屏",
  storyboard: "故事板",
};

/** 从 LLM 返回文本中提取资产数组 */
export interface RawAsset {
  name?: string;
  type?: string;
  description?: string;
}

export function extractAssets(text: string): RawAsset[] {
  if (!text) return [];
  const trimmed = text.trim();
  const tryParse = (s: string): RawAsset[] | null => {
    try {
      const parsed = JSON.parse(s);
      if (parsed && Array.isArray(parsed.assets)) return parsed.assets as RawAsset[];
      if (Array.isArray(parsed)) return parsed as RawAsset[];
    } catch {
      /* ignore */
    }
    return null;
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlock) {
    const r = tryParse(codeBlock[1].trim());
    if (r) return r;
  }

  const arrMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    const r = tryParse(arrMatch[0]);
    if (r) return r;
  }

  const objMatch = trimmed.match(/\{[\s\S]*"assets"[\s\S]*\}/);
  if (objMatch) {
    const r = tryParse(objMatch[0]);
    if (r) return r;
  }
  return [];
}

/** 规范化资产 type 字段 */
export function normalizeAssetType(t?: string): AssetType {
  if (t === "character" || t === "scene" || t === "object" || t === "screenshot") return t;
  // 兼容中文
  if (t === "人物") return "character";
  if (t === "场景") return "scene";
  if (t === "物品" || t === "道具") return "object";
  if (t === "截屏") return "screenshot";
  return "character";
}

/** 从 LLM 返回文本中提取人物设定数组 */
export interface RawCharacter {
  name?: string;
  role?: string;
  genderAge?: string;
  appearance?: string;
  personality?: string;
  background?: string;
  relationships?: string;
}

export function extractCharacters(text: string): RawCharacter[] {
  if (!text) return [];
  const trimmed = text.trim();
  const tryParse = (s: string): RawCharacter[] | null => {
    try {
      const parsed = JSON.parse(s);
      if (parsed && Array.isArray(parsed.characters)) return parsed.characters as RawCharacter[];
      if (Array.isArray(parsed)) return parsed as RawCharacter[];
    } catch {
      /* ignore */
    }
    return null;
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlock) {
    const r = tryParse(codeBlock[1].trim());
    if (r) return r;
  }

  const arrMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    const r = tryParse(arrMatch[0]);
    if (r) return r;
  }

  const objMatch = trimmed.match(/\{[\s\S]*"characters"[\s\S]*\}/);
  if (objMatch) {
    const r = tryParse(objMatch[0]);
    if (r) return r;
  }
  return [];
}

/** 从 RawCharacter 构造 CharacterProfile（补全 id + 缺失字段） */
export function toCharacterProfile(raw: RawCharacter): CharacterProfile {
  return {
    id: uuid(),
    characterId: uuid(),
    version: 1,
    versionLabel: "",
    name: raw.name?.trim() ?? "",
    role: raw.role?.trim() ?? "",
    genderAge: raw.genderAge?.trim() ?? "",
    appearance: raw.appearance?.trim() ?? "",
    personality: raw.personality?.trim() ?? "",
    background: raw.background?.trim() ?? "",
    relationships: raw.relationships?.trim() ?? "",
  };
}
