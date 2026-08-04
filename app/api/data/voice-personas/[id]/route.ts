import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";

/** DELETE /api/data/voice-personas/:id - 删除音色 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  db.prepare("DELETE FROM voice_personas WHERE id = ?").run(params.id);
  return Response.json({ ok: true });
}
