import type {
  VideoQueryProxyRequest,
  VideoQueryProxyResponse,
  VideoStatus,
} from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: VideoQueryProxyRequest;
  try {
    body = (await req.json()) as VideoQueryProxyRequest;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body.baseURL || !body.apiKey || !body.taskId) {
    return Response.json(
      { error: "缺少必要参数（baseURL / apiKey / taskId）" },
      { status: 400 }
    );
  }

  const base = body.baseURL.replace(/\/+$/, "");

  // ---- APIMart：GET /tasks/{task_id}?language=zh ----
  if (body.provider === "apimart") {
    const url = `${base}/tasks/${encodeURIComponent(body.taskId)}?language=zh`;
    let upstream: Response;
    try {
      upstream = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${body.apiKey}`,
        },
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

    const parsed = await upstream.json();
    const task = parsed?.data ?? parsed;
    const rawStatus = String(task?.status ?? "failed").toLowerCase();
    let status: VideoStatus;
    if (rawStatus === "completed") status = "succeeded";
    else if (rawStatus === "processing") status = "running";
    else if (rawStatus === "pending" || rawStatus === "submitted") status = "queued";
    else if (rawStatus === "cancelled") status = "cancelled";
    else status = "failed";

    const result: VideoQueryProxyResponse = { status };

    if (status === "succeeded") {
      const videos = task?.result?.videos;
      const v = Array.isArray(videos) && videos.length > 0 ? videos[0] : undefined;
      let videoUrl: string | undefined;
      if (v) {
        if (typeof v.url === "string") videoUrl = v.url;
        else if (Array.isArray(v.url) && v.url.length > 0) videoUrl = v.url[0];
        else if (typeof v.video_url === "string") videoUrl = v.video_url;
      }
      if (videoUrl) {
        result.videoUrl = videoUrl;
      } else {
        result.status = "failed";
        result.error = "任务完成但未返回视频 URL";
      }
      // 尾帧图像（return_last_frame=true 时落在 result.images）
      const imgs = task?.result?.images;
      const img = Array.isArray(imgs) && imgs.length > 0 ? imgs[0] : undefined;
      const imgUrls = img?.url;
      if (Array.isArray(imgUrls) && imgUrls.length > 0) {
        result.lastFrameUrl = imgUrls[0];
      } else if (typeof imgUrls === "string") {
        result.lastFrameUrl = imgUrls;
      }
    } else if (status === "failed") {
      result.error = task?.error?.message || "视频生成失败";
    }

    return Response.json(result);
  }

  // ---- ark / ark-plan / custom：GET /contents/generations/tasks/{id} ----
  const url = `${base}/contents/generations/tasks/${encodeURIComponent(body.taskId)}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${body.apiKey}`,
      },
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
  const status = (data?.status ?? "failed") as VideoStatus;
  const videoUrl: string | undefined = data?.content?.video_url;
  const lastFrameUrl: string | undefined = data?.content?.last_frame_url;
  const errorMsg: string | undefined = data?.error?.message;

  const result: VideoQueryProxyResponse = {
    status,
    videoUrl,
    lastFrameUrl,
    error: errorMsg,
  };
  return Response.json(result);
}
