import type { VideoCreateProxyRequest, VideoCreateProxyResponse } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: VideoCreateProxyRequest;
  try {
    body = (await req.json()) as VideoCreateProxyRequest;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body.baseURL || !body.apiKey || !body.model || !body.prompt) {
    return Response.json(
      { error: "缺少必要参数（baseURL / apiKey / model / prompt）" },
      { status: 400 }
    );
  }

  const base = body.baseURL.replace(/\/+$/, "");
  const url = `${base}/contents/generations/tasks`;

  // 构造 content 数组
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: body.prompt },
  ];

  // 参考图片：第一张作为首帧，其余作为参考图
  if (body.imageUrls && body.imageUrls.length > 0) {
    body.imageUrls.forEach((u, i) => {
      content.push({
        type: "image_url",
        image_url: { url: u },
        role: i === 0 ? "first_frame" : "reference_image",
      });
    });
  }

  const upstreamBody: Record<string, unknown> = {
    model: body.model,
    content,
    watermark: body.watermark ?? false,
  };
  if (body.resolution) upstreamBody.resolution = body.resolution;
  if (body.ratio) upstreamBody.ratio = body.ratio;
  if (typeof body.duration === "number") upstreamBody.duration = body.duration;
  if (typeof body.generateAudio === "boolean") upstreamBody.generate_audio = body.generateAudio;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${body.apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `请求上游失败：${msg}` }, { status: 502 });
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    let friendly = errText.slice(0, 500);
    try {
      const errJson = JSON.parse(errText);
      friendly = errJson?.error?.message ?? friendly;
    } catch {
      /* keep raw */
    }
    return Response.json(
      { error: `上游错误（${upstream.status}）：${friendly}` },
      { status: upstream.status || 502 }
    );
  }

  const data = await upstream.json();
  const taskId: string | undefined = data?.id;
  if (!taskId) {
    return Response.json({ error: "上游未返回任务 ID" }, { status: 502 });
  }

  const result: VideoCreateProxyResponse = { taskId };
  return Response.json(result);
}
