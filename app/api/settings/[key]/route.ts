import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";

export async function GET(request: Request, { params }: { params: { key: string } }) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(params.key) as any;
  // 未设置时返回 200 + null，而非 404（"未设置"是正常状态，不是错误）
  if (!row) return Response.json({ value: null });
  try {
    return Response.json({ value: JSON.parse(row.value) });
  } catch {
    return Response.json({ value: row.value });
  }
}

export async function PUT(request: Request, { params }: { params: { key: string } }) {
  if (!validateAuth(request)) return authError();
  const body = await request.json();
  const db = getDb();
  const now = Date.now();
  const value = typeof body.value === "string" ? body.value : JSON.stringify(body.value);
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(params.key, value, now);
  return Response.json({ ok: true });
}
