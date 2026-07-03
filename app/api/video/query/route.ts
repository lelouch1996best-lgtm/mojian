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
  const errorMsg: string | undefined = data?.error?.message;

  const result: VideoQueryProxyResponse = {
    status,
    videoUrl,
    error: errorMsg,
  };
  return Response.json(result);
}
