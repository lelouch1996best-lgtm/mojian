export const runtime = "nodejs";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const u = sp.get("url");
  // 可选自定义下载文件名（去除路径分隔符，兜底默认名）
  const rawName = (sp.get("name") ?? "").replace(/[/\\]/g, "").trim();
  const filename = rawName || `super-resolution-${Date.now()}.mp4`;
  if (!u) return Response.json({ error: "缺少 url 参数" }, { status: 400 });
  let upstream: Response;
  try {
    upstream = await fetch(u);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `下载失败：${msg}` }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: `下载失败（${upstream.status}）` }, { status: 502 });
  }
  const headers = new Headers(upstream.headers);
  headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
  // 透传流式响应体，强制附件下载以规避浏览器 CORS/跨域下载限制
  return new Response(upstream.body, { status: 200, headers });
}
