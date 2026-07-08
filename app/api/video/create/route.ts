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

  // 按 mode 校验必需输入
  if (body.mode === "first-frame" && !body.firstFrameUrl) {
    return Response.json({ error: "首帧模式需要提供首帧图片 URL" }, { status: 400 });
  }
  if (body.mode === "first-last-frame" && (!body.firstFrameUrl || !body.lastFrameUrl)) {
    return Response.json({ error: "首尾帧模式需要同时提供首帧与尾帧图片 URL" }, { status: 400 });
  }
  if (body.mode === "multimodal-ref") {
    const imgCount = body.referenceImageUrls?.length ?? 0;
    const vidCount = body.referenceVideoUrls?.length ?? 0;
    // 音频不可单独输入，需至少 1 个参考图或视频
    if (imgCount === 0 && vidCount === 0) {
      return Response.json(
        { error: "多模态参考模式需至少提供 1 张参考图或 1 个参考视频" },
        { status: 400 }
      );
    }
  }

  const base = body.baseURL.replace(/\/+$/, "");
  const url = `${base}/contents/generations/tasks`;

  // 按 mode 构造 content 数组
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: body.prompt },
  ];

  if (body.mode === "first-frame") {
    content.push({
      type: "image_url",
      image_url: { url: body.firstFrameUrl },
      role: "first_frame",
    });
  } else if (body.mode === "first-last-frame") {
    content.push({
      type: "image_url",
      image_url: { url: body.firstFrameUrl },
      role: "first_frame",
    });
    content.push({
      type: "image_url",
      image_url: { url: body.lastFrameUrl },
      role: "last_frame",
    });
  } else if (body.mode === "multimodal-ref") {
    // 参考图（role=reference_image）
    (body.referenceImageUrls ?? []).forEach((u) => {
      content.push({
        type: "image_url",
        image_url: { url: u },
        role: "reference_image",
      });
    });
    // 参考视频（仅 2.0）
    (body.referenceVideoUrls ?? []).forEach((u) => {
      content.push({ type: "video_url", video_url: { url: u } });
    });
    // 参考音频（仅 2.0，不可单独输入）
    (body.referenceAudioUrls ?? []).forEach((u) => {
      content.push({ type: "audio_url", audio_url: { url: u } });
    });
  }
  // text2video：不加任何素材

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
