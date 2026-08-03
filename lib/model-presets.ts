/**
 * 模型预设管理模块。
 *
 * 硬编码默认模型列表作为出发点；用户可通过 UI 手动增删模型。
 * 自定义列表保存在服务端，读取时优先使用自定义列表，未自定义则 fallback 默认列表。
 */

import type { LLMSettings, ImageGenSettings, VideoGenSettings, AudioGenSettings, AudioModelCapability, MusicGenSettings } from "./types";
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
  /** 音频模型能力（仅音频模型使用，用户自定义时覆盖注册表/FALLBACK） */
  audioCapability?: Partial<AudioModelCapability>;
}

/** 跨供应商聚合的模型选项（图片/视频模型选择弹框使用） */
export interface ModelOption {
  /** 供应商标识 */
  provider: string;
  /** 供应商显示名（来自各客户端的 *_PROVIDER_PRESETS） */
  providerLabel: string;
  /** 模型条目 */
  entry: ModelEntry;
}

/**
 * 在聚合模型选项中按 (provider, modelValue) 查找条目。
 * 优先精确匹配 provider+model（同一模型名可能存在于多个供应商，如 gpt-image-2），
 * provider 缺省时回退到首个 model 值匹配。
 */
export function findModelOption(
  options: ModelOption[],
  provider?: string,
  modelValue?: string
): ModelOption | undefined {
  if (!modelValue) return undefined;
  if (provider) {
    const byProvider = options.find((o) => o.provider === provider && o.entry.value === modelValue);
    if (byProvider) return byProvider;
  }
  return options.find((o) => o.entry.value === modelValue);
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
  apimart: [
    { value: "gpt-5", label: "GPT-5", isDefault: true },
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
  apimart: [
    {
      value: "gpt-image-2", label: "GPT-Image-2",
      hint: "APIMart gpt-image-2，异步任务模式，支持 15 种比例 + 1K/2K/4K 分辨率，参考图最多 16 张",
      isDefault: true,
      capability: {
        resolutions: ["1K", "2K", "4K"], outputFormat: false, webSearch: false,
        optimizePrompt: false, optimizePromptFast: false, sequentialImageGen: false,
        watermark: false, responseFormat: false, quality: false, supportsPolling: true, maxRefImages: 16,
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
  apimart: [
    {
      value: "doubao-seedance-2.0", label: "Seedance 2.0（APIMart）",
      hint: "APIMart 标准版，音画同生，多模态参考，480p/720p/1080p/4k，4-15s",
      isDefault: true,
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
        resolutions: ["480p", "720p", "1080p", "4k"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
        durationRange: [4, 15], durationAuto: false, audio: true, draft: false,
        seed: true, cameraFixed: false, webSearch: true, priority: false,
        returnLastFrame: true, watermark: false,
      },
    },
    {
      value: "doubao-seedance-2.0-fast", label: "Seedance 2.0 fast（APIMart）",
      hint: "APIMart 快速版，仅 480p/720p，4-15s",
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
        resolutions: ["480p", "720p"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
        durationRange: [4, 15], durationAuto: false, audio: true, draft: false,
        seed: true, cameraFixed: false, webSearch: true, priority: false,
        returnLastFrame: true, watermark: false,
      },
    },
    {
      value: "doubao-seedance-2.0-mini", label: "Seedance 2.0 mini（APIMart）",
      hint: "APIMart 迷你版，仅 480p/720p，4-15s",
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
        resolutions: ["480p", "720p"],
        ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
        durationRange: [4, 15], durationAuto: false, audio: true, draft: false,
        seed: true, cameraFixed: false, webSearch: true, priority: false,
        returnLastFrame: true, watermark: false,
      },
    },
    {
      value: "grok-imagine-1.5-video-apimart", label: "Grok Imagine 1.5（APIMart）",
      hint: "APIMart Grok 视频，文生/图生，480p/720p，6-30s",
      videoCapability: {
        modes: ["text2video", "first-frame", "multimodal-ref"],
        resolutions: ["480p", "720p"],
        ratios: ["16:9", "9:16", "1:1", "3:2", "2:3"],
        durationRange: [6, 30], durationAuto: false, audio: false, draft: false,
        seed: false, cameraFixed: false, webSearch: false, priority: false,
        returnLastFrame: false, watermark: false,
      },
    },
    {
      value: "MiniMax-H3", label: "MiniMax-H3（APIMart）",
      hint: "APIMart MiniMax-H3，2K 直出带音轨，文生/图生/首尾帧/多模态参考，4-15s",
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
        resolutions: ["2K"],
        ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"],
        durationRange: [4, 15], durationAuto: false, audio: true, draft: false,
        seed: false, cameraFixed: false, webSearch: false, priority: false,
        returnLastFrame: false, watermark: true,
      },
    },
    {
      value: "wan2.7", label: "Wan2.7（APIMart）",
      hint: "阿里云万相 2.7，文生/图生/首尾帧，720P/1080P，2-15s，支持种子与水印",
      videoCapability: {
        modes: ["text2video", "first-frame", "first-last-frame"],
        resolutions: ["720P", "1080P"],
        ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
        durationRange: [2, 15], durationAuto: false, audio: false, draft: false,
        seed: true, cameraFixed: false, webSearch: false, priority: false,
        returnLastFrame: false, watermark: true,
      },
    },
  ],
  custom: [],
};

/** 音频生成（TTS）模型默认（按供应商），内嵌能力矩阵（参照 docs/audio.md） */
export const DEFAULT_AUDIO_MODELS: Record<AudioGenSettings["provider"], ModelEntry[]> = {
  mimo: [
    {
      value: "mimo-v2.5-tts", label: "MiMo TTS（预置音色）",
      hint: "预置音色 + 唱歌，支持 voice ID",
      isDefault: true,
      audioCapability: {
        supportsPresetVoice: true, supportsVoiceDesign: false, supportsVoiceClone: false, supportsSinging: true,
      },
    },
    {
      value: "mimo-v2.5-tts-voicedesign", label: "MiMo TTS VoiceDesign（文本设计音色）",
      hint: "用文字描述生成专属音色",
      audioCapability: {
        supportsPresetVoice: false, supportsVoiceDesign: true, supportsVoiceClone: false, supportsSinging: false,
      },
    },
    {
      value: "mimo-v2.5-tts-voiceclone", label: "MiMo TTS VoiceClone（音频复刻音色）",
      hint: "用音频样本复刻音色",
      audioCapability: {
        supportsPresetVoice: false, supportsVoiceDesign: false, supportsVoiceClone: true, supportsSinging: false,
      },
    },
  ],
  custom: [],
};

/** 音乐生成模型默认（按供应商） */
export const DEFAULT_MUSIC_MODELS: Record<MusicGenSettings["provider"], ModelEntry[]> = {
  apimart: [
    { value: "suno", label: "Suno", isDefault: true },
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
  /** 是否支持异步轮询（供应商异步任务模式，如 APIMart 的 task_id 轮询） */
  supportsPolling?: boolean;
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
};

/** 供应商级模型能力覆盖（键格式 `${provider}:${modelValue}`）。
 *  用于同一模型名在不同供应商下能力不同的情况（如 gpt-image-2 在 APIMart 下的参数与通用格式不同）。
 *  覆盖优先于全局 IMAGE_MODEL_CAPABILITIES，未命中的模型仍走全局注册表/FALLBACK。 */
export const IMAGE_MODEL_CAPABILITIES_BY_PROVIDER: Record<string, ImageModelCapability> = {
  "apimart:gpt-image-2": {
    resolutions: ["1K", "2K", "4K"],
    outputFormat: false,
    webSearch: false,
    optimizePrompt: false,
    optimizePromptFast: false,
    sequentialImageGen: false,
    watermark: false,
    responseFormat: false,
    quality: false,
    supportsPolling: true,
    maxRefImages: 16,
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
 * - 用户模型列表（含落库的内置模型）条目上的 capability 优先：用户在设置页可编辑内置模型参数，编辑结果逐字段覆盖代码默认值
 * - 代码默认值作为合并基座：供应商级覆盖（IMAGE_MODEL_CAPABILITIES_BY_PROVIDER，用于同一模型名在不同供应商下
 *   能力不同的情况，如 gpt-image-2 在 APIMart 下的参数与通用格式不同）→ IMAGE_MODEL_CAPABILITIES 注册表 → FALLBACK
 * - 条目无 capability（未配置过的自定义模型）时直接返回代码默认值/FALLBACK
 * 注：代码更新能力矩阵后，已落库的旧值不会自动跟进，需在设置页通过「初始化模型参数」（单模型）
 * 或「刷新内置模型列表」（整表）手动同步。
 */
export function getImageModelCapability(
  modelValue: string,
  models?: ModelEntry[],
  provider?: string
): ImageModelCapability {
  const codeDefault =
    (provider ? IMAGE_MODEL_CAPABILITIES_BY_PROVIDER[`${provider}:${modelValue}`] : undefined) ??
    IMAGE_MODEL_CAPABILITIES[modelValue];
  const base = codeDefault ?? FALLBACK_IMAGE_CAPABILITY;
  const entry = models?.find((m) => m.value === modelValue);
  if (!entry?.capability) return base;
  return { ...base, ...entry.capability };
}

/** 代码中该图片模型的默认能力（「初始化模型参数」按钮的数据源）；代码中无该模型时返回 undefined */
export function getCodeDefaultImageCapability(
  provider: string,
  modelValue: string
): ImageModelCapability | undefined {
  const builtIn = (DEFAULT_IMAGE_MODELS[provider as ImageGenSettings["provider"]] ?? []).find(
    (m) => m.value === modelValue
  );
  if (builtIn?.capability) return { ...FALLBACK_IMAGE_CAPABILITY, ...builtIn.capability };
  const override = IMAGE_MODEL_CAPABILITIES_BY_PROVIDER[`${provider}:${modelValue}`];
  if (override) return override;
  return IMAGE_MODEL_CAPABILITIES[modelValue];
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
  /** 是否支持水印（ark 支持；APIMart 不支持，false 时 UI 隐藏开关）。缺省（undefined）视为支持 */
  watermark?: boolean;
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
  "doubao-seedance-2.0": {
    modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
    resolutions: ["480p", "720p", "1080p", "4k"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
    durationRange: [4, 15],
    durationAuto: false,
    audio: true,
    draft: false,
    seed: true,
    cameraFixed: false,
    webSearch: true,
    priority: false,
    returnLastFrame: true,
    watermark: false,
  },
  "doubao-seedance-2.0-fast": {
    modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
    resolutions: ["480p", "720p"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
    durationRange: [4, 15],
    durationAuto: false,
    audio: true,
    draft: false,
    seed: true,
    cameraFixed: false,
    webSearch: true,
    priority: false,
    returnLastFrame: true,
    watermark: false,
  },
  "doubao-seedance-2.0-mini": {
    modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
    resolutions: ["480p", "720p"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
    durationRange: [4, 15],
    durationAuto: false,
    audio: true,
    draft: false,
    seed: true,
    cameraFixed: false,
    webSearch: true,
    priority: false,
    returnLastFrame: true,
    watermark: false,
  },
  "grok-imagine-1.5-video-apimart": {
    modes: ["text2video", "first-frame", "multimodal-ref"],
    resolutions: ["480p", "720p"],
    ratios: ["16:9", "9:16", "1:1", "3:2", "2:3"],
    durationRange: [6, 30],
    durationAuto: false,
    audio: false,
    draft: false,
    seed: false,
    cameraFixed: false,
    webSearch: false,
    priority: false,
    returnLastFrame: false,
    watermark: false,
  },
  "MiniMax-H3": {
    modes: ["text2video", "first-frame", "first-last-frame", "multimodal-ref"],
    resolutions: ["2K"],
    ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"],
    durationRange: [4, 15],
    durationAuto: false,
    audio: true,
    draft: false,
    seed: false,
    cameraFixed: false,
    webSearch: false,
    priority: false,
    returnLastFrame: false,
    watermark: true,
  },
  "wan2.7": {
    modes: ["text2video", "first-frame", "first-last-frame"],
    resolutions: ["720P", "1080P"],
    ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    durationRange: [2, 15],
    durationAuto: false,
    audio: false,
    draft: false,
    seed: true,
    cameraFixed: false,
    webSearch: false,
    priority: false,
    returnLastFrame: false,
    watermark: true,
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
 * - 用户模型列表（含落库的内置模型）条目上的 videoCapability 优先：用户在设置页可编辑内置模型参数，
 *   编辑结果逐字段覆盖代码默认值
 * - 代码默认值（VIDEO_MODEL_CAPABILITIES 注册表，缺省 FALLBACK）作为合并基座
 * - 条目无 videoCapability（未配置过的自定义模型）时直接返回代码默认值/FALLBACK
 * 注：代码更新能力矩阵后，已落库的旧值不会自动跟进，需在设置页通过「初始化模型参数」（单模型）
 * 或「刷新内置模型列表」（整表）手动同步。
 */
export function getVideoModelCapability(
  modelValue: string,
  models?: ModelEntry[]
): VideoModelCapability {
  const base = VIDEO_MODEL_CAPABILITIES[modelValue] ?? FALLBACK_CAPABILITY;
  const entry = models?.find((m) => m.value === modelValue);
  if (!entry?.videoCapability) return base;
  return { ...base, ...entry.videoCapability };
}

/** 代码中该视频模型的默认能力（「初始化模型参数」按钮的数据源）；代码中无该模型时返回 undefined */
export function getCodeDefaultVideoCapability(
  provider: string,
  modelValue: string
): VideoModelCapability | undefined {
  const builtIn = (DEFAULT_VIDEO_MODELS[provider as VideoGenSettings["provider"]] ?? []).find(
    (m) => m.value === modelValue
  );
  if (builtIn?.videoCapability) return { ...FALLBACK_CAPABILITY, ...builtIn.videoCapability };
  return VIDEO_MODEL_CAPABILITIES[modelValue];
}

/** 各音频模型能力注册表（键与 DEFAULT_AUDIO_MODELS 的 value 对齐，参照 docs/audio.md） */
export const AUDIO_MODEL_CAPABILITIES: Record<string, AudioModelCapability> = {
  "mimo-v2.5-tts": {
    supportsPresetVoice: true, supportsVoiceDesign: false, supportsVoiceClone: false, supportsSinging: true,
  },
  "mimo-v2.5-tts-voicedesign": {
    supportsPresetVoice: false, supportsVoiceDesign: true, supportsVoiceClone: false, supportsSinging: false,
  },
  "mimo-v2.5-tts-voiceclone": {
    supportsPresetVoice: false, supportsVoiceDesign: false, supportsVoiceClone: true, supportsSinging: false,
  },
};

/** 未知/用户自定义模型的保守回退（启用预置音色） */
const FALLBACK_AUDIO_CAPABILITY: AudioModelCapability = {
  supportsPresetVoice: true, supportsVoiceDesign: false, supportsVoiceClone: false, supportsSinging: false,
};

/**
 * 查询音频模型能力。
 * - 内置模型（在 AUDIO_MODEL_CAPABILITIES 注册表中）：注册表能力为权威来源
 * - 自定义模型（不在注册表中）：合并用户自定义能力 over FALLBACK
 */
export function getAudioModelCapability(
  modelValue: string,
  models?: ModelEntry[]
): AudioModelCapability {
  const registry = AUDIO_MODEL_CAPABILITIES[modelValue];
  if (registry) return registry;
  const base = FALLBACK_AUDIO_CAPABILITY;
  if (!models) return base;
  const entry = models.find((m) => m.value === modelValue);
  if (!entry?.audioCapability) return base;
  return { ...base, ...entry.audioCapability };
}

/** 单个镜头视频生成的代码兜底默认配置（卡片缺省 videoConfig 且用户未自定义默认参数时回退） */
export const DEFAULT_SHOT_VIDEO_CONFIG: ShotVideoConfig = {
  model: "",
  provider: "ark",
  mode: "multimodal-ref",
  resolution: "720p",
  ratio: "16:9",
  duration: -1,
  watermark: false,
  generateAudio: true,
  seed: -1,
  cameraFixed: false,
  returnLastFrame: false,
  webSearch: false,
  priority: 0,
  draft: false,
};

/**
 * 用户自定义的视频生成默认参数（设置页「视频生成 API」区域维护）。
 * 新增镜头卡片、未记录 videoConfig 的旧卡片渲染回退、videoConfig 惰性写入的合并基座均使用它
 * （模型字段仍优先取模型列表中的「默认」星标）。
 * 缺省/读取失败时回退 DEFAULT_SHOT_VIDEO_CONFIG。
 */
export async function getDefaultShotVideoConfig(): Promise<ShotVideoConfig> {
  try {
    const stored = await apiClient.getSetting<Partial<ShotVideoConfig>>("default_video_config");
    if (stored) return { ...DEFAULT_SHOT_VIDEO_CONFIG, ...stored };
  } catch { /* fall through */ }
  return DEFAULT_SHOT_VIDEO_CONFIG;
}

export async function saveDefaultShotVideoConfig(cfg: ShotVideoConfig): Promise<void> {
  await apiClient.saveSetting("default_video_config", cfg);
}

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

/** 通用合并：代码最新内置列表 + 用户自添加模型（不在代码内置列表中的条目原样保留，含已被代码移除的旧内置模型） */
function mergeWithBuiltIn(builtIn: ModelEntry[], current: ModelEntry[]): ModelEntry[] {
  const builtInValues = new Set(builtIn.map((m) => m.value));
  return [...builtIn, ...current.filter((m) => !builtInValues.has(m.value))];
}

/**
 * 刷新内置模型列表：用代码中该 provider 最新的内置模型替换当前内置模型
 * （内置模型上手动修改的参数恢复为代码默认），用户自添加的模型保留。返回合并后的列表。
 */
export async function refreshBuiltInLLMModels(provider: LLMSettings["provider"]): Promise<ModelEntry[]> {
  const current = await getLLMModels(provider);
  const merged = mergeWithBuiltIn(DEFAULT_LLM_MODELS[provider] ?? [], current);
  await saveLLMModels(provider, merged);
  return merged;
}

/** 纯 model value 数组 */
export async function getLLMModelValues(provider: LLMSettings["provider"]): Promise<string[]> {
  const models = await getLLMModels(provider);
  return models.map((m) => m.value);
}

// ---- 图片 ----

export async function getImageModels(provider: ImageGenSettings["provider"]): Promise<ModelEntry[]> {
  try {
    const all = await apiClient.getSetting<Record<string, ModelEntry[]>>("models_image");
    const custom = all?.[provider];
    if (custom && custom.length > 0) return custom;
  } catch { /* fall through */ }
  return DEFAULT_IMAGE_MODELS[provider] ?? [];
}

export async function saveImageModels(provider: ImageGenSettings["provider"], models: ModelEntry[]): Promise<void> {
  let all: Record<string, ModelEntry[]> = {};
  try { all = (await apiClient.getSetting<Record<string, ModelEntry[]>>("models_image")) ?? {}; } catch { /* empty */ }
  all[provider] = models;
  await apiClient.saveSetting("models_image", all);
}

export async function refreshBuiltInImageModels(provider: ImageGenSettings["provider"]): Promise<ModelEntry[]> {
  const current = await getImageModels(provider);
  const merged = mergeWithBuiltIn(DEFAULT_IMAGE_MODELS[provider] ?? [], current);
  await saveImageModels(provider, merged);
  return merged;
}

/** 纯 model value 数组 */
export async function getImageModelValues(provider: ImageGenSettings["provider"]): Promise<string[]> {
  const models = await getImageModels(provider);
  return models.map((m) => m.value);
}

// ---- 视频 ----

export async function getVideoModels(provider: VideoGenSettings["provider"]): Promise<ModelEntry[]> {
  try {
    const all = await apiClient.getSetting<Record<string, ModelEntry[]>>("models_video");
    const custom = all?.[provider];
    if (custom && custom.length > 0) return custom;
  } catch { /* fall through */ }
  return DEFAULT_VIDEO_MODELS[provider] ?? [];
}

export async function saveVideoModels(provider: VideoGenSettings["provider"], models: ModelEntry[]): Promise<void> {
  let all: Record<string, ModelEntry[]> = {};
  try { all = (await apiClient.getSetting<Record<string, ModelEntry[]>>("models_video")) ?? {}; } catch { /* empty */ }
  all[provider] = models;
  await apiClient.saveSetting("models_video", all);
}

export async function refreshBuiltInVideoModels(provider: VideoGenSettings["provider"]): Promise<ModelEntry[]> {
  const current = await getVideoModels(provider);
  const merged = mergeWithBuiltIn(DEFAULT_VIDEO_MODELS[provider] ?? [], current);
  await saveVideoModels(provider, merged);
  return merged;
}

/** 纯 model value 数组 */
export async function getVideoModelValues(provider: VideoGenSettings["provider"]): Promise<string[]> {
  const models = await getVideoModels(provider);
  return models.map((m) => m.value);
}

// ---- 音频 ----

export async function getAudioModels(provider: AudioGenSettings["provider"]): Promise<ModelEntry[]> {
  try {
    const all = await apiClient.getSetting<Record<string, ModelEntry[]>>("models_audio");
    const custom = all?.[provider];
    if (custom && custom.length > 0) return custom;
  } catch { /* fall through */ }
  return DEFAULT_AUDIO_MODELS[provider] ?? [];
}

export async function saveAudioModels(provider: AudioGenSettings["provider"], models: ModelEntry[]): Promise<void> {
  let all: Record<string, ModelEntry[]> = {};
  try { all = (await apiClient.getSetting<Record<string, ModelEntry[]>>("models_audio")) ?? {}; } catch { /* empty */ }
  all[provider] = models;
  await apiClient.saveSetting("models_audio", all);
}

export async function refreshBuiltInAudioModels(provider: AudioGenSettings["provider"]): Promise<ModelEntry[]> {
  const current = await getAudioModels(provider);
  const merged = mergeWithBuiltIn(DEFAULT_AUDIO_MODELS[provider] ?? [], current);
  await saveAudioModels(provider, merged);
  return merged;
}

/** 纯 model value 数组 */
export async function getAudioModelValues(provider: AudioGenSettings["provider"]): Promise<string[]> {
  const models = await getAudioModels(provider);
  return models.map((m) => m.value);
}

// ---- 音乐 ----

export async function getMusicModels(provider: MusicGenSettings["provider"]): Promise<ModelEntry[]> {
  try {
    const all = await apiClient.getSetting<Record<string, ModelEntry[]>>("models_music");
    const custom = all?.[provider];
    if (custom && custom.length > 0) return custom;
  } catch { /* fall through */ }
  return DEFAULT_MUSIC_MODELS[provider] ?? [];
}

export async function saveMusicModels(provider: MusicGenSettings["provider"], models: ModelEntry[]): Promise<void> {
  let all: Record<string, ModelEntry[]> = {};
  try { all = (await apiClient.getSetting<Record<string, ModelEntry[]>>("models_music")) ?? {}; } catch { /* empty */ }
  all[provider] = models;
  await apiClient.saveSetting("models_music", all);
}

export async function refreshBuiltInMusicModels(provider: MusicGenSettings["provider"]): Promise<ModelEntry[]> {
  const current = await getMusicModels(provider);
  const merged = mergeWithBuiltIn(DEFAULT_MUSIC_MODELS[provider] ?? [], current);
  await saveMusicModels(provider, merged);
  return merged;
}

/** 纯 model value 数组 */
export async function getMusicModelValues(provider: MusicGenSettings["provider"]): Promise<string[]> {
  const models = await getMusicModels(provider);
  return models.map((m) => m.value);
}


