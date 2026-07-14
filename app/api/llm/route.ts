import type { LLMProxyRequest } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: LLMProxyRequest;
  try {
    body = (await req.json()) as LLMProxyRequest;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body.baseURL || !body.apiKey || !body.payload) {
    return Response.json({ error: "缺少 LLM 配置（baseURL / apiKey / payload）" }, { status: 400 });
  }

  const { model } = body.payload;
  if (!model) {
    return Response.json({ error: "payload 缺少 model 字段" }, { status: 400 });
  }

  // 规范化 baseURL：去末尾斜杠
  const base = body.baseURL.replace(/\/+$/, "");
  const url = `${base}/chat/completions`;

  // 纯透传：前端已构造好完整的上游请求体，后端仅负责添加鉴权头并转发
  const isStream = body.payload.stream;

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

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return Response.json(
      { error: `上游错误（${upstream.status}）：${errText.slice(0, 500)}` },
      { status: upstream.status || 502 }
    );
  }

  // 流式：解析 SSE，提取 delta.content，输出纯文本片段
  if (isStream) {
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const data = trimmed.slice(5).trim();
              if (data === "[DONE]") {
                controller.close();
                return;
              }
              try {
                const json = JSON.parse(data);
                const delta: string = json.choices?.[0]?.delta?.content ?? "";
                if (delta) controller.enqueue(encoder.encode(delta));
              } catch {
                /* 忽略心跳/不完整行 */
              }
            }
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // 非流式：直接返回 JSON
  const data = await upstream.json();
  const content: string = data.choices?.[0]?.message?.content ?? "";
  return Response.json({ content });
}
