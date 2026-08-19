import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";
import { maybeCleanOldApiCallLogs, updateApiCallFinal } from "@/lib/api-call-logger";
import type { ApiCallLog, ApiCallLogListResponse } from "@/lib/types";

const ALLOWED_TYPE = new Set(["image", "video"]);
const ALLOWED_STATUS = new Set(["success", "failed"]);

function rowToApiCallLog(row: any): ApiCallLog {
  return {
    id: row.id,
    type: row.type,
    provider: row.provider,
    model: row.model ?? "",
    upstreamUrl: row.upstream_url ?? "",
    requestBody: row.request_body ?? "",
    responseBody: row.response_body ?? "",
    status: row.status,
    error: row.error ?? undefined,
    durationMs: row.duration_ms ?? 0,
    createdAt: row.created_at,
    taskId: row.task_id ?? undefined,
    finalStatus: row.final_status ?? undefined,
    finalResult: row.final_result ?? undefined,
    finalUpdatedAt: row.final_updated_at ?? undefined,
  };
}

/** GET /api/data/api-logs - 列出调用日志（按 created_at 降序，支持筛选 + 分页） */
export async function GET(request: Request) {
  if (!validateAuth(request)) return authError();
  maybeCleanOldApiCallLogs();
  const db = getDb();

  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const provider = url.searchParams.get("provider");
  const status = url.searchParams.get("status");
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200
  );
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

  const where: string[] = [];
  const params: unknown[] = [];
  if (type && ALLOWED_TYPE.has(type)) {
    where.push("type = ?");
    params.push(type);
  }
  if (provider) {
    where.push("provider = ?");
    params.push(provider);
  }
  if (status && ALLOWED_STATUS.has(status)) {
    where.push("status = ?");
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM api_call_logs ${whereSql}`).get(...params) as { c: number }
  ).c;
  const rows = db
    .prepare(
      `SELECT * FROM api_call_logs ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as any[];

  const res: ApiCallLogListResponse = { items: rows.map(rowToApiCallLog), total };
  return Response.json(res);
}

/** POST /api/data/api-logs - 回填轮询终态结果（按 taskId，视频前端轮询完成时调用） */
export async function POST(request: Request) {
  if (!validateAuth(request)) return authError();
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体无效" }, { status: 400 });
  }
  const taskId = typeof body?.taskId === "string" ? body.taskId : "";
  const finalStatus = body?.finalStatus;
  const finalResult = typeof body?.finalResult === "string" ? body.finalResult : "";
  if (!taskId || !["done", "failed", "expired"].includes(finalStatus)) {
    return Response.json({ error: "参数无效（taskId / finalStatus）" }, { status: 400 });
  }
  updateApiCallFinal(taskId, finalStatus, finalResult);
  return Response.json({ ok: true });
}

/** DELETE /api/data/api-logs - 批量删除；ids 为空时清空全部 */
export async function DELETE(request: Request) {
  if (!validateAuth(request)) return authError();

  let ids: string[] = [];
  try {
    const body = await request.json();
    ids = Array.isArray(body?.ids)
      ? body.ids.filter((x: unknown) => typeof x === "string")
      : [];
  } catch {
    return Response.json({ error: "请求体无效" }, { status: 400 });
  }

  const db = getDb();
  if (ids.length === 0) {
    const info = db.prepare("DELETE FROM api_call_logs").run();
    return Response.json({ ok: true, deleted: info.changes });
  }
  const placeholders = ids.map(() => "?").join(",");
  const info = db.prepare(`DELETE FROM api_call_logs WHERE id IN (${placeholders})`).run(...ids);
  return Response.json({ ok: true, deleted: info.changes });
}
