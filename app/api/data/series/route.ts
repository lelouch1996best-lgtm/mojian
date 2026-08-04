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

/** GET /api/data/series — 列出所有系列（按 order 排序） */
export async function GET(request: Request) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  const rows = db.prepare("SELECT * FROM series ORDER BY order_num ASC").all() as any[];
  return Response.json(rows.map(rowToSeries));
}

/** POST /api/data/series — 保存（新增或更新）系列 */
export async function POST(request: Request) {
  if (!validateAuth(request)) return authError();
  const s = (await request.json()) as Series;
  const db = getDb();
  const now = Date.now();

  db.prepare(`
    INSERT INTO series (id, title, description, order_num, world_settings, character_settings, object_settings, scene_settings, style_settings, episode_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, description = excluded.description, order_num = excluded.order_num,
      world_settings = excluded.world_settings, character_settings = excluded.character_settings,
      object_settings = excluded.object_settings, scene_settings = excluded.scene_settings,
      style_settings = excluded.style_settings,
      episode_order = excluded.episode_order, updated_at = excluded.updated_at
  `).run(
    s.id,
    s.title ?? "",
    s.description ?? "",
    s.order ?? 0,
    JSON.stringify(s.worldSettings ?? {}),
    JSON.stringify(s.characterSettings ?? []),
    JSON.stringify(s.objectSettings ?? []),
    JSON.stringify(s.sceneSettings ?? []),
    JSON.stringify(s.styleSettings ?? {}),
    JSON.stringify(s.episodeOrder ?? []),
    s.createdAt ?? now,
    now
  );

  return Response.json({ ok: true });
}
