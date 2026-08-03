import type {
  ImageProxyRequest,
  ImageProxyResponse,
  ImageAsyncCreateResponse,
} from "@/lib/types";
import { getImageModelCapability } from "@/lib/model-presets";
import { getImageTaskCenter } from "@/lib/image-task-center";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: ImageProxyRequest;
  try {
    body = (await req.json()) as ImageProxyRequest;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body.baseURL || !body.apiKey || !body.model || !body.prompt) {
    return Response.json(
      { error: "缺少必要参数（baseURL / apiKey / model / prompt）" },
      { status: 400 }
    );
  }

  const taskCenter = getImageTaskCenter();
  taskCenter.ensureRunning();
  const register = (jobId: string) =>
    taskCenter.registerTask({
      jobId,
      provider: body.provider,
      apiKey: body.apiKey,
      baseURL: body.baseURL,
      model: body.model,
      cosPrefix: body.cosPrefix,
    });

  const base = body.baseURL.replace(/\/+$/, "");

  // ---- APIMart 供应商：始终异步，参考图走 image_urls，提交响应为 { code, data:[{task_id}] } ----
  if (body.provider === "apimart") {
    const upstreamBody: Record<string, unknown> = {
      model: body.model,
      prompt: body.prompt,
      n: 1,
    };
    if (body.size) upstreamBody.size = body.size;
    if (body.resolution) upstreamBody.resolution = body.resolution;
    if (body.images && body.images.length > 0) {
      upstreamBody.image_urls = body.images.slice(0, 16);
    }

    let apimartRes: Response;
    try {
      apimartRes = await fetch(`${base}/images/generations`, {
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
    let apimartData: Record<string, unknown>;
    try {
      apimartData = JSON.parse(apimartRaw);
    } catch {
      const snippet = apimartRaw.slice(0, 300).replace(/\s+/g, " ").trim();
      return Response.json(
        {
          error: `上游返回了非 JSON 响应（可能是 baseURL 错误或代理返回了 HTML 页面）。HTTP ${apimartRes.status}，内容片段：${snippet || "(空)"}`,
        },
        { status: 502 }
      );
    }

    // 提交响应：{ code: 200, data: [{ status: "submitted", task_id }] }
    const arr = (apimartData as { data?: Array<{ task_id?: string; status?: string }> })?.data;
    const first = Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined;
    const taskId = first?.task_id;
    if (!taskId) {
      return Response.json({ error: "APIMart 未返回 task_id" }, { status: 502 });
    }
    const result: ImageAsyncCreateResponse = {
      jobId: taskId,
      status: first?.status ?? "submitted",
    };
    register(taskId);
    return Response.json(result);
  }

  // 按模型能力条件性构造上游请求体（参照 docs/image.md 参数支持矩阵）
  const cap = getImageModelCapability(body.model, undefined, body.provider);
  const asyncMode = !!body.asyncMode;

  // 参考图统一走 /images/generations（JSON body）：Seedream 用 image 字段，APIMart 用 image_urls 字段
  const hasRefImages = cap.maxRefImages > 0 && body.images && body.images.length > 0;
  const url = `${base}/images/generations`;

  let upstream: Response;
  try {
    // /images/generations 端点：JSON body
    const upstreamBody: Record<string, unknown> = {
      model: body.model,
      prompt: body.prompt,
      response_format: cap.responseFormat
        ? (body.responseFormat ?? "url")
        : "url",
    };

    // Seedream 参考图（单图/多图生图）：1 张传 string，多张传 array
    if (hasRefImages) {
      upstreamBody.image =
        body.images!.length === 1 ? body.images![0] : body.images;
    }

    if (body.size) upstreamBody.size = body.size;
    if (cap.watermark && typeof body.watermark === "boolean") {
      upstreamBody.watermark = body.watermark;
    }
    if (cap.outputFormat && body.outputFormat) {
      upstreamBody.output_format = body.outputFormat;
    }
    if (cap.sequentialImageGen) {
      upstreamBody.sequential_image_generation = "disabled";
    }
    if (cap.webSearch && body.webSearch) {
      upstreamBody.tools = [{ type: "web_search" }];
    }
    if (cap.optimizePrompt && body.optimizePromptMode) {
      upstreamBody.optimize_prompt_options = { mode: body.optimizePromptMode };
    }
    if (cap.quality && body.quality) {
      upstreamBody.quality = body.quality;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${body.apiKey}`,
    };
    if (asyncMode) headers["X-Async-Mode"] = "true";

    upstream = await fetch(url, {
      method: "POST",
      headers,
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

  // 先读 text 再尝试 JSON.parse，避免上游返回 HTML（代理/网关错误页）时 json() 抛 SyntaxError
  const rawText = await upstream.text().catch(() => "");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawText);
  } catch {
    const snippet = rawText.slice(0, 300).replace(/\s+/g, " ").trim();
    return Response.json(
      {
        error: `上游返回了非 JSON 响应（可能是 baseURL 错误或代理返回了 HTML 页面）。HTTP ${upstream.status}，内容片段：${snippet || "(空)"}`,
      },
      { status: 502 }
    );
  }

  // 异步模式：上游返回 202 { job_id, status, status_url, created }
  if (asyncMode) {
    const jobId = (data as { job_id?: string })?.job_id;
    if (!jobId) {
      return Response.json(
        { error: "异步模式上游未返回 job_id" },
        { status: 502 }
      );
    }
    const result: ImageAsyncCreateResponse = {
      jobId,
      status: (data as { status?: string })?.status ?? "pending",
    };
    register(jobId);
    return Response.json(result);
  }

  // 同步模式：响应结构 { model, created, data: [{ url | b64_json, size }], usage }
  const first = (data as { data?: Array<Record<string, unknown>> })?.data?.[0];
  if (!first) {
    return Response.json(
      { error: "上游未返回图片数据" },
      { status: 502 }
    );
  }

  // 失败对象
  if (first.error) {
    const err = first.error as { message?: string; code?: string };
    return Response.json(
      {
        error: `图片生成失败：${err.message ?? "未知错误"}（code: ${err.code ?? "?"}）`,
      },
      { status: 502 }
    );
  }

  let imageUrl = "";
  if (body.responseFormat === "b64_json" && first.b64_json) {
    const fmt = body.outputFormat ?? "png";
    imageUrl = `data:image/${fmt};base64,${first.b64_json}`;
  } else if (first.url) {
    imageUrl = first.url as string;
  } else if (first.b64_json) {
    // 上游可能忽略 response_format，回退
    imageUrl = `data:image/png;base64,${first.b64_json}`;
  }

  if (!imageUrl) {
    return Response.json(
      { error: "上游返回的数据中未找到 url 或 b64_json" },
      { status: 502 }
    );
  }

  const result: ImageProxyResponse = {
    imageUrl,
    size: first.size as string | undefined,
    model: data.model as string | undefined,
  };
  return Response.json(result);
}
