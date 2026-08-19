import { buildQiniuPublicUrl } from "@/lib/qiniu-transfer";
import type { QiniuSettings } from "@/lib/types";

export const runtime = "nodejs";

/** 根据七牛错误给出排查建议 */
function qiniuTroubleshoot(statusCode: number, data: any): string {
  const code = data?.code;
  const msg = data?.error || data?.message || "";

  if (statusCode === 401 || code === 401) {
    return `认证失败。可能原因：
1. AccessKey / SecretKey 填错了（请到七牛控制台「密钥管理」核对）
2. 上传凭证签算错误
3. 该密钥没有对此存储空间的写入权限`;
  }

  if (code === 403) {
    return `权限不足。该密钥没有对空间「${data?.bucket ?? ""}」的写入权限，请检查七牛令牌策略。`;
  }

  if (code === 614) {
    return `同名资源已存在（空间内已存在该 key）。`;
  }

  if (code === 631) {
    return `存储空间不存在。请检查 Bucket 名称与所属区域是否正确。`;
  }

  return `七牛错误：[${statusCode}${code ? ` / ${code}` : ""}] ${msg}`;
}

export async function POST(req: Request) {
  let body: {
    base64: string;
    fileName: string;
    settings: QiniuSettings;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const { base64, fileName, settings } = body;
  if (!base64 || !fileName || !settings.accessKey || !settings.secretKey || !settings.bucket || !settings.domain) {
    return Response.json(
      { error: "缺少必要参数（base64 / fileName / settings）" },
      { status: 400 }
    );
  }

  // 动态导入七牛 SDK（避免客户端 bundle 包含服务端 SDK）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qiniu: any = await import("qiniu");

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

  // ====== 构建上传凭证与配置 ======
  const mac = new qiniu.auth.digest.Mac(settings.accessKey, settings.secretKey);
  const putPolicy = new qiniu.rs.PutPolicy({ scope: settings.bucket });
  const uploadToken = putPolicy.uploadToken(mac);

  const config = new qiniu.conf.Config();
  if (settings.region) {
    try {
      config.regionsProvider = qiniu.httpc.Region.fromRegionId(settings.region);
    } catch {
      // 区域 ID 无效时回退自动查询
    }
  }

  const formUploader = new qiniu.form_up.FormUploader(config);
  const putExtra = new qiniu.form_up.PutExtra();
  putExtra.mimeType = contentType;

  // ====== 上传到七牛 ======
  try {
    const { resp, data } = await formUploader.put(uploadToken, key, buffer, putExtra);
    if (resp.statusCode !== 200) {
      const tip = qiniuTroubleshoot(resp.statusCode, data);
      return Response.json(
        { error: `七牛上传失败：${data?.error ?? resp.statusCode}\n\n${tip}` },
        { status: 502 }
      );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: `七牛上传失败：${msg}` },
      { status: 502 }
    );
  }

  const url = buildQiniuPublicUrl(key, settings);

  return Response.json({
    url,
    key,
    bucket: settings.bucket,
    region: settings.region,
  });
}
