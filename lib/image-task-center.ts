import { getDb } from "./db";
import { queryUpstreamImageTask, type UpstreamQueryResult } from "./image-upstream";
import { isStorageConfiguredInDb, transferToStorage } from "./storage-transfer";
import { maybeCleanOldApiCallLogs, updateApiCallFinal } from "./api-call-logger";
import type { ImageGenSettings, ImageTaskRecord, ImageTaskStatus } from "./types";

const POLL_INTERVAL_MS = 3000;
/** 连续瞬态失败达到该次数才标记 failed（约 30 秒连续失败） */
const MAX_CONSECUTIVE_FAILURES = 10;
/** 硬超时：自任务创建起 30 分钟 → expired（保留记录，可 retry） */
const HARD_TIMEOUT_MS = 30 * 60 * 1000;
/** 终态任务保留 7 天（供前端补写回），ensureRunning 时顺手清理 */
const TERMINAL_RETENTION_MS = 7 * 24 * 3600 * 1000;
/** ensureRunning 节流间隔 */
const ENSURE_THROTTLE_MS = 60 * 1000;

type Provider = ImageGenSettings["provider"];

interface TaskRow {
  job_id: string;
  provider: string;
  api_key: string;
  base_url: string;
  model: string;
  cos_prefix: string;
  status: string;
  image_url: string | null;
  upstream_url: string | null;
  error: string | null;
  fail_count: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface RegisterImageTaskInput {
  jobId: string;
  provider: Provider;
  apiKey: string;
  baseURL: string;
  model?: string;
  cosPrefix?: string;
}

function rowToRecord(row: TaskRow): ImageTaskRecord {
  return {
    jobId: row.job_id,
    provider: row.provider as Provider,
    baseURL: row.base_url,
    model: row.model,
    cosPrefix: row.cos_prefix,
    status: row.status as ImageTaskStatus,
    imageUrl: row.image_url ?? undefined,
    upstreamUrl: row.upstream_url ?? undefined,
    error: row.error ?? undefined,
    failCount: row.fail_count,
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
  return status === "done" || status === "failed" || status === "expired";
}

/**
 * 服务端图片任务中心：任务提交后由本进程负责轮询上游、瞬态容错、
 * 超时管理与 COS 转存。前端只订阅本地任务状态，页面刷新/关闭/应用重启
 * 均不影响进行中的任务。
 */
class ImageTaskCenter {
  private running = new Map<string, AbortController>();
  private lastEnsureAt = 0;

  /** 注册任务（幂等）：无记录则插入；进行中任务确保轮询循环在跑 */
  registerTask(input: RegisterImageTaskInput): ImageTaskRecord {
    const db = getDb();
    const now = Date.now();
    const existing = db
      .prepare("SELECT * FROM image_tasks WHERE job_id = ?")
      .get(input.jobId) as TaskRow | undefined;

    if (!existing) {
      db.prepare(
        `INSERT INTO image_tasks
           (job_id, provider, api_key, base_url, model, cos_prefix, status, fail_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
      ).run(
        input.jobId,
        input.provider,
        input.apiKey,
        input.baseURL.replace(/\/+$/, ""),
        input.model ?? "",
        input.cosPrefix ?? "ai-script/assets",
        now,
        now
      );
    }

    const row = (existing ??
      db.prepare("SELECT * FROM image_tasks WHERE job_id = ?").get(input.jobId)) as TaskRow;
    if (!isTerminal(row.status)) {
      this.startLoop(row.job_id);
    }
    return rowToRecord(row);
  }

  /** 批量查询任务（API 响应已脱敏，不含 api_key） */
  getTasks(jobIds: string[]): ImageTaskRecord[] {
    if (jobIds.length === 0) return [];
    const placeholders = jobIds.map(() => "?").join(",");
    const rows = getDb()
      .prepare(`SELECT * FROM image_tasks WHERE job_id IN (${placeholders})`)
      .all(...jobIds) as TaskRow[];
    return rows.map(rowToRecord);
  }

  getTask(jobId: string): ImageTaskRecord | null {
    const row = getDb()
      .prepare("SELECT * FROM image_tasks WHERE job_id = ?")
      .get(jobId) as TaskRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  /** 失败/过期任务重试：重置状态与超时起点，重启轮询（进行中任务为空操作） */
  retryTask(jobId: string): ImageTaskRecord | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM image_tasks WHERE job_id = ?").get(jobId) as
      | TaskRow
      | undefined;
    if (!row) return null;
    if (!isTerminal(row.status)) {
      this.startLoop(jobId);
      return rowToRecord(row);
    }
    const now = Date.now();
    db.prepare(
      "UPDATE image_tasks SET status = 'pending', fail_count = 0, error = NULL, created_at = ?, updated_at = ?, completed_at = NULL WHERE job_id = ?"
    ).run(now, now, jobId);
    this.stopLoop(jobId);
    this.startLoop(jobId);
    return this.getTask(jobId);
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
        "DELETE FROM image_tasks WHERE status IN ('done','failed','expired') AND updated_at < ?"
      ).run(now - TERMINAL_RETENTION_MS);
      const rows = db
        .prepare("SELECT job_id FROM image_tasks WHERE status IN ('pending','running')")
        .all() as Array<{ job_id: string }>;
      for (const r of rows) this.startLoop(r.job_id);
      maybeCleanOldApiCallLogs(7);
    } catch (e) {
      console.error("[image-task-center] ensureRunning 失败：", e);
    }
  }

  private startLoop(jobId: string): void {
    if (this.running.has(jobId)) return;
    const ac = new AbortController();
    this.running.set(jobId, ac);
    void this.pollLoop(jobId, ac.signal)
      .catch((e) => {
        console.error(`[image-task-center] 轮询循环异常退出（${jobId}）：`, e);
      })
      .finally(() => {
        this.running.delete(jobId);
      });
  }

  private stopLoop(jobId: string): void {
    const ac = this.running.get(jobId);
    if (ac) {
      ac.abort();
      this.running.delete(jobId);
    }
  }

  private async pollLoop(jobId: string, signal: AbortSignal): Promise<void> {
    const db = getDb();
    while (!signal.aborted) {
      const row = db.prepare("SELECT * FROM image_tasks WHERE job_id = ?").get(jobId) as
        | TaskRow
        | undefined;
      if (!row || isTerminal(row.status)) return;

      if (Date.now() - row.created_at > HARD_TIMEOUT_MS) {
        db.prepare(
          "UPDATE image_tasks SET status = 'expired', error = ?, updated_at = ? WHERE job_id = ?"
        ).run("轮询超时（30 分钟），可重试", Date.now(), jobId);
        updateApiCallFinal(jobId, "expired", "轮询超时（30 分钟），可重试");
        return;
      }

      let result: UpstreamQueryResult;
      try {
        result = await queryUpstreamImageTask(row.provider as Provider, {
          apiKey: row.api_key,
          baseURL: row.base_url,
        }, jobId);
      } catch (e) {
        result = { status: "running", error: `查询异常：${(e as Error).message}`, transient: true };
      }
      if (signal.aborted) return;

      if (result.status === "done" && result.imageUrl) {
        await this.completeTask(row, result.imageUrl, signal);
        return;
      }

      if (result.status === "failed" && !result.transient) {
        db.prepare(
          "UPDATE image_tasks SET status = 'failed', error = ?, fail_count = 0, updated_at = ? WHERE job_id = ?"
        ).run(result.error ?? "图片生成失败", Date.now(), jobId);
        updateApiCallFinal(jobId, "failed", result.error ?? "图片生成失败");
        return;
      }

      if (result.transient) {
        const fails = row.fail_count + 1;
        if (fails >= MAX_CONSECUTIVE_FAILURES) {
          db.prepare(
            "UPDATE image_tasks SET status = 'failed', error = ?, fail_count = ?, updated_at = ? WHERE job_id = ?"
          ).run(
            `连续 ${fails} 次查询失败：${result.error ?? "未知错误"}`,
            fails,
            Date.now(),
            jobId
          );
          updateApiCallFinal(jobId, "failed", `连续 ${fails} 次查询失败：${result.error ?? "未知错误"}`);
          return;
        }
        db.prepare(
          "UPDATE image_tasks SET fail_count = ?, error = ?, updated_at = ? WHERE job_id = ?"
        ).run(fails, result.error ?? null, Date.now(), jobId);
      } else {
        db.prepare(
          "UPDATE image_tasks SET status = ?, fail_count = 0, error = NULL, updated_at = ? WHERE job_id = ?"
        ).run(result.status, Date.now(), jobId);
      }

      await sleep(POLL_INTERVAL_MS, signal);
    }
  }

  /** 完成处理：先记上游 URL，再尝试 COS 转存（3 次指数退避），最终落 done */
  private async completeTask(row: TaskRow, upstreamUrl: string, signal: AbortSignal): Promise<void> {
    const db = getDb();
    let imageUrl = upstreamUrl;
    let transferError: string | null = null;

    if (isStorageConfiguredInDb()) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal.aborted) break;
        try {
          const { url } = await transferToStorage(upstreamUrl, row.cos_prefix);
          imageUrl = url;
          transferError = null;
          break;
        } catch (e) {
          transferError = `存储转存失败：${(e as Error).message}`;
          if (attempt < 2) await sleep(1000 * 2 ** attempt, signal);
        }
      }
    }

    db.prepare(
      `UPDATE image_tasks
         SET status = 'done', image_url = ?, upstream_url = ?, error = ?, fail_count = 0, updated_at = ?, completed_at = ?
       WHERE job_id = ?`
    ).run(imageUrl, upstreamUrl, transferError, Date.now(), Date.now(), row.job_id);
    updateApiCallFinal(row.job_id, "done", transferError ? `${imageUrl}（${transferError}）` : imageUrl);
  }
}

const g = globalThis as unknown as { __imageTaskCenter?: ImageTaskCenter };

/** 任务中心单例（挂 globalThis，防 dev HMR 模块重建丢失轮询循环） */
export function getImageTaskCenter(): ImageTaskCenter {
  if (!g.__imageTaskCenter) {
    g.__imageTaskCenter = new ImageTaskCenter();
  }
  return g.__imageTaskCenter;
}
