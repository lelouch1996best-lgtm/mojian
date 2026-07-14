import type { ImageProxyRequest, ImageProxyResponse } from "@/lib/types";
import { getImageModelCapability } from "@/lib/model-presets";

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

  const base = body.baseURL.replace(/\/+$/, "");
  const url = `${base}/images/generations`;

  // 按模型能力条件性构造上游请求体（参照 docs/image.md 参数支持矩阵）
  const cap = getImageModelCapability(body.model);
  const upstreamBody: Record<string, unknown> = {
    model: body.model,
    prompt: body.prompt,
    response_format: cap.responseFormat ? (body.responseFormat ?? "url") : "url",
  };

  // 参考图（单图/多图生图）：1 张传 string，多张传 array
  if (body.images && body.images.length > 0) {
    upstreamBody.image = body.images.length === 1 ? body.images[0] : body.images;
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

  let upstream: Response;
  try {
    upstream = await fetch(url, {
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

  // 响应结构：{ model, created, data: [{ url | b64_json, size }], usage }
  const first = data?.data?.[0];
  if (!first) {
    return Response.json(
      { error: "上游未返回图片数据" },
      { status: 502 }
    );
  }

  // 失败对象
  if (first.error) {
    return Response.json(
      {
        error: `图片生成失败：${first.error.message ?? "未知错误"}（code: ${first.error.code ?? "?"}）`,
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
    size: first.size,
    model: data.model,
  };
  return Response.json(result);
}
