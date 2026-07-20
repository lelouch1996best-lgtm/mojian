import type { AudioProxyRequest, AudioProxyResponse } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: AudioProxyRequest;
  try {
    body = (await req.json()) as AudioProxyRequest;
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
  const url = `${base}/chat/completions`;

  // 透传：前端构造好完整的 mimo TTS 请求体，后端仅添加 api-key 鉴权头并转发
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": body.apiKey,
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
  const audioData: string | undefined = data?.choices?.[0]?.message?.audio?.data;
  const format: string = data?.choices?.[0]?.message?.audio?.format ?? "wav";
  if (!audioData) {
    return Response.json(
      { error: "上游未返回音频数据" },
      { status: 502 }
    );
  }

  const result: AudioProxyResponse = { audioBase64: audioData, format };
  return Response.json(result);
}
