import type {
  MusicQueryProxyRequest,
  MusicQueryProxyResponse,
} from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: MusicQueryProxyRequest;
  try {
    body = (await req.json()) as MusicQueryProxyRequest;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body.baseURL || !body.apiKey || !body.taskId) {
    return Response.json(
      { error: "缺少必要参数（baseURL / apiKey / taskId）" },
      { status: 400 }
    );
  }

  const base = body.baseURL.replace(/\/+$/, "");
  const url = `${base}/music/tasks/${encodeURIComponent(body.taskId)}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${body.apiKey}`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `请求上游失败：${msg}` }, { status: 502 });
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    let friendly = errText.slice(0, 500);
    try {
      const errJson = JSON.parse(errText);
      friendly = errJson?.error?.message ?? friendly;
    } catch {
      /* keep raw */
    }
    return Response.json(
      { error: `上游错误（${upstream.status}）：${friendly}` },
      { status: upstream.status || 502 }
    );
  }

  const parsed = await upstream.json();
  const task = parsed?.data ?? parsed;
  const rawStatus = String(task?.status ?? parsed?.status ?? "failed").toLowerCase();
  let status: MusicQueryProxyResponse["status"];
  if (rawStatus === "complete" || rawStatus === "completed" || rawStatus === "success" || rawStatus === "succeeded") {
    status = "completed";
  } else if (rawStatus === "failed" || rawStatus === "error") {
    status = "failed";
  } else {
    // submitted / pending / processing / queue(d) / running 等均视为进行中
    status = "pending";
  }

  const result: MusicQueryProxyResponse = { status };
  const progress = task?.progress ?? parsed?.progress;
  if (typeof progress === "number") result.progress = progress;

  if (status === "completed") {
    const res = task?.result;
    result.rawResult = res;

    const personaId =
      pickStr(res, ["persona_id", "voice_id", "id", "personaId"]) ??
      pickStr(task, ["persona_id", "voice_id"]);
    if (personaId) result.personaId = personaId;

    const lyricsParts = extractLyricsParts(res, task);
    if (lyricsParts.lyrics) result.lyrics = lyricsParts.lyrics;
    if (lyricsParts.title) result.lyricsTitle = lyricsParts.title;
    if (lyricsParts.tags) result.lyricsTags = lyricsParts.tags;

    const music = Array.isArray(res?.music)
      ? res.music
      : Array.isArray(res?.data?.music)
      ? res.data.music
      : Array.isArray(task?.music)
      ? task.music
      : Array.isArray(res)
      ? res
      : [];
    const tracks = music
      .filter((m: unknown): m is Record<string, unknown> => !!m && typeof m === "object")
      .map((m: Record<string, unknown>) => ({
        audioId: typeof m.audio_id === "string" ? m.audio_id : undefined,
        title: typeof m.title === "string" ? m.title : undefined,
        duration: typeof m.duration === "number" ? m.duration : undefined,
        lyrics: typeof m.lyrics === "string" ? m.lyrics : undefined,
        tags: typeof m.tags === "string" ? m.tags : undefined,
        audioUrl: typeof m.audio_url === "string" ? m.audio_url : undefined,
        imageUrl: typeof m.image_url === "string" ? m.image_url : undefined,
        videoUrl: typeof m.video_url === "string" ? m.video_url : undefined,
      }));
    if (tracks.length > 0) result.music = tracks;
    if (!result.lyrics && tracks.length > 0 && tracks[0].lyrics) {
      result.lyrics = tracks[0].lyrics;
    }
  } else if (status === "failed") {
    result.error = task?.error?.message || parsed?.error?.message || "音乐生成失败";
  }

  return Response.json(result);
}

interface LyricsParts {
  lyrics?: string;
  title?: string;
  tags?: string;
}

function extractLyricsParts(res: unknown, task: unknown): LyricsParts {
  if (typeof res === "string" && res.trim()) return { lyrics: res.trim() };
  if (Array.isArray(res)) {
    const fromArr = pickLyricsPartsFromArray(res);
    if (fromArr) return fromArr;
  }
  if (res && typeof res === "object") {
    const r = res as Record<string, unknown>;
    if (typeof r.lyrics === "string" && r.lyrics.trim()) return { lyrics: r.lyrics.trim() };
    if (Array.isArray(r.lyrics)) {
      const fromArr = pickLyricsPartsFromArray(r.lyrics);
      if (fromArr) return fromArr;
    }
    const body = pickStr(r, ["text", "content", "prompt", "result"]);
    if (body) {
      const parts: LyricsParts = { lyrics: body };
      const title = pickStr(r, ["title", "name"]);
      const tags = pickStr(r, ["tags", "tag"]);
      if (title) parts.title = title;
      if (tags) parts.tags = tags;
      return parts;
    }
  }
  if (task && typeof task === "object") {
    const t = task as Record<string, unknown>;
    if (typeof t.lyrics === "string" && t.lyrics.trim()) return { lyrics: t.lyrics.trim() };
    if (Array.isArray(t.lyrics)) {
      const fromArr = pickLyricsPartsFromArray(t.lyrics);
      if (fromArr) return fromArr;
    }
    if (typeof t.text === "string" && t.text.trim()) return { lyrics: t.text.trim() };
  }
  return {};
}

function pickLyricsPartsFromArray(arr: unknown[]): LyricsParts | undefined {
  for (const item of arr) {
    if (typeof item === "string" && item.trim()) return { lyrics: item.trim() };
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const body = pickStr(o, ["lyrics", "prompt", "text", "content"]);
      const title = pickStr(o, ["title", "name"]);
      const tags = pickStr(o, ["tags", "tag"]);
      if (body || title || tags) {
        const parts: LyricsParts = {};
        if (body) parts.lyrics = body;
        if (title) parts.title = title;
        if (tags) parts.tags = tags;
        return parts;
      }
    }
  }
  return undefined;
}

function pickStr(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof o[key] === "string" && (o[key] as string).trim()) {
      return (o[key] as string).trim();
    }
  }
  return undefined;
}
