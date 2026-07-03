"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import EpisodeList from "@/components/EpisodeList";
import WorldSettingsModal from "@/components/WorldSettingsModal";
import StyleSettingsModal from "@/components/StyleSettingsModal";
import Button from "@/components/ui/Button";
import { getSeries, saveSeries, deleteEpisode, getEpisodesBySeries, saveEpisode } from "@/lib/storage";
import { emptyEpisode } from "@/lib/utils";
import { getSettings } from "@/lib/llm-client";
import { getWorldSettings } from "@/lib/world-settings";
import { getStyleSettings } from "@/lib/style-settings";
import type { Episode, Series, WorldSettings, StyleSettings } from "@/lib/types";

export default function SeriesPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [series, setSeries] = useState<Series | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [worldSettingsOpen, setWorldSettingsOpen] = useState(false);
  const [styleSettingsOpen, setStyleSettingsOpen] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    const s = await getSeries(id);
    if (!s) {
      setNotFound(true);
      return;
    }
    setSeries(s);
    setEpisodes(await getEpisodesBySeries(id));
  }, [id]);

  useEffect(() => {
    setMounted(true);
    refresh();
  }, [refresh]);

  async function handleNewEpisode() {
    if (!series) return;
    const s = getSettings();
    if (!s) {
      alert("请先配置 LLM API");
      return;
    }
    const ep = emptyEpisode(series.id);
    const result = await saveEpisode(ep);
    if (!result.ok) {
      alert(result.error ?? "创建失败");
      return;
    }
    // 把新剧集加入 series.episodeOrder
    const updated: Series = {
      ...series,
      episodeOrder: [...series.episodeOrder, ep.id],
    };
    saveSeries(updated);
    setSeries(updated);
    setEpisodes([...episodes, ep]);
    router.push(`/episode/${ep.id}`);
  }

  function handleOpenEpisode(epId: string) {
    router.push(`/episode/${epId}`);
  }

  async function handleDeleteEpisode(epId: string) {
    if (!series) return;
    if (!confirm("确定删除该剧集？此操作不可撤销。")) return;
    await deleteEpisode(epId);
    const updated: Series = {
      ...series,
      episodeOrder: series.episodeOrder.filter((id) => id !== epId),
    };
    await saveSeries(updated);
    setSeries(updated);
    setEpisodes((prev) => prev.filter((ep) => ep.id !== epId));
  }

  function handleWorldSettingsSave(ws: WorldSettings) {
    if (!series) return;
    const updated = { ...series, worldSettings: ws };
    saveSeries(updated);
    setSeries(updated);
  }

  function handleStyleSettingsSave(ss: StyleSettings) {
    if (!series) return;
    const updated = { ...series, styleSettings: ss };
    saveSeries(updated);
    setSeries(updated);
  }

  if (notFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-slate-500">
        <p>未找到该企划</p>
        <Button onClick={() => router.push("/home")}>返回首页</Button>
      </main>
    );
  }

  if (!series) {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-400">
        加载中…
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/home")}
            className="text-slate-400 hover:text-slate-600"
            title="返回首页"
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
              value={series.title}
              onChange={(e) => setSeries({ ...series, title: e.target.value })}
              onBlur={() => {
                setTitleEditing(false);
                saveSeries(series);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setTitleEditing(false);
                  saveSeries(series);
                }
              }}
              className="rounded border border-brand-400 px-2 py-1 text-lg font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          ) : (
            <h1
              onClick={() => setTitleEditing(true)}
              className="cursor-text text-lg font-semibold text-slate-800"
              title="点击编辑标题"
            >
              {series.title || "未命名企划"}
            </h1>
          )}
          <span className="text-xs text-slate-400">
            {series.episodeOrder.length} 集
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="md" onClick={() => setWorldSettingsOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-1">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
              <ellipse cx="12" cy="12" rx="4" ry="10" stroke="currentColor" strokeWidth="1.8" />
              <path d="M2 12h20" stroke="currentColor" strokeWidth="1.8" />
            </svg>
            世界设定
          </Button>
          <Button variant="ghost" size="md" onClick={() => setStyleSettingsOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-1">
              <path
                d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-4.97-4.5-9-10-9z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" />
              <circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" />
              <circle cx="15" cy="8" r="1.2" fill="currentColor" />
              <circle cx="17.5" cy="12" r="1.2" fill="currentColor" />
            </svg>
            漫剧风格
          </Button>
        </div>
      </header>

      {mounted ? (
        <EpisodeList
          episodes={episodes}
          onOpen={handleOpenEpisode}
          onDelete={handleDeleteEpisode}
          onCreate={handleNewEpisode}
        />
      ) : (
        <div className="py-20 text-center text-slate-400">加载中…</div>
      )}

      <WorldSettingsModal
        open={worldSettingsOpen}
        onClose={() => setWorldSettingsOpen(false)}
        initialSettings={series.worldSettings}
        onSave={handleWorldSettingsSave}
      />

      <StyleSettingsModal
        open={styleSettingsOpen}
        onClose={() => setStyleSettingsOpen(false)}
        initialSettings={series.styleSettings}
        onSave={handleStyleSettingsSave}
      />
    </main>
  );
}
