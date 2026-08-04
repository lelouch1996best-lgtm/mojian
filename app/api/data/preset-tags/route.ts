import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";
import type { PresetTag } from "@/lib/types";

function rowToTag(row: any): PresetTag {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}

/** 级联清理：从所有 presets.tags 中移除指定标签名 */
function cascadeRemoveTagNames(db: ReturnType<typeof getDb>, names: string[]): number {
  if (names.length === 0) return 0;
  const nameSet = new Set(names);
  const rows = db.prepare("SELECT id, tags FROM presets").all() as any[];
  const update = db.prepare(
    "UPDATE presets SET tags = ?, updated_at = ? WHERE id = ?"
  );
  const now = Date.now();
  let changed = 0;
  for (const row of rows) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags || "[]");
      if (!Array.isArray(tags)) tags = [];
    } catch {
      tags = [];
    }
    const next = tags.filter((t) => !nameSet.has(t));
    if (next.length !== tags.length) {
      update.run(JSON.stringify(next), now, row.id);
      changed++;
    }
  }
  return changed;
}

/** GET /api/data/preset-tags - 列出全部标签（按 created_at 升序） */
export async function GET(request: Request) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM preset_tags ORDER BY created_at ASC")
    .all() as any[];
  return Response.json(rows.map(rowToTag));
}

/** POST /api/data/preset-tags - 新增标签（name 唯一） */
export async function POST(request: Request) {
  if (!validateAuth(request)) return authError();

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体无效" }, { status: 400 });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return Response.json({ error: "标签名不能为空" }, { status: 400 });

  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();

  try {
    db.prepare(
      "INSERT INTO preset_tags (id, name, created_at) VALUES (?, ?, ?)"
    ).run(id, name, now);
  } catch (e: any) {
    if (String(e?.message || "").includes("UNIQUE")) {
      const existing = db
        .prepare("SELECT * FROM preset_tags WHERE name = ?")
        .get(name) as any;
      if (existing) return Response.json({ ok: true, tag: rowToTag(existing) });
      return Response.json({ error: "标签已存在" }, { status: 409 });
    }
    throw e;
  }

  const row = db.prepare("SELECT * FROM preset_tags WHERE id = ?").get(id) as any;
  return Response.json({ ok: true, tag: rowToTag(row) });
}

/** DELETE /api/data/preset-tags - 批量删除标签（级联清理预设项） */
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
  if (ids.length === 0)
    return Response.json({ error: "未指定删除条目" }, { status: 400 });

  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const tagRows = db
    .prepare(`SELECT name FROM preset_tags WHERE id IN (${placeholders})`)
    .all(...ids) as any[];
  const names = tagRows.map((r) => r.name as string);

  const info = db
    .prepare(`DELETE FROM preset_tags WHERE id IN (${placeholders})`)
    .run(...ids);

  cascadeRemoveTagNames(db, names);

  return Response.json({ ok: true, deleted: info.changes });
}
