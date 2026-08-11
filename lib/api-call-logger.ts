import { getDb } from "@/lib/db";

export interface ApiCallLogInput {
  type: "image" | "video";
  provider: string;
  model: string;
  upstreamUrl: string;
  requestBody: unknown;
  responseBody: string;
  status: "success" | "failed";
  error?: string;
  durationMs: number;
  /** 异步任务的 jobId/taskId（提交成功时记录，用于轮询终态回填） */
  taskId?: string;
  /** 提交即可确定最终结果时直接写入（如提交失败、同步模式成功）；异步任务留空待回填 */
  finalStatus?: "done" | "failed";
  finalResult?: string;
}

function sanitizeBody(obj: unknown): string {
  const seen = new WeakSet();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string" && v.startsWith("data:") && v.length > 128) {
      return `${v.slice(0, 64)}…<truncated, len=${v.length}>`;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  try {
    return JSON.stringify(walk(obj));
  } catch {
    return JSON.stringify(String(obj));
  }
}

export function logApiCall(input: ApiCallLogInput): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO api_call_logs
        (id, type, provider, model, upstream_url, request_body, response_body, status, error, duration_ms, created_at, task_id, final_status, final_result, final_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      input.type,
      input.provider,
      input.model,
      input.upstreamUrl,
      sanitizeBody(input.requestBody),
      input.responseBody.slice(0, 4000),
      input.status,
      input.error ?? null,
      input.durationMs,
      Date.now(),
      input.taskId ?? null,
      input.finalStatus ?? null,
      input.finalResult ?? null,
      input.finalStatus ? Date.now() : null
    );
  } catch (e) {
    console.warn("[api-call-logger] 写入失败", e);
  }
}

const g = globalThis as { __apiLogCleanAt?: number };

/** 轮询终态回填：按 taskId 更新最终状态与结果（无匹配行时 no-op） */
export function updateApiCallFinal(
  taskId: string,
  finalStatus: "done" | "failed" | "expired",
  finalResult: string
): void {
  try {
    getDb().prepare(
      `UPDATE api_call_logs SET final_status = ?, final_result = ?, final_updated_at = ? WHERE task_id = ?`
    ).run(finalStatus, finalResult.slice(0, 4000), Date.now(), taskId);
  } catch (e) {
    console.warn("[api-call-logger] 回填最终结果失败", e);
  }
}

export function maybeCleanOldApiCallLogs(days = 7): void {
  const now = Date.now();
  if (g.__apiLogCleanAt && now - g.__apiLogCleanAt < 60_000) return;
  g.__apiLogCleanAt = now;
  try {
    getDb().prepare("DELETE FROM api_call_logs WHERE created_at < ?").run(now - days * 86400_000);
  } catch {
    /* ignore */
  }
}
