import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";
import type { Series } from "@/lib/types";

function rowToSeries(row: any): Series {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    order: row.order_num,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    worldSettings: JSON.parse(row.world_settings || "{}"),
    characterSettings: JSON.parse(row.character_settings || "[]"),
    objectSettings: JSON.parse(row.object_settings || "[]"),
    sceneSettings: JSON.parse(row.scene_settings || "[]"),
    styleSettings: JSON.parse(row.style_settings || "{}"),
    episodeOrder: JSON.parse(row.episode_order || "[]"),
  };
}

/** GET /api/data/series/:id — 获取单个系列 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  const row = db.prepare("SELECT * FROM series WHERE id = ?").get(params.id) as any;
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(rowToSeries(row));
}

/** DELETE /api/data/series/:id - 删除系列（级联删除其下剧集及关联资产） */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  if (!validateAuth(request)) return authError();
  const db = getDb();

  db.prepare("DELETE FROM media_assets WHERE series_id = ?").run(params.id);
  db.prepare("DELETE FROM episodes WHERE series_id = ?").run(params.id);
  db.prepare("DELETE FROM series WHERE id = ?").run(params.id);
  return Response.json({ ok: true });
}
