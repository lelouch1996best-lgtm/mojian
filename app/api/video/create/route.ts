import type { VideoCreateProxyRequest, VideoCreateProxyResponse } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: VideoCreateProxyRequest;
  try {
    body = (await req.json()) as VideoCreateProxyRequest;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body.baseURL || !body.apiKey || !body.payload) {
    return Response.json(
      { error: "缺少必要参数（baseURL / apiKey / payload）" },
      { status: 400 }
    );
  }

  const { model, content } = body.payload;
  if (!model || !Array.isArray(content) || content.length === 0) {
    return Response.json(
      { error: "payload 缺少必要字段（model / content）" },
      { status: 400 }
    );
  }

  const base = body.baseURL.replace(/\/+$/, "");
  const url = `${base}/contents/generations/tasks`;

  // 纯透传：前端已构造好完整的上游请求体，后端仅负责添加鉴权头并转发
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${body.apiKey}`,
      },
      body: JSON.stringify(body.payload),
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
