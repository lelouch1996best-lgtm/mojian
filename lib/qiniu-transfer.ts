import { getDb } from "./db";
import type { QiniuSettings } from "./types";

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

/** 生成七牛对象的公开访问 URL */
export function buildQiniuPublicUrl(key: string, settings: QiniuSettings): string {
  const base = (settings.domain || "").replace(/\/+$/, "");
  return `${base}/${key}`;
}

/**
 * 从 settings 表直接读取七牛配置（服务端使用，不经过 HTTP API）。
 * 未配置或字段不完整时返回 null。
 */
export function readQiniuSettingsFromDb(): QiniuSettings | null {
  try {
    const row = getDb()
      .prepare("SELECT value FROM settings WHERE key = 'qiniu'")
      .get() as { value: string } | undefined;
    if (!row?.value) return null;
    const s = JSON.parse(row.value) as Partial<QiniuSettings>;
    if (!s.accessKey || !s.secretKey || !s.bucket || !s.domain) return null;
    return {
      accessKey: s.accessKey,
      secretKey: s.secretKey,
      bucket: s.bucket,
      region: s.region ?? "z0",
      domain: s.domain,
    };
  } catch {
    return null;
  }
}

/**
 * 下载 sourceUrl 对应的文件并转存到七牛，返回公开 URL 与对象 key。
 * 供 /api/qiniu/transfer 路由与服务端图片任务中心共用。失败抛出 Error。
 */
export async function transferToQiniu(
  settings: QiniuSettings,
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
    buffer = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new Error("读取源文件数据失败");
  }

  // 动态导入七牛 SDK（避免客户端 bundle 包含服务端 SDK）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qiniu: any = await import("qiniu");

  const mac = new qiniu.auth.digest.Mac(settings.accessKey, settings.secretKey);
  const putPolicy = new qiniu.rs.PutPolicy({ scope: settings.bucket });
  const uploadToken = putPolicy.uploadToken(mac);

  const config = new qiniu.conf.Config();
  if (settings.region) {
    try {
      // regionsProvider 优先于已弃用的 zone；无效 regionId 时回退自动查询
      config.regionsProvider = qiniu.httpc.Region.fromRegionId(settings.region);
    } catch {
      // 忽略：SDK 将通过 AK+Bucket 自动查询区域
    }
  }

  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const key = `${prefix.replace(/\/+$/, "")}/${timestamp}-${random}.${ext}`;

  const formUploader = new qiniu.form_up.FormUploader(config);
  const putExtra = new qiniu.form_up.PutExtra();
  if (contentType) putExtra.mimeType = contentType;

  try {
    const { resp } = await formUploader.put(uploadToken, key, buffer, putExtra);
    if (resp.statusCode !== 200) {
      throw new Error(`七牛返回状态码 ${resp.statusCode}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`七牛上传失败：${msg}`);
  }

  return { url: buildQiniuPublicUrl(key, settings), key };
}
