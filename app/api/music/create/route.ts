import type {
  MusicCreateProxyRequest,
  MusicCreateProxyResponse,
} from "@/lib/types";

export const runtime = "nodejs";

const ACTION_ENDPOINTS: Record<MusicCreateProxyRequest["action"], string> = {
  generate: "/music/generations",
  inspo: "/music/generations/inspo",
  lyrics: "/music/generations/lyrics",
  createVoice: "/music/generations/createVoice",
};

export async function POST(req: Request) {
  let body: MusicCreateProxyRequest;
  try {
    body = (await req.json()) as MusicCreateProxyRequest;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body.baseURL || !body.apiKey || !body.payload) {
    return Response.json(
      { error: "缺少必要参数（baseURL / apiKey / payload）" },
      { status: 400 }
    );
  }

  const endpoint = ACTION_ENDPOINTS[body.action];
  if (!endpoint) {
    return Response.json(
      { error: `不支持的 action：${body.action}` },
      { status: 400 }
    );
  }

  const base = body.baseURL.replace(/\/+$/, "");
  const url = `${base}${endpoint}`;

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
  const arr = data?.data;
  const taskId: string | undefined =
    Array.isArray(arr) && arr.length > 0 ? arr[0].task_id : undefined;
  if (!taskId) {
    return Response.json({ error: "上游未返回 task_id" }, { status: 502 });
  }

  const result: MusicCreateProxyResponse = { taskId };
  return Response.json(result);
}
