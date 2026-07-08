/**
 * 模型预设管理模块。
 *
 * 硬编码默认模型列表作为出发点；用户可通过 UI 手动增删模型。
 * 自定义列表保存在服务端，读取时优先使用自定义列表，未自定义则 fallback 默认列表。
 */

import type { LLMSettings } from "./types";
import type {
  ShotVideoConfig,
  VideoGenerationMode,
  VideoRatio,
  VideoResolution,
} from "./types";
import { apiClient } from "./api-client";

// ---- 类型 ----
export interface ModelEntry {
  value: string;
  label?: string; // 显示名，缺省时用 value
  hint?: string;
}

// ==================== 默认模型列表 ====================

/** LLM 各 provider 默认模型 */
export const DEFAULT_LLM_MODELS: Record<LLMSettings["provider"], ModelEntry[]> = {
  deepseek: [
    { value: "deepseek-chat", label: "DeepSeek Chat" },
    { value: "deepseek-reasoner", label: "DeepSeek Reasoner", hint: "推理增强" },
  ],
  glm: [
    { value: "glm-4-plus", label: "GLM-4 Plus" },
    { value: "glm-4", label: "GLM-4" },
    { value: "glm-4-flash", label: "GLM-4 Flash", hint: "轻量快速" },
  ],
  mimo: [
    { value: "mimo-v2.5-pro", label: "MiMo V2.5 Pro" },
    { value: "mimo-v2.5", label: "MiMo V2.5" },
  ],
  "mimo-plan": [
    { value: "mimo-v2.5-pro", label: "MiMo V2.5 Pro" },
    { value: "mimo-v2.5", label: "MiMo V2.5" },
  ],
  custom: [],
};

/** 图片生成模型默认 */
export const DEFAULT_IMAGE_MODELS: ModelEntry[] = [
  { value: "doubao-seedream-5-0-260128", label: "Seedream 5.0 lite", hint: "最新，支持 png/jpeg、组图、联网搜索" },
  { value: "doubao-seedream-5-0-lite-260128", label: "Seedream 5.0 lite (别名)" },
  { value: "doubao-seedream-4-5-251128", label: "Seedream 4.5", hint: "支持多图融合、组图" },
  { value: "doubao-seedream-4-0-250828", label: "Seedream 4.0", hint: "支持多图融合、组图" },
];

/** 视频生成模型默认 */
export const DEFAULT_VIDEO_MODELS: ModelEntry[] = [
  { value: "doubao-seedance-2-0-260128", label: "Seedance 2.0（推荐）", hint: "最新旗舰，多模态参考生视频、有声，4-15s，720p" },
  { value: "doubao-seedance-2-0-fast-260128", label: "Seedance 2.0 fast", hint: "更快速度，多模态生视频，仅 480p/720p" },
  { value: "doubao-seedance-1-5-pro-251215", label: "Seedance 1.5 Pro", hint: "有声视频、adaptive 宽高比、Draft 样片模式" },
  { value: "doubao-seedance-1-0-pro-250528", label: "Seedance 1.0 Pro", hint: "首尾帧/首帧/文生视频，支持 1080p" },
  { value: "doubao-seedance-1-0-pro-fast-251015", label: "Seedance 1.0 Pro Fast", hint: "更快的生成速度，仅首帧/文生视频" },
];

// ==================== 模型能力描述 ====================

/** 视频模型能力描述 */
export interface VideoModelCapability {
  /** 支持的生成模式 */
  modes: VideoGenerationMode[];
  /** 支持的分辨率 */
  resolutions: VideoResolution[];
  /** 支持的宽高比 */
  ratios: VideoRatio[];
  /** 时长范围 [min, max]（秒） */
  durationRange: [number, number];
  /** 是否支持 duration=-1（模型自动选择时长） */
  durationAuto: boolean;
  /** 是否支持有声视频 */
  audio: boolean;
  /** 是否支持 Draft 样片模式（仅 1.5 Pro） */
  draft: boolean;
}

