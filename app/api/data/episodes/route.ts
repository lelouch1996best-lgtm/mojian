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

/** GET /api/data/episodes?seriesId=xxx — 获取某系列下所有剧集 */
export async function GET(request: Request) {
  if (!validateAuth(request)) return authError();
  const url = new URL(request.url);
  const seriesId = url.searchParams.get("seriesId");
  const db = getDb();

  if (seriesId) {
    const rows = db
      .prepare("SELECT * FROM episodes WHERE series_id = ? ORDER BY created_at ASC")
      .all(seriesId) as any[];
    const episodes = rows.map(rowToEpisode);

    // 按 series.episodeOrder 排序
    const series = db
      .prepare("SELECT episode_order FROM series WHERE id = ?")
      .get(seriesId) as any;
    if (series) {
      const order: string[] = JSON.parse(series.episode_order || "[]");
      const ordered: Episode[] = [];
      const seen = new Set<string>();
      for (const epId of order) {
        const ep = episodes.find((e) => e.id === epId);
        if (ep && !seen.has(ep.id)) {
          seen.add(ep.id);
          ordered.push(ep);
        }
      }
      for (const ep of episodes) {
        if (!seen.has(ep.id)) ordered.push(ep);
      }
      return Response.json(ordered);
    }
    return Response.json(episodes);
  }

  const rows = db.prepare("SELECT * FROM episodes").all() as any[];
  return Response.json(rows.map(rowToEpisode));
}

/** POST /api/data/episodes — 保存（新增或更新）剧集 */
export async function POST(request: Request) {
  if (!validateAuth(request)) return authError();
  const ep = (await request.json()) as Episode;
  const db = getDb();
  const now = Date.now();

  db.prepare(`
    INSERT INTO episodes (id, title, series_id, step, original_content, expanded_content, shots, assets, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, series_id = excluded.series_id, step = excluded.step,
      original_content = excluded.original_content, expanded_content = excluded.expanded_content,
      shots = excluded.shots, assets = excluded.assets, updated_at = excluded.updated_at
  `).run(
    ep.id,
    ep.title ?? "",
    ep.seriesId ?? "",
    ep.step ?? 1,
    ep.originalContent ?? "",
    ep.expandedContent ?? "",
    JSON.stringify(ep.shots ?? []),
    JSON.stringify(ep.assets ?? []),
    ep.createdAt ?? now,
    now
  );

  return Response.json({ ok: true });
}
