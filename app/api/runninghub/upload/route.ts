import { logApiCall } from "@/lib/api-call-logger";

export const runtime = "nodejs";

const UPSTREAM_URL = "https://www.runninghub.ai/openapi/v2/media/upload/binary";

export async function POST(req: Request) {
  const form = await req.formData();
  const apiKey = String(form.get("apiKey") ?? "");
  const file = form.get("file");
  if (!apiKey || !(file instanceof File)) {
    return Response.json({ error: "缺少 apiKey 或 file" }, { status: 400 });
  }

  const upstreamForm = new FormData();
  upstreamForm.append("file", file, file.name);

  // 按文件 MIME 归类日志：视频类记 video，其余（图片等）记 image
  const logType = file.type.startsWith("video/") ? "video" : "image";

  const t0 = Date.now();
  const finish = (o: { status: "success" | "failed"; responseBody: string; error?: string }) => {
    logApiCall({
      type: logType,
      provider: "runninghub",
      model: "media-upload",
      upstreamUrl: UPSTREAM_URL,
      requestBody: { fileName: file.name, size: file.size },
      durationMs: Date.now() - t0,
      status: o.status,
      responseBody: o.responseBody,
      error: o.error,
    });
  };

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstreamForm,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    finish({ status: "failed", responseBody: "", error: msg });
    return Response.json({ error: `请求上游失败：${msg}` }, { status: 502 });
  }
  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    finish({ status: "failed", responseBody: errText, error: errText.slice(0, 500) });
    return Response.json({ error: `上游错误（${upstream.status}）` }, { status: upstream.status || 502 });
  }

  const data = await upstream.json();
  // data: { code, message, data: { type, download_url, fileName, size } }
  if (data?.code !== 0 || !data?.data?.fileName) {
    finish({ status: "failed", responseBody: JSON.stringify(data), error: data?.message ?? "上传未返回 fileName" });
    return Response.json({ error: data?.message ?? "上传失败" }, { status: 502 });
  }
  finish({ status: "success", responseBody: JSON.stringify(data) });
  return Response.json({
    downloadUrl: data.data.download_url,
    fileName: data.data.fileName,
    size: String(data.data.size ?? ""),
  });
}
