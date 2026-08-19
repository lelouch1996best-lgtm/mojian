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
    styleSettings: { selectedStyleId: "cn-drama" },
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

/** 自动保存防抖间隔（ms） */
export const AUTOSAVE_DEBOUNCE_MS = 1500;

/** 简易防抖 */
export function debounce<T extends (...args: never[]) => void>(fn: T, wait = 300): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  }) as T;
}

/** 是否为 DOM 节点 */
function isDOMNode(value: unknown): value is Node {
  return typeof window !== "undefined" && value instanceof Node;
}

/**
 * 安全 JSON 序列化：遇到 BigInt、DOM 节点、循环引用时用描述性占位符替换，避免抛错。
 * 函数、Symbol、undefined 仍按 JSON.stringify 默认行为处理（对象中省略 / 数组中转为 null）。
 */
export function safeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key: string, val: unknown) => {
      if (val === null || typeof val === "boolean" || typeof val === "number" || typeof val === "string") {
        return val;
      }
      if (typeof val === "bigint") return `[BigInt: ${val.toString()}]`;
      if (isDOMNode(val)) return `[DOM ${val.nodeName.toLowerCase()}]`;
      if (typeof val !== "object") return val;
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
      return val;
    },
    space
  );
}

/**
 * 查找对象中第一个会导致 JSON.stringify 抛错的值的路径。
 * 检测：循环引用、DOM 节点、BigInt。
 */
