import type {
  AssetImageConfig,
  ImageGenSettings,
  ImageProxyRequest,
  ImageProxyResponse,
  ImageAsyncCreateResponse,
  ImageQueryProxyRequest,
  ImageQueryProxyResponse,
  ImageTaskStatus,
  ProviderCache,
  ProviderCacheEntry,
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
    label: "火山方舟",
    keyPrefix: "ark-",
    hint: "火山引擎方舟大模型服务平台。前往 console.volcengine.com/ark 获取 API Key 并开通对应模型。",
    sizes: ["2K", "3K", "4K", "2048x2048", "2304x1728", "1728x2304", "2848x1600", "1600x2848"],
    supportsOutputFormat: true,
    supportsWatermark: true,
  },
  "ark-plan": {
    baseURL: "https://ark.cn-beijing.volces.com/api/plan/v3",
    model: "doubao-seedream-5-0-260128",
    label: "火山引擎 ",
    keyPrefix: "ark-plan-",
    hint: "火山引擎 Agent Plan 计费端点。使用计划制 API Key，与方舟共用同一模型，仅 baseURL 不同。前往 console.volcengine.com/ark 获取 API Key 并开通对应模型。",
    sizes: ["2K", "3K", "4K", "2048x2048", "2304x1728", "1728x2304", "2848x1600", "1600x2848"],
    supportsOutputFormat: true,
    supportsWatermark: true,
  },
  openai: {
    baseURL: "https://img-cn.65535.space/v1",
    model: "gpt-image-2",
    label: "65535",
    keyPrefix: "sk-",
    hint: "OpenAI 兼容图片生成 API。前往对应平台获取 API Key 并开通 gpt-image-2 模型。支持 1024x1024 / 1024x1536 / 1536x1024 / 3840x2160 / auto 尺寸，low/medium/high/auto 画质。底层为异步队列，支持任务轮询。第三方中转平台兼容此格式，仅需修改 baseURL。",
    sizes: ["auto", "1024x1024", "1024x1536", "1536x1024", "3840x2160"],
    supportsOutputFormat: false,
    supportsWatermark: false,
  },
  apimart: {
    baseURL: "https://api.apib.ai/v1",
    model: "gpt-image-2",
    label: "APIMart",
    hint: "APIMart 图片生成 API。前往 apimart.ai/keys 获取 API Key。api域名变化比较快，如有变化请自行联系供应商的客服。",
    sizes: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"],
    supportsOutputFormat: false,
    supportsWatermark: false,
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
  aspectRatio: "16:9",
  outputFormat: "png",
  watermark: false,
  responseFormat: "url",
  webSearch: false,
  optimizePromptMode: "standard",
  quality: "auto",
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

/** 获取各图片 provider 缓存的配置（切换供应商时自动恢复，含 baseURL/model） */
export async function getImageProviderKeys(): Promise<ProviderCache> {
  try {
    const raw = await apiClient.getSetting<Record<string, unknown>>("image_provider_keys");
    if (!raw) return {};
    const result: ProviderCache = {};
    for (const [k, v] of Object.entries(raw)) {
      // 向后兼容：旧数据是 Record<string, string>（仅 apiKey）
      if (typeof v === "string") result[k] = { apiKey: v };
      else if (v && typeof v === "object") result[k] = v as ProviderCacheEntry;
    }
    return result;
  } catch {
    return {};
  }
}

/** 缓存某个图片 provider 的配置（合并写入，不覆盖未传入字段） */
export async function saveImageProviderKey(provider: string, entry: ProviderCacheEntry): Promise<void> {
  const all = await getImageProviderKeys();
  all[provider] = { ...all[provider], ...entry };
  await apiClient.saveSetting("image_provider_keys", all);
}

/** 清除某个图片 provider 的缓存配置（用于「初始化默认配置」时清空旧的缓存） */
export async function clearImageProviderKey(provider: string): Promise<void> {
  const all = await getImageProviderKeys();
  if (provider in all) {
    delete all[provider];
    await apiClient.saveSetting("image_provider_keys", all);
  }
}

/**
 * 调用图片生成 API。
 * - 支持轮询的模型（cap.supportsPolling）：异步创建任务 → 立即回调 onJobCreated 持久化 jobId → 轮询至完成
 * - 不支持轮询的模型：同步等待上游返回（最多 5 分钟）
 * @param prompt 图片生成提示词
 * @param config 卡片级图片生成配置（尺寸/格式/水印等），缺省时使用 DEFAULT_ASSET_IMAGE_CONFIG
 * @param images 参考图列表（URL 或 base64 data URI），用于单图/多图生图
 * @param models 用户自定义模型列表（用于能力查询）
 * @param onJobCreated 异步任务创建后的回调（收到 jobId 后可持久化，用于刷新页面恢复轮询）
 * @param signal AbortSignal，用于取消轮询（切页/卸载时传入，避免孤儿轮询与恢复轮询产生重复）
 * @returns ImageProxyResponse，imageUrl 可能是 URL 或 data URI
 */
export async function generateImage(
  prompt: string,
  config?: Partial<AssetImageConfig>,
  images?: string[],
  models?: ModelEntry[],
  onJobCreated?: (jobId: string) => void,
  signal?: AbortSignal
): Promise<ImageProxyResponse> {
  const s = await getImageSettings();
  if (!s || !s.apiKey) {
    throw new Error("未配置图片生成 API，请先在「图片 API 设置」中填写");
  }
  const cfg = { ...DEFAULT_ASSET_IMAGE_CONFIG, ...config };
  const model = cfg.model || s.model;
  const cap = getImageModelCapability(model, models, s.provider);
  const isApimart = s.provider === "apimart";
  const body: ImageProxyRequest = {
    provider: s.provider,
    apiKey: s.apiKey,
    baseURL: s.baseURL,
    model,
    prompt: isApimart ? prompt : appendAspectRatioToPrompt(prompt, cfg.aspectRatio),
    size: isApimart ? (cfg.aspectRatio === "auto" ? "1:1" : cfg.aspectRatio) : cfg.resolution,
    responseFormat: cfg.responseFormat,
  };
  if (isApimart) body.resolution = cfg.resolution.toLowerCase();
  if (cap.watermark) body.watermark = cfg.watermark;
  if (cap.outputFormat) body.outputFormat = cfg.outputFormat;
  if (cap.webSearch) body.webSearch = cfg.webSearch;
  if (cap.optimizePrompt) body.optimizePromptMode = cfg.optimizePromptMode;
  if (cap.quality) body.quality = cfg.quality;
  if (images && images.length > 0) {
    body.images = images;
  }

  // 支持轮询的模型：异步创建 + 轮询
  if (cap.supportsPolling) {
    body.asyncMode = true;
    const createRes = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!createRes.ok) {
      let msg = `HTTP ${createRes.status}`;
      try {
        const d = await createRes.json();
        msg = d.error ?? msg;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    const created = (await createRes.json()) as ImageAsyncCreateResponse;
    // 立即回调，让调用方持久化 jobId（刷新页面后可恢复轮询）
    onJobCreated?.(created.jobId);
    // 轮询至完成（传入 signal，切页/卸载时取消轮询，保留 jobId 供恢复）
    const final = await pollImageTask(created.jobId, s.apiKey, s.baseURL, undefined, 3000, 5 * 60 * 1000, signal, s.provider);
    if (final.status === "done" && final.imageUrl) {
      return { imageUrl: final.imageUrl, model };
    }
    throw new Error(final.error || "图片生成失败");
  }

  // 不支持轮询的模型：同步等待
  const res = await fetch("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
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

/**
 * 查询异步图片任务状态（单次）。
 * 供应商支持轮询时使用，对应 GET /v1/images/async-generations/{jobId}
 */
export async function queryImageTask(
  jobId: string,
  apiKey: string,
  baseURL: string,
  provider: ImageGenSettings["provider"]
): Promise<ImageQueryProxyResponse> {
  const reqBody: ImageQueryProxyRequest = { provider, apiKey, baseURL, jobId };
  const res = await fetch("/api/image/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const d = await res.json();
      msg = d.error ?? msg;
    } catch { /* ignore */ }
    return { status: "failed", error: msg };
  }
  return (await res.json()) as ImageQueryProxyResponse;
}

/**
 * 轮询异步图片任务直到完成/失败/超时。
 * @param jobId 任务 ID
 * @param apiKey API Key
 * @param baseURL 上游 baseURL
 * @param onUpdate 每次查询后的状态回调（可选，用于 UI 实时更新）
 * @param intervalMs 轮询间隔，默认 3 秒
 * @param timeoutMs 最大等待时间，默认 5 分钟
 * @param signal AbortSignal，用于取消轮询
 */
export async function pollImageTask(
  jobId: string,
  apiKey: string,
  baseURL: string,
  onUpdate?: (r: ImageQueryProxyResponse) => void,
  intervalMs = 3000,
  timeoutMs = 5 * 60 * 1000,
  signal?: AbortSignal,
  provider: ImageGenSettings["provider"] = "openai"
): Promise<ImageQueryProxyResponse> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) {
      return { status: "expired", error: "已取消" };
    }
    const result = await queryImageTask(jobId, apiKey, baseURL, provider);
    onUpdate?.(result);
    if (result.status === "done" || result.status === "failed") {
      return result;
    }
    // 等待 intervalMs，期间响应 abort
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, intervalMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
  }
  return { status: "expired", error: "轮询超时" };
}

