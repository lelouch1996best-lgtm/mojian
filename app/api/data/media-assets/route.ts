import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";
import type { MediaAsset } from "@/lib/types";

const ALLOWED_MEDIA_TYPES = new Set(["image", "video", "audio", "music", "voice"]);
const ALLOWED_ENTITY_TYPES = new Set([
  "character",
  "scene",
  "object",
  "shot",
  "screenshot",
  "storyboard",
  "generated",
  "music",
  "voicePersona",
  "other",
]);
const ALLOWED_SOURCES = new Set([
  "asset",
  "shot",
  "profile-character",
  "profile-object",
  "profile-scene",
  "manual",
  "screenshot",
  "generated",
  "music",
  "voicePersona",
]);

function rowToMediaAsset(row: any): MediaAsset {
  return {
    id: row.id,
    mediaType: row.media_type,
    url: row.url,
    entityType: row.entity_type,
    entityName: row.entity_name ?? "",
    prompt: row.prompt ?? "",
    source: row.source ?? "",
    seriesId: row.series_id ?? "",
    seriesTitle: row.series_title ?? "",
    episodeId: row.episode_id ?? "",
    episodeTitle: row.episode_title ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** GET /api/data/media-assets - 列出全部媒体资产记录（按 created_at 降序） */
export async function GET(request: Request) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM media_assets ORDER BY created_at DESC")
    .all() as any[];
  return Response.json(rows.map(rowToMediaAsset));
}

/** POST /api/data/media-assets - 新增一条媒体资产记录（生成双写 / 资产库手动添加） */
export async function POST(request: Request) {
  if (!validateAuth(request)) return authError();

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体无效" }, { status: 400 });
  }

  const mediaType = body?.mediaType;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const entityType = body?.entityType;
  const source = body?.source;

  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return Response.json({ error: "mediaType 非法" }, { status: 400 });
  }
  if (!url) {
    return Response.json({ error: "url 不能为空" }, { status: 400 });
  }
  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    return Response.json({ error: "entityType 非法" }, { status: 400 });
  }
  if (!ALLOWED_SOURCES.has(source)) {
    return Response.json({ error: "source 非法" }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  const entityName = typeof body?.entityName === "string" ? body.entityName : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const seriesId = typeof body?.seriesId === "string" ? body.seriesId : "";
  const seriesTitle = typeof body?.seriesTitle === "string" ? body.seriesTitle : "";
  const episodeId = typeof body?.episodeId === "string" ? body.episodeId : "";
  const episodeTitle = typeof body?.episodeTitle === "string" ? body.episodeTitle : "";

  db.prepare(
    `INSERT INTO media_assets
      (id, media_type, url, entity_type, entity_name, prompt, source, series_id, series_title, episode_id, episode_title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    mediaType,
    url,
    entityType,
    entityName,
    prompt,
    source,
    seriesId,
    seriesTitle,
    episodeId,
    episodeTitle,
    now,
    now
  );

  const row = db.prepare("SELECT * FROM media_assets WHERE id = ?").get(id) as any;
  return Response.json({ ok: true, asset: rowToMediaAsset(row) });
}

/** DELETE /api/data/media-assets - 批量删除媒体资产记录（仅删账本，不动业务表） */
export async function DELETE(request: Request) {
  if (!validateAuth(request)) return authError();

  let ids: string[] = [];
  try {
    const body = await request.json();
    ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  } catch {
    return Response.json({ error: "请求体无效" }, { status: 400 });
  }
  if (ids.length === 0) return Response.json({ error: "未指定删除条目" }, { status: 400 });

  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const stmt = db.prepare(`DELETE FROM media_assets WHERE id IN (${placeholders})`);
  const info = stmt.run(...ids);
  return Response.json({ ok: true, deleted: info.changes });
}
