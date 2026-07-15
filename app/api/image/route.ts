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

  // 按模型能力条件性构造上游请求体（参照 docs/gpt2.md、docs/image.md 参数支持矩阵）
  const cap = getImageModelCapability(body.model);

  // gpt-image-2 有参考图时走 /images/edits 端点（multipart/form-data，image 为文件字段）
  // 其余场景（gpt-image-2 文生图、Seedream 系列文/图生图）走 /images/generations（JSON body）
  const hasRefImages = cap.maxRefImages > 0 && body.images && body.images.length > 0;
  const useEditsEndpoint = cap.quality && hasRefImages;
  const endpoint = useEditsEndpoint ? "/images/edits" : "/images/generations";
  const url = `${base}${endpoint}`;

  let upstream: Response;
  try {
    if (useEditsEndpoint) {
      // /images/edits 端点：multipart/form-data，image 为文件字段
      const formData = new FormData();
      formData.append("model", body.model);
      formData.append("prompt", body.prompt);
      formData.append("n", "1");
      if (body.size) formData.append("size", body.size);
      if (cap.quality && body.quality) formData.append("quality", body.quality);

      // 将参考图（data URL 或远程 URL）转为 Blob 附加到 image 字段
      for (const refUrl of body.images!) {
        let imageBlob: Blob;
        if (refUrl.startsWith("data:")) {
          const m = refUrl.match(/^data:image\/([\w.+-]+);base64,(.+)$/);
          if (!m) throw new Error("参考图 data URL 格式无效");
          imageBlob = new Blob([Buffer.from(m[2], "base64")], {
            type: `image/${m[1]}`,
          });
        } else {
          const imgResp = await fetch(refUrl);
          if (!imgResp.ok) throw new Error(`获取参考图失败：HTTP ${imgResp.status}`);
          imageBlob = await imgResp.blob();
        }
        const ext = imageBlob.type.split("/")[1] || "png";
        formData.append("image[]", imageBlob, `image.${ext}`);
      }

      upstream = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${body.apiKey}` },
        body: formData,
      });
    } else {
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

      upstream = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${body.apiKey}`,
        },
        body: JSON.stringify(upstreamBody),
      });
    }
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

  // 响应结构：{ model, created, data: [{ url | b64_json, size }], usage }
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
