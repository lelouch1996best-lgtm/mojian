/**
 * 模型预设管理模块。
 *
 * 硬编码默认模型列表作为出发点；用户可通过 UI 手动增删模型。
 * 自定义列表保存在 localStorage，读取时优先使用自定义列表，未自定义则 fallback 默认列表。
 */

import type { LLMSettings } from "./types";
import { apiClient } from "./api-client";

const LLM_MODELS_PREFIX = "ai-script-models-llm-";
const IMAGE_MODELS_KEY = "ai-script-models-image";
const VIDEO_MODELS_KEY = "ai-script-models-video";
const STORAGE_MODE = process.env.NEXT_PUBLIC_STORAGE_MODE;

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
  { value: "doubao-seedance-1-5-pro-250428", label: "Seedance 1.5 Pro", hint: "有声视频、adaptive 宽高比、Draft 样片模式" },
  { value: "doubao-seedance-1-0-pro-250328", label: "Seedance 1.0 Pro", hint: "首尾帧/首帧/文生视频，支持 1080p" },
  { value: "doubao-seedance-1-0-pro-fast-250328", label: "Seedance 1.0 Pro Fast", hint: "更快的生成速度，仅首帧/文生视频" },
];

// ==================== 读写 ====================

function readModels(key: string): ModelEntry[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as ModelEntry[]) : null;
  } catch {
    return null;
  }
}

function writeModels(key: string, models: ModelEntry[]): void {
  localStorage.setItem(key, JSON.stringify(models));
}

// ---- LLM ----

export async function getLLMModels(provider: LLMSettings["provider"]): Promise<ModelEntry[]> {
  if (STORAGE_MODE === "server") {
    try {
      const all = await apiClient.getSetting<Record<string, ModelEntry[]>>("models_llm");
      const custom = all?.[provider];
      if (custom && custom.length > 0) return custom;
    } catch { /* fall through */ }
    return DEFAULT_LLM_MODELS[provider] ?? [];
  }
  const key = LLM_MODELS_PREFIX + provider;
  const custom = readModels(key);
  if (custom && custom.length > 0) return custom;
  return DEFAULT_LLM_MODELS[provider] ?? [];
}

export async function saveLLMModels(provider: LLMSettings["provider"], models: ModelEntry[]): Promise<void> {
  if (STORAGE_MODE === "server") {
    let all: Record<string, ModelEntry[]> = {};
    try { all = await apiClient.getSetting<Record<string, ModelEntry[]>>("models_llm") ?? {}; } catch { /* empty */ }
    all[provider] = models;
    await apiClient.saveSetting("models_llm", all);
    return;
  }
  writeModels(LLM_MODELS_PREFIX + provider, models);
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
  if (STORAGE_MODE === "server") {
    try {
      const custom = await apiClient.getSetting<ModelEntry[]>("models_image");
      if (custom && custom.length > 0) return custom;
    } catch { /* fall through */ }
    return DEFAULT_IMAGE_MODELS;
  }
  const custom = readModels(IMAGE_MODELS_KEY);
  if (custom && custom.length > 0) return custom;
  return DEFAULT_IMAGE_MODELS;
}

export async function saveImageModels(models: ModelEntry[]): Promise<void> {
  if (STORAGE_MODE === "server") {
    await apiClient.saveSetting("models_image", models);
    return;
  }
  writeModels(IMAGE_MODELS_KEY, models);
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
  if (STORAGE_MODE === "server") {
    try {
      const custom = await apiClient.getSetting<ModelEntry[]>("models_video");
      if (custom && custom.length > 0) return custom;
    } catch { /* fall through */ }
    return DEFAULT_VIDEO_MODELS;
  }
  const custom = readModels(VIDEO_MODELS_KEY);
  if (custom && custom.length > 0) return custom;
  return DEFAULT_VIDEO_MODELS;
}

export async function saveVideoModels(models: ModelEntry[]): Promise<void> {
  if (STORAGE_MODE === "server") {
    await apiClient.saveSetting("models_video", models);
    return;
  }
  writeModels(VIDEO_MODELS_KEY, models);
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
