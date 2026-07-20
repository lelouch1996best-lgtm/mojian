import type {
  ImageQueryProxyRequest,
  ImageQueryProxyResponse,
  ImageTaskStatus,
} from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: ImageQueryProxyRequest;
  try {
    body = (await req.json()) as ImageQueryProxyRequest;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body.baseURL || !body.apiKey || !body.jobId) {
    return Response.json(
      { error: "缺少必要参数（baseURL / apiKey / jobId）" },
      { status: 400 }
    );
  }

  const base = body.baseURL.replace(/\/+$/, "");

  // ---- APIMart：GET /tasks/{task_id}?language=zh，解析 result.images[0].url[0] ----
  if (body.provider === "apimart") {
    const apimartUrl = `${base}/tasks/${encodeURIComponent(body.jobId)}?language=zh`;
    let apimartRes: Response;
    try {
      apimartRes = await fetch(apimartUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${body.apiKey}` },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json({ error: `请求上游失败：${msg}` }, { status: 502 });
    }

    if (!apimartRes.ok) {
      const errText = await apimartRes.text().catch(() => "");
      let friendly = errText.slice(0, 500);
      try {
        const errJson = JSON.parse(errText);
        friendly = errJson?.error?.message ?? friendly;
      } catch {
        /* keep raw */
      }
      return Response.json(
        { error: `上游错误（${apimartRes.status}）：${friendly}` },
        { status: apimartRes.status || 502 }
      );
    }

    const apimartRaw = await apimartRes.text().catch(() => "");
    let apimartParsed: Record<string, unknown>;
    try {
      apimartParsed = JSON.parse(apimartRaw);
    } catch {
      const snippet = apimartRaw.slice(0, 300).replace(/\s+/g, " ").trim();
      return Response.json(
        {
          error: `上游返回了非 JSON 响应。HTTP ${apimartRes.status}，内容片段：${snippet || "(空)"}`,
        },
        { status: 502 }
      );
    }

    // 成功体：{ code: 200, data: { id, status, progress, result?: { images: [{ url: [...], expires_at }] }, error?: { code, message, type } } }
    const task = ((apimartParsed as { data?: Record<string, unknown> })?.data ?? apimartParsed) as {
      status?: string;
      result?: { images?: Array<{ url?: string[] }> };
      error?: { message?: string };
    };

    const rawStatus = (task.status ?? "failed").toLowerCase();
    let status: ImageTaskStatus;
    if (rawStatus === "completed") {
      status = "done";
    } else if (rawStatus === "processing") {
      status = "running";
    } else if (rawStatus === "pending" || rawStatus === "submitted") {
      // submitted 仅出现在提交响应，此处保留兜底
      status = "pending";
    } else {
      // failed / cancelled / 未知 -> failed
      status = "failed";
    }

    const result: ImageQueryProxyResponse = { status };

    if (status === "done") {
      const imgs = task.result?.images;
      const urls = imgs && imgs.length > 0 ? imgs[0].url : undefined;
      if (Array.isArray(urls) && urls.length > 0) {
        result.imageUrl = urls[0];
      } else {
        result.status = "failed";
        result.error = "任务完成但未返回图片 URL";
      }
    } else if (status === "failed") {
      result.error =
        task.error?.message ||
        (rawStatus === "cancelled" ? "任务已取消" : "图片生成失败");
    }

    return Response.json(result);
  }

  const url = `${base}/images/async-generations/${encodeURIComponent(body.jobId)}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${body.apiKey}` },
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

  const rawText = await upstream.text().catch(() => "");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const snippet = rawText.slice(0, 300).replace(/\s+/g, " ").trim();
    return Response.json(
      {
        error: `上游返回了非 JSON 响应。HTTP ${upstream.status}，内容片段：${snippet || "(空)"}`,
      },
      { status: 502 }
    );
  }

  // 响应可能为统一包络 { code, message, data: { status, result_urls, error_message } }
  // 也可能为扁平结构 { status, result_urls, error_message }
  const job = ((parsed as { data?: Record<string, unknown> })?.data ?? parsed) as {
    status?: string;
    result_urls?: string[];
    error_message?: string;
    error_code?: string;
  };

  const rawStatus = (job.status ?? "failed").toLowerCase();
  let status: ImageTaskStatus;
  if (rawStatus === "done" || rawStatus === "succeeded" || rawStatus === "success") {
    status = "done";
  } else if (rawStatus === "running" || rawStatus === "processing") {
    status = "running";
  } else if (rawStatus === "pending" || rawStatus === "queued") {
    status = "pending";
  } else if (rawStatus === "failed" || rawStatus === "error") {
    status = "failed";
  } else {
    status = "failed";
  }

  const result: ImageQueryProxyResponse = { status };

  if (status === "done") {
    const urls = job.result_urls;
    if (Array.isArray(urls) && urls.length > 0) {
      result.imageUrl = urls[0];
    } else {
      // done 但没有 result_urls，视为失败
      result.status = "failed";
      result.error = job.error_message || "任务完成但未返回图片 URL";
    }
  } else if (status === "failed") {
    result.error = job.error_message || job.error_code || "图片生成失败";
  }

  return Response.json(result);
}