/** 各模型能力注册表（键与 DEFAULT_VIDEO_MODELS 的 value 对齐） */
export const VIDEO_MODEL_CAPABILITIES: Record<string, VideoModelCapability> = {
  "doubao-seedance-2-0-260128": {
    modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
    resolutions: ["480p", "720p", "1080p"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
    durationRange: [4, 15],
    durationAuto: true,
    audio: true,
    draft: false,
  },
  "doubao-seedance-2-0-fast-260128": {
    modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
    resolutions: ["480p", "720p"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
    durationRange: [4, 15],
    durationAuto: true,
    audio: true,
    draft: false,
  },
  "doubao-seedance-1-5-pro-251215": {
    modes: ["text2video", "first-frame", "first-last-frame"],
    resolutions: ["480p", "720p", "1080p"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
    durationRange: [4, 12],
    durationAuto: true,
    audio: true,
    draft: true,
  },
  "doubao-seedance-1-0-pro-250528": {
    modes: ["text2video", "first-frame", "first-last-frame"],
    resolutions: ["480p", "720p", "1080p"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
    durationRange: [2, 12],
    durationAuto: false,
    audio: false,
    draft: false,
  },
  "doubao-seedance-1-0-pro-fast-251015": {
    modes: ["text2video", "first-frame"],
    resolutions: ["480p", "720p"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
    durationRange: [2, 12],
    durationAuto: false,
    audio: false,
    draft: false,
  },
};

/** 未知/用户自定义模型的保守回退（1.0 Pro 级能力，无多模态/有声） */
const FALLBACK_CAPABILITY: VideoModelCapability = {
  modes: ["text2video", "first-frame", "first-last-frame"],
  resolutions: ["480p", "720p", "1080p"],
  ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
  durationRange: [2, 12],
  durationAuto: false,
  audio: false,
  draft: false,
};

/** 查询模型能力，未注册模型回退保守能力 */
export function getVideoModelCapability(modelValue: string): VideoModelCapability {
  return VIDEO_MODEL_CAPABILITIES[modelValue] ?? FALLBACK_CAPABILITY;
}

/** 单个镜头视频生成的硬编码默认配置（卡片缺省 videoConfig 时回退） */
export const DEFAULT_SHOT_VIDEO_CONFIG: ShotVideoConfig = {
  model: "doubao-seedance-2-0-260128",
  mode: "first-frame",
  resolution: "720p",
  ratio: "16:9",
  duration: 5,
  watermark: false,
  generateAudio: false,
};

// ==================== 读写 ====================

// ---- LLM ----

export async function getLLMModels(provider: LLMSettings["provider"]): Promise<ModelEntry[]> {
  try {
    const all = await apiClient.getSetting<Record<string, ModelEntry[]>>("models_llm");
    const custom = all?.[provider];
    if (custom && custom.length > 0) return custom;
  } catch { /* fall through */ }
  return DEFAULT_LLM_MODELS[provider] ?? [];
}

export async function saveLLMModels(provider: LLMSettings["provider"], models: ModelEntry[]): Promise<void> {
  let all: Record<string, ModelEntry[]> = {};
  try { all = await apiClient.getSetting<Record<string, ModelEntry[]>>("models_llm") ?? {}; } catch { /* empty */ }
  all[provider] = models;
  await apiClient.saveSetting("models_llm", all);
}

export async function resetLLMModels(provider: LLMSettings["provider"]): Promise<ModelEntry[]> {
  const defaults = DEFAULT_LLM_MODELS[provider] ?? [];
  await saveLLMModels(provider, defaults);
  return defaults;
}

/** 纯 model value 数组 */
export async function getLLMModelValues(provider: LLMSettings["provider"]): Promise<string[]> {
  const models = await getLLMModels(provider);
  return models.map((m) => m.value);
}

// ---- 图片 ----

export async function getImageModels(): Promise<ModelEntry[]> {
  try {
    const custom = await apiClient.getSetting<ModelEntry[]>("models_image");
    if (custom && custom.length > 0) return custom;
  } catch { /* fall through */ }
  return DEFAULT_IMAGE_MODELS;
}

export async function saveImageModels(models: ModelEntry[]): Promise<void> {
  await apiClient.saveSetting("models_image", models);
}

export async function resetImageModels(): Promise<ModelEntry[]> {
  await saveImageModels(DEFAULT_IMAGE_MODELS);
  return DEFAULT_IMAGE_MODELS;
}

/** 纯 model value 数组 */
export async function getImageModelValues(): Promise<string[]> {
  const models = await getImageModels();
  return models.map((m) => m.value);
}

// ---- 视频 ----

export async function getVideoModels(): Promise<ModelEntry[]> {
  try {
    const custom = await apiClient.getSetting<ModelEntry[]>("models_video");
    if (custom && custom.length > 0) return custom;
  } catch { /* fall through */ }
  return DEFAULT_VIDEO_MODELS;
}

export async function saveVideoModels(models: ModelEntry[]): Promise<void> {
  await apiClient.saveSetting("models_video", models);
}

export async function resetVideoModels(): Promise<ModelEntry[]> {
  await saveVideoModels(DEFAULT_VIDEO_MODELS);
  return DEFAULT_VIDEO_MODELS;
}

/** 纯 model value 数组 */
export async function getVideoModelValues(): Promise<string[]> {
  const models = await getVideoModels();
  return models.map((m) => m.value);
}

// ---- 全局初始化 ----

/**
 * 初始化：用代码中的默认模型配置覆盖数据库中的所有模型列表。
 * 覆盖范围：所有 LLM provider 的模型列表 + 图片模型 + 视频模型。
 */
export async function initAllModels(): Promise<void> {
  await apiClient.saveSetting("models_llm", DEFAULT_LLM_MODELS);
  await apiClient.saveSetting("models_image", DEFAULT_IMAGE_MODELS);
  await apiClient.saveSetting("models_video", DEFAULT_VIDEO_MODELS);
}
