import type {
  AssetImageConfig,
  ImageGenSettings,
  ImageProxyRequest,
  ImageProxyResponse,
  ImageAsyncCreateResponse,
  ImageQueryProxyRequest,
  ImageQueryProxyResponse,
  ImageTaskRecord,
  ImageTaskStatus,
  ProviderCache,
  ProviderCacheEntry,
} from "./types";
import { apiClient } from "./api-client";
import { getImageModelCapability, getImageModels, type ModelEntry, type ModelOption } from "./model-presets";

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

/** 卡片级图片生成默认配置（代码兜底值；用户可在设置页自定义默认生成参数） */
export const DEFAULT_ASSET_IMAGE_CONFIG: AssetImageConfig = {
  model: "",
  provider: "ark",
  resolution: "2K",
  aspectRatio: "16:9",
  outputFormat: "png",
  watermark: false,
  responseFormat: "url",
  webSearch: false,
  optimizePromptMode: "standard",
  quality: "auto",
};

/**
 * 用户自定义的图片生成默认参数（设置页「图片生成 API」区域维护）。
 * 每次打开图片生成弹框时以其为基础。默认模型由设置页供应商面板的星标驱动，切换供应商/星标时同步写入。
 * 缺省/读取失败时回退 DEFAULT_ASSET_IMAGE_CONFIG。
 */
export async function getDefaultAssetImageConfig(): Promise<AssetImageConfig> {
  try {
    const stored = await apiClient.getSetting<Partial<AssetImageConfig>>("default_image_config");
    if (stored) return { ...DEFAULT_ASSET_IMAGE_CONFIG, ...stored };
  } catch { /* fall through */ }
  return DEFAULT_ASSET_IMAGE_CONFIG;
}

export async function saveDefaultAssetImageConfig(cfg: AssetImageConfig): Promise<void> {
  await apiClient.saveSetting("default_image_config", cfg);
}

/**
 * 若当前默认图片供应商未配置 apiKey，则把本次生成所用模型+供应商持久化为默认。
 * 用于「默认供应商未配置但用户使用了其他已配置供应商」时，首次生成自动落盘为默认。
 * 默认供应商已配置 apiKey 时为空操作（避免覆盖用户主动设置的默认）。
 */
export async function persistDefaultImageIfProviderUnconfigured(cfg: AssetImageConfig): Promise<void> {
  try {
    const defaultCfg = await getDefaultAssetImageConfig();
    const defaultCreds = await resolveImageCredentials(defaultCfg.provider);
    if (defaultCreds?.apiKey) return; // 默认供应商已配置，不覆盖
    await saveDefaultAssetImageConfig({
      ...defaultCfg,
      model: cfg.model || defaultCfg.model,
      provider: cfg.provider || defaultCfg.provider,
    });
  } catch { /* ignore persist failure */ }
}