/**
 * 恢复图片生成轮询（页面刷新后，对已创建但未完成的任务恢复轮询）。
 * @param jobId 已持久化的任务 ID
 * @param onUpdate 状态回调（可选）
 * @param signal AbortSignal（可选）
 * @returns 成功时返回 ImageProxyResponse，失败/超时抛出错误
 */
export async function resumeImageGeneration(
  jobId: string,
  onUpdate?: (r: ImageQueryProxyResponse) => void,
  signal?: AbortSignal
): Promise<ImageProxyResponse> {
  const s = await getImageSettings();
  if (!s || !s.apiKey) {
    throw new Error("未配置图片生成 API，请先在「图片 API 设置」中填写");
  }
  const final = await pollImageTask(jobId, s.apiKey, s.baseURL, onUpdate, 3000, 5 * 60 * 1000, signal, s.provider);
  if (final.status === "done" && final.imageUrl) {
    return { imageUrl: final.imageUrl };
  }
  throw new Error(final.error || "图片生成失败");
}

/**
 * 获取当前模型是否支持轮询（供 UI 判断是否需要恢复轮询）。
 */
export function isPollingSupported(model: string, models?: ModelEntry[], provider?: string): boolean {
  return getImageModelCapability(model, models, provider).supportsPolling ?? false;
}

