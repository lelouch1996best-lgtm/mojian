import { getDb } from "./db";
import { fetchComfyUiHistory } from "./comfyui-history";
import { updateApiCallFinal, maybeCleanOldApiCallLogs } from "./api-call-logger";
import type { ComfyUiHistoryResponse, ToolTaskRecord, ToolTaskSource } from "./types";

/** 轮询间隔：与原前端轮询一致（ComfyUI 4s / RunningHub 8s） */
const POLL_INTERVAL_MS: Record<ToolTaskSource, number> = { comfyui: 4000, runninghub: 8000 };
/** 硬超时：ComfyUI 30 分钟 / RunningHub 15 分钟（与原前端轮询一致） */
const HARD_TIMEOUT_MS: Record<ToolTaskSource, number> = {
  comfyui: 30 * 60 * 1000,
  runninghub: 15 * 60 * 1000,
};
/** 连续瞬态失败达到该次数才标记 failed */
const MAX_CONSECUTIVE_FAILURES = 10;
/** 终态任务保留 7 天（ensureRunning 时顺手清理） */
const TERMINAL_RETENTION_MS = 7 * 24 * 3600 * 1000;
/** ensureRunning 节流间隔 */
const ENSURE_THROTTLE_MS = 60 * 1000;

const RUNNINGHUB_QUERY_URL = "https://www.runninghub.ai/openapi/v2/query";

