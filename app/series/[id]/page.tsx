"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import EpisodeList from "@/components/EpisodeList";
import MusicList from "@/components/MusicList";
import Button from "@/components/ui/Button";
import { getSeries, saveSeries, deleteEpisode, getEpisodesBySeries, saveEpisode, getMusicsBySeries, saveMusic, deleteMusic, emptyMusic } from "@/lib/storage";
import { emptyEpisode } from "@/lib/utils";
import { getSettings } from "@/lib/llm-client";
import { isMusicConfigured } from "@/lib/music-client";
import type { Episode, Music, Series } from "@/lib/types";
import { useConfirm, useErrorDialog } from "@/components/ui/ConfirmDialog";

export default function SeriesPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const confirm = useConfirm();
  const showError = useErrorDialog();

  const [series, setSeries] = useState<Series | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [musics, setMusics] = useState<Music[]>([]);
  const [tab, setTabState] = useState<"episodes" | "music">("episodes");
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (tabMenuRef.current && !tabMenuRef.current.contains(e.target as Node)) {
        setTabMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const TAB_LABELS: Record<"episodes" | "music", string> = {
    episodes: "剧集",
    music: "音乐",
  };

  const refresh = useCallback(async () => {
    if (!id) return;
    const s = await getSeries(id);
    if (!s) {
      setNotFound(true);
      return;
    }
    setSeries(s);
    setEpisodes(await getEpisodesBySeries(id));
    setMusics(await getMusicsBySeries(id));
  }, [id]);

  const setTab = useCallback(
    (next: "episodes" | "music") => {
      setTabMenuOpen(false);
      setTabState(next);
      if (id) {
        try {
          window.localStorage.setItem(`series:tab:${id}`, next);
        } catch {
        }
      }
    },
    [id]
  );

  useEffect(() => {
    setMounted(true);
    if (id) {
      try {
        const saved = window.localStorage.getItem(`series:tab:${id}`);
        if (saved === "episodes" || saved === "music") setTabState(saved);
      } catch {
      }
    }
    refresh();
  }, [refresh, id]);

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
    if (!await confirm({
      message: "确定删除该剧集？此操作不可撤销。",
      confirmText: "删除",
    })) return;
    await deleteEpisode(epId);
    const updated: Series = {
      ...series,
      episodeOrder: series.episodeOrder.filter((id) => id !== epId),
    };
    await saveSeries(updated);
    setSeries(updated);
    setEpisodes((prev) => prev.filter((ep) => ep.id !== epId));
  }

  async function handleNewMusic() {
    if (!series) return;
    if (!await isMusicConfigured()) {
      showError("请先在设置页配置音乐生成 API");
      return;
    }
    const music = emptyMusic(series.id);
    const result = await saveMusic(music);
    if (!result.ok) {
      showError(result.error ?? "创建失败");
      return;
    }
    setMusics([...musics, music]);
    router.push(`/music/${music.id}`);
  }

  function handleOpenMusic(musicId: string) {
    router.push(`/music/${musicId}`);
  }

  async function handleDeleteMusic(musicId: string) {
    if (!await confirm({
      message: "确定删除该音乐？此操作不可撤销。",
      confirmText: "删除",
    })) return;
    await deleteMusic(musicId);
    setMusics((prev) => prev.filter((m) => m.id !== musicId));
  }

  if (notFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-slate-500">
        <p>未找到该企划</p>
        <Button onClick={() => router.push("/")}>返回首页</Button>
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

  const settingsButtons = (
    <div className="mb-4 flex flex-wrap gap-2">
      <Button variant="ghost" size="md" onClick={() => router.push(`/series/${id}/world-settings`)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-1">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
          <ellipse cx="12" cy="12" rx="4" ry="10" stroke="currentColor" strokeWidth="1.8" />
          <path d="M2 12h20" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        世界设定
      </Button>
      <Button variant="ghost" size="md" onClick={() => router.push(`/series/${id}/characters`)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-1">
          <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        人物设定
      </Button>
      <Button variant="ghost" size="md" onClick={() => router.push(`/series/${id}/objects`)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-1">
          <path
            d="M3 7l9-4 9 4-9 4-9-4z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M3 7v10l9 4 9-4V7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M12 11v10" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        物品设定
      </Button>
      <Button variant="ghost" size="md" onClick={() => router.push(`/series/${id}/scenes`)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-1">
          <path d="M3 17l6-6 4 4 4-7 4 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 21h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        场景设定
      </Button>
      <Button variant="ghost" size="md" onClick={() => router.push(`/series/${id}/style-settings`)}>
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
        风格设定
      </Button>
    </div>
  );

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
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
          <div ref={tabMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setTabMenuOpen((v) => !v)}
              className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              {TAB_LABELS[tab]}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                className={`transition-transform ${tabMenuOpen ? "rotate-180" : ""}`}
              >
                <path
                  d="M6 9l6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {tabMenuOpen && (
              <div className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                {(Object.keys(TAB_LABELS) as Array<"episodes" | "music">).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTab(value)}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors ${
                      tab === value
                        ? "bg-brand-50 text-brand-700"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {TAB_LABELS[value]}
                    {tab === value && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M5 13l4 4L19 7"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {mounted ? (
        <div>
          {tab === "episodes" ? (
            <EpisodeList
              episodes={episodes}
              onOpen={handleOpenEpisode}
              onDelete={handleDeleteEpisode}
              onCreate={handleNewEpisode}
              settingsButtons={settingsButtons}
            />
          ) : (
            <MusicList
              musics={musics}
              onOpen={handleOpenMusic}
              onDelete={handleDeleteMusic}
              onCreate={handleNewMusic}
              settingsButtons={settingsButtons}
            />
          )}
        </div>
      ) : (
        <div className="py-20 text-center text-slate-400">加载中…</div>
      )}
    </main>
  );
}
