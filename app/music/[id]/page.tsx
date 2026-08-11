"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AssetPicker, { type PickedAssetItem } from "@/components/AssetPicker";
import VoicePersonaPicker from "@/components/VoicePersonaPicker";
import Button from "@/components/ui/Button";
import Textarea from "@/components/ui/Textarea";
import { useErrorDialog } from "@/components/ui/ConfirmDialog";
import { isCosConfigured, transferAsset, uploadRefFile } from "@/lib/cos-client";
import {
  createMusicTask,
  generateLyrics,
  getMusicSettings,
  isMusicConfigured,
  MUSIC_PROVIDER_PRESETS,
  pollMusicTask,
} from "@/lib/music-client";
import { MUSIC_STYLE_CATEGORIES } from "@/lib/music-styles";
import {
  getMusic,
  getMusicsBySeries,
  getSeries,
  recordMediaAsset,
  saveMusic,
} from "@/lib/storage";
import { AUTOSAVE_DEBOUNCE_MS, debounce } from "@/lib/utils";
import type {
  Music,
  MusicMode,
  MusicModeParams,
  MusicQueryProxyResponse,
  MusicStatus,
  MusicTrack,
  MusicVersion,
} from "@/lib/types";

const MODE_LABELS: Record<MusicMode, string> = {
  inspiration: "灵感",
  custom: "自定义",
  remix: "二创",
};

const MODE_OPTIONS: { value: MusicMode; label: string }[] = [
  { value: "inspiration", label: "灵感模式" },
  { value: "custom", label: "自定义模式" },
  { value: "remix", label: "二次创作" },
];

const VERSION_OPTIONS: MusicVersion[] = ["v3.5", "v4", "v4.5", "v4.5+", "v4.5-all", "v5", "v5.5"];

const STATUS_LABELS: Partial<Record<MusicStatus, string>> = {
  pending: "生成中",
  completed: "完成",
  failed: "失败",
};

const STATUS_BADGE_CLASS: Partial<Record<MusicStatus, string>> = {
  pending: "bg-amber-100 text-amber-700",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-600",
};

const VOCAL_GENDER_OPTIONS: { value: "m" | "f" | ""; label: string }[] = [
  { value: "", label: "不指定" },
  { value: "m", label: "男声" },
  { value: "f", label: "女声" },
];

const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60";

