import type { AssetType, StylePreset, StyleSettings } from "@/lib/types";
import { apiClient } from "@/lib/api-client";

/** 4 个预设风格 */
const DEFAULT_PRESETS: StylePreset[] = [
  {
    id: "realistic",
    name: "真人风格",
    description: "电影级写实，自然光影，适合真人短剧",
    characterTemplate:
      "真人风格，电影级质感，自然光影，8K高清，全身照三视图（正面、侧面、背面），白色背景，写实摄影，细节丰富",
    sceneTemplate:
      "真人风格，电影级场景，自然光影，8K高清，广角构图，写实摄影，细节丰富",
    objectTemplate:
      "真人风格，电影级道具，自然光影，8K高清，特写构图，写实摄影，细节丰富",
  },
  {
    id: "anime2d",
    name: "2D动漫风格",
    description: "赛璐璐上色，锐利线条，鲜艳色彩",
    characterTemplate:
      "日系2D动漫风格，赛璐璐上色，锐利线条，鲜艳色彩，全身照三视图（正面、侧面、背面），白色背景，高画质，精致线稿",
    sceneTemplate:
      "日系2D动漫风格，赛璐璐上色，鲜艳色彩，广角构图，高画质，精致线稿",
    objectTemplate:
      "日系2D动漫风格，赛璐璐上色，鲜艳色彩，特写构图，高画质，精致线稿",
  },
  {
    id: "cn-drama",
    name: "国漫修仙风格",
    description: "凡人修仙传同款，写实3D国漫，修仙玄幻",
    characterTemplate:
      "完整角色设定稿，同画布分四格排版：第一格超精细面部特写，第二格完整全身立绘，第三格角色标准三视图（正面 / 侧面 / 背面同框）。写实偏半写实CG质感。8K超高清，细节丰富，光影层次分明，3D渲染质感。",
    sceneTemplate:
      "写实偏半写实CG质感，8K超高清，3D渲染质感",
    objectTemplate:
      "完整物品多视图平铺展示，包含正面、侧面、背面、俯视三视图，写实偏半写实 CG 影视质感，细腻材质纹理，金属 / 玉石 / 符文材质层次分明，柔光专业打光，无多余杂物纯白背景，8K 超高清，Octane 高精度 3D 渲染，细节拉满，边缘清晰，无畸变，构图规整",
  },
  {
    id: "ink-wash",
    name: "水墨风格",
    description: "中国水墨画，写意笔触，留白意境",
    characterTemplate:
      "中国水墨画风格，写意笔触，黑白灰调，留白意境，全身照三视图（正面、侧面、背面），宣纸纹理，传统国画质感",
    sceneTemplate:
      "中国水墨画风格，写意笔触，留白意境，宣纸纹理，传统国画质感",
    objectTemplate:
      "中国水墨画风格，写意笔触，水墨渲染，宣纸纹理，传统国画质感",
  },
];

/** 返回所有预设风格（默认值） */
export function getDefaultPresets(): StylePreset[] {
  return DEFAULT_PRESETS.map((p) => ({ ...p }));
}

/** 根据 id 获取默认预设 */
export function getDefaultPreset(id: string): StylePreset | undefined {
  return DEFAULT_PRESETS.find((p) => p.id === id);
}

/** 读取风格配置 */
export async function getStyleSettings(): Promise<StyleSettings> {
  const defaultSettings: StyleSettings = {
    selectedStyleId: "realistic",
    overrides: {},
  };
  try {
    const value = await apiClient.getSetting<StyleSettings>("style");
    return value ?? defaultSettings;
  } catch { return defaultSettings; }
}

/** 保存风格配置 */
export async function saveStyleSettings(s: StyleSettings): Promise<void> {
  await apiClient.saveSetting("style", s);
}

/** 获取所有风格列表（应用用户 override 后） */
export async function getAllStyles(): Promise<StylePreset[]> {
  const settings = await getStyleSettings();
  return DEFAULT_PRESETS.map((preset) => {
    const override = settings.overrides[preset.id];
    return override ? { ...preset, ...override } : { ...preset };
  });
}

/** 获取当前选中的风格（应用 override 后）。可传入 seriesStyleSettings 覆盖全局 */
export async function getActiveStyle(seriesSettings?: StyleSettings | null): Promise<StylePreset> {
  if (seriesSettings) {
    const preset = getDefaultPreset(seriesSettings.selectedStyleId) ?? DEFAULT_PRESETS[0];
    const override = seriesSettings.overrides[preset.id];
    return override ? { ...preset, ...override } : { ...preset };
  }
  const settings = await getStyleSettings();
  const preset = getDefaultPreset(settings.selectedStyleId) ?? DEFAULT_PRESETS[0];
  const override = settings.overrides[preset.id];
  return override ? { ...preset, ...override } : { ...preset };
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

/** 生成用于 LLM 上下文的风格文本（同步，pure function） */
export function styleToText(s: StylePreset): string {
  return `当前漫剧风格：${s.name}
【人物图片提示词模板】${s.characterTemplate}
【场景图片提示词模板】${s.sceneTemplate}
【物品图片提示词模板】${s.objectTemplate}`;
}

/** 按资产类型生成对应的风格文本（只包含该类型的模板） */
export function styleTemplateForType(s: StylePreset, type: AssetType): string {
  const typeLabel = type === "character" ? "人物" : type === "scene" ? "场景" : "物品";
  const template = type === "character" ? s.characterTemplate : type === "scene" ? s.sceneTemplate : s.objectTemplate;
  return `当前漫剧风格：${s.name}
【${typeLabel}图片提示词模板】${template}`;
}

/** 重置某风格为默认值 */
export async function resetStyleOverride(styleId: string): Promise<void> {
  const settings = await getStyleSettings();
  delete settings.overrides[styleId];
  await saveStyleSettings(settings);
}

/** 检查是否有自定义覆盖 */
export async function hasStyleOverride(styleId: string): Promise<boolean> {
  const settings = await getStyleSettings();
  return !!settings.overrides[styleId];
}
