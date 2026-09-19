import { apiClient } from "./api-client";
import type {
  RunningHubSettings,
  RunningHubRunProxyRequest,
  RunningHubRunProxyResponse,
  RunningHubQueryProxyRequest,
  RunningHubQueryProxyResponse,
  RunningHubUploadProxyResponse,
  SuperResolutionScale,
} from "./types";

export const RUNNINGHUB_BASE_URL = "https://www.runninghub.ai";
/** 超分 AI 应用 ID（固定） */
export const SUPER_RESOLUTION_APP_ID = "2034560632665677825";
/** 换装 AI 应用 ID（固定） */
export const OUTFIT_CHANGE_APP_ID = "2012848202482978818";
/** 局部编辑 AI 应用 ID（固定） */
export const INPAINT_APP_ID = "2004164487110369282";

// ---- settings ----

export async function getRunningHubSettings(): Promise<RunningHubSettings | null> {
  try {
    return await apiClient.getSetting<RunningHubSettings>("runninghub");
  } catch {
    return null;
  }
}

export async function saveRunningHubSettings(s: RunningHubSettings): Promise<void> {
  await apiClient.saveSetting("runninghub", s);
}

export async function isRunningHubConfigured(): Promise<boolean> {
  return !!(await getRunningHubSettings())?.apiKey;
}

// ---- 上传本地媒体文件（图片/视频通用） ----

export async function uploadMediaFile(file: File): Promise<RunningHubUploadProxyResponse> {
  const settings = await getRunningHubSettings();
  if (!settings?.apiKey) throw new Error("请先配置 RunningHub API Key");
  const form = new FormData();
  form.append("apiKey", settings.apiKey);
  form.append("file", file);
  const res = await fetch("/api/runninghub/upload", { method: "POST", body: form });
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
  return (await res.json()) as RunningHubUploadProxyResponse;
}

// ---- 提交任务（共享：对并发上限 421 自动重试） ----

/** 判断是否为 RunningHub 并发上限错误（errorCode 421），可稍后重试 */
function isQueueLimitError(errorCode: unknown, msg: string): boolean {
  return (
    String(errorCode ?? "") === "421" ||
    /并发数已达|queue limit/i.test(msg)
  );
}

async function postRun(
  body: RunningHubRunProxyRequest,
  opts: { maxAttempts?: number; intervalMs?: number; signal?: AbortSignal } = {}
): Promise<RunningHubRunProxyResponse> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const intervalMs = opts.intervalMs ?? 10_000;
  for (let attempt = 1; ; attempt++) {
    if (opts.signal?.aborted) throw new Error("已取消");
    const res = await fetch("/api/runninghub/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (res.ok) return (await res.json()) as RunningHubRunProxyResponse;
    let msg = `HTTP ${res.status}`;
    let errorCode: unknown = "";
    try {
      const data = await res.json();
      msg = data.error ?? msg;
      errorCode = data.errorCode;
    } catch {
      /* ignore */
    }
    // 并发上限为瞬时错误，等待后自动重试
    if (isQueueLimitError(errorCode, msg) && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }
    throw new Error(msg);
  }
}

// ---- 提交超分任务 ----

export async function submitSuperResolution(params: {
  /** 上传返回的 downloadUrl（或 fileName），作为 nodeId=6 file 节点的 fieldValue */
  fileFieldValue: string;
  /** 超分倍率 */
  scale: SuperResolutionScale;
  /** 取消信号（中断提交与并发重试等待） */
  signal?: AbortSignal;
}): Promise<RunningHubRunProxyResponse> {
  const settings = await getRunningHubSettings();
  if (!settings?.apiKey) throw new Error("请先配置 RunningHub API Key");
  const body: RunningHubRunProxyRequest = {
    apiKey: settings.apiKey,
    appId: SUPER_RESOLUTION_APP_ID,
    logType: "video",
    logModel: "视频超分",
    payload: {
      nodeInfoList: [
        // 节点 11 = 超分倍率（RTX Video Super Resolution Multiples），值形如 "2.0"/"3.0"/"4.0"
        { nodeId: "11", fieldName: "value", fieldValue: `${params.scale}.0`, description: "超分倍率" },
        // 节点 6 = 输入视频 file 节点，fieldValue 取上传返回的 downloadUrl/fileName
        { nodeId: "6", fieldName: "file", fieldValue: params.fileFieldValue, description: "输入视频" },
      ],
      instanceType: "default",
      usePersonalQueue: "false",
    },
  };
  return postRun(body, { signal: params.signal });
}

// ---- 提交换装任务 ----

