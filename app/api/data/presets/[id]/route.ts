import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";
import type { PresetItem } from "@/lib/types";

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

/** GET /api/data/presets/:id - 获取单个预设 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  const row = db.prepare("SELECT * FROM presets WHERE id = ?").get(params.id) as any;
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(rowToPreset(row));
}

/** DELETE /api/data/presets/:id - 删除单个预设 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  db.prepare("DELETE FROM presets WHERE id = ?").run(params.id);
  return Response.json({ ok: true });
}
