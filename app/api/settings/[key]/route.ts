import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";

export async function GET(request: Request, { params }: { params: { key: string } }) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(params.key) as any;
  if (!row) return Response.json({ value: null }, { status: 404 });
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
