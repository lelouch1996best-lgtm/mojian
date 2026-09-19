import { fetchComfyUiHistory } from "@/lib/comfyui-history";

export const runtime = "nodejs";

/**
 * 本地 ComfyUI 执行历史查询代理：GET {baseUrl}/history/{promptId}。
 * 归一化为 {status, files, errorMessage}；files 的 url 为 ComfyUI /view 直链。
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const baseUrl = (sp.get("baseUrl") ?? "").replace(/\/+$/, "");
  const promptId = sp.get("promptId") ?? "";
  if (!baseUrl || !promptId) {
    return Response.json({ error: "缺少 baseUrl 或 promptId" }, { status: 400 });
  }
  try {
    const result = await fetchComfyUiHistory(baseUrl, promptId);
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 502 });
  }
}
