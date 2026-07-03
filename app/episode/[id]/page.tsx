"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Stepper from "@/components/Stepper";
import ContentExpansion from "@/components/ContentExpansion";
import StoryboardTable from "@/components/StoryboardTable";
import AssetPreparation from "@/components/AssetPreparation";
import VideoGeneration from "@/components/VideoGeneration";
import Button from "@/components/ui/Button";
import SettingsModal from "@/components/SettingsModal";
import { getEpisode, saveEpisode, getEpisodesBySeries, getSeries } from "@/lib/storage";
import { getSettings } from "@/lib/llm-client";
import { emptyShot, debounce } from "@/lib/utils";
import type { Asset, Episode, Shot, VideoStatus, StyleSettings, WorldSettings } from "@/lib/types";

export default function EpisodePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [episode, setEpisode] = useState<Episode | null>(null);
  const [seriesOrder, setSeriesOrder] = useState<number>(1);
  const [seriesStyleSettings, setSeriesStyleSettings] = useState<StyleSettings | null>(null);
  const [seriesWorldSettings, setSeriesWorldSettings] = useState<WorldSettings | null>(null);
  const [previousContext, setPreviousContext] = useState<string>("");
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [titleEditing, setTitleEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState(false);

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
      persist(next);
      return next;
    });
  }

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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
          >
            设置
          </Button>
        </div>
      </header>

      {currentStep === 1 ? (
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <ContentExpansion
            originalContent={episode.originalContent}
            expandedContent={episode.expandedContent}
            previousContext={previousContext}
            worldSettings={seriesWorldSettings}
            onOriginalChange={(v) =>
              update((ep) => ({ ...ep, originalContent: v }))
            }
            onExpandedChange={(v) =>
              update((ep) => ({ ...ep, expandedContent: v }))
            }
            onShotsGenerated={handleShotsGenerated}
            onEnterStep2={() => gotoStep(2)}
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
        />
      ) : currentStep === 3 ? (
        <div className="mx-auto max-w-6xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <AssetPreparation
            episode={episode}
            onUpdateAsset={handleUpdateAsset}
            onReplaceAssets={handleReplaceAssets}
            onBackToStep2={() => gotoStep(2)}
            seriesStyleSettings={seriesStyleSettings}
          />
        </div>
      ) : (
        <VideoGeneration
          episode={episode}
          onUpdateShot={handleUpdateShot}
          onUpdateVideoStatus={handleUpdateVideoStatus}
          onBackToStep3={() => gotoStep(3)}
          onLinkAsset={handleLinkAsset}
          onUnlinkAsset={handleUnlinkAsset}
          seriesStyleSettings={seriesStyleSettings}
        />
      )}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}
