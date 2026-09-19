import { logApiCall } from "@/lib/api-call-logger";

export const runtime = "nodejs";

/**
 * 本地 ComfyUI 工作流提交代理：POST {baseUrl}/prompt。
 * 请求体 {baseUrl, workflow, logType?, logModel?}；workflow 为完整 API JSON（节点已覆盖用户输入）。
 * ComfyUI 校验失败返回 400（node_errors 明确指出问题节点），透传给前端。
 */
export async function POST(req: Request) {
  let body: {
    baseUrl?: string;
    workflow?: Record<string, unknown>;
    logType?: "image" | "video";
    logModel?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const baseUrl = (body.baseUrl ?? "").replace(/\/+$/, "");
  const workflow = body.workflow;
  if (!baseUrl || !workflow || typeof workflow !== "object") {
    return Response.json({ error: "缺少 baseUrl 或 workflow" }, { status: 400 });
  }

  const url = `${baseUrl}/prompt`;
  const t0 = Date.now();
  const finish = (o: {
    status: "success" | "failed";
    responseBody: string;
    error?: string;
    promptId?: string;
  }) => {
    logApiCall({
      type: body.logType ?? "video",
      provider: "comfyui",
      model: body.logModel ?? "ComfyUI 本地",
      upstreamUrl: url,
      requestBody: workflow,
      durationMs: Date.now() - t0,
      status: o.status,
      responseBody: o.responseBody,
      error: o.error,
      taskId: o.promptId,
      finalStatus: o.status === "failed" ? "failed" : undefined,
      finalResult: o.status === "failed" ? o.error ?? o.responseBody.slice(0, 500) : undefined,
    });
  };

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    finish({ status: "failed", responseBody: "", error: msg });
    return Response.json({ error: `无法连接本地 ComfyUI：${msg}` }, { status: 502 });
  }
  if (!upstream.ok) {
    // ComfyUI 校验/执行错误：400 + {error:{message,...}, node_errors:{...}}
    const errText = await upstream.text().catch(() => "");
    let msg = errText.slice(0, 500) || `HTTP ${upstream.status}`;
    try {
      const data = JSON.parse(errText);
      if (data?.error?.message) {
        const nodeIds = Object.keys(data.node_errors ?? {});
        msg = nodeIds.length
          ? `${data.error.message}（节点 ${nodeIds.join("、")}）`
          : data.error.message;
      }
    } catch {
      /* 非 JSON，用原文 */
    }
    finish({ status: "failed", responseBody: errText, error: msg });
    return Response.json({ error: msg }, { status: 502 });
  }

  const data = await upstream.json();
  const promptId = data?.prompt_id;
  if (!promptId) {
    const msg = "ComfyUI 未返回 prompt_id";
    finish({ status: "failed", responseBody: JSON.stringify(data), error: msg });
    return Response.json({ error: msg }, { status: 502 });
  }
  finish({ status: "success", responseBody: JSON.stringify(data), promptId });
  return Response.json({ promptId });
}