export function findNonSerializablePath(value: unknown, maxDepth = 20): string | null {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, path: string, depth: number): string | null => {
    if (depth > maxDepth) return null;
    if (v === null || typeof v === "boolean" || typeof v === "number" || typeof v === "string") return null;
    if (typeof v === "function") return null;
    if (typeof v === "symbol") return null;
    if (typeof v === "undefined") return null;
    if (typeof v === "bigint") return path;
    if (isDOMNode(v)) return path;
    if (typeof v !== "object") return path;
    if (seen.has(v)) return path;
    seen.add(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const childPath = `${path}[${i}]`;
        const found = walk(v[i], childPath, depth + 1);
        if (found) return found;
      }
    } else {
      for (const key of Object.keys(v as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key;
        const found = walk((v as Record<string, unknown>)[key], childPath, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(value, "root", 0);
}

/** 下载 JSON 文件（使用安全序列化，避免循环引用导致崩溃） */
export function downloadJSON(filename: string, data: unknown): void {
  const blob = new Blob([safeStringify(data, 2)], {
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
 * @ 提及标签的尾部边界字符集（用于 @name 后接边界判断，确保完整标签匹配、避免子串误匹配）。
 * 不含「的」；音色参考等场景（如「@林坤的音色参考」）可通过 isMentionedInText 的
 * extraTrailingBoundaryChars 追加。统一供 removeTagPrefix / replaceAssetTagsWithImageNos /
 * 视频提及检测等复用，避免多处重复定义导致不一致。
 * （「-」转义为字面量避免被当作范围符）
 */
export const MENTION_BOUNDARY = "[\\s，。、,\\.！？!?\\n：:；;）)、】\"'`（）\\[\\]{}｜|《》〈〉…\\-·@]";

/**
 * 判断 name 是否以 @ 提及形式出现在 text 中（要求 @ 前缀 + 尾部边界）。
 * 用于「参考图/视频/音频是否被 @ 引用」的检测，避免裸文本（如「韩立」）被误判为已引用。
 * @param text 原始文本（保留 @ 前缀）
 * @param name 标签名（资产名 / 图片N / 参考图N / 视频N 等）
 * @param extraTrailingBoundaryChars 额外尾部边界字符（如视频音色参考场景传入 "的"，
 *   使「@林坤的音色参考」中的 @林坤 被识别为已提及）
 */
export function isMentionedInText(
  text: string,
  name: string,
  extraTrailingBoundaryChars?: string
): boolean {
  if (!text || !name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = extraTrailingBoundaryChars
    ? MENTION_BOUNDARY.slice(0, -1) + extraTrailingBoundaryChars + "]"
    : MENTION_BOUNDARY;
  return new RegExp(`@${escaped}(?=${boundary}|$)`).test(text);
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
  // @tagName + lookahead(边界|$) 确保完整匹配，再消耗一个可选尾随空格
  const re = new RegExp(`@${escaped}(?=${MENTION_BOUNDARY}|$) ?`, "g");
  return text.replace(re, tagName);
}

/**
 * 安全兜底：确保指定标签名在文本中都以 @ 前缀出现。
 * 用于单行智能标注后，防止 LLM 误删已有 @标签。
 * 仅对「当前缺少 @ 前缀」的裸名称补回 @；按边界匹配，避免误伤子串（如标签"明"不会误标"小明"）。
 * 与 removeTagPrefix / extractTags 使用一致的边界字符集。
 */
export function ensureExistingTagsPrefixed(text: string, tags: string[]): string {
  if (!text || tags.length === 0) return text ?? "";
  // 标签前置边界字符集（不含 @：@ 前缀的视为已标注，不重复处理）
  const leadingBoundary = MENTION_BOUNDARY.replace("@", "");
  // 标签尾部边界字符集（与 removeTagPrefix 一致，含 @）
  const trailingBoundary = MENTION_BOUNDARY;
  let result = text;
  for (const tag of tags) {
    if (!tag) continue;
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // 匹配「起始或前置边界字符 + 裸名称 + 尾部边界」；@ 前缀的因 @ 不在 leadingBoundary 内故不会被匹配
    const re = new RegExp(`(^|${leadingBoundary})${escaped}(?=${trailingBoundary}|$)`, "g");
    result = result.replace(re, (_m, p1: string) => `${p1}@${tag}`);
  }
  return result;
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
  let result = text;
  const entries = Array.from(assetImageNo.entries()).sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [name, no] of entries) {
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (no == null) {
      // 无参考图：去掉 @ 并吸收前后的空格（中文文本中多余，名称应与上下文相连）
      const re = new RegExp(` ?@${escaped}(?=${MENTION_BOUNDARY}|$) ?`, "g");
      result = result.replace(re, name);
    } else {
      // 有参考图：替换为 图片N，仅吸收尾随空格（图片N 是独立标记，前面留空格更清晰）
      const re = new RegExp(`@${escaped}(?=${MENTION_BOUNDARY}|$) ?`, "g");
      result = result.replace(re, `图片${no}`);
    }
  }
  return result;
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

/** 从 LLM 返回文本中提取单行标注结果：{"text":"..."}；兼容 items 数组格式（取首项 text） */
export function extractSingleTagText(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  const tryParse = (s: string): string | null => {
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed.text === "string") return parsed.text;
      if (parsed && Array.isArray(parsed.items) && typeof parsed.items[0]?.text === "string") {
        return parsed.items[0].text;
      }
      if (Array.isArray(parsed) && typeof parsed[0]?.text === "string") {
        return parsed[0].text;
      }
    } catch {
      /* ignore */
    }
    return null;
  };
  const direct = tryParse(trimmed);
  if (direct !== null) return direct;
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlock) {
    const r = tryParse(codeBlock[1].trim());
    if (r !== null) return r;
  }
  const objMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const r = tryParse(objMatch[0]);
    if (r !== null) return r;
  }
  return "";
}

/** 资产类型的中文标签 */
export const ASSET_TYPE_LABELS: Record<string, string> = {
  character: "人物",
  scene: "场景",
  object: "物品",
  shot: "镜头",
  screenshot: "截屏",
  storyboard: "故事板",
  generated: "生成",
  music: "音乐",
  voicePersona: "歌手音色",
  other: "其他",
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
  if (t === "character" || t === "scene" || t === "object" || t === "screenshot" || t === "generated") return t;
  // 兼容中文
  if (t === "人物") return "character";
  if (t === "场景") return "scene";
  if (t === "物品" || t === "道具") return "object";
  if (t === "截屏") return "screenshot";
  if (t === "生成" || t === "参考图") return "generated";
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

/**
 * 根据 @ 提及标签构建正则（最长优先，避免短名误匹配长名前缀）。
 * 例：values=["图片1","图片10"] 时，正则会先匹配 "图片10" 再匹配 "图片1"，避免 "图片1" 被当作 "图片10" 的前缀。
 */
export function buildMentionRegex(values: string[]): RegExp | null {
  const unique = Array.from(new Set(values)).filter(Boolean);
  if (unique.length === 0) return null;
  const sorted = unique.sort((a, b) => b.length - a.length);
  const escaped = sorted.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`@(${escaped.join("|")})`, "g");
}

/** 高亮切分片段：普通文字段 highlighted=false，@标签段 highlighted=true */
export interface MentionSpan {
  text: string;
  highlighted: boolean;
}

/**
 * 将文本按 @提及 标签切分为片段数组（供 React 组件 map 渲染为高亮 span）。
 * values 为需要高亮的标签名列表（不含 @ 前缀）。
 */
export function renderMentionSpans(text: string, values: string[]): MentionSpan[] {
  const regex = buildMentionRegex(values);
  if (!regex) return [{ text, highlighted: false }];
  const spans: MentionSpan[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ text: text.slice(lastIndex, match.index), highlighted: false });
    }
    spans.push({ text: match[0], highlighted: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    spans.push({ text: text.slice(lastIndex), highlighted: false });
  }
  return spans;
}