export async function getImageSettings(): Promise<ImageGenSettings | null> {
  try {
    const s = await apiClient.getSetting<ImageGenSettings>("image");
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
    const raw = await apiClient.getSetting<ProviderCache>("image_provider_keys");
    return raw ?? {};
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
 * 按指定 provider 解析生成/查询所需的凭证。
 * - 与当前设置一致：直接用当前设置的 apiKey/baseURL；
 * - 否则（所选模型供应商与当前不同）：从 image_provider_keys 缓存读取（设置页已落盘）；
 * - 缓存也缺失时回退当前设置凭证。
 * 用于跨供应商生成/恢复轮询：按「所选模型所属供应商」正确选择 API Key / baseURL。
 */
export async function resolveImageCredentials(
  provider?: ImageGenSettings["provider"]
): Promise<{ provider: ImageGenSettings["provider"]; apiKey: string; baseURL: string } | null> {
  const current = await getImageSettings();
  const p = provider ?? current?.provider;
  if (!p) return null;
  let apiKey = current?.apiKey;
  let baseURL = current?.baseURL;
  if (current && p !== current.provider) {
    const cache = await getImageProviderKeys();
    apiKey = cache[p]?.apiKey ?? apiKey;
    baseURL = cache[p]?.baseURL ?? baseURL;
  }
  if (!apiKey || !baseURL) return null;
  return { provider: p, apiKey, baseURL };
}

/**
 * 聚合所有「已配置 API Key」的图片供应商的全部模型（供模型选择弹框使用）。
 * - 已配置 = 当前激活供应商有 apiKey，或在 image_provider_keys 缓存中有 apiKey 的供应商；
 * - 每个模型条目携带其供应商与供应商显示名，便于按供应商分组展示与生成时路由凭证。
 * 新增供应商 / 修改模型参数 / 新增模型后，调用本函数即可取到最新全集。
 */
export async function getAllConfiguredImageModels(): Promise<ModelOption[]> {
  const current = await getImageSettings();
  const cache = await getImageProviderKeys();
  const configuredProviders = new Set<string>();
  if (current?.apiKey) configuredProviders.add(current.provider);
  for (const [p, entry] of Object.entries(cache)) {
    if (entry?.apiKey) configuredProviders.add(p);
  }
  const options: ModelOption[] = [];
  for (const p of Array.from(configuredProviders)) {
    const preset = IMAGE_PROVIDER_PRESETS[p as ImageGenSettings["provider"]];
    if (!preset) continue;
    const models = await getImageModels(p as ImageGenSettings["provider"]);
    for (const entry of models) {
      options.push({ provider: p, providerLabel: preset.label, entry });
    }
  }
  return options;
}

/**
 * 调用图片生成 API。
 * - 支持轮询的模型（cap.supportsPolling）：异步创建任务 → 立即回调 onJobCreated 持久化 jobId →
 *   订阅服务端任务中心至完成（服务端负责轮询上游，前端取消订阅不影响任务本身）
 * - 不支持轮询的模型：同步等待上游返回（最多 5 分钟）
 * @param prompt 图片生成提示词
 * @param config 卡片级图片生成配置（尺寸/格式/水印等，含所选模型供应商 provider），缺省时使用 DEFAULT_ASSET_IMAGE_CONFIG
 * @param images 参考图列表（URL 或 base64 data URI），用于单图/多图生图
 * @param onJobCreated 异步任务创建后的回调（收到 jobId 后可持久化，用于刷新页面恢复订阅）
 * @param signal AbortSignal，用于取消订阅（切页/卸载时传入；仅停止前端等待，服务端任务继续）
 * @param options.cosPrefix 任务完成后服务端 COS 转存的 key 前缀（默认 ai-script/assets）
 * @returns ImageProxyResponse，imageUrl 可能是 URL 或 data URI
 */
export async function generateImage(
  prompt: string,
  config?: Partial<AssetImageConfig>,
  images?: string[],
  onJobCreated?: (jobId: string) => void,
  signal?: AbortSignal,
  options?: { cosPrefix?: string }
): Promise<ImageProxyResponse> {
  const cfg = { ...DEFAULT_ASSET_IMAGE_CONFIG, ...config };
  // 未选择模型时明确提示，避免发出空 model 的请求
  if (!cfg.model) {
    throw new Error("未选择图片生成模型，请先在弹框中选择一个模型后再生成");
  }
  // 按所选模型所属供应商解析凭证（跨供应商生成）；缺省回退当前激活供应商
  const creds = await resolveImageCredentials(cfg.provider);
  if (!creds || !creds.apiKey) {
    throw new Error("未配置图片生成 API，请先在「图片 API 设置」中填写");
  }
  const model = cfg.model || IMAGE_PROVIDER_PRESETS[creds.provider]?.model || "";
  // 能力查询使用该供应商的模型列表（同一模型名在不同供应商下能力可能不同，如 gpt-image-2）
  const providerModels = await getImageModels(creds.provider);
  const cap = getImageModelCapability(model, providerModels, creds.provider);
  const isApimart = creds.provider === "apimart";
  const body: ImageProxyRequest = {
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
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

  // 支持轮询的模型：异步创建 + 订阅服务端任务中心
  if (cap.supportsPolling) {
    body.asyncMode = true;
    if (options?.cosPrefix) body.cosPrefix = options.cosPrefix;
    // 提交请求故意不绑定组件 signal：提交是秒级操作，且服务端在响应前已把任务
    // 注册进任务中心。若绑定 signal，切页时 fetch 被取消会导致上游任务已创建
    // 但 jobId 永远丢失（任务无人认领）。
    const createRes = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
    // 立即回调，让调用方持久化 jobId（刷新页面后可恢复订阅）
    onJobCreated?.(created.jobId);
    // 订阅服务端任务中心至完成（signal 仅取消前端等待，服务端任务继续，jobId 保留供恢复）
    const final = await waitImageTask(created.jobId, signal);
    // 默认供应商未配置 apiKey 时，把本次使用的供应商+模型落盘为默认（首次生成生效）
    void persistDefaultImageIfProviderUnconfigured({ ...cfg, model, provider: creds.provider });
    return { imageUrl: final.imageUrl, model };
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
  // 默认供应商未配置 apiKey 时，把本次使用的供应商+模型落盘为默认（首次生成生效）
  void persistDefaultImageIfProviderUnconfigured({ ...cfg, model, provider: creds.provider });
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
  provider: ImageGenSettings["provider"] = "apimart"
): Promise<ImageQueryProxyResponse> {
  const start = Date.now();
  // 进入循环前若已取消，直接返回（保留 jobId 供恢复轮询）
  if (signal?.aborted) {
    return { status: "expired", error: "已取消" };
  }
  while (Date.now() - start < timeoutMs) {
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
    // 取消信号到达后，再做最后一次查询：上游任务可能此刻已完成，
    // 优先返回真实结果，避免切页/卸载中止轮询导致已生成图片被丢弃。
    if (signal?.aborted) {
      const final = await queryImageTask(jobId, apiKey, baseURL, provider);
      onUpdate?.(final);
      if (final.status === "done" || final.status === "failed") {
        return final;
      }
      return { status: "expired", error: "已取消" };
    }
  }
  return { status: "expired", error: "轮询超时" };
}

const WAIT_TASK_INTERVAL_MS = 3000;
/** 前端订阅上限（大于服务端 30 分钟硬超时；服务端 expired 会先触发自动重试） */
const WAIT_TASK_TIMEOUT_MS = 35 * 60 * 1000;

function waitInterruptible(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

/**
 * 订阅服务端图片任务中心的任务状态直到终态。
 * - 仅服务端明确返回 failed / expired（自动重试一次后仍 expired）才抛错；
 *   本地 API 瞬态失败（服务重启/抖动）不计终态，下一轮继续。
 * - signal abort 时抛 "已取消"：仅停止前端等待，服务端任务继续，jobId 保留供恢复。
 */
export async function waitImageTask(
  jobId: string,
  signal?: AbortSignal,
  onUpdate?: (task: ImageTaskRecord) => void
): Promise<ImageProxyResponse> {
  const start = Date.now();
  let expiredRetried = false;
  let missingCount = 0;
  while (Date.now() - start < WAIT_TASK_TIMEOUT_MS) {
    if (signal?.aborted) throw new Error("已取消");
    let task: ImageTaskRecord | undefined;
    try {
      const { tasks } = await apiClient.getImageTasks([jobId]);
      task = tasks[0];
    } catch {
      await waitInterruptible(WAIT_TASK_INTERVAL_MS, signal);
      continue;
    }
    if (!task) {
      missingCount += 1;
      if (missingCount >= 20) throw new Error("任务记录不存在或已过期清理");
      await waitInterruptible(WAIT_TASK_INTERVAL_MS, signal);
      continue;
    }
    missingCount = 0;
    onUpdate?.(task);
    if (task.status === "done" && task.imageUrl) {
      return { imageUrl: task.imageUrl };
    }
    if (task.status === "failed") {
      throw new Error(task.error || "图片生成失败");
    }
    if (task.status === "expired") {
      if (!expiredRetried) {
        expiredRetried = true;
        try {
          await apiClient.retryImageTask(jobId);
        } catch { /* ignore */ }
        await waitInterruptible(WAIT_TASK_INTERVAL_MS, signal);
        continue;
      }
      throw new Error(task.error || "图片生成超时");
    }
    await waitInterruptible(WAIT_TASK_INTERVAL_MS, signal);
  }
  throw new Error("等待图片任务超时");
}

/**
 * 恢复图片任务订阅（页面刷新/切页后，对已创建但未完成的任务恢复等待）。
 * attach 到服务端任务中心（幂等：已注册为空操作，未注册则登记并由服务端接管轮询），
 * 随后订阅至终态。任务已完成时直接返回结果。
 * @param jobId 已持久化的任务 ID
 * @param provider 创建该任务时使用的供应商（按此解析凭证，支持跨供应商恢复；缺省回退当前激活供应商）
 * @param onUpdate 状态回调（可选）
 * @param signal AbortSignal（可选；仅取消前端等待，任务不丢）
 * @returns 成功时返回 ImageProxyResponse，失败/超时抛出错误
 */
export async function resumeImageGeneration(
  jobId: string,
  provider?: ImageGenSettings["provider"],
  onUpdate?: (task: ImageTaskRecord) => void,
  signal?: AbortSignal
): Promise<ImageProxyResponse> {
  const creds = await resolveImageCredentials(provider);
  if (!creds || !creds.apiKey) {
    throw new Error("未配置图片生成 API，请先在「图片 API 设置」中填写");
  }
  const { task } = await apiClient.attachImageTask({
    jobId,
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
  });
  if (task.status === "done" && task.imageUrl) {
    return { imageUrl: task.imageUrl };
  }
  if (task.status === "failed") {
    // 存量失败任务自动重试一次（旧版可能把瞬态错误误判为失败）
    try {
      await apiClient.retryImageTask(jobId);
    } catch { /* ignore */ }
  }
  return waitImageTask(jobId, signal, onUpdate);
}

/**
 * 获取当前模型是否支持轮询（供 UI 判断是否需要恢复轮询）。
 * 能力查询走代码注册表（IMAGE_MODEL_CAPABILITIES_BY_PROVIDER / IMAGE_MODEL_CAPABILITIES），
 * 覆盖同一模型名在不同供应商下的差异（如 gpt-image-2）。
 */
export function isPollingSupported(model: string, provider?: string): boolean {
  return getImageModelCapability(model, undefined, provider).supportsPolling ?? false;
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
