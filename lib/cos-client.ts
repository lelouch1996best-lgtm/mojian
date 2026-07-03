import type { CosSettings } from "@/lib/types";
import { apiClient } from "@/lib/api-client";

const COS_STORAGE_KEY = "mojian_cos_settings";
const STORAGE_MODE = process.env.NEXT_PUBLIC_STORAGE_MODE;

/** 从 localStorage 读取 COS 配置 */
export async function getCosSettings(): Promise<CosSettings | null> {
  if (STORAGE_MODE === "server") {
    try { return await apiClient.getSetting<CosSettings>("cos"); } catch { return null; }
  }
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(COS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CosSettings) : null;
  } catch {
    return null;
  }
}

/** 保存 COS 配置到 localStorage */
export async function saveCosSettings(settings: CosSettings): Promise<void> {
  if (STORAGE_MODE === "server") {
    await apiClient.saveSetting("cos", settings);
    return;
  }
  if (typeof window === "undefined") return;
  localStorage.setItem(COS_STORAGE_KEY, JSON.stringify(settings));
}

/** 检查 COS 配置是否完整 */
export async function isCosConfigured(): Promise<boolean> {
  const s = await getCosSettings();
  return !!(s?.secretId && s?.secretKey && s?.bucket && s?.region);
}

/** 生成 COS 对象的公网访问 URL */
export function buildCosPublicUrl(
  key: string,
  settings: CosSettings
): string {
  if (settings.customDomain) {
    const base = settings.customDomain.replace(/\/+$/, "");
    return `${base}/${key}`;
  }
  return `https://${settings.bucket}.cos.${settings.region}.myqcloud.com/${key}`;
}

/** COS 上传请求体 */
export interface CosUploadRequest {
  base64: string; // data:image/...;base64,... 或纯 base64
  fileName: string; // 文件名（含扩展名），如 "character-xiaoming.png"
  settings: CosSettings;
}

/** COS 上传响应 */
export interface CosUploadResponse {
  url: string; // 公网访问 URL
  key: string; // COS 对象 key
  bucket: string;
  region: string;
}
