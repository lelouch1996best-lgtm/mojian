import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";
import type { AssetLibraryItem } from "@/lib/types";

/** GET /api/data/assets - 聚合所有企划/剧集下生成的图片与视频，返回扁平列表 */
export async function GET(request: Request) {
  if (!validateAuth(request)) return authError();
  const db = getDb();

  const items: AssetLibraryItem[] = [];

  // 1) 读取全部 series，构建 seriesMap 并提取企划设定形象图
  const seriesRows = db.prepare("SELECT * FROM series").all() as any[];
  const seriesMap = new Map<string, { title: string; updatedAt: number }>();

  for (const row of seriesRows) {
    const seriesId: string = row.id;
    const seriesTitle: string = row.title ?? "";
    const updatedAt: number = row.updated_at ?? 0;
    seriesMap.set(seriesId, { title: seriesTitle, updatedAt });

    // 人物设定形象图
    const characters = safeParseArray(row.character_settings);
    for (const c of characters) {
      if (c.imageUrl) {
        items.push({
          id: `profile-character-${c.id}`,
          mediaType: "image",
          url: c.imageUrl,
          seriesId,
          seriesTitle,
          entityType: "character",
          entityName: c.name || "未命名人物",
          source: "profile-character",
          createdAt: updatedAt,
        });
      }
      if (c.voiceUrl) {
        items.push({
          id: `profile-character-voice-${c.id}`,
          mediaType: "audio",
          url: c.voiceUrl,
          seriesId,
          seriesTitle,
          entityType: "character",
          entityName: c.name || "未命名人物",
          source: "profile-character",
          createdAt: updatedAt,
        });
      }
    }

    // 物品设定形象图
    const objects = safeParseArray(row.object_settings);
    for (const o of objects) {
      if (o.imageUrl) {
        items.push({
          id: `profile-object-${o.id}`,
          mediaType: "image",
          url: o.imageUrl,
          seriesId,
          seriesTitle,
          entityType: "object",
          entityName: o.name || "未命名物品",
          source: "profile-object",
          createdAt: updatedAt,
        });
      }
    }

    // 场景设定形象图
    const scenes = safeParseArray(row.scene_settings);
    for (const s of scenes) {
      if (s.imageUrl) {
        items.push({
          id: `profile-scene-${s.id}`,
          mediaType: "image",
          url: s.imageUrl,
          seriesId,
          seriesTitle,
          entityType: "scene",
          entityName: s.name || "未命名场景",
          source: "profile-scene",
          createdAt: updatedAt,
        });
      }
    }
  }

  // 2) 读取全部 episodes，提取剧集资产图与分镜视频
  const episodeRows = db.prepare("SELECT * FROM episodes").all() as any[];
  for (const row of episodeRows) {
    const seriesId: string = row.series_id;
    const series = seriesMap.get(seriesId);
    const seriesTitle = series?.title ?? "";
    const episodeId: string = row.id;
    const episodeTitle: string = row.title ?? "";
    const updatedAt: number = row.updated_at ?? 0;

    // 剧集资产图（仅 status==="ready" 且有 imageUrl）
    const assets = safeParseArray(row.assets);
    for (const a of assets) {
      if (a.imageUrl && a.status === "ready") {
        items.push({
          id: `asset-${episodeId}-${a.id}`,
          mediaType: "image",
          url: a.imageUrl,
          seriesId,
          seriesTitle,
          episodeId,
          episodeTitle,
          entityType:
            a.type === "scene"
              ? "scene"
              : a.type === "object"
                ? "object"
                : a.type === "screenshot"
                  ? "screenshot"
                  : a.type === "storyboard"
                    ? "storyboard"
                    : "character",
          entityName: a.name || "未命名资产",
          source: "asset",
          prompt: a.imagePrompt || a.description,
          createdAt: updatedAt,
        });
      }
    }

    // 分镜视频（仅 videoStatus==="succeeded" 且有 videoUrl）
    const shots = safeParseArray(row.shots);
    for (const s of shots) {
      if (s.videoUrl && s.videoStatus === "succeeded") {
        const desc = (s.visualDescription || "").trim();
        items.push({
          id: `shot-${episodeId}-${s.id}`,
          mediaType: "video",
          url: s.videoUrl,
          seriesId,
          seriesTitle,
          episodeId,
          episodeTitle,
          entityType: "shot",
          entityName: desc ? (desc.length > 20 ? desc.slice(0, 20) + "…" : desc) : "镜头",
          source: "shot",
          prompt: s.finalPrompt,
          createdAt: updatedAt,
        });
      }
    }
  }

  // 3) 按 createdAt 降序排序
  items.sort((a, b) => b.createdAt - a.createdAt);

  return Response.json(items);
}

