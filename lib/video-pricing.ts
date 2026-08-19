import type { VideoResolution, VideoGenSettings } from "./types";
import { apiClient } from "./api-client";

/**
 * 视频生成费用估算
 *
 * 价格数据来源于各供应商官方刊例价（网络搜索确认），按每秒单价（元/秒）存储。
 * 仅用于预估展示，实际费用以 API 返回的 usage 为准。
 */

/** 每秒单价条目 */
export interface VideoPriceRate {
  /** 每秒单价（元/秒） */
  perSecond: number;
  /** 数据来源 */
  source?: string;
}

/** 价格表条目（三种类型） */
export type VideoPriceEntry =
  | { kind: "rate"; rates: Partial<Record<VideoResolution, VideoPriceRate>> }
  | { kind: "subscription"; label: string }
  | { kind: "unknown" };

/**
 * 价格表：provider → model(value) → entry
 *
 * ark-plan / custom 在 estimateVideoCost 中统一处理，不在此逐模型配置。
 */
export const VIDEO_PRICE_TABLE: Partial<Record<VideoGenSettings["provider"], Record<string, VideoPriceEntry>>> = {
  ark: {
    // Seedance 2.0 标准版 — 火山方舟刊例 46元/百万token(480p/720p), 51元/百万token(1080p)
    "doubao-seedance-2-0-260128": {
      kind: "rate",
      rates: {
        "480p": { perSecond: 0.46, source: "火山方舟刊例 46元/百万token" },
        "720p": { perSecond: 0.99, source: "火山方舟刊例 46元/百万token" },
        "1080p": { perSecond: 2.48, source: "火山方舟刊例 51元/百万token" },
      },
    },
    // Seedance 2.0 fast — AFP系数 0.80×标准版
    "doubao-seedance-2-0-fast-260128": {
      kind: "rate",
      rates: {
        "480p": { perSecond: 0.37, source: "AFP系数 0.80×标准版" },
        "720p": { perSecond: 0.80, source: "AFP系数 0.80×标准版" },
      },
    },
    // Seedance 2.0 mini — AFP系数 0.50×标准版
    "doubao-seedance-2-0-mini-260615": {
      kind: "rate",
      rates: {
        "480p": { perSecond: 0.23, source: "AFP系数 0.50×标准版" },
        "720p": { perSecond: 0.50, source: "AFP系数 0.50×标准版" },
      },
    },
    // Seedance 1.5 Pro（有声）— 火山引擎套餐计费 1.72/3.44算点/秒
    "doubao-seedance-1-5-pro-251215": {
      kind: "rate",
      rates: {
        "480p": { perSecond: 0.17, source: "火山引擎套餐计价 有声 1.72算点/秒" },
        "720p": { perSecond: 0.34, source: "火山引擎套餐计价 有声 3.44算点/秒" },
        "1080p": { perSecond: 0.86, source: "按720p×2.5估算" },
      },
    },
    // Seedance 1.0 Pro — 火山引擎套餐计费 1.4/2.8/7算点/秒
    "doubao-seedance-1-0-pro-250528": {
      kind: "rate",
      rates: {
        "480p": { perSecond: 0.14, source: "火山引擎套餐计价 1.4算点/秒" },
        "720p": { perSecond: 0.28, source: "火山引擎套餐计价 2.8算点/秒" },
        "1080p": { perSecond: 0.70, source: "火山引擎套餐计价 7算点/秒" },
      },
    },
    // Seedance 1.0 Pro Fast — 火山引擎套餐计费 0.4/0.8/2算点/秒
    "doubao-seedance-1-0-pro-fast-251015": {
      kind: "rate",
      rates: {
        "480p": { perSecond: 0.04, source: "火山引擎套餐计价 0.4算点/秒" },
        "720p": { perSecond: 0.08, source: "火山引擎套餐计价 0.8算点/秒" },
        "1080p": { perSecond: 0.20, source: "火山引擎套餐计价 2算点/秒" },
      },
    },
  },
  apimart: {
    // APIMart Seedance 2.0 — 美元按秒计费，1 USD ≈ 7 CNY
    // 来源: CSDN 拆解 480P $0.11/sec, 720P 标准版 $0.236/sec
    "doubao-seedance-2.0": {
      kind: "rate",
      rates: {
        "480p": { perSecond: 0.77, source: "APIMart $0.11/秒 (1USD≈7CNY)" },
        "720p": { perSecond: 1.65, source: "APIMart $0.236/秒 (1USD≈7CNY)" },
        "1080p": { perSecond: 3.50, source: "按720p×2.12估算" },
      },
    },
    // APIMart Seedance 2.0 fast — 720P FAST $0.19/sec
    "doubao-seedance-2.0-fast": {
      kind: "rate",
      rates: {
        "480p": { perSecond: 0.62, source: "按720p比例估算 $0.088/秒" },
        "720p": { perSecond: 1.33, source: "APIMart 720P FAST $0.19/秒" },
      },
    },
    // APIMart Seedance 2.0 mini — apipod.ai $0.060/sec 不分分辨率
    "doubao-seedance-2.0-mini": {
      kind: "rate",
      rates: {
        "480p": { perSecond: 0.42, source: "APIMart $0.060/秒 不分分辨率" },
        "720p": { perSecond: 0.42, source: "APIMart $0.060/秒 不分分辨率" },
      },
    },
    // APIMart Grok Imagine 1.5 — xAI 官方价 grok-imagine-video-1.5
    "grok-imagine-1.5-video-apimart": {
      kind: "rate",
      rates: {
        "480p": { perSecond: 0.56, source: "xAI官方价 $0.08/秒" },
        "720p": { perSecond: 0.98, source: "xAI官方价 $0.14/秒" },
      },
    },
    // APIMart wan2.7 — apipod.ai $0.120/sec 不分分辨率
    "wan2.7": {
      kind: "rate",
      rates: {
        "720P": { perSecond: 0.84, source: "APIMart $0.120/秒 不分分辨率" },
        "1080P": { perSecond: 0.84, source: "APIMart $0.120/秒 不分分辨率" },
      },
    },
    // APIMart MiniMax-H3 — 仅 2K，apipod.ai t2v/i2v $0.140/sec
    "MiniMax-H3": {
      kind: "rate",
      rates: {
        "2K": { perSecond: 0.98, source: "APIMart $0.140/秒 (t2v/i2v)" },
      },
    },
  },
};

