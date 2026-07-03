import { buildCosPublicUrl } from "@/lib/cos-client";
import type { CosSettings } from "@/lib/types";

export const runtime = "nodejs";

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

export async function POST(req: Request) {
  let body: {
    sourceUrl: string;
    settings: CosSettings;
    prefix?: string; // 可选，COS key 前缀，默认 "ai-script/assets"
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const { sourceUrl, settings, prefix = "ai-script/assets" } = body;
  if (!sourceUrl || !settings.secretId || !settings.secretKey || !settings.bucket || !settings.region) {
    return Response.json(
      { error: "缺少必要参数（sourceUrl / settings）" },
      { status: 400 }
    );
  }

  // ====== 下载源文件 ======
  let response: Response;
  try {
    response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(5 * 60 * 1000), // 5 分钟超时（视频可能较大）
    });
  } catch (e) {
    return Response.json(
      { error: `下载源文件失败：${(e as Error).message}` },
      { status: 502 }
    );
  }

  if (!response.ok) {
    return Response.json(
      { error: `下载源文件失败：HTTP ${response.status}` },
      { status: 502 }
    );
  }

  // ====== 推断文件类型和扩展名 ======
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  let ext = MIME_TO_EXT[contentType] ?? guessExtFromUrl(sourceUrl) ?? "png";

  // ====== 下载为 Buffer ======
  let buffer: Buffer;
  try {
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch {
    return Response.json({ error: "读取源文件数据失败" }, { status: 502 });
  }

  // ====== 上传到 COS ======
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
    return Response.json({ error: `COS 上传失败：${msg}` }, { status: 502 });
  }

  const url = buildCosPublicUrl(key, settings);

  return Response.json({
    url,
    key,
    bucket: settings.bucket,
    region: settings.region,
  });
}
