import type { AssetType, StylePreset, StyleSettings } from "@/lib/types";
import { apiClient } from "@/lib/api-client";
import { uuid } from "@/lib/utils";

/** 故事板图片提示词默认模板（含 {镜头信息} 占位符，生成时替换为当前镜头信息块） */
export const DEFAULT_STORYBOARD_TEMPLATE = `专业影视分镜故事板，多格分格铅笔线稿素描，黑白手绘速写，分镜师手稿，干净线稿无上色。
{镜头信息}
要求：每个分格内标注镜头时长、景别、光圈、运镜；每格下方附文字描述；画面添加红/蓝/橙彩色箭头指示动作、视线与运镜方向，并以手写小字标注构图思路；线条采用细腻排线表现阴影与层次，整体为黑白铅笔速写风格，不上色。`;

/** 内置预设风格（作为全局模板库的初始种子数据） */
const DEFAULT_PRESETS: StylePreset[] = [
  {
    id: "cn-drama",
    name: "cg超写实动漫风格",
    description: "cg超写实动漫风格",
    characterTemplate:
      "完整角色设定稿，白色背景，同画布分左右两列排版：第一列超精细面部特写（占30%宽度），第二列角色标准三视图（正面 / 侧面 / 背面）（占70%宽度）。cg超写实动漫风格，8K超高清，细节丰富，光影层次分明，3D渲染质感。",
    sceneTemplate:
      "场景全景图，360度全方位展示。cg超写实动漫风格，8K超高清，细节丰富，光影层次分明，3D渲染质感。",
    objectTemplate:
      "完整物品设计稿，白色背景，同画布分左右两列排版：第一列超精细正面特写（占30%宽度），第二列标准三视图（左侧面 / 右侧面 / 背面）（占70%宽度）。cg超写实动漫风格，8K超高清，细节丰富，光影层次分明，3D渲染质感。",
    storyboardTemplate: DEFAULT_STORYBOARD_TEMPLATE,
  },
];

/** 全局风格模板存储的 setting key */
const STYLE_TEMPLATES_KEY = "style-templates";

/** 模块级缓存：避免每次 sync 调用都读取数据库 */
let _globalTemplatesCache: StylePreset[] | null = null;

/** 返回所有内置预设风格（默认值） */
export function getDefaultPresets(): StylePreset[] {
  return DEFAULT_PRESETS.map((p) => ({ ...p }));
}

/** 根据 id 获取内置默认预设 */
export function getDefaultPreset(id: string): StylePreset | undefined {
  return DEFAULT_PRESETS.find((p) => p.id === id);
}

/** 判断某 id 是否为内置预设 */
export function isBuiltinPreset(id: string): boolean {
  return DEFAULT_PRESETS.some((p) => p.id === id);
}

/** 创建一个空的风格模板；可传入 source 复制模板内容 */
export function createEmptyTemplate(source?: StylePreset | null): StylePreset {
  return {
    id: `custom-${uuid()}`,
    name: "新风格",
    description: "",
    characterTemplate: source?.characterTemplate ?? "",
    sceneTemplate: source?.sceneTemplate ?? "",
    objectTemplate: source?.objectTemplate ?? "",
    storyboardTemplate: source?.storyboardTemplate ?? DEFAULT_STORYBOARD_TEMPLATE,
    characterReferenceImage: source?.characterReferenceImage,
    sceneReferenceImage: source?.sceneReferenceImage,
    objectReferenceImage: source?.objectReferenceImage,
  };
}

/**
 * 读取全局风格模板列表（异步）。首次读取会从数据库加载并缓存；
 * 若数据库无数据，则以内置预设初始化并落库。
 */
export async function getStyleTemplates(): Promise<StylePreset[]> {
  if (_globalTemplatesCache) return _globalTemplatesCache.map((p) => ({ ...p }));

  let templates: StylePreset[] = [];
  try {
    const stored = await apiClient.getSetting<StylePreset[]>(STYLE_TEMPLATES_KEY);
    if (stored && Array.isArray(stored) && stored.length > 0) {
      templates = stored.map((p) => ({ ...p }));
    }
  } catch {
    /* key 不存在或读取失败，走初始化逻辑 */
  }

  if (templates.length === 0) {
    templates = DEFAULT_PRESETS.map((p) => ({ ...p }));
    await apiClient.saveSetting(STYLE_TEMPLATES_KEY, templates);
  }

  _globalTemplatesCache = templates.map((p) => ({ ...p }));
  return _globalTemplatesCache.map((p) => ({ ...p }));
}

