import type { ComfyUiHistoryResponse, ComfyUiOutputFile } from "./types";

/**
 * 查询本地 ComfyUI 执行历史并归一化为 { status, files, errorMessage }。
 * 供 /api/comfyui/history 代理与任务中心服务端轮询共用。
 * 连接失败 / 上游非 2xx 时抛错（错误信息带原因）。
 */
export async function fetchComfyUiHistory(
  baseUrl: string,
  promptId: string
): Promise<ComfyUiHistoryResponse> {
  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`无法连接本地 ComfyUI：${msg}`);
  }
  if (!upstream.ok) {
    throw new Error(`查询失败（${upstream.status}）`);
  }

  const data = await upstream.json();
  const entry = data?.[promptId];
  // history 为空对象 = 还在队列/执行中
  if (!entry) return { status: "running", files: [] };

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
    return { status: "error", files, errorMessage };
  }
  if (statusStr === "cancelled") {
    return { status: "cancelled", files };
  }
  if (entry?.status?.completed) {
    return { status: "success", files };
  }
  return { status: "running", files: [] };
}
