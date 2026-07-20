"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ImageLightbox from "@/components/ImageLightbox";
import Spinner from "@/components/ui/Spinner";
import { apiClient } from "@/lib/api-client";
import { ASSET_TYPE_LABELS, formatTime } from "@/lib/utils";
import type { AssetLibraryItem } from "@/lib/types";

type MediaTypeFilter = "all" | "image" | "video" | "audio";
type EntityTypeFilter = "all" | "character" | "scene" | "object" | "screenshot" | "storyboard";

const MEDIA_TYPE_OPTIONS: { value: MediaTypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音色" },
];

const ENTITY_TYPE_OPTIONS: { value: EntityTypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "character", label: "人物" },
  { value: "object", label: "物品" },
  { value: "scene", label: "场景" },
  { value: "screenshot", label: "截屏" },
  { value: "storyboard", label: "故事板" },
];

function entityTypeLabel(t: AssetLibraryItem["entityType"]): string {
  if (t === "shot") return "镜头";
  return ASSET_TYPE_LABELS[t] ?? t;
}

function sourceLabel(item: AssetLibraryItem): string {
  if (item.source === "asset" || item.source === "shot") {
    return item.episodeTitle || "未命名剧集";
  }
  return "企划设定";
}

function mediaEmptyText(mediaType: MediaTypeFilter): string {
  if (mediaType === "image") return "暂无图片资产";
  if (mediaType === "video") return "暂无视频资产";
  if (mediaType === "audio") return "暂无音色资产";
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
  const [items, setItems] = useState<AssetLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [seriesId, setSeriesId] = useState("");
  const [mediaType, setMediaType] = useState<MediaTypeFilter>("all");
  const [entityType, setEntityType] = useState<EntityTypeFilter>("all");
  const [videoPreview, setVideoPreview] = useState<AssetLibraryItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<null | { ids: string[]; names: string[] }>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiClient.listAssetLibrary();
      setItems(list);
    } catch {
      setItems([]);
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
    for (const item of items) {
      if (!map.has(item.seriesId)) {
        map.set(item.seriesId, item.seriesTitle || "未命名企划");
      }
    }
    return Array.from(map, ([id, title]) => ({ id, title }));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (seriesId && item.seriesId !== seriesId) return false;
      if (mediaType === "image" && item.mediaType !== "image") return false;
      if (mediaType === "video" && item.mediaType !== "video") return false;
      if (mediaType === "audio" && item.mediaType !== "audio") return false;
      if (entityType !== "all" && item.entityType !== entityType) return false;
      return true;
    });
  }, [items, seriesId, mediaType, entityType]);

  // 媒体类型为"视频"时，实体类型筛选无意义（视频 entityType 恒为 shot），禁用
  const entityTypeDisabled = mediaType === "video";

  async function handleCopy(item: AssetLibraryItem) {
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
      await apiClient.deleteAssetLibraryItems(ids);
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

  function requestDeleteSingle(item: AssetLibraryItem) {
    setConfirmDelete({ ids: [item.id], names: [item.entityName] });
  }

  function requestDeleteSelected() {
    const ids = filtered.filter((i) => selected.has(i.id)).map((i) => i.id);
    const names = filtered.filter((i) => selected.has(i.id)).map((i) => i.entityName);
    if (ids.length === 0) return;
    setConfirmDelete({ ids, names });
  }

  return (
    <div>
      {/* 过滤栏 */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
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

        <div className="flex items-center gap-1.5">
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

        <div className="ml-auto flex items-center gap-2 text-sm text-slate-400">
          <button
            onClick={() => { setSelectMode(!selectMode); clearSelection(); }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              selectMode ? "bg-brand-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {selectMode ? "退出多选" : "多选"}
          </button>
          {selectMode && (
            <>
              <span>已选 {selected.size} 项</span>
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
          {!selectMode && <span>共 {filtered.length} 项</span>}
        </div>
      </div>

      {/* 内容区 */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
          <Spinner size={18} />
          <span>加载中…</span>
        </div>
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
                  `${item.entityName}.${item.mediaType === "video" ? "mp4" : item.mediaType === "audio" ? "mp3" : "png"}`
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
              将删除 {confirmDelete.ids.length} 个资产，本地存储模式下会同时删除本地文件。此操作不可撤销。
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
  item: AssetLibraryItem;
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
      ) : isAudio ? (
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
          {isVideo ? "视频" : isAudio ? "音色" : "图片"}
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
      ) : isAudio ? (
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
