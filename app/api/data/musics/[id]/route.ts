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

/** GET /api/data/musics/:id — 获取单个音乐 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  const row = db.prepare("SELECT * FROM musics WHERE id = ?").get(params.id) as any;
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(rowToMusic(row));
}

/** DELETE /api/data/musics/:id — 删除音乐 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  db.prepare("DELETE FROM musics WHERE id = ?").run(params.id);
  return Response.json({ ok: true });
}
