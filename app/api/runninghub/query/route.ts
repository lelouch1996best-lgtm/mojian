import type { RunningHubQueryProxyRequest, RunningHubQueryProxyResponse } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: RunningHubQueryProxyRequest;
  try {
    body = (await req.json()) as RunningHubQueryProxyRequest;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (!body.apiKey || !body.taskId) {
    return Response.json({ error: "缺少 apiKey 或 taskId" }, { status: 400 });
  }
  const url = "https://www.runninghub.ai/openapi/v2/query";
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${body.apiKey}` },
      body: JSON.stringify({ taskId: body.taskId }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `请求上游失败：${msg}` }, { status: 502 });
  }
  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    return Response.json({ error: `上游错误（${upstream.status}）` }, { status: upstream.status || 502 });
  }
  const data = await upstream.json();
  const result: RunningHubQueryProxyResponse = {
    status: data?.status ?? "FAILED",
    results: Array.isArray(data?.results) ? data.results : undefined,
    errorMessage: data?.errorMessage || undefined,
  };
  return Response.json(result);
}
