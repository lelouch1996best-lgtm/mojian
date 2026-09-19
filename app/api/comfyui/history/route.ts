import type { ComfyUiHistoryResponse, ComfyUiOutputFile } from "@/lib/types";

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
  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `无法连接本地 ComfyUI：${msg}` }, { status: 502 });
  }
  if (!upstream.ok) {
    return Response.json({ error: `查询失败（${upstream.status}）` }, { status: 502 });
  }

  const data = await upstream.json();
  const entry = data?.[promptId];
  // history 为空对象 = 还在队列/执行中
  if (!entry) return Response.json({ status: "running", files: [] } satisfies ComfyUiHistoryResponse);

  const statusStr: string = entry?.status?.status_str ?? "";
  const files: ComfyUiOutputFile[] = [];
  const outputs = entry?.outputs ?? {};
  for (const nodeOutputs of Object.values(outputs)) {
    if (!nodeOutputs || typeof nodeOutputs !== "object") continue;
    // SaveImage → images；VHS_VideoCombine → gifs；音频 → audio
    for (const key of ["images", "gifs", "audio"]) {
      const arr = (nodeOutputs as Record<string, unknown>)[key];
      if (!Array.isArray(arr)) continue;
      for (const f of arr) {
        const o = f as Record<string, unknown>;
        if (!o?.filename) continue;
        const filename = String(o.filename);
        const subfolder = String(o.subfolder ?? "");
        const type = String(o.type ?? "output");
        files.push({
          filename,
          subfolder,
          type,
          url: `${baseUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`,
        });
      }
    }
  }

  if (statusStr === "error") {
    // 从 messages 里提取执行错误（execution_error / execution_interrupted）
    let errorMessage = "执行出错";
    const messages = entry?.status?.messages ?? [];
    for (const m of messages) {
      if (!Array.isArray(m)) continue;
      const [kind, payload] = m;
      if (kind === "execution_error") {
        const p = payload as Record<string, unknown>;
        errorMessage = `节点 ${p?.node_type ?? "?"} 执行出错：${p?.exception_message ?? "未知错误"}`;
        break;
      }
      if (kind === "execution_interrupted") {
        errorMessage = "已中断";
        break;
      }
    }
    return Response.json({ status: "error", files, errorMessage } satisfies ComfyUiHistoryResponse);
  }
  if (statusStr === "cancelled") {
    return Response.json({ status: "cancelled", files } satisfies ComfyUiHistoryResponse);
  }
  if (entry?.status?.completed) {
    return Response.json({ status: "success", files } satisfies ComfyUiHistoryResponse);
  }
  return Response.json({ status: "running", files: [] } satisfies ComfyUiHistoryResponse);
}
