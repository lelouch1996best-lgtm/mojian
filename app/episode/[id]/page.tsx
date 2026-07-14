"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Stepper from "@/components/Stepper";
import ContentExpansion from "@/components/ContentExpansion";
import StoryboardTable from "@/components/StoryboardTable";
import AssetPreparation from "@/components/AssetPreparation";
import VideoGeneration from "@/components/VideoGeneration";
import Button from "@/components/ui/Button";
import CharacterConflictModal, {
  type CharacterConflictItem,
  type ConflictAction,
} from "@/components/CharacterConflictModal";
import { getEpisode, saveEpisode, getEpisodesBySeries, getSeries, saveSeries } from "@/lib/storage";
import { getSettings } from "@/lib/llm-client";
import { emptyShot, debounce, removeTagPrefix } from "@/lib/utils";
import type { Asset, Episode, Shot, ShotVideoConfig, VideoStatus, StyleSettings, WorldSettings, CharacterProfile, ObjectProfile, SceneProfile } from "@/lib/types";
import { DEFAULT_SHOT_VIDEO_CONFIG } from "@/lib/model-presets";

export default function EpisodePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [episode, setEpisode] = useState<Episode | null>(null);
  const [seriesOrder, setSeriesOrder] = useState<number>(1);
  const [seriesStyleSettings, setSeriesStyleSettings] = useState<StyleSettings | null>(null);
  const [seriesWorldSettings, setSeriesWorldSettings] = useState<WorldSettings | null>(null);
  const [seriesCharacterSettings, setSeriesCharacterSettings] = useState<CharacterProfile[]>([]);
  const [seriesObjectSettings, setSeriesObjectSettings] = useState<ObjectProfile[]>([]);
  const [seriesSceneSettings, setSeriesSceneSettings] = useState<SceneProfile[]>([]);
  const [previousContext, setPreviousContext] = useState<string>("");
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [titleEditing, setTitleEditing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState(false);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflictItems, setConflictItems] = useState<CharacterConflictItem[]>([]);
  const conflictResolverRef = useRef<((items: CharacterConflictItem[]) => void) | null>(null);

  const episodeRef = useRef<Episode | null>(null);
  episodeRef.current = episode;

  const persist = useCallback(
    debounce(async (ep: Episode) => {
      const result = await saveEpisode(ep);
      if (!result.ok) {
        setSaveError(result.error ?? "保存失败");
      } else {
        setSaveError(null);
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
      }
    }, 400),
    []
  );

  function update(mut: (ep: Episode) => Episode) {
    setEpisode((prev) => {
      if (!prev) return prev;
      const next = mut({ ...prev });
      next.updatedAt = Date.now();
      return next;
    });
  }

  // 监听 episode 变化，防抖保存（跳过首次加载，避免无意义回存）
  const skipPersistRef = useRef(true);
  useEffect(() => {
    if (!episode) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    persist(episode);
  }, [episode, persist]);

  // 页面卸载时兜底保存，防止防抖未触发导致数据丢失
  useEffect(() => {
    const handler = () => {
      const ep = episodeRef.current;
      if (!ep) return;
      fetch("/api/data/episodes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_STORAGE_TOKEN ?? ""}`,
        },
        body: JSON.stringify(ep),
        keepalive: true,
      });
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const ep = await getEpisode(id);
      if (!ep) {
        setNotFound(true);
        return;
      }
      setEpisode(ep);
      setCurrentStep(ep.step);

      // 计算前几集的扩写内容（同系列内），作为扩写时的上下文
      const seriesData = await getSeries(ep.seriesId);
      const allEpisodes = await getEpisodesBySeries(ep.seriesId);
      const currentIdx = seriesData?.episodeOrder.indexOf(ep.id) ?? -1;
      setSeriesOrder(currentIdx >= 0 ? currentIdx + 1 : 1);
      setSeriesStyleSettings(seriesData?.styleSettings ?? null);
      setSeriesWorldSettings(seriesData?.worldSettings ?? null);
      setSeriesCharacterSettings(seriesData?.characterSettings ?? []);
    setSeriesObjectSettings(seriesData?.objectSettings ?? []);
    setSeriesSceneSettings(seriesData?.sceneSettings ?? []);
      const prevEpisodes = allEpisodes.filter((_, i) => i < currentIdx && allEpisodes[i].expandedContent.trim());
      const prev = prevEpisodes.map((e, i) => `【第${i + 1}集】\n${e.expandedContent.trim()}`);
      // 限制总字数，避免超出 token 限制（保留约 3000 字）
      let ctx = prev.join("\n\n");
      if (ctx.length > 3000) {
        let truncated = "";
        for (let i = prev.length - 1; i >= 0; i--) {
          const next = prev[i] + (i < prev.length - 1 ? "\n\n" : "") + truncated;
          if (next.length > 3000) break;
          truncated = prev[i] + (i < prev.length - 1 ? "\n\n" : "") + truncated;
        }
        ctx = truncated || prev[prev.length - 1]?.slice(-3000) || "";
      }
      setPreviousContext(ctx);
    })();
  }, [id]);

  if (notFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-slate-500">
        <p>未找到该剧集</p>
        <Button onClick={() => router.push("/home")}>返回首页</Button>
      </main>
    );
  }

  if (!episode) {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-400">
        加载中…
      </main>
    );
  }

  const step1Done = episode.expandedContent.trim().length > 0;
  const step2Done = episode.shots.length > 0;
  const step3Done = episode.assets.length > 0;

  // ---- Step1 handlers ----
  function handleShotsGenerated(shots: Shot[]) {
    update((ep) => ({ ...ep, shots, step: 2 }));
  }

  /** 提取人物设定后，合并到系列级。已存在同名人物时弹出 Modal 选择：覆盖最新版本/新建版本/跳过 */
  async function handleCharactersExtracted(characters: CharacterProfile[]): Promise<{ added: number; overwritten: number; total: number; skipped: number }> {
    if (!episode) return { added: 0, overwritten: 0, total: 0, skipped: 0 };
    const seriesData = await getSeries(episode.seriesId);
    if (!seriesData) return { added: 0, overwritten: 0, total: 0, skipped: 0 };
    const existingList = seriesData.characterSettings ?? [];
    // 按 name 分组已有人物
    const existingByName = new Map<string, CharacterProfile[]>();
    for (const c of existingList) {
      const arr = existingByName.get(c.name);
      if (arr) arr.push(c);
      else existingByName.set(c.name, [c]);
    }

    let merged = [...existingList];
    let added = 0;
    let overwritten = 0;
    let skipped = 0;

    // 收集冲突项
    const conflicts: CharacterConflictItem[] = [];
    const newCharacters: CharacterProfile[] = [];

    for (const incoming of characters) {
      const existing = existingByName.get(incoming.name);
      if (!existing || existing.length === 0) {
        // 新人物，直接添加
        newCharacters.push(incoming);
        existingByName.set(incoming.name, [incoming]);
        added++;
        continue;
      }
      // 已存在同名，收集到冲突列表（按 version 降序排列已有版本）
      const sorted = [...existing].sort((a, b) => (b.version ?? 1) - (a.version ?? 1));
      conflicts.push({
        incoming,
        existing: sorted,
        action: "overwrite",
      });
    }

    // 若有冲突，弹出 Modal 等待用户选择
    if (conflicts.length > 0) {
      setConflictItems(conflicts);
      setConflictModalOpen(true);
      const resolved = await new Promise<CharacterConflictItem[]>((resolve) => {
        conflictResolverRef.current = resolve;
      });

      // 按用户选择处理
      for (const item of resolved) {
        if (item.action === "skip") {
          skipped++;
          continue;
        }
        if (item.action === "overwrite") {
          // 找到最新版本，覆盖内容字段，保留 id/characterId/version/versionLabel/name/imageUrl
          const latest = item.existing[0];
          const overwrittenProfile: CharacterProfile = {
            ...latest,
            role: item.incoming.role,
            genderAge: item.incoming.genderAge,
            appearance: item.incoming.appearance,
            personality: item.incoming.personality,
            background: item.incoming.background,
            relationships: item.incoming.relationships,
          };
          merged = merged.map((c) => (c.id === latest.id ? overwrittenProfile : c));
          overwritten++;
        } else if (item.action === "newVersion") {
          // 新建版本：继承 characterId，version + 1
          const maxVersion = item.existing.reduce((max, c) => Math.max(max, c.version ?? 1), 0);
          const newVersion: CharacterProfile = {
            ...item.incoming,
            characterId: item.existing[0].characterId,
            version: maxVersion + 1,
            versionLabel: `v${maxVersion + 1}`,
          };
          merged.push(newVersion);
          added++;
        }
      }
    }

    // 合并新人物
    merged = [...merged, ...newCharacters];

    if (added > 0 || overwritten > 0) {
      await saveSeries({ ...seriesData, characterSettings: merged });
      setSeriesCharacterSettings(merged);
    }
    return { added, overwritten, total: merged.length, skipped };
  }

  /** 保存人物设定（资产准备中提取人物资产时调用） */
  async function handleSaveCharacterSettings(characters: CharacterProfile[]) {
    if (!episode) return;
    const seriesData = await getSeries(episode.seriesId);
    if (!seriesData) return;
    await saveSeries({ ...seriesData, characterSettings: characters });
    setSeriesCharacterSettings(characters);
  }

  /** 保存物品设定（资产准备中提取物品资产时调用） */
  async function handleSaveObjectSettings(objects: ObjectProfile[]) {
    if (!episode) return;
    const seriesData = await getSeries(episode.seriesId);
    if (!seriesData) return;
    await saveSeries({ ...seriesData, objectSettings: objects });
    setSeriesObjectSettings(objects);
  }

  /** 保存场景设定（资产准备中提取场景资产时调用） */
  async function handleSaveSceneSettings(scenes: SceneProfile[]) {
    if (!episode) return;
    const seriesData = await getSeries(episode.seriesId);
    if (!seriesData) return;
    await saveSeries({ ...seriesData, sceneSettings: scenes });
    setSeriesSceneSettings(scenes);
  }

  function handleConflictConfirm() {
    setConflictModalOpen(false);
    conflictResolverRef.current?.(conflictItems);
    conflictResolverRef.current = null;
  }

  function handleConflictCancel() {
    setConflictModalOpen(false);
    // 取消 = 全部视为跳过
    conflictResolverRef.current?.(conflictItems.map((c) => ({ ...c, action: "skip" as ConflictAction })));
    conflictResolverRef.current = null;
  }

  // ---- Step2 handlers ----
  function handleUpdateShot(shotId: string, field: keyof Shot, value: string) {
    update((ep) => ({
      ...ep,
      shots: ep.shots.map((s) => (s.id === shotId ? { ...s, [field]: value } : s)),
    }));
  }
  function handleUpdateVideoStatus(shotId: string, status: VideoStatus) {
    update((ep) => ({
      ...ep,
      shots: ep.shots.map((s) => (s.id === shotId ? { ...s, videoStatus: status } : s)),
    }));
  }
  /** 卡片级视频配置增量更新（惰性写入：首次修改时落库 videoConfig） */
  function handleUpdateVideoConfig(shotId: string, patch: Partial<ShotVideoConfig>) {
    update((ep) => ({
      ...ep,
      shots: ep.shots.map((s) => {
        if (s.id !== shotId) return s;
        const base = s.videoConfig ?? DEFAULT_SHOT_VIDEO_CONFIG;
        return { ...s, videoConfig: { ...base, ...patch } };
      }),
    }));
  }
  function handleUpdateManyVisuals(
    updates: { id: string; visualDescription: string }[]
  ) {
    update((ep) => {
      const map = new Map(updates.map((u) => [u.id, u.visualDescription]));
      return {
        ...ep,
        shots: ep.shots.map((s) =>
          map.has(s.id) ? { ...s, visualDescription: map.get(s.id)! } : s
        ),
      };
    });
  }

  /** 从所有分镜画面描述中移除某标签的 @ 前缀（删除标注，保留名称） */
  function handleRemoveTag(tagName: string) {
    update((ep) => ({
      ...ep,
      shots: ep.shots.map((s) => ({
        ...s,
        visualDescription: removeTagPrefix(s.visualDescription, tagName),
      })),
    }));
  }
  function handleAddRow() {
    update((ep) => ({ ...ep, shots: [...ep.shots, emptyShot()] }));
  }
  function handleDeleteRow(shotId: string) {
    update((ep) => ({ ...ep, shots: ep.shots.filter((s) => s.id !== shotId) }));
  }
  function handleMoveRow(shotId: string, direction: "up" | "down") {
    update((ep) => {
      const idx = ep.shots.findIndex((s) => s.id === shotId);
      if (idx < 0) return ep;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= ep.shots.length) return ep;
      const shots = [...ep.shots];
      [shots[idx], shots[target]] = [shots[target], shots[idx]];
      return { ...ep, shots };
    });
  }

  // ---- Step3 handlers ----
  function handleUpdateAsset(assetId: string, field: keyof Asset, value: string) {
    update((ep) => ({
      ...ep,
      assets: ep.assets.map((a) =>
        a.id === assetId ? { ...a, [field]: value } : a
      ),
    }));
  }
  function handleReplaceAssets(assets: Asset[]) {
    update((ep) => ({ ...ep, assets }));
  }
  /** 删除资产（同时清理分镜中的关联引用） */
  function handleDeleteAsset(assetId: string) {
    update((ep) => ({
      ...ep,
      assets: ep.assets.filter((a) => a.id !== assetId),
      shots: ep.shots.map((s) => ({
        ...s,
        relatedAssetIds: (s.relatedAssetIds ?? []).filter((id) => id !== assetId),
      })),
    }));
  }

  // ---- Step4 handlers ----
  function handleLinkAsset(shotId: string, assetId: string) {
    update((ep) => ({
      ...ep,
      shots: ep.shots.map((s) =>
        s.id === shotId && !s.relatedAssetIds?.includes(assetId)
          ? { ...s, relatedAssetIds: [...(s.relatedAssetIds ?? []), assetId] }
          : s
      ),
    }));
  }
  function handleUnlinkAsset(shotId: string, assetId: string) {
    update((ep) => ({
      ...ep,
      shots: ep.shots.map((s) =>
        s.id === shotId
          ? { ...s, relatedAssetIds: (s.relatedAssetIds ?? []).filter((id) => id !== assetId) }
          : s
      ),
    }));
  }

  function gotoStep(step: 1 | 2 | 3 | 4) {
    if (step === 2 && !step1Done) return;
    if (step === 3 && !step2Done) return;
    if (step === 4 && !step3Done) return;
    setCurrentStep(step);
    update((ep) => ({ ...ep, step }));
  }

  return (
    <main className="mx-auto min-h-screen max-w-[1400px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(episode.seriesId ? `/series/${episode.seriesId}` : "/home")}
            className="text-slate-400 hover:text-slate-600"
            title="返回企划"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {titleEditing ? (
            <input
              autoFocus
              value={episode.title}
              onChange={(e) =>
                update((ep) => ({ ...ep, title: e.target.value }))
              }
              onBlur={() => setTitleEditing(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setTitleEditing(false);
              }}
              className="rounded border border-brand-400 px-2 py-1 text-lg font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          ) : (
          <h1
            onClick={() => setTitleEditing(true)}
            className="cursor-text text-lg font-semibold text-slate-800"
            title="点击编辑标题"
          >
            {episode.title || "未命名剧集"}
            <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-xs font-normal text-brand-700">
              第{seriesOrder}集
            </span>
          </h1>
          )}
          <span className="text-xs text-slate-400">
            {savedHint ? "已保存 ✓" : saveError ? saveError : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Stepper
            currentStep={currentStep}
            onStepClick={gotoStep}
            step1Done={step1Done}
            step2Done={step2Done}
            step3Done={step3Done}
          />
        </div>
      </header>

      {currentStep === 1 ? (
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <ContentExpansion
            originalContent={episode.originalContent}
            expandedContent={episode.expandedContent}
            previousContext={previousContext}
            worldSettings={seriesWorldSettings}
            characterSettings={seriesCharacterSettings}
            onOriginalChange={(v) =>
              update((ep) => ({ ...ep, originalContent: v }))
            }
            onExpandedChange={(v) =>
              update((ep) => ({ ...ep, expandedContent: v }))
            }
            onShotsGenerated={handleShotsGenerated}
            onEnterStep2={() => gotoStep(2)}
            onCharactersExtracted={handleCharactersExtracted}
          />
        </div>
      ) : currentStep === 2 ? (
        <StoryboardTable
          episode={episode}
          onUpdateShot={handleUpdateShot}
          onUpdateManyVisuals={handleUpdateManyVisuals}
          onAddRow={handleAddRow}
          onDeleteRow={handleDeleteRow}
          onMoveRow={handleMoveRow}
          onBackToStep1={() => gotoStep(1)}
          onEnterStep3={() => gotoStep(3)}
          onRemoveTag={handleRemoveTag}
        />
      ) : currentStep === 3 ? (
        <div className="mx-auto max-w-6xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <AssetPreparation
            episode={episode}
            onUpdateAsset={handleUpdateAsset}
            onReplaceAssets={handleReplaceAssets}
            onBackToStep2={() => gotoStep(2)}
            seriesStyleSettings={seriesStyleSettings}
            characterSettings={seriesCharacterSettings}
            onSaveCharacterSettings={handleSaveCharacterSettings}
            objectSettings={seriesObjectSettings}
            onSaveObjectSettings={handleSaveObjectSettings}
            sceneSettings={seriesSceneSettings}
            onSaveSceneSettings={handleSaveSceneSettings}
            onRemoveTag={handleRemoveTag}
            onDeleteAsset={handleDeleteAsset}
          />
        </div>
      ) : (
        <VideoGeneration
          episode={episode}
          onUpdateShot={handleUpdateShot}
          onUpdateVideoStatus={handleUpdateVideoStatus}
          onUpdateVideoConfig={handleUpdateVideoConfig}
          onBackToStep3={() => gotoStep(3)}
          onLinkAsset={handleLinkAsset}
          onUnlinkAsset={handleUnlinkAsset}
          seriesStyleSettings={seriesStyleSettings}
        />
      )}

      <CharacterConflictModal
        open={conflictModalOpen}
        conflicts={conflictItems}
        onActionChange={(i, action) =>
          setConflictItems((prev) =>
            prev.map((c, idx) => (idx === i ? { ...c, action } : c))
          )
        }
        onConfirm={handleConflictConfirm}
        onCancel={handleConflictCancel}
      />

    </main>
  );
}
