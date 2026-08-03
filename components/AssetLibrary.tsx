"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ImageLightbox from "@/components/ImageLightbox";
import Spinner from "@/components/ui/Spinner";
import { ImageGenerationDialog } from "./ImageGenerationDialog";
import VoicePersonaCreateDialog from "./VoicePersonaCreateDialog";
import { apiClient } from "@/lib/api-client";
import { ASSET_TYPE_LABELS, formatTime } from "@/lib/utils";
import { isCosConfigured, transferAsset, uploadRefFile } from "@/lib/cos-client";
import { generateImage, getImageSettings, DEFAULT_ASSET_IMAGE_CONFIG, getDefaultAssetImageConfig, getAllConfiguredImageModels } from "@/lib/image-client";
import { type ModelOption } from "@/lib/model-presets";
import { getVoicePersonas, deleteVoicePersona } from "@/lib/storage";
import type { AssetImageConfig, MediaAsset, MediaAssetInput, VoicePersona } from "@/lib/types";

type MediaTypeFilter = "all" | "image" | "video" | "audio" | "music" | "voice";
type EntityTypeFilter = "all" | "character" | "scene" | "object" | "screenshot" | "storyboard" | "generated";

const MEDIA_TYPE_OPTIONS: { value: MediaTypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音色" },
  { value: "music", label: "音乐" },
  { value: "voice", label: "歌手音色" },
];

const ENTITY_TYPE_OPTIONS: { value: EntityTypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "character", label: "人物" },
  { value: "object", label: "物品" },
  { value: "scene", label: "场景" },
  { value: "screenshot", label: "截屏" },
  { value: "storyboard", label: "故事板" },
  { value: "generated", label: "生成" },
];

/** 添加资产弹窗用的实体类型选项 */
const ADD_ENTITY_TYPE_OPTIONS: { value: MediaAsset["entityType"]; label: string }[] = [
  { value: "character", label: "人物" },
  { value: "object", label: "物品" },
  { value: "scene", label: "场景" },
  { value: "screenshot", label: "截屏" },
  { value: "storyboard", label: "故事板" },
  { value: "generated", label: "生成" },
];

const ADD_MEDIA_TYPE_OPTIONS: { value: MediaAsset["mediaType"]; label: string }[] = [
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
];

function entityTypeLabel(t: MediaAsset["entityType"]): string {
  if (t === "shot") return "镜头";
  if (t === "other") return "其他";
  return ASSET_TYPE_LABELS[t] ?? t;
}

function sourceLabel(item: MediaAsset): string {
  if (item.source === "manual") return "手动添加";
  if (item.source === "asset" || item.source === "shot" || item.source === "screenshot") {
    return item.episodeTitle || "未命名剧集";
  }
  return "企划设定";
}

function mediaEmptyText(mediaType: MediaTypeFilter): string {
  if (mediaType === "image") return "暂无图片资产";
  if (mediaType === "video") return "暂无视频资产";
  if (mediaType === "audio") return "暂无音色资产";
  if (mediaType === "music") return "暂无音乐资产";
  if (mediaType === "voice") return "暂无歌手音色，点击右上角「创建歌手音色」开始";
  return "暂无生成的资产";
}

/** 下载媒体文件：优先 fetch blob 触发下载，失败则新窗口打开 */
async function downloadMedia(url: string, fallbackName: string) {
  const fromUrl = url.split("/").pop()?.split("?")[0] ?? "";
  const fileName =
    fromUrl && fromUrl.includes(".") ? decodeURIComponent(fromUrl) : fallbackName;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objUrl);
  } catch {
    window.open(url, "_blank");
  }
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    /* 忽略 */
  }
}