/** 获取全局风格模板列表（同步，依赖模块缓存；缓存未就绪时回退到内置预设） */
export function getStyleTemplatesSync(): StylePreset[] {
  const list = _globalTemplatesCache ?? DEFAULT_PRESETS;
  return list.map((p) => ({ ...p }));
}

/** 保存全局风格模板列表（同步更新缓存 + 异步落库） */
export async function saveStyleTemplates(templates: StylePreset[]): Promise<void> {
  const normalized = templates.map((p) => ({ ...p }));
  _globalTemplatesCache = normalized.map((p) => ({ ...p }));
  await apiClient.saveSetting(STYLE_TEMPLATES_KEY, normalized);
}

/** 获取所有风格列表（全局模板），同步版本 */
export function getAllStylesSync(_settings?: StyleSettings | null): StylePreset[] {
  return getStyleTemplatesSync();
}

/** 根据 id 查找风格模板（从全局缓存），同步版本 */
export function getPresetByIdSync(id: string, _settings?: StyleSettings | null): StylePreset | undefined {
  return getStyleTemplatesSync().find((p) => p.id === id);
}

/** 获取所有风格列表（全局模板） */
export async function getAllStyles(): Promise<StylePreset[]> {
  return getStyleTemplates();
}

/** 获取当前选中的风格（从全局模板中按 selectedStyleId 查找）。可传入 seriesStyleSettings */
export async function getActiveStyle(seriesSettings?: StyleSettings | null): Promise<StylePreset> {
  await getStyleTemplates();
  return getActiveStyleSync(seriesSettings);
}

/** getActiveStyle 的同步版本：仅在已确保全局模板缓存就绪时使用（不读取数据库） */
export function getActiveStyleSync(seriesSettings?: StyleSettings | null): StylePreset {
  const templates = getStyleTemplatesSync();
  const id = seriesSettings?.selectedStyleId ?? templates[0]?.id ?? DEFAULT_PRESETS[0].id;
  return templates.find((p) => p.id === id) ?? { ...templates[0] };
}

/** 获取当前选中风格的故事板提示词模板（同步） */
export function getStoryboardTemplateSync(seriesSettings?: StyleSettings | null): string {
  return getActiveStyleSync(seriesSettings).storyboardTemplate;
}

/** 按资产类型获取对应的图片提示词模板。可传入 seriesStyleSettings */
export async function getAssetTemplate(type: AssetType, seriesSettings?: StyleSettings | null): Promise<string> {
  const style = await getActiveStyle(seriesSettings);
  switch (type) {
    case "character":
      return style.characterTemplate;
    case "scene":
      return style.sceneTemplate;
    case "object":
      return style.objectTemplate;
    default:
      return style.characterTemplate;
  }
}

/** 按资产类型获取对应的风格参考图 URL（无则 undefined）。可传入 seriesStyleSettings */
export async function getAssetReferenceImage(
  type: AssetType,
  seriesSettings?: StyleSettings | null
): Promise<string | undefined> {
  const style = await getActiveStyle(seriesSettings);
  switch (type) {
    case "character":
      return style.characterReferenceImage;
    case "scene":
      return style.sceneReferenceImage;
    case "object":
      return style.objectReferenceImage;
    default:
      return undefined;
  }
}

/** 生成用于 LLM 上下文的风格文本（同步，pure function） */
export function styleToText(s: StylePreset): string {
  return `当前风格设定：${s.name}
【人物图片提示词模板】${s.characterTemplate}
【场景图片提示词模板】${s.sceneTemplate}
【物品图片提示词模板】${s.objectTemplate}`;
}

/** 按资产类型生成对应的风格文本（只包含该类型的模板） */
export function styleTemplateForType(s: StylePreset, type: AssetType): string {
  const typeLabel = type === "character" ? "人物" : type === "scene" ? "场景" : "物品";
  const template = type === "character" ? s.characterTemplate : type === "scene" ? s.sceneTemplate : s.objectTemplate;
  return `当前风格设定：${s.name}
【${typeLabel}图片提示词模板】${template}`;
}
