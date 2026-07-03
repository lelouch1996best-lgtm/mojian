import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";

export async function POST(request: Request) {
  if (!validateAuth(request)) return authError();
  const body = await request.json();
  const db = getDb();
  const now = Date.now();

  const writeSeries = db.transaction(() => {
    // Series
    if (body.series) {
      for (const [id, s] of Object.entries(body.series)) {
        const ser = s as any;
        db.prepare(`
          INSERT INTO series (id, title, description, order_num, world_settings, style_settings, episode_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title, description = excluded.description, order_num = excluded.order_num,
            world_settings = excluded.world_settings, style_settings = excluded.style_settings,
            episode_order = excluded.episode_order, updated_at = excluded.updated_at
        `).run(
          ser.id, ser.title ?? "", ser.description ?? "", ser.order ?? 0,
          JSON.stringify(ser.worldSettings ?? {}), JSON.stringify(ser.styleSettings ?? {}),
          JSON.stringify(ser.episodeOrder ?? []), ser.createdAt ?? now, now
        );
      }
    }

    // Episodes
    if (body.episodes) {
      for (const [id, ep] of Object.entries(body.episodes)) {
        const e = ep as any;
        db.prepare(`
          INSERT INTO episodes (id, title, series_id, step, original_content, expanded_content, shots, assets, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title, series_id = excluded.series_id, step = excluded.step,
            original_content = excluded.original_content, expanded_content = excluded.expanded_content,
            shots = excluded.shots, assets = excluded.assets, updated_at = excluded.updated_at
        `).run(
          e.id, e.title ?? "", e.seriesId ?? "", e.step ?? 1,
          e.originalContent ?? "", e.expandedContent ?? "",
          JSON.stringify(e.shots ?? []), JSON.stringify(e.assets ?? []),
          e.createdAt ?? now, now
        );
      }
    }

    // Settings
    if (body.settings) {
      for (const [key, val] of Object.entries(body.settings)) {
        const value = typeof val === "string" ? val : JSON.stringify(val);
        db.prepare(
          "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
        ).run(key, value, now);
      }
    }
  });

  writeSeries();
  return Response.json({ ok: true });
}
