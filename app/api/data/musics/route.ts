import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";
import type { Music } from "@/lib/types";

function rowToMusic(row: any): Music {
  return {
    id: row.id,
    seriesId: row.series_id,
    title: row.title,
    mode: row.mode,
    status: row.status,
    error: row.error ?? undefined,
    params: JSON.parse(row.params || "{}"),
    source: row.source ? JSON.parse(row.source) : undefined,
    sunoTaskId: row.suno_task_id ?? undefined,
    tracks: JSON.parse(row.tracks || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** GET /api/data/musics?seriesId=xxx — 获取某系列下所有音乐 */
export async function GET(request: Request) {
  if (!validateAuth(request)) return authError();
  const url = new URL(request.url);
  const seriesId = url.searchParams.get("seriesId");
  const db = getDb();

  if (seriesId) {
    const rows = db
      .prepare("SELECT * FROM musics WHERE series_id = ? ORDER BY created_at ASC")
      .all(seriesId) as any[];
    return Response.json(rows.map(rowToMusic));
  }

  const rows = db.prepare("SELECT * FROM musics").all() as any[];
  return Response.json(rows.map(rowToMusic));
}

/** POST /api/data/musics — 保存（新增或更新）音乐 */
export async function POST(request: Request) {
  if (!validateAuth(request)) return authError();
  const m = (await request.json()) as Music;
  const db = getDb();
  const now = Date.now();

  db.prepare(`
    INSERT INTO musics (id, series_id, title, mode, status, error, params, source, suno_task_id, tracks, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      series_id = excluded.series_id, title = excluded.title, mode = excluded.mode,
      status = excluded.status, error = excluded.error, params = excluded.params,
      source = excluded.source, suno_task_id = excluded.suno_task_id,
      tracks = excluded.tracks, updated_at = excluded.updated_at
  `).run(
    m.id,
    m.seriesId ?? "",
    m.title ?? "",
    m.mode ?? "inspiration",
    m.status ?? "idle",
    m.error ?? null,
    JSON.stringify(m.params ?? {}),
    m.source ? JSON.stringify(m.source) : null,
    m.sunoTaskId ?? null,
    JSON.stringify(m.tracks ?? []),
    m.createdAt ?? now,
    now
  );

  return Response.json({ ok: true });
}
