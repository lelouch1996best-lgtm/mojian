import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";
import type { VoicePersona } from "@/lib/types";

function rowToVoicePersona(row: any): VoicePersona {
  return {
    id: row.id,
    name: row.name,
    personaId: row.persona_id ?? "",
    sourceType: row.source_type ?? "upload",
    sourceAudioUrl: row.source_audio_url ?? "",
    description: row.description ?? undefined,
    status: row.status ?? "idle",
    error: row.error ?? undefined,
    sunoTaskId: row.suno_task_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** GET /api/data/voice-personas - 获取全部音色（按 created_at 降序） */
export async function GET(request: Request) {
  if (!validateAuth(request)) return authError();
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM voice_personas ORDER BY created_at DESC")
    .all() as any[];
  return Response.json(rows.map(rowToVoicePersona));
}

/** POST /api/data/voice-personas - 保存（新增或更新）音色 */
export async function POST(request: Request) {
  if (!validateAuth(request)) return authError();

  let vp: VoicePersona;
  try {
    vp = (await request.json()) as VoicePersona;
  } catch {
    return Response.json({ error: "请求体无效" }, { status: 400 });
  }

  if (!vp.id || typeof vp.id !== "string") {
    return Response.json({ error: "id 不能为空" }, { status: 400 });
  }

  const db = getDb();
  const now = Date.now();

  db.prepare(`
    INSERT INTO voice_personas
      (id, name, persona_id, source_type, source_audio_url, description, status, error, suno_task_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, persona_id = excluded.persona_id,
      source_type = excluded.source_type, source_audio_url = excluded.source_audio_url,
      description = excluded.description, status = excluded.status,
      error = excluded.error, suno_task_id = excluded.suno_task_id,
      updated_at = excluded.updated_at
  `).run(
    vp.id,
    vp.name ?? "",
    vp.personaId || null,
    vp.sourceType ?? "upload",
    vp.sourceAudioUrl ?? "",
    vp.description ?? null,
    vp.status ?? "idle",
    vp.error ?? null,
    vp.sunoTaskId ?? null,
    vp.createdAt ?? now,
    now
  );

  return Response.json({ ok: true });
}
