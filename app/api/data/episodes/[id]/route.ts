import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";
import type { Episode } from "@/lib/types";

function rowToEpisode(row: any): Episode {
  return {
    id: row.id,
    title: row.title,
    seriesId: row.series_id,
    step: row.step,
    originalContent: row.original_content,
    expandedContent: row.expanded_content,
    shots: JSON.parse(row.shots || "[]"),
    assets: JSON.parse(row.assets || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** GET /api/data/episodes/:id — 获取单个剧集 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  const row = db.prepare("SELECT * FROM episodes WHERE id = ?").get(params.id) as any;
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(rowToEpisode(row));
}

/** DELETE /api/data/episodes/:id — 删除剧集 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  db.prepare("DELETE FROM episodes WHERE id = ?").run(params.id);
  return Response.json({ ok: true });
}