function formatDuration(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseTags(value?: string): string[] {
  return (value ?? "")
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseTagsFromString(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((x) => (typeof x === "string" ? x.trim() : ""))
          .filter(Boolean);
      }
      if (parsed && typeof parsed === "object") {
        return Object.values(parsed)
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim())
          .filter(Boolean);
      }
    } catch {
    }
  }
  return parseTags(trimmed);
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-brand-600" : "bg-slate-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-[2px]"
          }`}
        />
      </span>
      <span className="text-sm text-slate-700">{label}</span>
    </button>
  );
}

function WeightSlider({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value?: number;
  disabled?: boolean;
  onChange: (v: number | undefined) => void;
}) {
  const enabled = value != null;
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <Toggle
          checked={enabled}
          disabled={disabled}
          onChange={(v) => onChange(v ? 0.5 : undefined)}
          label={label}
        />
        {enabled && (
          <span className="text-xs tabular-nums text-slate-400">{value.toFixed(2)}</span>
        )}
      </div>
      {enabled && (
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="mt-2.5 w-full accent-brand-600"
        />
      )}
    </div>
  );
}

function StyleTagsPanel({
  value,
  disabled,
  onToggleTag,
}: {
  value?: string;
  disabled?: boolean;
  onToggleTag: (tag: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    [MUSIC_STYLE_CATEGORIES[0].category]: true,
  });
  const selected = useMemo(
    () => new Set(parseTags(value).map((t) => t.toLowerCase())),
    [value]
  );
  return (
    <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      {MUSIC_STYLE_CATEGORIES.map((cat) => {
        const open = !!expanded[cat.category];
        return (
          <div key={cat.category} className="mb-1 last:mb-0">
            <button
              type="button"
              onClick={() => setExpanded((prev) => ({ ...prev, [cat.category]: !open }))}
              className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                className={`transition-transform ${open ? "rotate-90" : ""}`}
              >
                <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {cat.category}
            </button>
            {open && (
              <div className="mt-1 flex flex-wrap gap-1.5 pl-3">
                {cat.tags.map((tag) => {
                  const active = selected.has(tag.toLowerCase());
                  return (
                    <button
                      key={tag}
                      type="button"
                      disabled={disabled}
                      onClick={() => onToggleTag(tag)}
                      className={`rounded-full px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        active
                          ? "bg-brand-600 text-warm-50"
                          : "border border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-600"
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MusicPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const showError = useErrorDialog();

  const [music, setMusic] = useState<Music | null>(null);
  const [seriesTitle, setSeriesTitle] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  // 当前音乐供应商/模型（仅展示，不可选择，沿用设置页配置）
  const [musicProviderLabel, setMusicProviderLabel] = useState("");
  const [musicModelLabel, setMusicModelLabel] = useState("");
  const [lyricsTheme, setLyricsTheme] = useState("");
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  const [sourceTab, setSourceTab] = useState<"asset" | "url" | "upload">("asset");
  const [sourceName, setSourceName] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [expandedLyrics, setExpandedLyrics] = useState<Record<number, boolean>>({});
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const musicRef = useRef<Music | null>(null);
  musicRef.current = music;
  const seriesTitleRef = useRef("");
  seriesTitleRef.current = seriesTitle;
  const pollingTaskRef = useRef<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  if (abortRef.current === null) abortRef.current = new AbortController();
  useEffect(() => {
    const ac = abortRef.current!;
    return () => ac.abort();
  }, []);

  const persist = useCallback(
    debounce(async (m: Music) => {
      const result = await saveMusic(m);
      if (!result.ok) {
        setSaveError(result.error ?? "保存失败");
      } else {
        setSaveError(null);
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
      }
    }, AUTOSAVE_DEBOUNCE_MS),
    []
  );

  function update(mut: (m: Music) => Music) {
    setMusic((prev) => {
      if (!prev) return prev;
      const next = mut({ ...prev });
      next.updatedAt = Date.now();
      return next;
    });
  }

  function updateParams(patch: Partial<MusicModeParams>) {
    update((m) => ({
      ...m,
      params: {
        ...m.params,
        [m.mode]: { ...m.params[m.mode], ...patch },
      },
    }));
  }

  const skipPersistRef = useRef(true);
  useEffect(() => {
    if (!music) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    persist(music);
  }, [music, persist]);

  // 加载当前音乐供应商/模型用于展示
  useEffect(() => {
    getMusicSettings().then((s) => {
      if (s) {
        setMusicProviderLabel(MUSIC_PROVIDER_PRESETS[s.provider]?.label ?? s.provider);
        setMusicModelLabel(s.model || "");
      }
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const m = await getMusic(id);
      if (!m) {
        setNotFound(true);
        return;
      }
      setMusic(m);
      setSourceTab(m.source?.type ?? "asset");
      const s = await getSeries(m.seriesId);
      setSeriesTitle(s?.title ?? "");
      if (m.source?.type === "asset" && m.source.url) {
        try {
          const musics = await getMusicsBySeries(m.seriesId);
          const matched = musics
            .flatMap((o) => o.tracks.map((t) => ({ o, t })))
            .find(({ t }) => t.audioUrl === m.source!.url);
          if (matched) setSourceName(`${matched.o.title} · ${matched.t.title}`);
        } catch {
          /* ignore */
        }
      }
      if (m.source?.type === "upload" && m.source.fileName) {
        setSourceName(m.source.fileName);
      }
      if (m.status === "pending" && m.sunoTaskId) {
        startPolling(m.sunoTaskId);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function startPolling(taskId: string) {
    if (pollingTaskRef.current === taskId) return;
    pollingTaskRef.current = taskId;
    const signal = abortRef.current?.signal;
    setGenerating(true);
    pollMusicTask(
      taskId,
      {
        onProgress: (r) => setProgress(r.progress ?? null),
        onCompleted: (r) => {
          void handleCompleted(taskId, r);
        },
        onFailed: (err) => {
          void handleFailed(taskId, err);
        },
      },
      4000,
      10 * 60 * 1000,
      signal
    ).catch((err) => {
      const isAborted =
        (err as Error)?.name === "AbortError" || (err as Error)?.message === "已取消";
      if (!isAborted) void handleFailed(taskId, (err as Error).message);
    });
  }

  async function handleCompleted(taskId: string, result: MusicQueryProxyResponse) {
    pollingTaskRef.current = null;
    const m = musicRef.current;
    if (!m || m.sunoTaskId !== taskId) return;
    const rawTracks = result.music ?? [];
    const cosReady = await isCosConfigured().catch(() => false);
    const tracks: MusicTrack[] = [];
    for (let i = 0; i < rawTracks.length; i++) {
      const raw = rawTracks[i];
      let audioUrl = raw.audioUrl ?? "";
      let coverUrl = raw.imageUrl;
      if (cosReady) {
        try {
          if (audioUrl) audioUrl = (await transferAsset(audioUrl, "ai-script/music")).url;
        } catch (e) {
          console.error("音乐音频转存失败：", (e as Error).message);
        }
        try {
          if (coverUrl) coverUrl = (await transferAsset(coverUrl, "ai-script/music")).url;
        } catch (e) {
          console.error("音乐封面转存失败：", (e as Error).message);
        }
      }
      tracks.push({
        audioIndex: i + 1,
        title: raw.title?.trim() || `音轨 ${i + 1}`,
        audioUrl,
        coverUrl,
        duration: raw.duration,
        lyrics: raw.lyrics,
        tags: raw.tags,
      });
    }
    const completed: Music = {
      ...m,
      status: "completed",
      error: undefined,
      tracks,
      title: m.title.trim() ? m.title : (tracks[0]?.title ?? m.title),
      updatedAt: Date.now(),
    };
    setMusic(completed);
    await saveMusic(completed);
    setGenerating(false);
    setProgress(null);
    for (const track of tracks) {
      if (!track.audioUrl) continue;
      void recordMediaAsset({
        mediaType: "music",
        url: track.audioUrl,
        entityType: "music",
        entityName: track.title,
        prompt: track.tags || m.params[m.mode].tags || m.params[m.mode].lyrics || m.params.inspiration.prompt,
        source: "music",
        seriesId: m.seriesId,
        seriesTitle: seriesTitleRef.current,
      });
    }
  }

  async function handleFailed(taskId: string, error: string) {
    pollingTaskRef.current = null;
    if (error === "已取消") return;
    const m = musicRef.current;
    if (!m || m.sunoTaskId !== taskId) return;
    const failed: Music = { ...m, status: "failed", error, updatedAt: Date.now() };
    setMusic(failed);
    await saveMusic(failed);
    setGenerating(false);
    setProgress(null);
  }

  async function handleGenerate() {
    const m = musicRef.current;
    if (!m || generating) return;
    if (!(await isMusicConfigured())) {
      showError("请先在设置页配置音乐生成 API");
      return;
    }
    const p = m.params[m.mode];
    if (m.mode === "inspiration" && !p.prompt?.trim()) {
      showError("请填写提示词");
      return;
    }
    if (m.mode === "custom" && !p.instrumental && !p.lyrics?.trim()) {
      showError("请填写歌词（或开启纯音乐）");
      return;
    }
    if (m.mode === "remix") {
      if (!m.source?.url?.trim()) {
        showError("请先选择源音乐（从资产库选择、本地上传或添加公网地址）");
        return;
      }
    }

    const signal = abortRef.current?.signal;
    setGenerating(true);
    setProgress(null);
    try {
      const settings = await getMusicSettings();
      const model = settings?.model || "suno";
      const version = p.version || "v5";
      let action: "generate" | "inspo" = "generate";
      let payload: Record<string, unknown>;
      let source = m.source;

      if (m.mode === "remix") {
        action = "inspo";
        source = { ...m.source!, url: m.source!.url!.trim() };
        payload = {
          model,
          audio_urls: [source.url!],
          version,
        };
        if (p.lyrics?.trim()) payload.prompt = p.lyrics.trim();
        if (p.title?.trim()) payload.title = p.title.trim();
        if (p.tags?.trim()) payload.tags = p.tags.trim();
        if (p.negativeTags?.trim()) payload.negative_tags = p.negativeTags.trim();
        if (p.vocalGender) payload.vocal_gender = p.vocalGender;
        if (p.styleWeight != null) payload.style_weight = p.styleWeight;
        if (p.weirdnessConstraint != null) payload.weirdness_constraint = p.weirdnessConstraint;
        if (p.audioWeight != null) payload.audio_weight = p.audioWeight;
        if (p.autoLyrics != null) payload.auto_lyrics = p.autoLyrics;
      } else if (m.mode === "custom") {
        payload = {
          model,
          custom: true,
          version,
          instrumental: !!p.instrumental,
        };
        if (p.lyrics?.trim()) payload.prompt = p.lyrics.trim();
        if (p.title?.trim()) payload.title = p.title.trim();
        if (p.tags?.trim()) payload.style = p.tags.trim();
        if (p.negativeTags?.trim()) payload.negative_tags = p.negativeTags.trim();
        if (p.vocalGender) payload.vocal_gender = p.vocalGender;
        if (p.styleWeight != null) payload.style_weight = p.styleWeight;
        if (p.weirdnessConstraint != null) payload.weirdness_constraint = p.weirdnessConstraint;
        if (p.audioWeight != null) payload.audio_weight = p.audioWeight;
        if (p.autoLyrics != null) payload.auto_lyrics = p.autoLyrics;
        if (p.personaId?.trim()) payload.persona_id = p.personaId.trim();
      } else {
        payload = {
          model,
          custom: false,
          version,
          prompt: p.prompt!.trim(),
          instrumental: !!p.instrumental,
        };
        if (p.vocalGender) payload.vocal_gender = p.vocalGender;
      }

      const taskId = await createMusicTask(action, payload);
      const pending: Music = {
        ...m,
        status: "pending",
        error: undefined,
        sunoTaskId: taskId,
        source,
        updatedAt: Date.now(),
      };
      setMusic(pending);
      await saveMusic(pending);
      startPolling(taskId);
    } catch (e) {
      if (signal?.aborted) return;
      const msg = (e as Error).message;
      const current = musicRef.current;
      if (current) {
        const failed: Music = { ...current, status: "failed", error: msg, updatedAt: Date.now() };
        setMusic(failed);
        await saveMusic(failed);
      }
      setGenerating(false);
      setProgress(null);
    }
  }

  async function handleGenerateLyrics() {
    const theme = lyricsTheme.trim();
    if (!theme || lyricsLoading) return;
    if (!(await isMusicConfigured())) {
      showError("请先在设置页配置音乐生成 API");
      return;
    }
    setLyricsLoading(true);
    try {
      const { lyrics, title, tags } = await generateLyrics(theme);
      const patch: Partial<MusicModeParams> = { lyrics };
      if (title?.trim()) patch.title = title.trim();
      if (tags?.trim()) {
        const incoming = parseTagsFromString(tags);
        if (incoming.length > 0) {
          const merged = [...parseTags(musicRef.current?.params[musicRef.current.mode].tags)];
          for (const t of incoming) {
            if (!merged.some((x) => x.toLowerCase() === t.toLowerCase())) merged.push(t);
          }
          patch.tags = merged.join(", ");
        }
      }
      updateParams(patch);
    } catch (e) {
      showError(`歌词生成失败：${(e as Error).message}`);
    } finally {
      setLyricsLoading(false);
    }
  }

  function handleModeChange(mode: MusicMode) {
    setModeMenuOpen(false);
    if (mode === musicRef.current?.mode) return;
    update((m) => ({ ...m, mode }));
  }

  function toggleStyleTag(tag: string) {
    const current = parseTags(musicRef.current?.params[musicRef.current.mode].tags);
    const idx = current.findIndex((t) => t.toLowerCase() === tag.toLowerCase());
    if (idx >= 0) current.splice(idx, 1);
    else current.push(tag);
    updateParams({ tags: current.join(", ") });
  }

  function handlePickSource(items: PickedAssetItem[]) {
    setPickerOpen(false);
    const item = items[0];
    if (!item) return;
    update((m) => ({ ...m, source: { type: "asset", url: item.url } }));
    setSourceName(item.name);
  }

  async function handleUploadSource(file: File) {
    if (!file) return;
    if (!(await isCosConfigured())) {
      showError("请先在设置页配置 COS 存储");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadRefFile(file, `music-source-${Date.now()}`);
      update((m) => ({
        ...m,
        source: { type: "upload", url, fileName: file.name },
      }));
      setSourceName(file.name);
    } catch (e) {
      showError(`本地上传失败：${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  if (notFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-slate-500">
        <p>未找到该音乐</p>
        <Button onClick={() => router.push("/")}>返回首页</Button>
      </main>
    );
  }

  if (!music) {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-400">
        加载中…
      </main>
    );
  }

  const modeParams = music.params[music.mode];

  const vocalGenderControl = (
    <div className="flex items-center gap-1.5">
      <span className="mr-1 text-sm text-slate-500">人声性别</span>
      {VOCAL_GENDER_OPTIONS.map((opt) => (
        <button
          key={opt.label}
          type="button"
          disabled={generating}
          onClick={() => updateParams({ vocalGender: opt.value || undefined })}
          className={`rounded-md border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            (modeParams.vocalGender ?? "") === opt.value
              ? "border-brand-500 bg-brand-50 text-brand-700"
              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  const weightsControl = (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">高级权重（可选）</label>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <WeightSlider
          label="风格权重"
          value={modeParams.styleWeight}
          disabled={generating}
          onChange={(v) => updateParams({ styleWeight: v })}
        />
        <WeightSlider
          label="创意权重"
          value={modeParams.weirdnessConstraint}
          disabled={generating}
          onChange={(v) => updateParams({ weirdnessConstraint: v })}
        />
        <WeightSlider
          label="音频权重"
          value={modeParams.audioWeight}
          disabled={generating}
          onChange={(v) => updateParams({ audioWeight: v })}
        />
      </div>
    </div>
  );

  const autoLyricsToggle = (
    <Toggle
      checked={!!modeParams.autoLyrics}
      disabled={generating}
      onChange={(v) => updateParams({ autoLyrics: v })}
      label="对输入歌词进行二次创作"
    />
  );

  const tagsField = (required: boolean) => (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="block text-sm font-medium text-slate-700">
          {required ? (
            <>
              目标风格标签 <span className="text-red-500">*</span>
            </>
          ) : (
            "风格标签"
          )}
        </label>
        <button
          type="button"
          onClick={() => setStylePanelOpen((v) => !v)}
          className="text-xs text-brand-600 transition-colors hover:text-brand-700"
        >
          {stylePanelOpen ? "收起风格词库" : "风格词库"}
        </button>
      </div>
      <input
        value={modeParams.tags ?? ""}
        disabled={generating}
        onChange={(e) => updateParams({ tags: e.target.value })}
        placeholder="风格标签，逗号分隔，如：pop, upbeat"
        className={INPUT_CLASS}
      />
      {stylePanelOpen && (
        <StyleTagsPanel
          value={modeParams.tags}
          disabled={generating}
          onToggleTag={toggleStyleTag}
        />
      )}
    </div>
  );

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex items-center gap-3">
        <button
          onClick={() => router.push(music.seriesId ? `/series/${music.seriesId}` : "/")}
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
            value={music.title}
            onChange={(e) => update((m) => ({ ...m, title: e.target.value }))}
            onBlur={() => setTitleEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setTitleEditing(false);
            }}
            className="min-w-0 flex-1 rounded border border-brand-400 px-2 py-1 text-lg font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        ) : (
          <h1
            onClick={() => setTitleEditing(true)}
            className="min-w-0 flex-1 cursor-text truncate text-lg font-semibold text-slate-800"
            title="点击编辑标题"
          >
            {music.title || "未命名音乐"}
            {music.status !== "idle" && (
              <span
                className={`ml-1.5 rounded px-1.5 py-0.5 text-xs font-normal ${STATUS_BADGE_CLASS[music.status]}`}
              >
                {STATUS_LABELS[music.status]}
              </span>
            )}
          </h1>
        )}
        <span className="text-xs text-slate-400">
          {savedHint ? "已保存 ✓" : saveError ? saveError : ""}
        </span>
        <div ref={modeMenuRef} className="relative">
          <button
            type="button"
            disabled={generating}
            onClick={() => setModeMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {MODE_LABELS[music.mode]}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              className={`transition-transform ${modeMenuOpen ? "rotate-180" : ""}`}
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
          {modeMenuOpen && (
            <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleModeChange(opt.value)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors ${
                    music.mode === opt.value
                      ? "bg-brand-50 text-brand-700"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                  {music.mode === opt.value && (
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
      </header>

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-sm font-medium text-slate-500">版本</span>
          {VERSION_OPTIONS.filter((v) => music.mode !== "remix" || v !== "v3.5").map((v) => (
            <button
              key={v}
              type="button"
              disabled={generating}
              onClick={() => updateParams({ version: v })}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                modeParams.version === v
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {music.mode === "inspiration" && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                提示词 <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={modeParams.prompt ?? ""}
                disabled={generating}
                onChange={(e) => updateParams({ prompt: e.target.value })}
                placeholder="描述想要的音乐风格与氛围，如：深夜城市 lo-fi 钢琴，带雨声"
                rows={3}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Toggle
                checked={!!modeParams.instrumental}
                disabled={generating}
                onChange={(v) => updateParams({ instrumental: v })}
                label="纯音乐（无人声）"
              />
              {vocalGenderControl}
            </div>
          </div>
        )}

        {music.mode === "custom" && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">标题</label>
              <input
                value={modeParams.title ?? ""}
                disabled={generating}
                onChange={(e) => updateParams({ title: e.target.value })}
                placeholder="歌曲标题（可选）"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                歌词 {!modeParams.instrumental && <span className="text-red-500">*</span>}
              </label>
              <Textarea
                value={modeParams.lyrics ?? ""}
                disabled={generating}
                onChange={(e) => updateParams({ lyrics: e.target.value })}
                placeholder="填写歌词文本；开启纯音乐时可以不填"
                rows={6}
              />
              <div className="mt-2 flex gap-2">
                <input
                  value={lyricsTheme}
                  disabled={generating || lyricsLoading}
                  onChange={(e) => setLyricsTheme(e.target.value)}
                  placeholder="歌词主题，如：一首关于重逢的抒情歌"
                  className={INPUT_CLASS}
                />
                <Button
                  variant="secondary"
                  size="md"
                  loading={lyricsLoading}
                  disabled={generating || !lyricsTheme.trim()}
                  onClick={handleGenerateLyrics}
                  className="shrink-0"
                >
                  AI 生成歌词
                </Button>
              </div>
            </div>
            {tagsField(false)}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">负面标签</label>
              <input
                value={modeParams.negativeTags ?? ""}
                disabled={generating}
                onChange={(e) => updateParams({ negativeTags: e.target.value })}
                placeholder="不希望出现的风格，逗号分隔（可选）"
                className={INPUT_CLASS}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Toggle
                checked={!!modeParams.instrumental}
                disabled={generating}
                onChange={(v) => updateParams({ instrumental: v })}
                label="纯音乐（无人声）"
              />
              {vocalGenderControl}
            </div>
            {autoLyricsToggle}
            <VoicePersonaPicker
              value={modeParams.personaId ?? ""}
              disabled={generating}
              onChange={(personaId) => updateParams({ personaId })}
              seriesId={music.seriesId || undefined}
            />
            {weightsControl}
          </div>
        )}

        {music.mode === "remix" && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                源音乐 <span className="text-red-500">*</span>
              </label>
              <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { value: "asset", label: "从资产库选择" },
                    { value: "upload", label: "本地上传" },
                    { value: "url", label: "添加公网地址" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={generating}
                    onClick={() => setSourceTab(opt.value)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      sourceTab === opt.value
                        ? "border-brand-500 bg-brand-50 text-brand-700"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                {sourceTab === "asset" &&
                  !(music.source?.type === "asset" && music.source.url) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={generating}
                      onClick={() => setPickerOpen(true)}
                      className="shrink-0"
                    >
                      选择音乐
                    </Button>
                  )}
              </div>
              {sourceTab === "asset" ? (
                music.source?.type === "asset" && music.source.url ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="line-clamp-1 text-sm font-medium text-slate-700">
                        {sourceName || "已选音乐资产"}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={generating}
                          onClick={() => setPickerOpen(true)}
                        >
                          重新选择
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={generating}
                          onClick={() => {
                            update((m) => ({ ...m, source: undefined }));
                            setSourceName("");
                          }}
                        >
                          清除
                        </Button>
                      </div>
                    </div>
                    <audio controls src={music.source.url} className="w-full" />
                  </div>
                ) : null
              ) : sourceTab === "upload" ? (
                music.source?.type === "upload" && music.source.url ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="line-clamp-1 text-sm font-medium text-slate-700">
                        {sourceName || "已上传音乐"}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={generating || uploading}
                          onClick={() => uploadInputRef.current?.click()}
                        >
                          重新上传
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={generating || uploading}
                          onClick={() => {
                            update((m) => ({ ...m, source: undefined }));
                            setSourceName("");
                          }}
                        >
                          清除
                        </Button>
                      </div>
                    </div>
                    <audio controls src={music.source.url} className="w-full" />
                  </div>
                ) : (
                  <div>
                    <input
                      ref={uploadInputRef}
                      type="file"
                      accept="audio/*"
                      disabled={generating || uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleUploadSource(f);
                      }}
                      className="hidden"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={uploading}
                        disabled={generating || uploading}
                        onClick={() => uploadInputRef.current?.click()}
                        className="shrink-0"
                      >
                        {uploading ? "上传中…" : "选择文件"}
                      </Button>
                      <span className="text-xs text-slate-400">
                        支持上传本地音频文件（mp3、wav、m4a、aac 等），需已配置 COS 存储。
                      </span>
                    </div>
                  </div>
                )
              ) : (
                <div>
                  <input
                    value={music.source?.type === "url" ? music.source.url ?? "" : ""}
                    disabled={generating}
                    onChange={(e) =>
                      update((m) => ({ ...m, source: { type: "url", url: e.target.value } }))
                    }
                    placeholder="粘贴公开可访问的音频 URL，如 https://example.com/song.mp3"
                    className={INPUT_CLASS}
                  />
                  <p className="mt-1.5 text-xs text-slate-400">
                    公网音频将作为灵感参考生成新歌。
                  </p>
                </div>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">标题</label>
              <input
                value={modeParams.title ?? ""}
                disabled={generating}
                onChange={(e) => updateParams({ title: e.target.value })}
                placeholder="歌曲标题（可选）"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">歌词/提示词</label>
              <Textarea
                value={modeParams.lyrics ?? ""}
                disabled={generating}
                onChange={(e) => updateParams({ lyrics: e.target.value })}
                placeholder="填写歌词或提示词（可选，不填则沿用源音频内容）"
                rows={4}
              />
              <div className="mt-2 flex gap-2">
                <input
                  value={lyricsTheme}
                  disabled={generating || lyricsLoading}
                  onChange={(e) => setLyricsTheme(e.target.value)}
                  placeholder="歌词主题，如：一首关于重逢的抒情歌"
                  className={INPUT_CLASS}
                />
                <Button
                  variant="secondary"
                  size="md"
                  loading={lyricsLoading}
                  disabled={generating || !lyricsTheme.trim()}
                  onClick={handleGenerateLyrics}
                  className="shrink-0"
                >
                  AI 生成歌词
                </Button>
              </div>
            </div>
            {tagsField(false)}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">负面标签</label>
              <input
                value={modeParams.negativeTags ?? ""}
                disabled={generating}
                onChange={(e) => updateParams({ negativeTags: e.target.value })}
                placeholder="不希望出现的风格，逗号分隔（可选）"
                className={INPUT_CLASS}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              {vocalGenderControl}
            </div>
            {autoLyricsToggle}
            {weightsControl}
          </div>
        )}
      </section>

      <section className="mb-4 flex items-center justify-between gap-3">
        {musicProviderLabel && (
          <span
            className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500"
            title={`当前音乐 API 供应商：${musicProviderLabel}${musicModelLabel ? ` · ${musicModelLabel}` : ""}`}
          >
            {musicProviderLabel}{musicModelLabel ? ` · ${musicModelLabel}` : ""}
          </span>
        )}
        <div className="flex items-center gap-3">
          {generating && (
            <span className="text-xs text-slate-400">
              {progress != null ? `生成中 ${progress}%` : "生成中…"}
            </span>
          )}
          <Button
            variant="primary"
            size="md"
            loading={generating}
            disabled={generating}
            onClick={handleGenerate}
          >
            {generating
              ? "生成中…"
              : music.status === "failed" || music.tracks.length > 0
                ? "重新生成"
                : "生成音乐"}
          </Button>
        </div>
      </section>

      {music.status === "failed" && music.error && (
        <section className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              className="mt-0.5 shrink-0 text-red-500"
            >
              <path
                d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M12 8v4M12 16h.01"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-red-800">生成失败</h3>
              <p className="mt-1 break-words text-sm text-red-700">{music.error}</p>
              <p className="mt-1 text-xs text-red-400">可修改参数后点击「重新生成」重试</p>
            </div>
          </div>
        </section>
      )}

      {music.status === "completed" && music.tracks.length > 0 && (
        <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">
            生成结果（{music.tracks.length} 个音轨）
          </h3>
          <div className="space-y-3">
            {music.tracks.map((track) => (
              <div
                key={track.audioIndex}
                className="rounded-lg border border-slate-200 p-3"
              >
                <div className="flex items-start gap-3">
                  {track.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={track.coverUrl}
                      alt={track.title}
                      className="h-16 w-16 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-300">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M9 18V5l12-2v13"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.8" />
                        <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.8" />
                      </svg>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="line-clamp-1 text-sm font-semibold text-slate-800">
                        {track.title}
                      </h4>
                      {track.duration != null && (
                        <span className="shrink-0 text-xs tabular-nums text-slate-400">
                          {formatDuration(track.duration)}
                        </span>
                      )}
                    </div>
                    {track.tags && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {parseTags(track.tags).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {track.audioUrl && (
                      <audio controls src={track.audioUrl} className="mt-2 w-full" />
                    )}
                    {track.lyrics && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedLyrics((prev) => ({
                            ...prev,
                            [track.audioIndex]: !prev[track.audioIndex],
                          }))
                        }
                        className="mt-2 inline-flex items-center gap-1 text-xs text-brand-600 transition-colors hover:text-brand-700"
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          className={`transition-transform ${
                            expandedLyrics[track.audioIndex] ? "rotate-90" : ""
                          }`}
                        >
                          <path
                            d="M8 4l8 8-8 8"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        {expandedLyrics[track.audioIndex] ? "收起歌词" : "查看歌词"}
                      </button>
                    )}
                    {expandedLyrics[track.audioIndex] && track.lyrics && (
                      <pre className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-700">
                        {track.lyrics}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <AssetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        mediaType="music"
        defaultSeriesId={music.seriesId || undefined}
        selectedUrls={music.source?.type === "asset" && music.source.url ? [music.source.url] : []}
        onConfirm={handlePickSource}
      />
    </main>
  );
}
