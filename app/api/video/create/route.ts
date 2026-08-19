import type {
  VideoApimartUpstreamPayload,
  VideoCreateProxyRequest,
  VideoCreateProxyResponse,
  VideoUpstreamPayload,
} from "@/lib/types";
import { logApiCall } from "@/lib/api-call-logger";

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

  const base = body.baseURL.replace(/\/+$/, "");

  // ---- APIMart：POST /videos/generations，扁平结构，解析 data[0].task_id ----
  if (body.provider === "apimart") {
    const ap = body.payload as VideoApimartUpstreamPayload;
    if (!ap.model || !ap.prompt) {
      return Response.json(
        { error: "payload 缺少必要字段（model / prompt）" },
        { status: 400 }
      );
    }
    const url = `${base}/videos/generations`;
    const t0 = Date.now();
    const finish = (o: { status: "success" | "failed"; responseBody: string; error?: string; taskId?: string; finalStatus?: "done" | "failed"; finalResult?: string }) => {
      const finalStatus = o.finalStatus ?? (o.status === "failed" ? "failed" : undefined);
      const finalResult = o.finalResult ?? (o.status === "failed" ? (o.error ?? o.responseBody.slice(0, 500)) : undefined);
      logApiCall({ type: "video", provider: "apimart", model: ap.model, upstreamUrl: url, requestBody: ap, durationMs: Date.now() - t0, status: o.status, responseBody: o.responseBody, error: o.error, taskId: o.taskId, finalStatus, finalResult });
    };
    let upstream: Response;
    try {
      upstream = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${body.apiKey}`,
        },
        body: JSON.stringify(ap),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      finish({ status: "failed", responseBody: "", error: msg });
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
      finish({ status: "failed", responseBody: errText, error: friendly });
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
      finish({ status: "failed", responseBody: JSON.stringify(data), error: "APIMart 未返回 task_id" });
      return Response.json({ error: "APIMart 未返回 task_id" }, { status: 502 });
    }

    const result: VideoCreateProxyResponse = { taskId, provider: "apimart" };
    finish({ status: "success", responseBody: JSON.stringify(data), taskId });
    return Response.json(result);
  }

  // ---- ark / ark-plan / custom：POST /contents/generations/tasks，content[] 结构 ----
  const { model, content } = body.payload as VideoUpstreamPayload;
  if (!model || !Array.isArray(content) || content.length === 0) {
    return Response.json(
      { error: "payload 缺少必要字段（model / content）" },
      { status: 400 }
    );
  }

  const url = `${base}/contents/generations/tasks`;
  const t0 = Date.now();
  const finish = (o: { status: "success" | "failed"; responseBody: string; error?: string; taskId?: string; finalStatus?: "done" | "failed"; finalResult?: string }) => {
    const finalStatus = o.finalStatus ?? (o.status === "failed" ? "failed" : undefined);
    const finalResult = o.finalResult ?? (o.status === "failed" ? (o.error ?? o.responseBody.slice(0, 500)) : undefined);
    logApiCall({ type: "video", provider: body.provider ?? "ark", model, upstreamUrl: url, requestBody: body.payload, durationMs: Date.now() - t0, status: o.status, responseBody: o.responseBody, error: o.error, taskId: o.taskId, finalStatus, finalResult });
  };

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
    finish({ status: "failed", responseBody: "", error: msg });
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
    finish({ status: "failed", responseBody: errText, error: friendly });
    return Response.json(
      { error: `上游错误（${upstream.status}）：${friendly}` },
      { status: upstream.status || 502 }
    );
  }

  const data = await upstream.json();
  const taskId: string | undefined = data?.id;
  if (!taskId) {
    finish({ status: "failed", responseBody: JSON.stringify(data), error: "上游未返回任务 ID" });
    return Response.json({ error: "上游未返回任务 ID" }, { status: 502 });
  }

  const result: VideoCreateProxyResponse = { taskId, provider: body.provider ?? "ark" };
  finish({ status: "success", responseBody: JSON.stringify(data), taskId });
  return Response.json(result);
}
