export const runtime = "nodejs";

/** 本地 ComfyUI 在线探测：GET {baseUrl}/system_stats（5 秒超时） */
export async function GET(req: Request) {
  const baseUrl = new URL(req.url).searchParams.get("baseUrl");
  if (!baseUrl) return Response.json({ error: "缺少 baseUrl 参数" }, { status: 400 });
  try {
    const res = await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return Response.json({ online: false });
    const data = await res.json();
    return Response.json({ online: true, version: data?.system?.comfyui_version ?? undefined });
  } catch {
    return Response.json({ online: false });
  }
}
