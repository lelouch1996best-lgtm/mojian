import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";
import type { PresetItem, PresetType } from "@/lib/types";

const ALLOWED_TYPES = new Set<PresetType>(["image", "video", "audio", "text", "camera"]);

function parseTags(raw: any): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter((t) => t.length > 0)
      .filter((t, i, arr) => arr.indexOf(t) === i);
  }
  return [];
}

function rowToPreset(row: any): PresetItem {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags || "[]");
    if (!Array.isArray(tags)) tags = [];
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    name: row.name ?? "",
    type: row.type,
    url: row.url ?? "",
    content: row.content ?? "",
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** GET /api/data/presets - 列出全部预设（按 created_at 降序） */
export async function GET(request: Request) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM presets ORDER BY created_at DESC")
    .all() as any[];
  return Response.json(rows.map(rowToPreset));
}

/** POST /api/data/presets - 新增或更新预设（upsert） */
export async function POST(request: Request) {
  if (!validateAuth(request)) return authError();

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体无效" }, { status: 400 });
  }

  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const type = body?.type as PresetType;

  if (!id) return Response.json({ error: "id 不能为空" }, { status: 400 });
  if (!name) return Response.json({ error: "名称不能为空" }, { status: 400 });
  if (!ALLOWED_TYPES.has(type)) {
    return Response.json({ error: "type 非法" }, { status: 400 });
  }

  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const content = typeof body?.content === "string" ? body.content : "";
  const tags = parseTags(body?.tags);

  if (type === "text" || type === "camera") {
    if (!content.trim()) {
      return Response.json({ error: "内容不能为空" }, { status: 400 });
    }
  } else {
    if (!url) {
      return Response.json({ error: "媒体 url 不能为空" }, { status: 400 });
    }
  }

  const db = getDb();
  const now = Date.now();
  const createdAt = typeof body?.createdAt === "number" ? body.createdAt : now;

  db.prepare(
    `INSERT INTO presets (id, name, type, url, content, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, type = excluded.type, url = excluded.url,
       content = excluded.content, tags = excluded.tags, updated_at = excluded.updated_at`
  ).run(id, name, type, url, content, JSON.stringify(tags), createdAt, now);

  const row = db.prepare("SELECT * FROM presets WHERE id = ?").get(id) as any;
  return Response.json({ ok: true, preset: rowToPreset(row) });
}

/** DELETE /api/data/presets - 批量删除预设 */
export async function DELETE(request: Request) {
  if (!validateAuth(request)) return authError();

  let ids: string[] = [];
  try {
    const body = await request.json();
    ids = Array.isArray(body?.ids)
      ? body.ids.filter((x: unknown) => typeof x === "string")
      : [];
  } catch {
    return Response.json({ error: "请求体无效" }, { status: 400 });
  }
  if (ids.length === 0) return Response.json({ error: "未指定删除条目" }, { status: 400 });

  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const info = db
    .prepare(`DELETE FROM presets WHERE id IN (${placeholders})`)
    .run(...ids);
  return Response.json({ ok: true, deleted: info.changes });
}