export default function AssetLibrary() {
  const router = useRouter();
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [seriesId, setSeriesId] = useState("");
  const [mediaType, setMediaType] = useState<MediaTypeFilter>("all");
  const [entityType, setEntityType] = useState<EntityTypeFilter>("all");
  const [videoPreview, setVideoPreview] = useState<MediaAsset | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<null | { ids: string[]; names: string[] }>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [voiceCreateOpen, setVoiceCreateOpen] = useState(false);
  const [voicePersonas, setVoicePersonas] = useState<VoicePersona[]>([]);
  const [allSeries, setAllSeries] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    apiClient.listSeries().then((list) => {
      setAllSeries(
        (list ?? [])
          .map((s) => ({ id: s.id, title: s.title || "未命名企划" }))
          .sort((a, b) => a.title.localeCompare(b.title, "zh"))
      );
    }).catch(() => setAllSeries([]));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, voices] = await Promise.all([
        apiClient.listMediaAssets(),
        getVoicePersonas(),
      ]);
      setItems(list);
      setVoicePersonas(voices);
    } catch {
      setItems([]);
      setVoicePersonas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 视频预览：ESC 关闭 + 禁止滚动
  useEffect(() => {
    if (!videoPreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVideoPreview(null);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [videoPreview]);

  const seriesOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of allSeries) map.set(s.id, s.title);
    for (const item of items) {
      if (item.seriesId && !map.has(item.seriesId)) {
        map.set(item.seriesId, item.seriesTitle || "未命名企划");
      }
    }
    return Array.from(map, ([id, title]) => ({ id, title }));
  }, [allSeries, items]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (seriesId && item.seriesId !== seriesId) return false;
      if (mediaType === "image" && item.mediaType !== "image") return false;
      if (mediaType === "video" && item.mediaType !== "video") return false;
      if (mediaType === "audio" && item.mediaType !== "audio") return false;
      if (mediaType === "music" && item.mediaType !== "music") return false;
      if (entityType !== "all" && item.entityType !== entityType) return false;
      return true;
    });
  }, [items, seriesId, mediaType, entityType]);

  // 媒体类型为"视频"或"歌手音色"时，实体类型筛选无意义，禁用
  const entityTypeDisabled = mediaType === "video" || mediaType === "voice";

  async function handleCopy(item: MediaAsset) {
    await copyUrl(item.url);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId((cur) => (cur === item.id ? null : cur)), 1500);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected(new Set(filtered.map((i) => i.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function performDelete(ids: string[]) {
    setDeleting(true);
    try {
      await apiClient.deleteMediaAssets(ids);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      await refresh();
    } catch (e) {
      alert("删除失败：" + (e as Error).message);
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  function requestDeleteSingle(item: MediaAsset) {
    setConfirmDelete({ ids: [item.id], names: [item.entityName] });
  }

  async function deleteVoicePersonaItem(vp: VoicePersona) {
    setDeleting(true);
    try {
      await deleteVoicePersona(vp.id);
      await refresh();
    } catch (e) {
      alert("删除失败：" + (e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  function requestDeleteSelected() {
    const ids = filtered.filter((i) => selected.has(i.id)).map((i) => i.id);
    const names = filtered.filter((i) => selected.has(i.id)).map((i) => i.entityName);
    if (ids.length === 0) return;
    setConfirmDelete({ ids, names });
  }

  return (
    <div>
      {/* 顶部 header：返回 + 标题 + 操作按钮（同一水平线） */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          onClick={() => router.back()}
          className="text-slate-400 hover:text-slate-600"
          title="返回"
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
        <h1 className="text-xl font-bold text-slate-800">资产库</h1>

        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <button
            onClick={() => setVoiceCreateOpen(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          >
            + 创建歌手音色
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          >
            + 添加资产
          </button>
          <button
            onClick={() => { setSelectMode(!selectMode); clearSelection(); }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
              selectMode
                ? "bg-slate-800 text-white hover:bg-slate-900"
                : "bg-brand-100 text-brand-700 hover:bg-brand-200"
            }`}
          >
            {selectMode ? "退出多选" : "多选"}
          </button>
          {selectMode && (
            <>
              <span className="text-slate-500">已选 {selected.size} 项</span>
              <button onClick={selectAllVisible} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">全选</button>
              <button onClick={clearSelection} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">清空</button>
              <button
                onClick={requestDeleteSelected}
                disabled={selected.size === 0 || deleting}
                className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                删除选中
              </button>
            </>
          )}
          {!selectMode && <span className="text-slate-400">共 {filtered.length} 项</span>}
        </div>
      </div>

      {/* 过滤栏 */}
      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-500">企划</span>
            <select
              value={seriesId}
              onChange={(e) => setSeriesId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              <option value="">全部企划</option>
              {seriesOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-sm font-medium text-slate-500">媒体</span>
            {MEDIA_TYPE_OPTIONS.map((opt) => (
              <FilterPill
                key={opt.value}
                active={mediaType === opt.value}
                onClick={() => setMediaType(opt.value)}
              >
                {opt.label}
              </FilterPill>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-sm font-medium text-slate-500">类型</span>
          {ENTITY_TYPE_OPTIONS.map((opt) => (
            <FilterPill
              key={opt.value}
              active={entityType === opt.value}
              disabled={entityTypeDisabled}
              onClick={() => setEntityType(opt.value)}
            >
              {opt.label}
            </FilterPill>
          ))}
        </div>
      </div>

      {/* 内容区 */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
          <Spinner size={18} />
          <span>加载中…</span>
        </div>
      ) : mediaType === "voice" ? (
        voicePersonas.length === 0 ? (
          <div className="py-20 text-center text-slate-400">
            暂无歌手音色，点击右上角「创建歌手音色」开始
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {voicePersonas.map((vp) => (
              <VoicePersonaCard
                key={vp.id}
                vp={vp}
                onDelete={() => deleteVoicePersonaItem(vp)}
              />
            ))}
          </div>
        )
      ) : items.length === 0 ? (
        <div className="py-20 text-center text-slate-400">{mediaEmptyText(mediaType)}</div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-slate-400">
          {mediaType === "all" ? "没有匹配的资产，试试调整筛选条件" : mediaEmptyText(mediaType)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((item) => (
            <AssetCard
              key={item.id}
              item={item}
              copied={copiedId === item.id}
              selectMode={selectMode}
              selected={selected.has(item.id)}
              onToggleSelect={() => toggleSelect(item.id)}
              onPreviewVideo={() => setVideoPreview(item)}
              onDownload={() =>
                downloadMedia(
                  item.url,
                  `${item.entityName}.${item.mediaType === "video" ? "mp4" : item.mediaType === "image" ? "png" : "mp3"}`
                )
              }
              onCopy={() => handleCopy(item)}
              onDelete={() => requestDeleteSingle(item)}
            />
          ))}
        </div>
      )}

      {/* 视频预览模态 */}
      {videoPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setVideoPreview(null)}
        >
          <button
            onClick={() => setVideoPreview(null)}
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
            aria-label="关闭"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6L6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              downloadMedia(
                videoPreview.url,
                `${videoPreview.entityName}.mp4`
              );
            }}
            className="absolute right-16 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
            aria-label="下载"
            title="下载视频"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <video
            src={videoPreview.url}
            controls
            autoPlay
            className="max-h-[85vh] max-w-[90vw] rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* 删除确认弹窗 */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => !deleting && setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-base font-semibold text-slate-800">确认删除</h3>
            <p className="mb-1 text-sm text-slate-600">
              将从资产库移除 {confirmDelete.ids.length} 个资产记录（仅删除账本记录，不影响已生成的原始文件）。此操作不可撤销。
            </p>
            {confirmDelete.ids.length <= 3 && (
              <ul className="mb-3 max-h-32 space-y-0.5 overflow-y-auto text-xs text-slate-500">
                {confirmDelete.names.map((n, i) => (
                  <li key={i} className="line-clamp-1">• {n}</li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={() => performDelete(confirmDelete.ids)}
                disabled={deleting}
                className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-40"
              >
                {deleting ? "删除中…" : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 添加资产弹窗 */}
      {addOpen && (
        <AddAssetDialog
          seriesOptions={seriesOptions}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            refresh();
          }}
        />
      )}

      {/* 创建歌手音色弹窗 */}
      <VoicePersonaCreateDialog
        open={voiceCreateOpen}
        onClose={() => setVoiceCreateOpen(false)}
        onCreated={() => {
          setVoiceCreateOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

const VOICE_SOURCE_LABELS: Record<VoicePersona["sourceType"], string> = {
  upload: "上传",
  tts: "TTS",
  url: "链接",
};

const VOICE_STATUS_LABELS: Record<VoicePersona["status"], { label: string; cls: string }> = {
  idle: { label: "待创建", cls: "bg-slate-100 text-slate-500" },
  pending: { label: "创建中", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "已完成", cls: "bg-green-100 text-green-700" },
  failed: { label: "失败", cls: "bg-red-100 text-red-600" },
};

function VoicePersonaCard({
  vp,
  onDelete,
}: {
  vp: VoicePersona;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const statusInfo = VOICE_STATUS_LABELS[vp.status] ?? VOICE_STATUS_LABELS.idle;

  function copyPersonaId() {
    if (!vp.personaId) return;
    navigator.clipboard.writeText(vp.personaId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <span className="truncate text-sm font-medium text-slate-800">{vp.name}</span>
        <div className="flex shrink-0 items-center gap-1">
          <span className={`rounded px-1.5 py-0.5 text-xs ${statusInfo.cls}`}>
            {statusInfo.label}
          </span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
            {VOICE_SOURCE_LABELS[vp.sourceType]}
          </span>
        </div>
      </div>

      <div className="flex-1 space-y-2 p-3">
        {vp.sourceAudioUrl ? (
          <audio controls src={vp.sourceAudioUrl} className="w-full" preload="metadata" />
        ) : (
          <div className="flex h-10 items-center justify-center rounded bg-slate-50 text-xs text-slate-400">
            无预览音频
          </div>
        )}

        {vp.description && (
          <p className="line-clamp-2 text-xs text-slate-500">{vp.description}</p>
        )}

        {vp.personaId ? (
          <div className="flex items-center gap-1.5">
            <code className="flex-1 truncate rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
              {vp.personaId}
            </code>
            <button
              onClick={copyPersonaId}
              className="shrink-0 rounded px-1.5 py-1 text-xs text-brand-600 hover:bg-brand-50"
              title="复制 Persona ID"
            >
              {copied ? "已复制" : "复制"}
            </button>
          </div>
        ) : vp.status === "failed" ? (
          <p className="line-clamp-2 text-xs text-red-500">{vp.error || "创建失败"}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-3 py-1.5">
        <span className="text-xs text-slate-400">{formatTime(vp.createdAt)}</span>
        <button
          onClick={onDelete}
          className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
        >
          删除
        </button>
      </div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-brand-600 text-warm-50"
          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      {children}
    </button>
  );
}

function AssetCard({
  item,
  copied,
  selectMode,
  selected,
  onToggleSelect,
  onPreviewVideo,
  onDownload,
  onCopy,
  onDelete,
}: {
  item: MediaAsset;
  copied: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onPreviewVideo: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const isVideo = item.mediaType === "video";
  const isAudio = item.mediaType === "audio";
  const isMusic = item.mediaType === "music";

  const thumbnail = (
    <div className="group relative aspect-square w-full overflow-hidden bg-slate-100">
      {isVideo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <video
            muted
            preload="metadata"
            src={item.url}
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </>
      ) : isAudio || isMusic ? (
        <div className="flex h-full w-full items-center justify-center bg-slate-50 p-3">
          <audio controls src={item.url} className="w-full" />
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.url}
          alt={item.entityName}
          className="h-full w-full object-cover"
        />
      )}

      {/* 媒体类型角标 / 多选勾选圈 */}
      {selectMode ? (
        <div
          className={`absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 backdrop-blur-sm ${
            selected ? "border-brand-500 bg-brand-500 text-white" : "border-white bg-black/30 text-transparent"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
              d="M20 6L9 17l-5-5"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ) : (
        <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {isVideo ? "视频" : isAudio ? "音色" : isMusic ? "音乐" : "图片"}
        </span>
      )}

      {/* 悬停操作按钮 */}
      {!selectMode && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
            className="flex h-7 w-7 items-center justify-center rounded bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
            aria-label="下载"
            title="下载"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            className="flex h-7 w-7 items-center justify-center rounded bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
            aria-label="复制链接"
            title={copied ? "已复制" : "复制链接"}
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M20 6L9 17l-5-5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M10 14a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 10a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="flex h-7 w-7 items-center justify-center rounded bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-red-500"
            aria-label="删除"
            title="删除"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      onClick={selectMode ? onToggleSelect : undefined}
      className={`group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-all hover:shadow-md ${
        selectMode
          ? selected
            ? "border-brand-500 ring-2 ring-brand-500/30"
            : "border-slate-200 hover:border-brand-300"
          : "border-slate-200 hover:border-brand-300"
      }`}
    >
      {selectMode ? (
        thumbnail
      ) : isVideo ? (
        <div onClick={onPreviewVideo} title="点击播放">
          {thumbnail}
        </div>
      ) : isAudio || isMusic ? (
        thumbnail
      ) : (
        <ImageLightbox src={item.url} alt={item.entityName}>
          {thumbnail}
        </ImageLightbox>
      )}

      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center gap-2">
          <span className="line-clamp-1 flex-1 text-sm font-semibold text-slate-800">
            {item.entityName}
          </span>
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
            {entityTypeLabel(item.entityType)}
          </span>
        </div>
        <div className="line-clamp-1 text-xs text-slate-400">
          {item.seriesTitle || "未命名企划"} · {sourceLabel(item)}
        </div>
        <div className="text-[11px] text-slate-300">
          {formatTime(item.createdAt)}
        </div>
      </div>
    </div>
  );
}

/** 添加资产弹窗：支持上传本地文件或粘贴 URL，写入 media_assets 账本 */
function AddAssetDialog({
  seriesOptions,
  onClose,
  onCreated,
}: {
  seriesOptions: { id: string; title: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [mediaType, setMediaType] = useState<MediaAsset["mediaType"]>("image");
  const [entityType, setEntityType] = useState<MediaAsset["entityType"]>("character");
  const [mode, setMode] = useState<"upload" | "url" | "generate">("upload");
  const [name, setName] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [seriesId, setSeriesId] = useState(seriesOptions[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cosReady, setCosReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 图片生成相关状态
  const [imageConfigured, setImageConfigured] = useState(false);
  // 所有「已配置 API Key」图片供应商的全部模型（聚合，供模型选择弹框使用）
  const [imageOptions, setImageOptions] = useState<ModelOption[]>([]);
  const [genOpen, setGenOpen] = useState(false);
  const [genInitialPrompt, setGenInitialPrompt] = useState("");
  const [genImageConfig, setGenImageConfig] = useState<AssetImageConfig>(DEFAULT_ASSET_IMAGE_CONFIG);
  const [defaultImageConfig, setDefaultImageConfig] = useState<AssetImageConfig>(DEFAULT_ASSET_IMAGE_CONFIG);
  const [genRefImages, setGenRefImages] = useState<string[]>([]);
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  // 卸载时取消进行中的生成轮询，避免孤儿轮询
  const abortRef = useRef<AbortController | null>(null);
  if (abortRef.current === null) abortRef.current = new AbortController();
  useEffect(() => {
    const ac = abortRef.current!;
    return () => ac.abort();
  }, []);

  useEffect(() => {
    (async () => {
      const s = await getImageSettings();
      setImageConfigured(!!s?.apiKey);
      setImageOptions(await getAllConfiguredImageModels());
    })();
    isCosConfigured().then(setCosReady);
    // 用户自定义的图片默认生成参数（每次打开弹框时作为基础）
    getDefaultAssetImageConfig().then(setDefaultImageConfig);
  }, []);

  function changeMode(next: "upload" | "url" | "generate") {
    setMode(next);
    if (next === "generate") setMediaType("image");
    setGeneratedUrl("");
    setGeneratedPrompt("");
  }

  function openGenerateDialog() {
    setGenInitialPrompt(name.trim());
    setGenImageConfig({
      ...defaultImageConfig,
    });
    setGenOpen(true);
  }

  async function handleGenerateConfirm(params: {
    prompt: string;
    images: string[];
    config: AssetImageConfig;
  }) {
    setGenOpen(false);
    setGenerating(true);
    setError(null);
    try {
      const result = await generateImage(
        params.prompt,
        params.config,
        params.images.length > 0 ? params.images : undefined,
        undefined,
        abortRef.current?.signal
      );
      let finalUrl = result.imageUrl;
      if (cosReady) {
        try {
          const { url } = await transferAsset(result.imageUrl, "ai-script/assets");
          finalUrl = url;
        } catch {
          finalUrl = result.imageUrl;
        }
      }
      setGeneratedUrl(finalUrl);
      setGeneratedPrompt(params.prompt);
      setGenInitialPrompt(params.prompt);
    } catch (e) {
      // 与其他生图入口保持一致的取消判定：不依赖共享 signal.aborted（避免真实失败被误判为取消而静默）
      const isAborted =
        (e as Error)?.name === "AbortError" || (e as Error)?.message === "已取消";
      if (!isAborted) setError("图片生成失败：" + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    if (!name.trim()) {
      setError("请填写资产名称");
      return;
    }

    let url = "";
    let prompt = "";
    if (mode === "upload") {
      if (!file) {
        setError("请选择要上传的文件");
        return;
      }
      if (!cosReady) {
        setError("请先配置存储方式后再上传文件");
        return;
      }
      setSubmitting(true);
      try {
        url = await uploadRefFile(file, name.trim() || `asset-${Date.now()}`);
      } catch (e) {
        setError("文件上传失败：" + (e as Error).message);
        setSubmitting(false);
        return;
      }
    } else if (mode === "generate") {
      if (!generatedUrl) {
        setError("请先生成图片");
        return;
      }
      url = generatedUrl;
      prompt = generatedPrompt.trim();
    } else {
      url = urlInput.trim();
      if (!url) {
        setError("请填写资源 URL");
        return;
      }
      if (!/^https?:\/\//i.test(url)) {
        setError("URL 需以 http(s):// 开头");
        return;
      }
    }

    const series = seriesOptions.find((s) => s.id === seriesId);
    const input: MediaAssetInput = {
      mediaType,
      url,
      entityType,
      entityName: name.trim(),
      prompt,
      source: "manual",
      seriesId: series?.id,
      seriesTitle: series?.title,
    };

    setSubmitting(true);
    try {
      await apiClient.addMediaAsset(input);
      onCreated();
    } catch (e) {
      setError("添加失败：" + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const accept =
    mediaType === "image" ? "image/*" : mediaType === "video" ? "video/*" : "audio/*";

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget && !submitting) onClose();
        }}
      >
        <div
          className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
        <h3 className="mb-4 text-base font-semibold text-slate-800">添加资产</h3>

        <div className="space-y-4">
          {/* 媒体类型 */}
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-sm text-slate-500">媒体类型</span>
            <div className="flex gap-1.5">
              {ADD_MEDIA_TYPE_OPTIONS.map((opt) => (
                <FilterPill
                  key={opt.value}
                  active={mediaType === opt.value}
                  onClick={() => setMediaType(opt.value)}
                  disabled={mode === "generate"}
                >
                  {opt.label}
                </FilterPill>
              ))}
            </div>
          </div>

          {/* 来源方式 */}
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-sm text-slate-500">来源方式</span>
            <div className="flex gap-1.5">
              <FilterPill active={mode === "upload"} onClick={() => changeMode("upload")}>
                上传本地文件
              </FilterPill>
              <FilterPill active={mode === "url"} onClick={() => changeMode("url")}>
                粘贴 URL
              </FilterPill>
              <FilterPill active={mode === "generate"} onClick={() => changeMode("generate")}>
                AI 生成
              </FilterPill>
            </div>
          </div>

          {/* 文件 / URL / 生成 */}
          {mode === "upload" ? (
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-sm text-slate-500">文件</span>
              <div className="flex flex-1 items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={accept}
                  disabled={!cosReady}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!cosReady}
                  className="rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-40"
                >
                  选择文件
                </button>
                {file ? (
                  <span className="truncate text-sm text-slate-600">{file.name}</span>
                ) : (
                  <span className="text-sm text-slate-400">未选择文件</span>
                )}
                {!cosReady && (
                  <span className="text-xs text-amber-600">需先配置存储方式</span>
                )}
              </div>
            </div>
          ) : mode === "generate" ? (
            <div className="flex items-start gap-2">
              <span className="mt-1.5 w-16 shrink-0 text-sm text-slate-500">图片</span>
              <div className="flex-1 space-y-2">
                {!imageConfigured && (
                  <p className="text-xs text-amber-600">
                    未配置图片生成 API，请先前往「图片 API 设置」页配置
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={openGenerateDialog}
                    disabled={!imageConfigured || generating}
                    className="rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-40"
                  >
                    {generatedUrl ? "重新生成" : "生成图片"}
                  </button>
                  {generating && (
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Spinner size={14} /> 生成中…
                    </span>
                  )}
                </div>
                {generatedUrl && !generating && (
                  <img
                    src={generatedUrl}
                    alt="生成预览"
                    className="h-32 w-auto rounded-lg border border-slate-200 object-cover"
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-sm text-slate-500">URL</span>
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="建议粘贴 COS 持久 URL"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          )}

          {/* 名称 */}
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-sm text-slate-500">名称</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="资产名称"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>

          {/* 实体类型 */}
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-sm text-slate-500">类型</span>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as MediaAsset["entityType"])}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              {ADD_ENTITY_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* 所属企划 */}
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-sm text-slate-500">所属企划</span>
            <select
              value={seriesId}
              onChange={(e) => setSeriesId(e.target.value)}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              {seriesOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || (mode === "generate" && (generating || !generatedUrl))}
            className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
          >
            {submitting ? "添加中…" : "添加"}
          </button>
        </div>
      </div>
      </div>

      <ImageGenerationDialog
        open={genOpen}
        onClose={() => setGenOpen(false)}
        initialPrompt={genInitialPrompt}
        initialConfig={genImageConfig}
        images={genRefImages}
        onImagesChange={setGenRefImages}
        imageOptions={imageOptions}
        loading={generating}
        onConfirm={handleGenerateConfirm}
      />
    </>
  );
}
