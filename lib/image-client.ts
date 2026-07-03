import type {
  ImageGenSettings,
  ImageProxyRequest,
  ImageProxyResponse,
} from "./types";
import { apiClient } from "./api-client";

const SETTINGS_KEY = "ai-script-image-settings";
const STORAGE_MODE = process.env.NEXT_PUBLIC_STORAGE_MODE;

/** 火山引擎 Seedream 模型预设 */
export const IMAGE_MODEL_PRESETS: {
  value: string;
  label: string;
  hint?: string;
}[] = [
  {
    value: "doubao-seedream-5-0-260128",
    label: "Doubao Seedream 5.0 lite",
    hint: "最新，支持 png/jpeg、组图、联网搜索",
  },
  {
    value: "doubao-seedream-5-0-lite-260128",
    label: "Doubao Seedream 5.0 lite (别名)",
  },
  {
    value: "doubao-seedream-4-5-251128",
    label: "Doubao Seedream 4.5",
    hint: "支持多图融合、组图",
  },
  {
    value: "doubao-seedream-4-0-250828",
    label: "Doubao Seedream 4.0",
    hint: "支持多图融合、组图",
  },
];

export const SIZE_PRESETS = ["2K", "3K", "4K", "2048x2048", "2304x1728", "1728x2304", "2848x1600", "1600x2848"];

export const DEFAULT_IMAGE_SETTINGS: ImageGenSettings = {
  apiKey: "",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  model: "doubao-seedream-5-0-260128",
  size: "2K",
  outputFormat: "png",
  watermark: false,
  responseFormat: "url",
};

export async function getImageSettings(): Promise<ImageGenSettings | null> {
  if (STORAGE_MODE === "server") {
    try { return await apiClient.getSetting<ImageGenSettings>("image"); } catch { return null; }
  }
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ImageGenSettings>;
    return { ...DEFAULT_IMAGE_SETTINGS, ...parsed };
  } catch {
    return null;
  }
}

export async function saveImageSettings(s: ImageGenSettings): Promise<void> {
  const normalized: ImageGenSettings = {
    ...s,
    baseURL: s.baseURL.replace(/\/+$/, ""),
  };
  if (STORAGE_MODE === "server") {
    await apiClient.saveSetting("image", normalized);
    return;
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
}

/**
 * 调用图片生成 API。
 * @param prompt 图片生成提示词
 * @returns ImageProxyResponse，imageUrl 可能是 URL 或 data URI
 */
export async function generateImage(prompt: string): Promise<ImageProxyResponse> {
  const s = await getImageSettings();
  if (!s || !s.apiKey) {
    throw new Error("未配置图片生成 API，请先在「图片 API 设置」中填写");
  }
  const body: ImageProxyRequest = {
    apiKey: s.apiKey,
    baseURL: s.baseURL,
    model: s.model,
    prompt,
    size: s.size,
    outputFormat: s.outputFormat,
    watermark: s.watermark,
    responseFormat: s.responseFormat,
  };
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
        apiKey: s.apiKey,
        baseURL: s.baseURL.replace(/\/+$/, ""),
        model: s.model,
        prompt: "一只可爱的小猫，写实风格",
        size: s.size || "2K",
        outputFormat: s.outputFormat,
        watermark: s.watermark,
        responseFormat: s.responseFormat,
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
