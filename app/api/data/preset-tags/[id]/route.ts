import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";

/** 级联清理：从所有 presets.tags 中移除指定标签名 */
function cascadeRemoveTagNames(
  db: ReturnType<typeof getDb>,
  names: string[]
): number {
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

/** DELETE /api/data/preset-tags/:id - 删除单个标签（级联清理预设项） */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  const row = db
    .prepare("SELECT name FROM preset_tags WHERE id = ?")
    .get(params.id) as any;
  db.prepare("DELETE FROM preset_tags WHERE id = ?").run(params.id);
  if (row?.name) cascadeRemoveTagNames(db, [row.name]);
  return Response.json({ ok: true });
}
