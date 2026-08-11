import type { CosSettings, QiniuSettings, StorageProvider } from "@/lib/types";
import { apiClient } from "@/lib/api-client";

// ============ 存储供应商 ============

/** 读取当前存储供应商，默认 "cos" */
export async function getStorageProvider(): Promise<StorageProvider> {
  try {
    const v = await apiClient.getSetting<StorageProvider>("storageProvider");
    return v === "qiniu" ? "qiniu" : "cos";
  } catch {
    return "cos";
  }
}

/** 保存当前存储供应商 */
export async function saveStorageProvider(provider: StorageProvider): Promise<void> {
  await apiClient.saveSetting("storageProvider", provider);
}

// ============ COS 配置 ============

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

// ============ 七牛云 Kodo 配置 ============

/** 读取七牛云配置 */
export async function getQiniuSettings(): Promise<QiniuSettings | null> {
  try { return await apiClient.getSetting<QiniuSettings>("qiniu"); } catch { return null; }
}

/** 保存七牛云配置 */
export async function saveQiniuSettings(settings: QiniuSettings): Promise<void> {
  await apiClient.saveSetting("qiniu", settings);
}

/** 检查七牛云配置是否完整 */
export async function isQiniuConfigured(): Promise<boolean> {
  const s = await getQiniuSettings();
  return !!(s?.accessKey && s?.secretKey && s?.bucket && s?.domain);
}

/** 生成七牛对象的公开访问 URL */
export function buildQiniuPublicUrl(key: string, settings: QiniuSettings): string {
  const base = (settings.domain || "").replace(/\/+$/, "");
  return `${base}/${key}`;
}

// ============ 存储统一接口（按供应商分发） ============

/** 检查当前存储供应商是否已配置 */
export async function isStorageConfigured(): Promise<boolean> {
  const provider = await getStorageProvider();
  return provider === "qiniu" ? isQiniuConfigured() : isCosConfigured();
}

/** COS 上传请求体 */
export interface CosUploadRequest {
  base64: string; // data:image/...;base64,... 或纯 base64
  fileName: string; // 文件名（含扩展名），如 "character-xiaoming.png"
  settings: CosSettings;
}

/** 七牛上传请求体 */
export interface QiniuUploadRequest {
  base64: string;
  fileName: string;
  settings: QiniuSettings;
}

/** COS 上传响应 */
export interface CosUploadResponse {
  url: string; // 公网访问 URL
  key: string; // COS 对象 key
  bucket: string;
  region: string;
}

/** 转存/上传结果 */
export interface TransferResult {
  url: string;
  key: string;
}

/** 将远程图片转存到 COS，返回公网 URL 与 key */
async function transferAssetToCos(
  sourceUrl: string,
  prefix?: string
): Promise<TransferResult> {
  const settings = await getCosSettings();
  if (!settings) throw new Error("未配置 COS 存储");
  const res = await fetch("/api/cos/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceUrl,
      settings,
      prefix: prefix ?? "ai-script/assets",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error ?? "转存失败");
  return { url: data.url, key: data.key };
}

/** 将远程图片转存到七牛，返回公网 URL 与 key */
async function transferAssetToQiniu(
  sourceUrl: string,
  prefix?: string
): Promise<TransferResult> {
  const settings = await getQiniuSettings();
  if (!settings) throw new Error("未配置七牛云存储");
  const res = await fetch("/api/qiniu/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceUrl,
      settings,
      prefix: prefix ?? "ai-script/assets",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error ?? "转存失败");
  return { url: data.url, key: data.key };
}

/** 将远程图片转存到当前存储供应商，返回公网 URL 与 key */
export async function transferAsset(
  sourceUrl: string,
  prefix?: string
): Promise<TransferResult> {
  const provider = await getStorageProvider();
  return provider === "qiniu"
    ? transferAssetToQiniu(sourceUrl, prefix)
    : transferAssetToCos(sourceUrl, prefix);
}

/** 将 base64 data URI 上传到 COS，返回公网 URL 与 key */
async function uploadBase64ToCos(
  base64: string,
  fileName: string
): Promise<TransferResult> {
  const settings = await getCosSettings();
  if (!settings) throw new Error("未配置 COS 存储");
  const res = await fetch("/api/cos/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64, fileName, settings }),
  });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error ?? "上传失败");
  return { url: data.url, key: data.key };
}

/** 将 base64 data URI 上传到七牛，返回公网 URL 与 key */
async function uploadBase64ToQiniu(
  base64: string,
  fileName: string
): Promise<TransferResult> {
  const settings = await getQiniuSettings();
  if (!settings) throw new Error("未配置七牛云存储");
  const res = await fetch("/api/qiniu/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64, fileName, settings }),
  });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error ?? "上传失败");
  return { url: data.url, key: data.key };
}

/** 将 base64 data URI 上传到当前存储供应商，返回公网 URL 与 key */
export async function uploadBase64(
  base64: string,
  fileName: string
): Promise<TransferResult> {
  const provider = await getStorageProvider();
  return provider === "qiniu"
    ? uploadBase64ToQiniu(base64, fileName)
    : uploadBase64ToCos(base64, fileName);
}

/**
 * 将本地文件上传到存储，返回公网 URL。
 * 用于视频卡片上传参考视频/音频/尾帧图等参考素材。
 * @param file 用户选择的文件
 * @param nameHint 文件名提示（不含扩展名），用于生成可读的 key
 */
export async function uploadRefFile(file: File, nameHint: string): Promise<string> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
  const ext = file.name.split(".").pop() ?? "bin";
  const result = await uploadBase64(base64, `${nameHint}.${ext}`);
  return result.url;
}

/**
 * 将 base64 data URI 上传到存储，返回公网 URL。
 * 用于图片弹框参考图持久化。
 * @param base64 data:image/...;base64,... 格式的 base64 字符串
 * @param nameHint 文件名提示（不含扩展名），用于生成可读的 key
 */
export async function uploadRefBase64(base64: string, nameHint: string): Promise<string> {
  const ext = base64.match(/data:image\/([\w.+-]+)/)?.[1] ?? "png";
  const result = await uploadBase64(base64, `${nameHint}.${ext}`);
  return result.url;
}