/** 费用估算结果 */
export interface VideoCostEstimate {
  /** 预估总费用（元），null 表示无法计算 */
  amount: number | null;
  /** 每秒单价（元），null 表示未知 */
  perSecond: number | null;
  /** 显示文案 */
  label: string;
  /** 费用明细，如 "¥0.99/秒 × 5秒" */
  breakdown?: string;
  /** 补充说明 */
  note?: string;
}

/**
 * 估算视频生成费用
 *
 * @param provider 供应商 key（ark / ark-plan / apimart / custom）
 * @param model 模型 value（如 "doubao-seedance-2-0-260128"）
 * @param resolution 输出分辨率（如 "720p"、"1080P"）
 * @param durationSeconds 时长（秒），-1 表示模型自动
 */
export function estimateVideoCost(
  provider: string | undefined,
  model: string,
  resolution: VideoResolution,
  durationSeconds: number
): VideoCostEstimate {
  // 1. ark-plan → 套餐制
  if (provider === "ark-plan") {
    return {
      amount: null,
      perSecond: null,
      label: "套餐制（AFP 积分计费）",
      note: "Agent Plan 套餐订阅，不按条计费",
    };
  }

  // 2. custom → 未知
  if (provider === "custom") {
    return {
      amount: null,
      perSecond: null,
      label: "价格未知",
      note: "自定义 API 端点，无法预估费用",
    };
  }

  // 3. 时长无效或自动
  if (durationSeconds <= 0 || !Number.isFinite(durationSeconds)) {
    return {
      amount: null,
      perSecond: null,
      label: "费用待定",
      note: durationSeconds === -1 ? "时长为自动模式，最终费用以实际生成为准" : "请设置有效时长",
    };
  }

  // 4. 查价格表
  const providerTable = VIDEO_PRICE_TABLE[provider as keyof typeof VIDEO_PRICE_TABLE];
  const entry = providerTable?.[model];

  if (!entry || entry.kind === "unknown") {
    return { amount: null, perSecond: null, label: "价格待补充", note: "该模型定价数据暂未收录" };
  }

  if (entry.kind === "subscription") {
    return { amount: null, perSecond: null, label: entry.label };
  }

  // kind === "rate"
  const rate = entry.rates[resolution];
  if (!rate) {
    return { amount: null, perSecond: null, label: "价格待补充", note: `该模型在 ${resolution} 分辨率下定价暂未收录` };
  }

  const amount = rate.perSecond * durationSeconds;
  return {
    amount,
    perSecond: rate.perSecond,
    label: `¥${amount.toFixed(2)}`,
    breakdown: `¥${rate.perSecond}/秒 × ${durationSeconds}秒`,
    note: "价格仅供参考，实际以 API 返回为准",
  };
}

