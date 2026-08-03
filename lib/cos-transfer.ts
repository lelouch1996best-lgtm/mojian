import { getDb } from "./db";
import { buildCosPublicUrl } from "./cos-client";
import type { CosSettings } from "./types";

/** ContentType → 扩展名映射 */
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-msvideo": "avi",
};

/** 从 URL 中尝试提取扩展名 */
function guessExtFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/**
 * 从 settings 表直接读取 COS 配置（服务端使用，不经过 HTTP API）。
 * 未配置或字段不完整时返回 null。
 */
export function readCosSettingsFromDb(): CosSettings | null {
  try {
    const row = getDb()
      .prepare("SELECT value FROM settings WHERE key = 'cos'")
      .get() as { value: string } | undefined;
    if (!row?.value) return null;
    const s = JSON.parse(row.value) as Partial<CosSettings>;
    if (!s.secretId || !s.secretKey || !s.bucket || !s.region) return null;
    return {
      secretId: s.secretId,
      secretKey: s.secretKey,
      bucket: s.bucket,
      region: s.region,
      customDomain: s.customDomain,
    };
  } catch {
    return null;
  }
}

/**
 * 下载 sourceUrl 对应的文件并转存到 COS，返回公网 URL 与对象 key。
 * 供 /api/cos/transfer 路由与服务端图片任务中心共用。失败抛出 Error。
 */
export async function transferToCos(
  settings: CosSettings,
  sourceUrl: string,
  prefix: string
): Promise<{ url: string; key: string }> {
  let response: Response;
  try {
    response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(5 * 60 * 1000), // 5 分钟超时（视频可能较大）
    });
  } catch (e) {
    throw new Error(`下载源文件失败：${(e as Error).message}`);
  }

  if (!response.ok) {
    throw new Error(`下载源文件失败：HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const ext = MIME_TO_EXT[contentType] ?? guessExtFromUrl(sourceUrl) ?? "png";

  let buffer: Buffer;
  try {
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch {
    throw new Error("读取源文件数据失败");
  }

  const COS = await import("cos-nodejs-sdk-v5");
  const cos = new (COS.default as typeof COS.default)({
    SecretId: settings.secretId,
    SecretKey: settings.secretKey,
  });

  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const key = `${prefix.replace(/\/+$/, "")}/${timestamp}-${random}.${ext}`;

  try {
    await cos.putObject({
      Bucket: settings.bucket,
      Region: settings.region,
      Key: key,
      Body: buffer,
      ContentType: contentType || undefined,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`COS 上传失败：${msg}`);
  }

  return { url: buildCosPublicUrl(key, settings), key };
}