/** 测试连接：用最简单的提示词生成一张图 */
export async function testImageConnection(
  s: ImageGenSettings
): Promise<{ ok: boolean; message: string; imageUrl?: string }> {
  try {
    // APIMart 始终异步：提交后轮询至完成（其余供应商走下方同步逻辑，保持原有行为不变）
    if (s.provider === "apimart") {
      const body: ImageProxyRequest = {
        provider: s.provider,
        apiKey: s.apiKey,
        baseURL: s.baseURL.replace(/\/+$/, ""),
        model: s.model || "gpt-image-2",
        prompt: "一只可爱的小猫，写实风格",
        size: "1:1",
        resolution: "1k",
        asyncMode: true,
      };
      const createRes = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body satisfies ImageProxyRequest),
      });
      if (!createRes.ok) {
        let msg = `HTTP ${createRes.status}`;
        try {
          const d = await createRes.json();
          msg = d.error ?? msg;
        } catch {
          /* ignore */
        }
        return { ok: false, message: `连接失败：${msg}` };
      }
      const created = (await createRes.json()) as ImageAsyncCreateResponse;
      if (!created.jobId) {
        return { ok: false, message: "连接失败：APIMart 未返回 task_id" };
      }
      const final = await pollImageTask(created.jobId, s.apiKey, s.baseURL, undefined, 3000, 5 * 60 * 1000, undefined, s.provider);
      if (final.status === "done" && final.imageUrl) {
        return { ok: true, message: "连接成功，已生成测试图片", imageUrl: final.imageUrl };
      }
      return { ok: false, message: `连接失败：${final.error || "图片生成失败"}` };
    }

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