export async function submitOutfitChange(params: {
  /** 人物图（nodeId=107 image 节点的 fieldValue），取上传返回的 downloadUrl */
  modelImageFieldValue: string;
  /** 服装图（nodeId=285 image 节点的 fieldValue），取上传返回的 downloadUrl */
  clothingImageFieldValue: string;
  /** 提示词（nodeId=223 value 节点） */
  prompt: string;
  /** 取消信号（中断提交与并发重试等待） */
  signal?: AbortSignal;
}): Promise<RunningHubRunProxyResponse> {
  const settings = await getRunningHubSettings();
  if (!settings?.apiKey) throw new Error("请先配置 RunningHub API Key");
  const body: RunningHubRunProxyRequest = {
    apiKey: settings.apiKey,
    appId: OUTFIT_CHANGE_APP_ID,
    logType: "image",
    logModel: "AI 换装",
    payload: {
      nodeInfoList: [
        // 节点 107 = 人物图（Model image）
        { nodeId: "107", fieldName: "image", fieldValue: params.modelImageFieldValue, description: "人物图" },
        // 节点 285 = 服装图（Replace clothing image）
        { nodeId: "285", fieldName: "image", fieldValue: params.clothingImageFieldValue, description: "服装图" },
        // 节点 223 = 提示词（Prompt）
        { nodeId: "223", fieldName: "value", fieldValue: params.prompt, description: "提示词" },
      ],
      instanceType: "default",
      usePersonalQueue: "false",
    },
  };
  return postRun(body, { signal: params.signal });
}

// ---- 提交局部编辑任务 ----

export async function submitInpaint(params: {
  /** 带蒙版图片（nodeId=107 image 节点）。示例 fieldValue 为 clipspace/xxx.png [input]（ComfyUI 文件路径格式），此处用上传返回的 fileName（openapi/xxx.png）；若报节点参数错误可改用 downloadUrl */
  imageFieldValue: string;
  /** 提示词（nodeId=223 value 节点），如「戴一顶帽子」 */
  prompt: string;
  /** 取消信号（中断提交与并发重试等待） */
  signal?: AbortSignal;
}): Promise<RunningHubRunProxyResponse> {
  const settings = await getRunningHubSettings();
  if (!settings?.apiKey) throw new Error("请先配置 RunningHub API Key");
  const body: RunningHubRunProxyRequest = {
    apiKey: settings.apiKey,
    appId: INPAINT_APP_ID,
    logType: "image",
    logModel: "图片局部编辑",
    payload: {
      nodeInfoList: [
        // 节点 107 = 带蒙版图片（image (please draw mask)，蒙版编码在 PNG alpha 通道，涂抹区透明）
        { nodeId: "107", fieldName: "image", fieldValue: params.imageFieldValue, description: "图片" },
        // 节点 223 = 提示词（value prompt）
        { nodeId: "223", fieldName: "value", fieldValue: params.prompt, description: "提示词" },
      ],
      instanceType: "default",
      usePersonalQueue: "false",
    },
  };
  return postRun(body, { signal: params.signal });
}

// ---- 查询任务状态 ----

export async function queryRunningHubTask(taskId: string): Promise<RunningHubQueryProxyResponse> {
  const settings = await getRunningHubSettings();
  if (!settings?.apiKey) throw new Error("请先配置 RunningHub API Key");
  const body: RunningHubQueryProxyRequest = { apiKey: settings.apiKey, taskId };
  const res = await fetch("/api/runninghub/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  return (await res.json()) as RunningHubQueryProxyResponse;
}

// ---- 轮询任务直到终态（参考 pollVideoTask） ----

export async function pollRunningHubTask(
  taskId: string,
  onUpdate: (r: RunningHubQueryProxyResponse) => void,
  opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal; onSuccess?: (r: RunningHubQueryProxyResponse) => void } = {}
): Promise<RunningHubQueryProxyResponse> {
  const intervalMs = opts.intervalMs ?? 8000;
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
  const start = Date.now();
  const finalize = (r: RunningHubQueryProxyResponse): RunningHubQueryProxyResponse => {
    const finalStatus: "done" | "failed" | "expired" =
      r.status === "SUCCESS" ? "done" : r.status === "FAILED" ? "failed" : "expired";
    const finalResult = r.results?.[0]?.url ?? r.errorMessage ?? r.status;
    void apiClient.finalizeApiCallLog(taskId, finalStatus, finalResult).catch(() => {});
    return r;
  };
  while (Date.now() - start < timeoutMs) {
    if (opts.signal?.aborted) return finalize({ status: "FAILED", errorMessage: "已取消" });
    const r = await queryRunningHubTask(taskId);
    onUpdate(r);
    if (r.status === "SUCCESS") {
      opts.onSuccess?.(r);
      return finalize(r);
    }
    if (r.status === "FAILED") return finalize(r);
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
  return finalize({ status: "FAILED", errorMessage: "轮询超时" });
}
