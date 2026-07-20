import type { CosSettings } from "@/lib/types";
import { apiClient } from "@/lib/api-client";

/** 读取 COS 配置 */
export async function getCosSettings(): Promise<CosSettings | null> {
  try { return await apiClient.getSetting<CosSettings>("cos"); } catch { return null; }
}

/** 保存 COS 配置 */
export async function saveCosSettings(settings: CosSettings): Promise<void> {
  await apiClient.saveSetting("cos", settings);
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

/**
 * 将本地文件上传到 COS，返回公网 URL。
 * 用于视频卡片上传参考视频/音频/尾帧图等参考素材。
 * @param file 用户选择的文件
 * @param nameHint 文件名提示（不含扩展名），用于生成可读的 key
 */
export async function uploadRefFile(file: File, nameHint: string): Promise<string> {
  return (await import("./storage-provider")).uploadRefFile(file, nameHint);
}

/**
 * 将 base64 data URI 上传到 COS，返回公网 URL。
 * 用于图片弹框参考图持久化。
 * @param base64 data:image/...;base64,... 格式的 base64 字符串
 * @param nameHint 文件名提示（不含扩展名），用于生成可读的 key
 */
export async function uploadRefBase64(base64: string, nameHint: string): Promise<string> {
  return (await import("./storage-provider")).uploadRefBase64(base64, nameHint);
}
