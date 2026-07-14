import { buildCosPublicUrl } from "@/lib/cos-client";
import type { CosSettings } from "@/lib/types";

export const runtime = "nodejs";

/** 解析 COS SDK 抛出的错误，提取有用信息 */
function parseCosError(e: unknown): {
  statusCode: number;
  code: string;
  message: string;
  requestId?: string;
} {
  const err = e as Record<string, unknown> | null;
  return {
    statusCode: (err?.statusCode as number) ?? 0,
    code: (err?.code as string) ?? (err?.error as Record<string, string>)?.Code ?? "Unknown",
    message: (err?.message as string) ?? String(e),
    requestId: err?.RequestId as string | undefined,
  };
}

/** 根据 COS 错误码给出排查建议 */
function cosTroubleshoot(st: { statusCode: number; code: string; requestId?: string }): string {
  const rid = st.requestId ? `（RequestId: ${st.requestId}）` : "";

  if (st.statusCode === 403 || st.code === "AccessDenied") {
    return `Access Denied${rid}。可能原因：
1. SecretId / SecretKey 填错了（请到腾讯云控制台「访问管理→API密钥」核对）
2. 该密钥没有对此存储桶的写入权限（请检查 CAM 策略是否包含 cos:PutObject）
3. Bucket 名称格式不对（应为 BucketName-APPID，如 my-bucket-1250000000）
4. Bucket 不存在于该 Region（请确认 Bucket 和 Region 对应）`;
  }

  if (st.statusCode === 404 || st.code === "NoSuchBucket") {
    return `Bucket 不存在${rid}。请检查 Bucket 名称和 Region 是否正确。Bucket 格式：BucketName-APPID（如 my-bucket-1250000000）。`;
  }

  if (st.code === "InvalidAccessKeyId") {
    return `SecretId 无效${rid}。请检查 SecretId 是否正确。`;
  }

  if (st.code === "SignatureDoesNotMatch") {
    return `签名不匹配${rid}。SecretKey 可能填错了，请核对。`;
  }

  return `COS 错误${rid}：[${st.statusCode}] ${st.code}`;
}

export async function POST(req: Request) {
  let body: {
    base64: string;
    fileName: string;
    settings: CosSettings;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const { base64, fileName, settings } = body;
  if (!base64 || !fileName || !settings.secretId || !settings.secretKey || !settings.bucket || !settings.region) {
    return Response.json(
      { error: "缺少必要参数（base64 / fileName / settings）" },
      { status: 400 }
    );
  }

  // 动态导入 COS SDK（避免客户端 bundle 包含服务端 SDK）
  const COS = await import("cos-nodejs-sdk-v5");
  const cos = new (COS.default as typeof COS.default)({
    SecretId: settings.secretId,
    SecretKey: settings.secretKey,
  });

  // ====== 预检：headBucket 验证凭据和 Bucket 是否可访问 ======
  try {
    await cos.headBucket({
      Bucket: settings.bucket,
      Region: settings.region,
    });
  } catch (e: unknown) {
    const parsed = parseCosError(e);
    const tip = cosTroubleshoot(parsed);
    return Response.json(
      { error: `Bucket 连通性检查失败：${parsed.message}\n\n${tip}` },
      { status: 502 }
    );
  }

  // ====== 从 base64 提取 Buffer ======
  if (typeof base64 !== "string" || base64.length === 0) {
    return Response.json(
      { error: `base64 参数无效（类型：${typeof base64}，长度：${base64?.length ?? 0}）` },
      { status: 400 }
    );
  }

  let buffer: Buffer;
  try {
    // 用字符串操作代替正则，避免大 base64 触发 "Maximum call stack size exceeded"
    const commaIdx = base64.indexOf(",");
    const raw =
      commaIdx >= 0 && base64.startsWith("data:")
        ? base64.slice(commaIdx + 1)
        : base64;
    buffer = Buffer.from(raw, "base64");
  } catch (e) {
    return Response.json(
      { error: `无法解码 base64 图片数据：${(e as Error).message}` },
      { status: 400 }
    );
  }

  // ====== 根据文件名推断 ContentType ======
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const contentTypeMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
  };
  const contentType = contentTypeMap[ext] ?? "application/octet-stream";

  // ====== 按素材类型分目录生成唯一 key ======
  const dirByExt: Record<string, string> = {
    mp4: "videos", mov: "videos", webm: "videos",
    mp3: "audios", wav: "audios", m4a: "audios", aac: "audios",
  };
  const subdir = dirByExt[ext] ?? "assets";
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const key = `ai-script/${subdir}/${timestamp}-${random}.${ext}`;

  // ====== 上传到 COS ======
  try {
    await cos.putObject({
      Bucket: settings.bucket,
      Region: settings.region,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });
  } catch (e: unknown) {
    const parsed = parseCosError(e);
    const tip = cosTroubleshoot(parsed);
    return Response.json(
      { error: `COS 上传失败：${parsed.message}\n\n${tip}` },
      { status: 502 }
    );
  }

  const url = buildCosPublicUrl(key, settings);

  return Response.json({
    url,
    key,
    bucket: settings.bucket,
    region: settings.region,
  });
}
