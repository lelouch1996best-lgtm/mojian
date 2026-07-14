import type {
  AssetImageConfig,
  ImageGenSettings,
  ImageProxyRequest,
  ImageProxyResponse,
} from "./types";
import { apiClient } from "./api-client";
import { getImageModelCapability, type ModelEntry } from "./model-presets";

/** 图片供应商预设 */
export interface ImageProviderPreset {
  baseURL: string;
  model: string;
  label: string;
  keyPrefix?: string;
  hint?: string;
  /** 该供应商支持的尺寸选项（兜底，优先使用模型级尺寸） */
  sizes: string[];
  /** 是否支持输出格式选择 */
  supportsOutputFormat: boolean;
  /** 是否支持水印 */
  supportsWatermark: boolean;
}

/** 可选宽高比（方式2，拼接到提示词中） */
export const IMAGE_ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"];

/** 查询某模型支持的分辨率档位，未注册时回退保守能力中的分辨率 */
export function getModelResolutions(model: string, models?: ModelEntry[]): string[] {
  return getImageModelCapability(model, models).resolutions;
}

/** 将宽高比拼接到提示词末尾（方式2） */
export function appendAspectRatioToPrompt(prompt: string, aspectRatio: string): string {
  const base = prompt.trim();
  if (!aspectRatio || aspectRatio === "auto") return base;
  return `${base}，宽高比为${aspectRatio}`;
}

export const IMAGE_PROVIDER_PRESETS: Record<ImageGenSettings["provider"], ImageProviderPreset> = {
  ark: {
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seedream-5-0-260128",
    label: "火山方舟（Seedream）",
    keyPrefix: "ark-",
    hint: "火山引擎方舟大模型服务平台。前往 console.volcengine.com/ark 获取 API Key 并开通对应模型。",
    sizes: ["2K", "3K", "4K", "2048x2048", "2304x1728", "1728x2304", "2848x1600", "1600x2848"],
    supportsOutputFormat: true,
    supportsWatermark: true,
  },
  "ark-plan": {
    baseURL: "https://ark.cn-beijing.volces.com/api/plan/v3",
    model: "doubao-seedream-5-0-260128",
    label: "火山引擎 Agent Plan（Seedream）",
    keyPrefix: "ark-plan-",
    hint: "火山引擎 Agent Plan 计费端点。使用计划制 API Key，与方舟共用同一模型，仅 baseURL 不同。前往 console.volcengine.com/ark 获取 API Key 并开通对应模型。",
    sizes: ["2K", "3K", "4K", "2048x2048", "2304x1728", "1728x2304", "2848x1600", "1600x2848"],
    supportsOutputFormat: true,
    supportsWatermark: true,
  },
  custom: {
    baseURL: "",
    model: "",
    label: "自定义",
    sizes: [],
    supportsOutputFormat: true,
    supportsWatermark: true,
  },
};

export const DEFAULT_IMAGE_SETTINGS: ImageGenSettings = {
  provider: "ark",
  apiKey: "",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  model: "doubao-seedream-5-0-260128",
};

/** 卡片级图片生成默认配置 */
export const DEFAULT_ASSET_IMAGE_CONFIG: AssetImageConfig = {
  model: "doubao-seedream-5-0-260128",
  resolution: "2K",
  aspectRatio: "1:1",
  outputFormat: "png",
  watermark: false,
  responseFormat: "url",
  webSearch: false,
  optimizePromptMode: "standard",
};

export async function getImageSettings(): Promise<ImageGenSettings | null> {
  try {
    const s = await apiClient.getSetting<ImageGenSettings>("image");
    if (!s) return null;
    // 向后兼容：旧数据缺少 provider 字段时默认 ark
    if (!s.provider) return { ...DEFAULT_IMAGE_SETTINGS, ...s, provider: "ark" };
    return s;
  } catch { return null; }
}

export async function saveImageSettings(s: ImageGenSettings): Promise<void> {
  const normalized: ImageGenSettings = {
    ...s,
    baseURL: s.baseURL.replace(/\/+$/, ""),
  };
  await apiClient.saveSetting("image", normalized);
}

/** 获取各图片 provider 缓存的 API Key（切换供应商时自动恢复） */
export async function getImageProviderKeys(): Promise<Record<string, string>> {
  try {
    return (await apiClient.getSetting<Record<string, string>>("image_provider_keys")) ?? {};
  } catch {
    return {};
  }
}

/** 缓存某个图片 provider 的 API Key */
export async function saveImageProviderKey(provider: string, key: string): Promise<void> {
  const all = await getImageProviderKeys();
  all[provider] = key;
  await apiClient.saveSetting("image_provider_keys", all);
}

/**
 * 调用图片生成 API。
 * @param prompt 图片生成提示词
 * @param config 卡片级图片生成配置（尺寸/格式/水印等），缺省时使用 DEFAULT_ASSET_IMAGE_CONFIG
 * @param images 参考图列表（URL 或 base64 data URI），用于单图/多图生图
 * @returns ImageProxyResponse，imageUrl 可能是 URL 或 data URI
 */
export async function generateImage(
  prompt: string,
  config?: Partial<AssetImageConfig>,
  images?: string[],
  models?: ModelEntry[]
): Promise<ImageProxyResponse> {
  const s = await getImageSettings();
  if (!s || !s.apiKey) {
    throw new Error("未配置图片生成 API，请先在「图片 API 设置」中填写");
  }
  const cfg = { ...DEFAULT_ASSET_IMAGE_CONFIG, ...config };
  const model = cfg.model || s.model;
  const cap = getImageModelCapability(model, models);
  const body: ImageProxyRequest = {
    provider: s.provider,
    apiKey: s.apiKey,
    baseURL: s.baseURL,
    model,
    prompt: appendAspectRatioToPrompt(prompt, cfg.aspectRatio),
    size: cfg.resolution,
    responseFormat: cfg.responseFormat,
  };
  if (cap.watermark) body.watermark = cfg.watermark;
  if (cap.outputFormat) body.outputFormat = cfg.outputFormat;
  if (cap.webSearch) body.webSearch = cfg.webSearch;
  if (cap.optimizePrompt) body.optimizePromptMode = cfg.optimizePromptMode;
  if (images && images.length > 0) {
    body.images = images;
  }
  const res = await fetch("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const data = (await res.json()) as ImageProxyResponse;
  return data;
}

/** 测试连接：用最简单的提示词生成一张图 */
export async function testImageConnection(
  s: ImageGenSettings
): Promise<{ ok: boolean; message: string; imageUrl?: string }> {
  try {
    const res = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...DEFAULT_ASSET_IMAGE_CONFIG,
        provider: s.provider,
        apiKey: s.apiKey,
        baseURL: s.baseURL.replace(/\/+$/, ""),
        model: s.model || DEFAULT_ASSET_IMAGE_CONFIG.model,
        prompt: "一只可爱的小猫，写实风格",
      } satisfies ImageProxyRequest),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        msg = data.error ?? msg;
      } catch {
        /* ignore */
      }
      return { ok: false, message: `连接失败：${msg}` };
    }
    const data = (await res.json()) as ImageProxyResponse;
    return {
      ok: true,
      message: "连接成功，已生成测试图片",
      imageUrl: data.imageUrl,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `连接失败：${msg}` };
  }
}