interface TaskRow {
  id: string;
  tool_id: string;
  tool_name: string;
  source: string;
  media_type: string;
  title: string;
  prompt: string;
  upstream_task_id: string | null;
  base_url: string | null;
  status: string;
  result_url: string | null;
  error: string | null;
  fail_count: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface RegisterToolTaskInput {
  toolId: string;
  toolName: string;
  source: ToolTaskSource;
  mediaType: "image" | "video";
  title?: string;
  prompt?: string;
  upstreamTaskId: string;
  baseUrl?: string;
}

function rowToRecord(row: TaskRow): ToolTaskRecord {
  return {
    id: row.id,
    toolId: row.tool_id,
    toolName: row.tool_name,
    source: row.source as ToolTaskSource,
    mediaType: row.media_type as "image" | "video",
    title: row.title,
    prompt: row.prompt,
    upstreamTaskId: row.upstream_task_id ?? undefined,
    baseUrl: row.base_url ?? undefined,
    status: row.status as ToolTaskRecord["status"],
    resultUrl: row.result_url ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

function isTerminal(status: string): boolean {
  return ["done", "failed", "cancelled", "expired"].includes(status);
}

/** 从 settings 表读 RunningHub apiKey（服务端直读，不经前端） */
function getRunningHubApiKey(): string {
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get("runninghub") as
      | { value: string }
      | undefined;
    if (!row?.value) return "";
    return (JSON.parse(row.value) as { apiKey?: string })?.apiKey ?? "";
  } catch {
    return "";
  }
}

/** ComfyUI 输出文件挑选：按媒体类型挑扩展名匹配的文件，fallback 第一个 */
function pickResultFile(files: ComfyUiHistoryResponse["files"], mediaType: string): string {
  if (files.length === 0) return "";
  const videoRe = /\.(mp4|webm|mov|mkv)$/i;
  const imageRe = /\.(png|jpe?g|webp)$/i;
  const re = mediaType === "video" ? videoRe : imageRe;
  return (files.find((f) => re.test(f.filename) || re.test(f.url)) ?? files[0]).url;
}

/**
 * AI 小工具任务中心：任务提交后由本进程负责轮询上游（RunningHub / 本地 ComfyUI），
 * 终态回填 api_call_logs。前端（工具页/任务中心页）只订阅任务状态，
 * 页面刷新/关闭/应用重启（经 ensureRunning 惰性恢复）均不影响进行中的任务。
 */
class ToolTaskCenter {
  private running = new Map<string, AbortController>();
  private lastEnsureAt = 0;

  /** 注册任务（幂等，按 upstream_task_id 去重）：插入记录并启动轮询循环 */
  registerTask(input: RegisterToolTaskInput): ToolTaskRecord {
    const db = getDb();
    const existing = db
      .prepare("SELECT * FROM tool_tasks WHERE upstream_task_id = ?")
      .get(input.upstreamTaskId) as TaskRow | undefined;
    if (existing) {
      if (!isTerminal(existing.status)) this.startLoop(existing.id);
      return rowToRecord(existing);
    }
    const now = Date.now();
    db.prepare(
      `INSERT INTO tool_tasks
        (id, tool_id, tool_name, source, media_type, title, prompt, upstream_task_id, base_url, status, fail_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', 0, ?, ?)`
    ).run(
      crypto.randomUUID(),
      input.toolId,
      input.toolName,
      input.source,
      input.mediaType,
      input.title ?? "",
      (input.prompt ?? "").slice(0, 500),
      input.upstreamTaskId,
      input.baseUrl?.replace(/\/+$/, "") ?? null,
      now,
      now
    );
    const row = db
      .prepare("SELECT * FROM tool_tasks WHERE upstream_task_id = ?")
      .get(input.upstreamTaskId) as TaskRow;
    this.startLoop(row.id);
    return rowToRecord(row);
  }

  /** 分页列表（created_at 降序），status 传 "active" 时查进行中 */
  listTasks(opts: { status?: string; limit: number; offset: number }): { items: ToolTaskRecord[]; total: number } {
    const db = getDb();
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.status === "active") {
      where.push("status IN ('running')");
    } else if (opts.status && isTerminal(opts.status)) {
      where.push("status = ?");
      params.push(opts.status);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (
      db.prepare(`SELECT COUNT(*) AS c FROM tool_tasks ${whereSql}`).get(...params) as { c: number }
    ).c;
    const rows = db
      .prepare(`SELECT * FROM tool_tasks ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, opts.limit, opts.offset) as TaskRow[];
    return { items: rows.map(rowToRecord), total };
  }

  /** 取消任务：停止轮询；comfyui 任务尽力中断本机执行；置 cancelled */
  cancelTask(id: string): ToolTaskRecord | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM tool_tasks WHERE id = ?").get(id) as TaskRow | undefined;
    if (!row) return null;
    if (isTerminal(row.status)) return rowToRecord(row);
    this.stopLoop(id);
    if (row.source === "comfyui" && row.base_url) {
      // RunningHub 无上游取消 API；ComfyUI 通过 /interrupt 中断当前执行（尽力而为）
      void fetch(`${row.base_url}/interrupt`, { method: "POST" }).catch(() => {});
    }
    const now = Date.now();
    db.prepare(
      "UPDATE tool_tasks SET status = 'cancelled', updated_at = ?, completed_at = ? WHERE id = ?"
    ).run(now, now, id);
    if (row.upstream_task_id) {
      updateApiCallFinal(row.upstream_task_id, "failed", "已取消");
    }
    return this.getTask(id);
  }

  getTask(id: string): ToolTaskRecord | null {
    const row = getDb().prepare("SELECT * FROM tool_tasks WHERE id = ?").get(id) as
      | TaskRow
      | undefined;
    return row ? rowToRecord(row) : null;
  }

  /** 批量删除：停止仍在轮询的循环后删记录 */
  deleteTasks(ids: string[]): number {
    if (ids.length === 0) {
      for (const ac of Array.from(this.running.values())) ac.abort();
      this.running.clear();
      const info = getDb().prepare("DELETE FROM tool_tasks").run();
      return info.changes;
    }
    for (const id of ids) this.stopLoop(id);
    const placeholders = ids.map(() => "?").join(",");
    const info = getDb().prepare(`DELETE FROM tool_tasks WHERE id IN (${placeholders})`).run(...ids);
    return info.changes;
  }

  /**
   * 惰性恢复：扫描 DB 中进行中但内存无轮询循环的任务并重启轮询；
   * 顺手清理过期的终态任务。相关 API 路由入口调用，内部节流。
   */
  ensureRunning(): void {
    const now = Date.now();
    if (now - this.lastEnsureAt < ENSURE_THROTTLE_MS) return;
    this.lastEnsureAt = now;
    try {
      const db = getDb();
      db.prepare(
        "DELETE FROM tool_tasks WHERE status IN ('done','failed','cancelled','expired') AND updated_at < ?"
      ).run(now - TERMINAL_RETENTION_MS);
      const rows = db
        .prepare("SELECT id FROM tool_tasks WHERE status = 'running'")
        .all() as Array<{ id: string }>;
      for (const r of rows) this.startLoop(r.id);
      maybeCleanOldApiCallLogs(7);
    } catch (e) {
      console.error("[tool-task-center] ensureRunning 失败：", e);
    }
  }

  private startLoop(id: string): void {
    if (this.running.has(id)) return;
    const ac = new AbortController();
    this.running.set(id, ac);
    void this.pollLoop(id, ac.signal)
      .catch((e) => {
        console.error(`[tool-task-center] 轮询循环异常退出（${id}）：`, e);
      })
      .finally(() => {
        this.running.delete(id);
      });
  }

  private stopLoop(id: string): void {
    const ac = this.running.get(id);
    if (ac) {
      ac.abort();
      this.running.delete(id);
    }
  }

  private setFinal(row: TaskRow, status: string, resultUrl: string | null, error: string | null): void {
    getDb()
      .prepare(
        `UPDATE tool_tasks
           SET status = ?, result_url = ?, error = ?, fail_count = 0, updated_at = ?, completed_at = ?
         WHERE id = ?`
      )
      .run(status, resultUrl, error, Date.now(), Date.now(), row.id);
    if (row.upstream_task_id) {
      const finalStatus = status === "done" ? "done" : status === "expired" ? "expired" : "failed";
      updateApiCallFinal(row.upstream_task_id, finalStatus, resultUrl ?? error ?? status);
    }
  }

  private async pollLoop(id: string, signal: AbortSignal): Promise<void> {
    const db = getDb();
    while (!signal.aborted) {
      const row = db.prepare("SELECT * FROM tool_tasks WHERE id = ?").get(id) as
        | TaskRow
        | undefined;
      if (!row || isTerminal(row.status)) return;

      if (Date.now() - row.created_at > HARD_TIMEOUT_MS[row.source as ToolTaskSource]) {
        this.setFinal(row, "expired", null, "轮询超时");
        return;
      }

      // 上游查询（异常视为瞬态失败，累计容错）
      let transientError = "";
      if (row.source === "comfyui") {
        try {
          const r = await fetchComfyUiHistory(row.base_url ?? "", row.upstream_task_id ?? "");
          if (signal.aborted) return;
          if (r.status === "success") {
            this.setFinal(row, "done", pickResultFile(r.files, row.media_type), null);
            return;
          }
          if (r.status === "error") {
            this.setFinal(row, "failed", null, r.errorMessage ?? "执行出错");
            return;
          }
          if (r.status === "cancelled") {
            this.setFinal(row, "cancelled", null, "已中断");
            return;
          }
          // running：清空错误继续等
          if (row.fail_count > 0 || row.error) {
            db.prepare("UPDATE tool_tasks SET fail_count = 0, error = NULL, updated_at = ? WHERE id = ?")
              .run(Date.now(), id);
          }
        } catch (e) {
          transientError = e instanceof Error ? e.message : String(e);
        }
      } else {
        // RunningHub
        const apiKey = getRunningHubApiKey();
        if (!apiKey) {
          this.setFinal(row, "failed", null, "未配置 RunningHub API Key，无法轮询任务结果");
          return;
        }
        try {
          const res = await fetch(RUNNINGHUB_QUERY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ taskId: row.upstream_task_id }),
            signal: AbortSignal.timeout(10_000),
          });
          if (signal.aborted) return;
          if (!res.ok) {
            transientError = `查询上游失败（${res.status}）`;
          } else {
            const data = await res.json();
            const status: string = data?.status ?? "";
            if (status === "SUCCESS") {
              const url = Array.isArray(data?.results) ? (data.results[0]?.url ?? "") : "";
              this.setFinal(row, "done", url || null, url ? null : "任务成功但未解析到结果地址");
              return;
            }
            if (status === "FAILED") {
              this.setFinal(row, "failed", null, data?.errorMessage || "任务失败");
              return;
            }
            // QUEUED / RUNNING：清空错误继续等
            if (row.fail_count > 0 || row.error) {
              db.prepare("UPDATE tool_tasks SET fail_count = 0, error = NULL, updated_at = ? WHERE id = ?")
                .run(Date.now(), id);
            }
          }
        } catch (e) {
          transientError = e instanceof Error ? e.message : String(e);
        }
      }
      if (signal.aborted) return;

      if (transientError) {
        const fails = row.fail_count + 1;
        if (fails >= MAX_CONSECUTIVE_FAILURES) {
          this.setFinal(row, "failed", null, `连续 ${fails} 次查询失败：${transientError}`);
          return;
        }
        db.prepare("UPDATE tool_tasks SET fail_count = ?, error = ?, updated_at = ? WHERE id = ?")
          .run(fails, transientError, Date.now(), id);
      }

      await sleep(POLL_INTERVAL_MS[row.source as ToolTaskSource], signal);
    }
  }
}

const g = globalThis as unknown as { __toolTaskCenter?: ToolTaskCenter };

/** 任务中心单例（挂 globalThis，防 dev HMR 模块重建丢失轮询循环） */
export function getToolTaskCenter(): ToolTaskCenter {
  if (!g.__toolTaskCenter) {
    g.__toolTaskCenter = new ToolTaskCenter();
  }
  return g.__toolTaskCenter;
}
