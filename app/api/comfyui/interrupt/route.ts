export const runtime = "nodejs";

/** 本地 ComfyUI 中断代理：POST {baseUrl}/interrupt（取消当前执行/出队，尽力而为） */
export async function POST(req: Request) {
  let body: { baseUrl?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const baseUrl = (body.baseUrl ?? "").replace(/\/+$/, "");
  if (!baseUrl) return Response.json({ error: "缺少 baseUrl" }, { status: 400 });
  try {
    await fetch(`${baseUrl}/interrupt`, { method: "POST" });
  } catch {
    /* 尽力而为 */
  }
  return Response.json({ ok: true });
}
