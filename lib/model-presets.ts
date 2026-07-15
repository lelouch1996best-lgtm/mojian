/**
 * 模型预设管理模块。
 *
 * 硬编码默认模型列表作为出发点；用户可通过 UI 手动增删模型。
 * 自定义列表保存在服务端，读取时优先使用自定义列表，未自定义则 fallback 默认列表。
 */

import type { LLMSettings, ImageGenSettings, VideoGenSettings } from "./types";
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
  /** 是否为默认模型（生成图片/视频参数时优先使用） */
  isDefault?: boolean;
  /** 图片模型能力（仅图片模型使用，用户自定义时覆盖注册表/FALLBACK） */
  capability?: Partial<ImageModelCapability>;
  /** 视频模型能力（仅视频模型使用，用户自定义时覆盖注册表/FALLBACK） */
  videoCapability?: Partial<VideoModelCapability>;
}

/** 从模型列表中获取默认模型 value（优先 isDefault，否则取第一个） */
export function getDefaultModelValue(models: ModelEntry[]): string | undefined {
  return models.find((m) => m.isDefault)?.value ?? models[0]?.value;
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
  ark: [
    { value: "doubao-seed-2-1-pro-260628", label: "Doubao Seed 2.1 Pro", hint: "最新旗舰，Agent/Coding/多模态全面升级" },
    { value: "doubao-seed-2-1-turbo-260628", label: "Doubao Seed 2.1 Turbo", hint: "低成本低时延，效果比肩 Pro" },
    { value: "doubao-seed-2-0-pro-260215", label: "Doubao Seed 2.0 Pro" },
    { value: "doubao-seed-2-0-lite-260428", label: "Doubao Seed 2.0 Lite", hint: "轻量全模态，企业规模化部署" },
    { value: "doubao-seed-1-6-251015", label: "Doubao Seed 1.6", hint: "综合模型，支持思考/非思考模式" },
    { value: "doubao-seed-evolving", label: "Doubao Seed Evolving", hint: "快速迭代，始终最新版本" },
  ],
  "ark-agent-plan": [
    { value: "doubao-seed-2.0-pro", label: "Doubao Seed 2.0 Pro", hint: "进阶，256K 上下文" },
    { value: "doubao-seed-2.0-code", label: "Doubao Seed 2.0 Code", hint: "进阶，编程场景增强" },
    { value: "doubao-seed-2.0-lite", label: "Doubao Seed 2.0 Lite", hint: "标准，256K 上下文" },
    { value: "doubao-seed-2.0-mini", label: "Doubao Seed 2.0 Mini", hint: "极速，低延迟" },
    { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro", hint: "进阶，1M 超长上下文" },
    { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash", hint: "标准，1M 超长上下文" },
    { value: "glm-5.2", label: "GLM 5.2", hint: "进阶，1M 超长上下文" },
    { value: "minimax-m2.7", label: "MiniMax M2.7", hint: "进阶，200K 上下文" },
    { value: "minimax-m3", label: "MiniMax M3", hint: "进阶，512K 上下文" },
    { value: "kimi-k2.6", label: "Kimi K2.6", hint: "进阶，256K 上下文" },
    { value: "kimi-k2.7-code", label: "Kimi K2.7 Code", hint: "进阶，编程场景" },
  ],
  custom: [],
};

/** 图片生成模型默认（按供应商），内嵌能力矩阵（参照 docs/image.md） */
export const DEFAULT_IMAGE_MODELS: Record<ImageGenSettings["provider"], ModelEntry[]> = {
  ark: [
    {
      value: "doubao-seedream-5-0-pro-260628", label: "Seedream 5.0 Pro",
      hint: "最新旗舰，高精度图片生成，精准位置与元素控制，1K/2K",
      capability: {
        resolutions: ["1K", "2K"], outputFormat: false, webSearch: false,
        optimizePrompt: false, optimizePromptFast: false, sequentialImageGen: false,
        watermark: true, responseFormat: true, maxRefImages: 10,
      },
    },
    {
      value: "doubao-seedream-5-0-260128", label: "Seedream 5.0 Lite",
      hint: "支持 png/jpeg、组图、联网搜索、单/多图生图，2K/3K/4K",
      isDefault: true,
      capability: {
        resolutions: ["2K", "3K", "4K"], outputFormat: true, webSearch: true,
        optimizePrompt: true, optimizePromptFast: false, sequentialImageGen: true,
        watermark: true, responseFormat: true, maxRefImages: 14,
      },
    },
    {
      value: "doubao-seedream-5-0-lite-260128", label: "Seedream 5.0 Lite (别名)",
      capability: {
        resolutions: ["2K", "3K", "4K"], outputFormat: true, webSearch: true,
        optimizePrompt: true, optimizePromptFast: false, sequentialImageGen: true,
        watermark: true, responseFormat: true, maxRefImages: 14,
      },
    },
    {
      value: "doubao-seedream-4-5-251128", label: "Seedream 4.5",
      hint: "支持多图融合、组图，2K/4K",
      capability: {
        resolutions: ["2K", "4K"], outputFormat: false, webSearch: false,
        optimizePrompt: true, optimizePromptFast: false, sequentialImageGen: true,
        watermark: true, responseFormat: true, maxRefImages: 14,
      },
    },
    {
      value: "doubao-seedream-4-0-250828", label: "Seedream 4.0",
      hint: "支持多图融合、组图、极速优化模式，1K/2K/4K",
      capability: {
        resolutions: ["1K", "2K", "4K"], outputFormat: false, webSearch: false,
        optimizePrompt: true, optimizePromptFast: true, sequentialImageGen: true,
        watermark: true, responseFormat: true, maxRefImages: 14,
      },
    },
  ],
  "ark-plan": [
    {
      value: "doubao-seedream-5-0-pro-260628", label: "Seedream 5.0 Pro",
      hint: "最新旗舰，高精度图片生成，精准位置与元素控制，1K/2K",
      capability: {
        resolutions: ["1K", "2K"], outputFormat: false, webSearch: false,
        optimizePrompt: false, optimizePromptFast: false, sequentialImageGen: false,
        watermark: true, responseFormat: true, maxRefImages: 10,
      },
    },
    {
      value: "doubao-seedream-5-0-260128", label: "Seedream 5.0 Lite",
      hint: "支持 png/jpeg、组图、联网搜索、单/多图生图，2K/3K/4K",
      isDefault: true,
      capability: {
        resolutions: ["2K", "3K", "4K"], outputFormat: true, webSearch: true,
        optimizePrompt: true, optimizePromptFast: false, sequentialImageGen: true,
        watermark: true, responseFormat: true, maxRefImages: 14,
      },
    },
    {
      value: "doubao-seedream-5-0-lite-260128", label: "Seedream 5.0 Lite (别名)",
      capability: {
        resolutions: ["2K", "3K", "4K"], outputFormat: true, webSearch: true,
        optimizePrompt: true, optimizePromptFast: false, sequentialImageGen: true,
        watermark: true, responseFormat: true, maxRefImages: 14,
      },
    },
    {
      value: "doubao-seedream-4-5-251128", label: "Seedream 4.5",
      hint: "支持多图融合、组图，2K/4K",
      capability: {
        resolutions: ["2K", "4K"], outputFormat: false, webSearch: false,
        optimizePrompt: true, optimizePromptFast: false, sequentialImageGen: true,
        watermark: true, responseFormat: true, maxRefImages: 14,
      },
    },
    {
      value: "doubao-seedream-4-0-250828", label: "Seedream 4.0",
      hint: "支持多图融合、组图、极速优化模式，1K/2K/4K",
      capability: {
        resolutions: ["1K", "2K", "4K"], outputFormat: false, webSearch: false,
        optimizePrompt: true, optimizePromptFast: true, sequentialImageGen: true,
        watermark: true, responseFormat: true, maxRefImages: 14,
      },
    },
  ],
  openai: [
    {
      value: "gpt-image-2", label: "GPT-Image-2",
      hint: "OpenAI 最新图像生成模型，超强文字渲染，最高4K，支持 low/medium/high/auto 画质",
      isDefault: true,
      capability: {
        resolutions: ["auto", "1024x1024", "1024x1536", "1536x1024", "3840x2160"],
        outputFormat: false, webSearch: false,
        optimizePrompt: false, optimizePromptFast: false, sequentialImageGen: false,
        watermark: false, responseFormat: true, quality: true, maxRefImages: 4,
      },
    },
  ],
  custom: [],
};

/** 视频生成模型默认（按供应商），内嵌能力矩阵（参照 docs/model.md） */
export const DEFAULT_VIDEO_MODELS: Record<VideoGenSettings["provider"], ModelEntry[]> = {
  ark: [
    {
      value: "doubao-seedance-2-0-260128", label: "Seedance 2.0（推荐）",
      hint: "最新旗舰，音画同生，多模态生视频/编辑/延长，480p/720p/1080p/4k，4-15s",
      isDefault: true,
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
        resolutions: ["480p", "720p", "1080p", "4k"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
        durationRange: [4, 15], durationAuto: true, audio: true, draft: false,
        seed: false, cameraFixed: false, webSearch: true, priority: true, returnLastFrame: true,
      },
    },
    {
      value: "doubao-seedance-2-0-fast-260128", label: "Seedance 2.0 fast",
      hint: "更快速度，音画同生，仅 480p/720p，4-15s",
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
        resolutions: ["480p", "720p"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
        durationRange: [4, 15], durationAuto: true, audio: true, draft: false,
        seed: false, cameraFixed: false, webSearch: true, priority: true, returnLastFrame: true,
      },
    },
    {
      value: "doubao-seedance-2-0-mini-260615", label: "Seedance 2.0 mini",
      hint: "轻量版，音画同生，仅 480p/720p，4-15s",
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
        resolutions: ["480p", "720p"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
        durationRange: [4, 15], durationAuto: true, audio: true, draft: false,
        seed: false, cameraFixed: false, webSearch: true, priority: true, returnLastFrame: true,
      },
    },
    {
      value: "doubao-seedance-1-5-pro-251215", label: "Seedance 1.5 Pro（即将下线）",
      hint: "音画同生、adaptive 宽高比、Draft 样片模式，4-12s",
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame"],
        resolutions: ["480p", "720p", "1080p"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
        durationRange: [4, 12], durationAuto: true, audio: true, draft: true,
        seed: true, cameraFixed: true, webSearch: false, priority: false, returnLastFrame: true,
      },
    },
    {
      value: "doubao-seedance-1-0-pro-250528", label: "Seedance 1.0 Pro",
      hint: "首尾帧/首帧/文生视频，480p/720p/1080p，2-12s",
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame"],
        resolutions: ["480p", "720p", "1080p"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
        durationRange: [2, 12], durationAuto: false, audio: false, draft: false,
        seed: true, cameraFixed: true, webSearch: false, priority: false, returnLastFrame: true,
      },
    },
    {
      value: "doubao-seedance-1-0-pro-fast-251015", label: "Seedance 1.0 Pro Fast",
      hint: "更快的生成速度，仅首帧/文生视频，2-12s",
      videoCapability: {
        modes: ["text2video", "first-frame"],
        resolutions: ["480p", "720p", "1080p"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
        durationRange: [2, 12], durationAuto: false, audio: false, draft: false,
        seed: true, cameraFixed: true, webSearch: false, priority: false, returnLastFrame: true,
      },
    },
  ],
  "ark-plan": [
    {
      value: "doubao-seedance-2-0-260128", label: "Seedance 2.0（推荐）",
      hint: "最新旗舰，音画同生，多模态生视频/编辑/延长，480p/720p/1080p/4k，4-15s",
      isDefault: true,
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
        resolutions: ["480p", "720p", "1080p", "4k"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
        durationRange: [4, 15], durationAuto: true, audio: true, draft: false,
        seed: false, cameraFixed: false, webSearch: true, priority: true, returnLastFrame: true,
      },
    },
    {
      value: "doubao-seedance-2-0-fast-260128", label: "Seedance 2.0 fast",
      hint: "更快速度，音画同生，仅 480p/720p，4-15s",
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
        resolutions: ["480p", "720p"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
        durationRange: [4, 15], durationAuto: true, audio: true, draft: false,
        seed: false, cameraFixed: false, webSearch: true, priority: true, returnLastFrame: true,
      },
    },
    {
      value: "doubao-seedance-2-0-mini-260615", label: "Seedance 2.0 mini",
      hint: "轻量版，音画同生，仅 480p/720p，4-15s",
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
        resolutions: ["480p", "720p"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
        durationRange: [4, 15], durationAuto: true, audio: true, draft: false,
        seed: false, cameraFixed: false, webSearch: true, priority: true, returnLastFrame: true,
      },
    },
    {
      value: "doubao-seedance-1-5-pro-251215", label: "Seedance 1.5 Pro（即将下线）",
      hint: "音画同生、adaptive 宽高比、Draft 样片模式，4-12s",
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame"],
        resolutions: ["480p", "720p", "1080p"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
        durationRange: [4, 12], durationAuto: true, audio: true, draft: true,
        seed: true, cameraFixed: true, webSearch: false, priority: false, returnLastFrame: true,
      },
    },
    {
      value: "doubao-seedance-1-0-pro-250528", label: "Seedance 1.0 Pro",
      hint: "首尾帧/首帧/文生视频，480p/720p/1080p，2-12s",
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame"],
        resolutions: ["480p", "720p", "1080p"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
        durationRange: [2, 12], durationAuto: false, audio: false, draft: false,
        seed: true, cameraFixed: true, webSearch: false, priority: false, returnLastFrame: true,
      },
    },
    {
      value: "doubao-seedance-1-0-pro-fast-251015", label: "Seedance 1.0 Pro Fast",
      hint: "更快的生成速度，仅首帧/文生视频，2-12s",
      videoCapability: {
        modes: ["text2video", "first-frame"],
        resolutions: ["480p", "720p", "1080p"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
        durationRange: [2, 12], durationAuto: false, audio: false, draft: false,
        seed: true, cameraFixed: true, webSearch: false, priority: false, returnLastFrame: true,
      },
    },
  ],
  custom: [],
};

// ==================== 模型能力描述 ====================

/** 图片模型能力描述 */
export interface ImageModelCapability {
  /** 支持的分辨率档位（方式2，通过 size 字段传输） */
  resolutions: string[];
  /** 支持输出格式选择（output_format，仅 5.0 Lite） */
  outputFormat: boolean;
  /** 支持联网搜索（tools.web_search，仅 5.0 Lite） */
  webSearch: boolean;
  /** 支持提示词优化（optimize_prompt_options，5.0 Lite / 4.5 / 4.0） */
  optimizePrompt: boolean;
  /** 提示词优化支持 fast 模式（仅 4.0；5.0 Lite / 4.5 仅 standard） */
  optimizePromptFast: boolean;
  /** 支持组图功能开关（sequential_image_generation，5.0 Lite / 4.5 / 4.0） */
  sequentialImageGen: boolean;
  /** 支持水印设置（所有模型） */
  watermark: boolean;
  /** 支持返回格式选择（所有模型） */
  responseFormat: boolean;
  /** 支持画质选择（quality，仅 gpt-image-2） */
  quality?: boolean;
  /** 最大参考图数量 */
  maxRefImages: number;
}

/**
 * 各图片模型能力注册表（键与 DEFAULT_IMAGE_MODELS 的 value 对齐）。
 * 参照 docs/image.md 参数支持矩阵：
 *  - output_format: 仅 doubao-seedream-5.0-lite 支持
 *  - tools(web_search): 仅 doubao-seedream-5.0-lite 支持
 *  - optimize_prompt_options: 5.0 Lite / 4.5 / 4.0 支持；fast 模式仅 4.0
 *  - sequential_image_generation: 5.0 Lite / 4.5 / 4.0 支持
 * 注：doubao-seedream-5-0-260128 与 doubao-seedream-5-0-lite-260128 为同一模型（见 model.md）。
 */
export const IMAGE_MODEL_CAPABILITIES: Record<string, ImageModelCapability> = {
  "doubao-seedream-5-0-pro-260628": {
    resolutions: ["1K", "2K"],
    outputFormat: false,
    webSearch: false,
    optimizePrompt: false,
    optimizePromptFast: false,
    sequentialImageGen: false,
    watermark: true,
    responseFormat: true,
    maxRefImages: 10,
  },
  "doubao-seedream-5-0-260128": {
    resolutions: ["2K", "3K", "4K"],
    outputFormat: true,
    webSearch: true,
    optimizePrompt: true,
    optimizePromptFast: false,
    sequentialImageGen: true,
    watermark: true,
    responseFormat: true,
    maxRefImages: 14,
  },
  "doubao-seedream-5-0-lite-260128": {
    resolutions: ["2K", "3K", "4K"],
    outputFormat: true,
    webSearch: true,
    optimizePrompt: true,
    optimizePromptFast: false,
    sequentialImageGen: true,
    watermark: true,
    responseFormat: true,
    maxRefImages: 14,
  },
  "doubao-seedream-4-5-251128": {
    resolutions: ["2K", "4K"],
    outputFormat: false,
    webSearch: false,
    optimizePrompt: true,
    optimizePromptFast: false,
    sequentialImageGen: true,
    watermark: true,
    responseFormat: true,
    maxRefImages: 14,
  },
  "doubao-seedream-4-0-250828": {
    resolutions: ["1K", "2K", "4K"],
    outputFormat: false,
    webSearch: false,
    optimizePrompt: true,
    optimizePromptFast: true,
    sequentialImageGen: true,
    watermark: true,
    responseFormat: true,
    maxRefImages: 14,
  },
  "gpt-image-2": {
    resolutions: ["auto", "1024x1024", "1024x1536", "1536x1024", "3840x2160"],
    outputFormat: false,
    webSearch: false,
    optimizePrompt: false,
    optimizePromptFast: false,
    sequentialImageGen: false,
    watermark: false,
    responseFormat: true,
    quality: true,
    maxRefImages: 4,
  },
};

/** 未知/用户自定义模型的保守回退（启用所有功能，由上游 API 决定是否报错） */
const FALLBACK_IMAGE_CAPABILITY: ImageModelCapability = {
  resolutions: ["2K"],
  outputFormat: true,
  webSearch: true,
  optimizePrompt: true,
  optimizePromptFast: true,
  sequentialImageGen: true,
  watermark: true,
  responseFormat: true,
  maxRefImages: 14,
};

/**
 * 查询图片模型能力。
 * - 内置模型（在 IMAGE_MODEL_CAPABILITIES 注册表中）：注册表能力为权威来源，忽略数据库中的旧值
 *   （避免代码更新能力矩阵后数据库残留旧值导致能力不生效）
 * - 自定义模型（不在注册表中）：合并用户自定义能力 over FALLBACK
 */
export function getImageModelCapability(
  modelValue: string,
  models?: ModelEntry[]
): ImageModelCapability {
  const registry = IMAGE_MODEL_CAPABILITIES[modelValue];
  if (registry) return registry;
  const base = FALLBACK_IMAGE_CAPABILITY;
  if (!models) return base;
  const entry = models.find((m) => m.value === modelValue);
  if (!entry?.capability) return base;
  return { ...base, ...entry.capability };
}

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
  /** 是否支持 seed（Seedance 2.0 系列不支持） */
  seed: boolean;
  /** 是否支持固定摄像头（Seedance 2.0 系列、参考图场景不支持） */
  cameraFixed: boolean;
  /** 是否支持联网搜索（仅 Seedance 2.0 系列） */
  webSearch: boolean;
  /** 是否支持优先级（仅 Seedance 2.0 系列） */
  priority: boolean;
  /** 是否支持返回尾帧图像 */
  returnLastFrame: boolean;
}

/** 各模型能力注册表（键与 DEFAULT_VIDEO_MODELS 的 value 对齐） */
export const VIDEO_MODEL_CAPABILITIES: Record<string, VideoModelCapability> = {
  "doubao-seedance-2-0-260128": {
    modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
    resolutions: ["480p", "720p", "1080p", "4k"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
    durationRange: [4, 15],
    durationAuto: true,
    audio: true,
    draft: false,
    seed: false,
    cameraFixed: false,
    webSearch: true,
    priority: true,
    returnLastFrame: true,
  },
  "doubao-seedance-2-0-fast-260128": {
    modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
    resolutions: ["480p", "720p"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
    durationRange: [4, 15],
    durationAuto: true,
    audio: true,
    draft: false,
    seed: false,
    cameraFixed: false,
    webSearch: true,
    priority: true,
    returnLastFrame: true,
  },
  "doubao-seedance-2-0-mini-260615": {
    modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
    resolutions: ["480p", "720p"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
    durationRange: [4, 15],
    durationAuto: true,
    audio: true,
    draft: false,
    seed: false,
    cameraFixed: false,
    webSearch: true,
    priority: true,
    returnLastFrame: true,
  },
  "doubao-seedance-1-5-pro-251215": {
    modes: ["text2video", "first-frame", "first-last-frame"],
    resolutions: ["480p", "720p", "1080p"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
    durationRange: [4, 12],
    durationAuto: true,
    audio: true,
    draft: true,
    seed: true,
    cameraFixed: true,
    webSearch: false,
    priority: false,
    returnLastFrame: true,
  },
  "doubao-seedance-1-0-pro-250528": {
    modes: ["text2video", "first-frame", "first-last-frame"],
    resolutions: ["480p", "720p", "1080p"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
    durationRange: [2, 12],
    durationAuto: false,
    audio: false,
    draft: false,
    seed: true,
    cameraFixed: true,
    webSearch: false,
    priority: false,
    returnLastFrame: true,
  },
  "doubao-seedance-1-0-pro-fast-251015": {
    modes: ["text2video", "first-frame"],
    resolutions: ["480p", "720p", "1080p"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
    durationRange: [2, 12],
    durationAuto: false,
    audio: false,
    draft: false,
    seed: true,
    cameraFixed: true,
    webSearch: false,
    priority: false,
    returnLastFrame: true,
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
  seed: true,
  cameraFixed: true,
  webSearch: false,
  priority: false,
  returnLastFrame: true,
};

/**
 * 查询视频模型能力。
 * - 内置模型（在 VIDEO_MODEL_CAPABILITIES 注册表中）：注册表能力为权威来源
 * - 自定义模型（不在注册表中）：合并用户自定义能力 over FALLBACK
 */
export function getVideoModelCapability(
  modelValue: string,
  models?: ModelEntry[]
): VideoModelCapability {
  const registry = VIDEO_MODEL_CAPABILITIES[modelValue];
  if (registry) return registry;
  const base = FALLBACK_CAPABILITY;
  if (!models) return base;
  const entry = models.find((m) => m.value === modelValue);
  if (!entry?.videoCapability) return base;
  return { ...base, ...entry.videoCapability };
}

/** 单个镜头视频生成的硬编码默认配置（卡片缺省 videoConfig 时回退） */
export const DEFAULT_SHOT_VIDEO_CONFIG: ShotVideoConfig = {
  model: "doubao-seedance-2-0-260128",
  mode: "multimodal-ref",
  resolution: "720p",
  ratio: "16:9",
  duration: 5,
  watermark: false,
  generateAudio: true,
  seed: -1,
  cameraFixed: false,
  returnLastFrame: false,
  webSearch: false,
  priority: 0,
  draft: false,
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

/** 向后兼容：若读到旧格式（flat ModelEntry[]），自动包装为 { ark: [...] } */
function normalizeImageModelsMap(raw: unknown): Record<string, ModelEntry[]> {
  if (Array.isArray(raw)) return { ark: raw };
  return (raw as Record<string, ModelEntry[]>) ?? {};
}

export async function getImageModels(provider: ImageGenSettings["provider"]): Promise<ModelEntry[]> {
  try {
    const all = normalizeImageModelsMap(await apiClient.getSetting("models_image"));
    const custom = all?.[provider];
    if (custom && custom.length > 0) return custom;
  } catch { /* fall through */ }
  return DEFAULT_IMAGE_MODELS[provider] ?? [];
}

export async function saveImageModels(provider: ImageGenSettings["provider"], models: ModelEntry[]): Promise<void> {
  let all: Record<string, ModelEntry[]> = {};
  try { all = normalizeImageModelsMap(await apiClient.getSetting("models_image")); } catch { /* empty */ }
  all[provider] = models;
  await apiClient.saveSetting("models_image", all);
}

export async function resetImageModels(provider: ImageGenSettings["provider"]): Promise<ModelEntry[]> {
  const defaults = DEFAULT_IMAGE_MODELS[provider] ?? [];
  await saveImageModels(provider, defaults);
  return defaults;
}

/** 纯 model value 数组 */
export async function getImageModelValues(provider: ImageGenSettings["provider"]): Promise<string[]> {
  const models = await getImageModels(provider);
  return models.map((m) => m.value);
}

// ---- 视频 ----

/** 向后兼容：若读到旧格式（flat ModelEntry[]），自动包装为 { ark: [...] } */
function normalizeVideoModelsMap(raw: unknown): Record<string, ModelEntry[]> {
  if (Array.isArray(raw)) return { ark: raw };
  return (raw as Record<string, ModelEntry[]>) ?? {};
}

export async function getVideoModels(provider: VideoGenSettings["provider"]): Promise<ModelEntry[]> {
  try {
    const all = normalizeVideoModelsMap(await apiClient.getSetting("models_video"));
    const custom = all?.[provider];
    if (custom && custom.length > 0) return custom;
  } catch { /* fall through */ }
  return DEFAULT_VIDEO_MODELS[provider] ?? [];
}

export async function saveVideoModels(provider: VideoGenSettings["provider"], models: ModelEntry[]): Promise<void> {
  let all: Record<string, ModelEntry[]> = {};
  try { all = normalizeVideoModelsMap(await apiClient.getSetting("models_video")); } catch { /* empty */ }
  all[provider] = models;
  await apiClient.saveSetting("models_video", all);
}

export async function resetVideoModels(provider: VideoGenSettings["provider"]): Promise<ModelEntry[]> {
  const defaults = DEFAULT_VIDEO_MODELS[provider] ?? [];
  await saveVideoModels(provider, defaults);
  return defaults;
}

/** 纯 model value 数组 */
export async function getVideoModelValues(provider: VideoGenSettings["provider"]): Promise<string[]> {
  const models = await getVideoModels(provider);
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
