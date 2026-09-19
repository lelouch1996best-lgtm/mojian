export const runtime = "nodejs";

/** 本地 ComfyUI 释放内存代理：POST {baseUrl}/free（卸载模型 + 清空执行缓存） */
export async function POST(req: Request) {
  let body: { baseUrl?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const baseUrl = (body.baseUrl ?? "").replace(/\/+$/, "");
  if (!baseUrl) return Response.json({ error: "缺少 baseUrl" }, { status: 400 });

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/free`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `无法连接本地 ComfyUI：${msg}` }, { status: 502 });
  }
  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    return Response.json(
      { error: `释放内存失败（${upstream.status}）：${errText.slice(0, 300)}` },
      { status: 502 }
    );
  }
  return Response.json({ ok: true });
}