// ─── 用户价格表（可编辑，持久化到 setting） ───────────────────────────

export const VIDEO_PRICES_SETTING_KEY = "video_prices";

/** 用户价格表全量结构：provider → model(value) → entry */
export type UserVideoPriceTable = Partial<Record<VideoGenSettings["provider"], Record<string, VideoPriceEntry>>>;

/**
 * 读取某 provider 的用户价格表。
 * 未保存过返回 undefined（调用方应回退到 VIDEO_PRICE_TABLE 默认）。
 */
export async function getUserVideoPriceTable(
  provider: VideoGenSettings["provider"]
): Promise<Record<string, VideoPriceEntry> | undefined> {
  try {
    const all = await apiClient.getSetting<UserVideoPriceTable>(VIDEO_PRICES_SETTING_KEY);
    return all?.[provider];
  } catch {
    return undefined;
  }
}

/**
 * 保存某 provider 的价格表（与现有 setting 合并后保存）。
 */
export async function saveUserVideoPriceTable(
  provider: VideoGenSettings["provider"],
  table: Record<string, VideoPriceEntry>
): Promise<void> {
  let all: UserVideoPriceTable = {};
  try {
    all = (await apiClient.getSetting<UserVideoPriceTable>(VIDEO_PRICES_SETTING_KEY)) ?? {};
  } catch { /* ignore */ }
  all[provider] = table;
  await apiClient.saveSetting(VIDEO_PRICES_SETTING_KEY, all);
}

/**
 * 删除某 provider 的用户价格表（回退到内置默认）。
 */
export async function resetUserVideoPriceTable(
  provider: VideoGenSettings["provider"]
): Promise<void> {
  let all: UserVideoPriceTable = {};
  try {
    all = (await apiClient.getSetting<UserVideoPriceTable>(VIDEO_PRICES_SETTING_KEY)) ?? {};
  } catch { /* ignore */ }
  delete all[provider];
  await apiClient.saveSetting(VIDEO_PRICES_SETTING_KEY, all);
}

/**
 * 获取某 provider 的生效价格表：优先用户保存的，否则内置默认。
 */
export function getEffectivePriceTable(
  provider: string | undefined,
  userTable?: Record<string, VideoPriceEntry>
): Record<string, VideoPriceEntry> | undefined {
  if (userTable) return userTable;
  return VIDEO_PRICE_TABLE[provider as keyof typeof VIDEO_PRICE_TABLE];
}

/**
 * 带用户价格表的费用估算（同步）。
 * 确认弹框组件应预加载 userTable 后调用本函数。
 */
export function estimateVideoCostWith(
  provider: string | undefined,
  model: string,
  resolution: VideoResolution,
  durationSeconds: number,
  userTable?: Record<string, VideoPriceEntry>
): VideoCostEstimate {
  // 1. ark-plan → 套餐制
  if (provider === "ark-plan") {
    return {
      amount: null,
      perSecond: null,
      label: "套餐制（AFP 积分计费）",
      note: "Agent Plan 套餐订阅，不按条计费",
    };
  }

  // 2. custom → 未知
  if (provider === "custom") {
    return {
      amount: null,
      perSecond: null,
      label: "价格未知",
      note: "自定义 API 端点，无法预估费用",
    };
  }

  // 3. 时长无效或自动
  if (durationSeconds <= 0 || !Number.isFinite(durationSeconds)) {
    return {
      amount: null,
      perSecond: null,
      label: "费用待定",
      note: durationSeconds === -1 ? "时长为自动模式，最终费用以实际生成为准" : "请设置有效时长",
    };
  }

  // 4. 查生效价格表（优先用户表）
  const table = getEffectivePriceTable(provider, userTable);
  const entry = table?.[model];

  if (!entry || entry.kind === "unknown") {
    return { amount: null, perSecond: null, label: "价格待补充", note: "该模型定价数据暂未收录" };
  }

  if (entry.kind === "subscription") {
    return { amount: null, perSecond: null, label: entry.label };
  }

  // kind === "rate"
  const rate = entry.rates[resolution];
  if (!rate) {
    return { amount: null, perSecond: null, label: "价格待补充", note: `该模型在 ${resolution} 分辨率下定价暂未收录` };
  }

  const amount = rate.perSecond * durationSeconds;
  return {
    amount,
    perSecond: rate.perSecond,
    label: `¥${amount.toFixed(2)}`,
    breakdown: `¥${rate.perSecond}/秒 × ${durationSeconds}秒`,
    note: "价格仅供参考，实际以 API 返回为准",
  };
}
