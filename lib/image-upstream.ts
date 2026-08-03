import type { ImageGenSettings, ImageTaskStatus } from "./types";

/**
 * 上游单次查询结果。
 * transient=true 表示瞬态错误（网络异常 / 5xx / 429 / 非 JSON 响应 / 未知状态），
 * 调用方不应将其计为任务终态，而应继续轮询。
 */
export interface UpstreamQueryResult {
  status: ImageTaskStatus;
  imageUrl?: string;
  error?: string;
  transient?: boolean;
}

/**
 * 查询上游异步图片任务状态（服务端直接调用，不经过本地 API 路由）。
 * 状态归一化规则与 /api/image/query 保持一致（该路由内部亦调用本函数）。
 *
 * 终态判定原则（修复旧版"任何 HTTP 错误都算任务失败"的缺陷）：
 * - 上游明确返回 failed / cancelled / error → 终态 failed
 * - HTTP 错误、网络异常、非 JSON 响应、未知状态 → transient（继续轮询）
 */
export async function queryUpstreamImageTask(
  provider: ImageGenSettings["provider"],
  creds: { apiKey: string; baseURL: string },
  jobId: string
): Promise<UpstreamQueryResult> {
  const base = creds.baseURL.replace(/\/+$/, "");
  if (provider === "apimart") {
    return queryApimartTask(base, creds.apiKey, jobId);
  }
  return queryArkTask(base, creds.apiKey, jobId);
}

async function queryApimartTask(
  base: string,
  apiKey: string,
  jobId: string
): Promise<UpstreamQueryResult> {
  const url = `${base}/tasks/${encodeURIComponent(jobId)}?language=zh`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (e) {
    return { status: "running", error: `请求上游失败：${(e as Error).message}`, transient: true };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    let friendly = errText.slice(0, 500);
    try {
      const errJson = JSON.parse(errText);
      friendly = errJson?.error?.message ?? friendly;
    } catch {
      /* keep raw */
    }
    // 404 视为任务不存在（终态），其余 HTTP 错误视为瞬态
    if (res.status === 404) {
      return { status: "failed", error: `上游任务不存在（404）：${friendly}` };
    }
    return { status: "running", error: `上游错误（${res.status}）：${friendly}`, transient: true };
  }

  const rawText = await res.text().catch(() => "");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const snippet = rawText.slice(0, 300).replace(/\s+/g, " ").trim();
    return {
      status: "running",
      error: `上游返回了非 JSON 响应。HTTP ${res.status}，内容片段：${snippet || "(空)"}`,
      transient: true,
    };
  }

  // 成功体：{ code: 200, data: { id, status, progress, result?: { images: [{ url: [...], expires_at }] }, error?: { code, message, type } } }
  const task = ((parsed as { data?: Record<string, unknown> })?.data ?? parsed) as {
    status?: string;
    result?: { images?: Array<{ url?: string[] }> };
    error?: { message?: string };
  };

  const rawStatus = (task.status ?? "").toLowerCase();
  if (rawStatus === "completed") {
    const imgs = task.result?.images;
    const urls = imgs && imgs.length > 0 ? imgs[0].url : undefined;
    if (Array.isArray(urls) && urls.length > 0) {
      return { status: "done", imageUrl: urls[0] };
    }
    return { status: "failed", error: "任务完成但未返回图片 URL" };
  }
  if (rawStatus === "processing") return { status: "running" };
  if (rawStatus === "pending" || rawStatus === "submitted") return { status: "pending" };
  if (rawStatus === "failed" || rawStatus === "error") {
    return { status: "failed", error: task.error?.message || "图片生成失败" };
  }
  if (rawStatus === "cancelled") {
    return { status: "failed", error: task.error?.message || "任务已取消" };
  }
  // 未知状态：视为瞬态，继续轮询（旧版一律归 failed 会丢任务）
  return { status: "running", error: `上游返回未知状态：${rawStatus || "(空)"}`, transient: true };
}

async function queryArkTask(
  base: string,
  apiKey: string,
  jobId: string
): Promise<UpstreamQueryResult> {
  const url = `${base}/images/async-generations/${encodeURIComponent(jobId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (e) {
    return { status: "running", error: `请求上游失败：${(e as Error).message}`, transient: true };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    let friendly = errText.slice(0, 500);
    try {
      const errJson = JSON.parse(errText);
      friendly = errJson?.error?.message ?? friendly;
    } catch {
      /* keep raw */
    }
    if (res.status === 404) {
      return { status: "failed", error: `上游任务不存在（404）：${friendly}` };
    }
    return { status: "running", error: `上游错误（${res.status}）：${friendly}`, transient: true };
  }

  const rawText = await res.text().catch(() => "");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const snippet = rawText.slice(0, 300).replace(/\s+/g, " ").trim();
    return {
      status: "running",
      error: `上游返回了非 JSON 响应。HTTP ${res.status}，内容片段：${snippet || "(空)"}`,
      transient: true,
    };
  }

  // 响应可能为统一包络 { code, message, data: { status, result_urls, error_message } }
  // 也可能为扁平结构 { status, result_urls, error_message }
  const job = ((parsed as { data?: Record<string, unknown> })?.data ?? parsed) as {
    status?: string;
    result_urls?: string[];
    error_message?: string;
    error_code?: string;
  };

  const rawStatus = (job.status ?? "").toLowerCase();
  if (rawStatus === "done" || rawStatus === "succeeded" || rawStatus === "success") {
    const urls = job.result_urls;
    if (Array.isArray(urls) && urls.length > 0) {
      return { status: "done", imageUrl: urls[0] };
    }
    return { status: "failed", error: job.error_message || "任务完成但未返回图片 URL" };
  }
  if (rawStatus === "running" || rawStatus === "processing") return { status: "running" };
  if (rawStatus === "pending" || rawStatus === "queued") return { status: "pending" };
  if (rawStatus === "failed" || rawStatus === "error" || rawStatus === "cancelled") {
    return { status: "failed", error: job.error_message || job.error_code || "图片生成失败" };
  }
  return { status: "running", error: `上游返回未知状态：${rawStatus || "(空)"}`, transient: true };
}
