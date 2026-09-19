import type { RunningHubRunProxyRequest } from "@/lib/types";
import { logApiCall } from "@/lib/api-call-logger";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: RunningHubRunProxyRequest;
  try {
    body = (await req.json()) as RunningHubRunProxyRequest;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (!body.apiKey || !body.appId || !body.payload?.nodeInfoList) {
    return Response.json({ error: "缺少必要参数（apiKey / appId / payload.nodeInfoList）" }, { status: 400 });
  }

  const url = `https://www.runninghub.ai/openapi/v2/run/ai-app/${encodeURIComponent(body.appId)}`;
  const t0 = Date.now();
  const finish = (o: {
    status: "success" | "failed";
    responseBody: string;
    error?: string;
    taskId?: string;
    finalStatus?: "done" | "failed";
    finalResult?: string;
  }) => {
    const finalStatus = o.finalStatus ?? (o.status === "failed" ? "failed" : undefined);
    const finalResult =
      o.finalResult ?? (o.status === "failed" ? o.error ?? o.responseBody.slice(0, 500) : undefined);
    logApiCall({
      type: body.logType ?? "video",
      provider: "runninghub",
      model: body.logModel ?? body.appId,
      upstreamUrl: url,
      requestBody: body.payload,
      durationMs: Date.now() - t0,
      status: o.status,
      responseBody: o.responseBody,
      error: o.error,
      taskId: o.taskId,
      finalStatus,
      finalResult,
    });
  };

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${body.apiKey}` },
      body: JSON.stringify(body.payload),
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
  const taskId: string | undefined = data?.taskId;
  if (!taskId) {
    // 上游 HTTP 200 但业务失败（如 errorCode 421 并发上限），透传真实错误
    const errMsg = data?.errorMessage || "上游未返回 taskId";
    finish({ status: "failed", responseBody: JSON.stringify(data), error: errMsg });
    return Response.json(
      { error: errMsg, errorCode: data?.errorCode ?? "" },
      { status: 502 }
    );
  }
  finish({ status: "success", responseBody: JSON.stringify(data), taskId });
  return Response.json({ taskId, status: data?.status ?? "RUNNING" });
}