/** 安全解析 JSON 数组，失败返回空数组 */
function safeParseArray(raw: unknown): any[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** DELETE /api/data/assets - 批量删除资产库条目（清源记录 url） */
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
  const seriesUpdates = new Map<string, { characters?: any[]; objects?: any[]; scenes?: any[] }>();
  const episodeUpdates = new Map<string, { assets?: any[]; shots?: any[] }>();
  const now = Date.now();

  const getSeriesChars = (id: string) => {
    const row = db.prepare("SELECT character_settings FROM series WHERE id = ?").get(id) as any;
    return row ? safeParseArray(row.character_settings) : [];
  };
  const getSeriesObjs = (id: string) => {
    const row = db.prepare("SELECT object_settings FROM series WHERE id = ?").get(id) as any;
    return row ? safeParseArray(row.object_settings) : [];
  };
  const getSeriesScenes = (id: string) => {
    const row = db.prepare("SELECT scene_settings FROM series WHERE id = ?").get(id) as any;
    return row ? safeParseArray(row.scene_settings) : [];
  };
  const getEpAssets = (id: string) => {
    const row = db.prepare("SELECT assets FROM episodes WHERE id = ?").get(id) as any;
    return row ? safeParseArray(row.assets) : [];
  };
  const getEpShots = (id: string) => {
    const row = db.prepare("SELECT shots FROM episodes WHERE id = ?").get(id) as any;
    return row ? safeParseArray(row.shots) : [];
  };

  for (const id of ids) {
    if (id.startsWith("profile-character-voice-")) {
      const charId = id.slice("profile-character-voice-".length);
      const rows = db.prepare("SELECT id FROM series").all() as any[];
      for (const row of rows) {
        const chars = getSeriesChars(row.id);
        const target = chars.find((c: any) => c.id === charId);
        if (target && target.voiceUrl) {
          target.voiceUrl = undefined;
          const u = seriesUpdates.get(row.id) ?? {};
          u.characters = chars;
          seriesUpdates.set(row.id, u);
          break;
        }
      }
    } else if (id.startsWith("profile-character-")) {
      const charId = id.slice("profile-character-".length);
      const rows = db.prepare("SELECT id FROM series").all() as any[];
      for (const row of rows) {
        const chars = getSeriesChars(row.id);
        const target = chars.find((c: any) => c.id === charId);
        if (target && target.imageUrl) {
          target.imageUrl = undefined;
          const u = seriesUpdates.get(row.id) ?? {};
          u.characters = chars;
          seriesUpdates.set(row.id, u);
          break;
        }
      }
    } else if (id.startsWith("profile-object-")) {
      const objId = id.slice("profile-object-".length);
      const rows = db.prepare("SELECT id FROM series").all() as any[];
      for (const row of rows) {
        const objs = getSeriesObjs(row.id);
        const target = objs.find((o: any) => o.id === objId);
        if (target && target.imageUrl) {
          target.imageUrl = undefined;
          const u = seriesUpdates.get(row.id) ?? {};
          u.objects = objs;
          seriesUpdates.set(row.id, u);
          break;
        }
      }
    } else if (id.startsWith("profile-scene-")) {
      const sceneId = id.slice("profile-scene-".length);
      const rows = db.prepare("SELECT id FROM series").all() as any[];
      for (const row of rows) {
        const scenes = getSeriesScenes(row.id);
        const target = scenes.find((s: any) => s.id === sceneId);
        if (target && target.imageUrl) {
          target.imageUrl = undefined;
          const u = seriesUpdates.get(row.id) ?? {};
          u.scenes = scenes;
          seriesUpdates.set(row.id, u);
          break;
        }
      }
    } else if (id.startsWith("asset-")) {
      const rest = id.slice("asset-".length);
      if (rest.length < 37) continue;
      const episodeId = rest.slice(0, 36);
      const assetId = rest.slice(37);
      const assets = getEpAssets(episodeId);
      const target = assets.find((a: any) => a.id === assetId);
      if (target && target.imageUrl) {
        target.imageUrl = undefined;
        const u = episodeUpdates.get(episodeId) ?? {};
        u.assets = assets;
        episodeUpdates.set(episodeId, u);
      }
    } else if (id.startsWith("shot-")) {
      const rest = id.slice("shot-".length);
      if (rest.length < 37) continue;
      const episodeId = rest.slice(0, 36);
      const shotId = rest.slice(37);
      const shots = getEpShots(episodeId);
      const target = shots.find((s: any) => s.id === shotId);
      if (target && target.videoUrl) {
        target.videoUrl = undefined;
        const u = episodeUpdates.get(episodeId) ?? {};
        u.shots = shots;
        episodeUpdates.set(episodeId, u);
      }
    }
  }

  seriesUpdates.forEach((u, seriesId) => {
    if (u.characters) db.prepare("UPDATE series SET character_settings = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(u.characters), now, seriesId);
    if (u.objects) db.prepare("UPDATE series SET object_settings = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(u.objects), now, seriesId);
    if (u.scenes) db.prepare("UPDATE series SET scene_settings = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(u.scenes), now, seriesId);
  });

  episodeUpdates.forEach((u, episodeId) => {
    if (u.assets) db.prepare("UPDATE episodes SET assets = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(u.assets), now, episodeId);
    if (u.shots) db.prepare("UPDATE episodes SET shots = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(u.shots), now, episodeId);
  });

  return Response.json({ ok: true, deleted: ids.length });
}
