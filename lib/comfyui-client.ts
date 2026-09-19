import { apiClient } from "./api-client";
import type {
  ComfyUiSettings,
  ComfyUiStatusResponse,
  ComfyUiUploadResponse,
  ComfyUiModelsResponse,
  ComfyUiSubmitResponse,
  ComfyUiHistoryResponse,
} from "./types";

/** 本地 ComfyUI 默认地址 */
export const COMFYUI_DEFAULT_BASE_URL = "http://127.0.0.1:8188";

// ---- settings（所有本地直连小工具共用 key="comfyui"） ----

export async function getComfyUiSettings(): Promise<ComfyUiSettings> {
  try {
    const s = await apiClient.getSetting<ComfyUiSettings>("comfyui");
    if (s?.baseUrl) return s;
  } catch {
    /* ignore */
  }
  return { baseUrl: COMFYUI_DEFAULT_BASE_URL };
}

export async function saveComfyUiSettings(s: ComfyUiSettings): Promise<void> {
  await apiClient.saveSetting("comfyui", s);
}

function normalizeBaseUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) throw new Error("地址需以 http:// 或 https:// 开头");
  return u;
}

// ---- 在线状态探测（GET /system_stats） ----

export async function checkComfyUiStatus(baseUrl: string): Promise<ComfyUiStatusResponse> {
  const base = normalizeBaseUrl(baseUrl);
  try {
    const res = await fetch(`/api/comfyui/status?baseUrl=${encodeURIComponent(base)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { online: false };
    return (await res.json()) as ComfyUiStatusResponse;
  } catch {
    return { online: false };
  }
}

// ---- 上传文件（POST /upload/image，ComfyUI 不校验扩展名，图片/视频/音频均可） ----

export async function uploadComfyUiFile(
  file: File,
  baseUrl: string
): Promise<ComfyUiUploadResponse> {
  const base = normalizeBaseUrl(baseUrl);
  const form = new FormData();
  form.append("baseUrl", base);
  form.append("image", file);
  const res = await fetch("/api/comfyui/upload", { method: "POST", body: form });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as ComfyUiUploadResponse;
}

/** LoadImage / VHS_LoadVideo / LoadAudio 节点文件字段格式：subfolder/name（无 subfolder 时直接 name） */
export function comfyUiImagePath(up: ComfyUiUploadResponse): string {
  return up.subfolder ? `${up.subfolder}/${up.name}` : up.name;
}

// ---- 提交工作流（POST /prompt） ----

export async function submitComfyUiPrompt(params: {
  /** 完整工作流 API JSON（节点已覆盖用户输入） */
  workflow: Record<string, unknown>;
  baseUrl: string;
  /** 日志显示名（工具名） */
  logModel: string;
  /** 日志归类 */
  logType?: "image" | "video";
  signal?: AbortSignal;
}): Promise<ComfyUiSubmitResponse> {
  const base = normalizeBaseUrl(params.baseUrl);
  const res = await fetch("/api/comfyui/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseUrl: base,
      workflow: params.workflow,
      logModel: params.logModel,
      logType: params.logType ?? "video",
    }),
    signal: params.signal,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as ComfyUiSubmitResponse;
}

// ---- 轮询执行结果（GET /history/{promptId}） ----

export async function queryComfyUiHistory(
  promptId: string,
  baseUrl: string
): Promise<ComfyUiHistoryResponse> {
  const base = normalizeBaseUrl(baseUrl);
  const res = await fetch(
    `/api/comfyui/history?baseUrl=${encodeURIComponent(base)}&promptId=${encodeURIComponent(promptId)}`
  );
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as ComfyUiHistoryResponse;
}

export async function pollComfyUiPrompt(
  promptId: string,
  baseUrl: string,
  onUpdate: (r: ComfyUiHistoryResponse) => void,
  opts: {
    intervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    onSuccess?: (r: ComfyUiHistoryResponse) => void;
  } = {}
): Promise<ComfyUiHistoryResponse> {
  const intervalMs = opts.intervalMs ?? 4000;
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
  const start = Date.now();
  const finalize = (r: ComfyUiHistoryResponse): ComfyUiHistoryResponse => {
    const finalStatus: "done" | "failed" | "expired" =
      r.status === "success" ? "done" : r.status === "running" ? "expired" : "failed";
    const finalResult = r.files[0]?.url ?? r.errorMessage ?? r.status;
    void apiClient.finalizeApiCallLog(promptId, finalStatus, finalResult).catch(() => {});
    return r;
  };
  while (Date.now() - start < timeoutMs) {
    if (opts.signal?.aborted) return finalize({ status: "cancelled", files: [] });
    const r = await queryComfyUiHistory(promptId, baseUrl);
    onUpdate(r);
    if (r.status !== "running") {
      if (r.status === "success") opts.onSuccess?.(r);
      return finalize(r);
    }
    await new Promise((resolve) => {
      const t = setTimeout(resolve, intervalMs);
      if (opts.signal) {
        const onAbort = () => {
          clearTimeout(t);
          resolve(undefined);
        };
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }
  return finalize({ status: "error", files: [], errorMessage: "轮询超时" });
}

// ---- 中断当前执行（POST /interrupt，取消时尽力而为） ----

export async function interruptComfyUi(baseUrl: string): Promise<void> {
  try {
    const base = normalizeBaseUrl(baseUrl);
    await fetch("/api/comfyui/interrupt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: base }),
    });
  } catch {
    /* 尽力而为 */
  }
}

// ---- 已安装模型列表（GET /object_info/{UNETLoader,CLIPLoader,VAELoader}） ----

export async function fetchComfyUiModels(baseUrl: string): Promise<ComfyUiModelsResponse> {
  const base = normalizeBaseUrl(baseUrl);
  const res = await fetch(`/api/comfyui/models?baseUrl=${encodeURIComponent(base)}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as ComfyUiModelsResponse;
}

// ---- 释放内存（POST /free：卸载模型 + 清空执行缓存） ----

export async function freeComfyUiMemory(baseUrl: string): Promise<void> {
  const base = normalizeBaseUrl(baseUrl);
  const res = await fetch("/api/comfyui/free", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl: base }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}
