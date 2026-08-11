import { getDb } from "./db";
import { readCosSettingsFromDb, transferToCos } from "./cos-transfer";
import { readQiniuSettingsFromDb, transferToQiniu } from "./qiniu-transfer";
import type { StorageProvider } from "./types";

/**
 * 从 settings 表读取当前存储供应商，默认 "cos"。
 * 兼容字符串原始存储与 JSON 序列化两种形式。
 */
export function readStorageProviderFromDb(): StorageProvider {
  try {
    const row = getDb()
      .prepare("SELECT value FROM settings WHERE key = 'storageProvider'")
      .get() as { value: string } | undefined;
    if (!row?.value) return "cos";
    try {
      const parsed = JSON.parse(row.value);
      return parsed === "qiniu" ? "qiniu" : "cos";
    } catch {
      return row.value === "qiniu" ? "qiniu" : "cos";
    }
  } catch {
    return "cos";
  }
}

/** 当前供应商的存储是否已配置（服务端，用于图片任务中心决定是否转存） */
export function isStorageConfiguredInDb(): boolean {
  if (readStorageProviderFromDb() === "qiniu") {
    return readQiniuSettingsFromDb() !== null;
  }
  return readCosSettingsFromDb() !== null;
}

/**
 * 按当前存储供应商转存远程文件，返回公开 URL 与对象 key。
 * 未配置或上传失败时抛出 Error。
 */
export async function transferToStorage(
  sourceUrl: string,
  prefix: string
): Promise<{ url: string; key: string }> {
  const provider = readStorageProviderFromDb();
  if (provider === "qiniu") {
    const s = readQiniuSettingsFromDb();
    if (!s) throw new Error("未配置七牛云存储");
    return transferToQiniu(s, sourceUrl, prefix);
  }
  const s = readCosSettingsFromDb();
  if (!s) throw new Error("未配置 COS 存储");
  return transferToCos(s, sourceUrl, prefix);
}
