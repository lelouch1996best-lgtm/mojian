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
    videoStyleSuffix: "真人电影风格，自然光影，写实色彩，电影级质感",
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
    videoStyleSuffix: "2D动漫风格，赛璐璐上色，鲜艳色彩，锐利线条",
  },
  {
    id: "cn-drama",
    name: "国漫修仙风格",
    description: "凡人修仙传同款，写实3D国漫，修仙玄幻",
    characterTemplate:
      "国漫3D修仙角色设定图，风格参考《凡人修仙传》，写实偏半写实CG质感，角色全身三视图（正面全身+侧面全身+背面全身），并列排布，深灰色渐变背景，统一冷光源。包含面部特写（正视、侧视、3/4视角），五官清秀俊朗，肤质细腻真实，眼神英气内敛。发型细节（束发道髻、发冠、玉簪），道袍法衣穿着，衣袂飘逸，服饰纹理特写（云纹刺绣、仙鹤纹样、腰封玉带、法器配饰），鞋靴细节。仙风道骨气质，修仙问道风范，8K超高清，细节丰富，光影层次分明，3D渲染质感",
    sceneTemplate:
      "国漫3D修仙场景，风格参考《凡人修仙传》，写实偏半写实CG质感，仙山云海、洞府灵脉、古风建筑，灵气氤氲，冷色调光影，大气磅礴，8K超高清，3D渲染质感",
    objectTemplate:
      "国漫3D修仙道具，风格参考《凡人修仙传》，写实偏半写实CG质感，法器法宝、丹药玉瓶、灵剑符箓，金属木质质感，雕纹细节，冷色光泽，8K超高清，3D渲染质感",
    videoStyleSuffix: "国漫修仙风格，凡人修仙传同款，写实3D渲染，修仙玄幻，冷色光影，仙风道骨",
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
    videoStyleSuffix: "中国水墨画风格，写意笔触，留白意境，宣纸质感",
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

/** 获取视频风格后缀。可传入 seriesStyleSettings */
export async function getVideoStyleSuffix(seriesSettings?: StyleSettings | null): Promise<string> {
  const style = await getActiveStyle(seriesSettings);
  return style.videoStyleSuffix;
}

/** 生成用于 LLM 上下文的风格文本（同步，pure function） */
export function styleToText(s: StylePreset): string {
  return `当前漫剧风格：${s.name}
【人物图片提示词模板】${s.characterTemplate}
【场景图片提示词模板】${s.sceneTemplate}
【物品图片提示词模板】${s.objectTemplate}
【视频风格要求】${s.videoStyleSuffix}`;
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
