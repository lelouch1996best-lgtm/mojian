"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import ImageLightbox from "@/components/ImageLightbox";
import { apiClient } from "@/lib/api-client";
import { ASSET_TYPE_LABELS } from "@/lib/utils";
import type { MediaAsset } from "@/lib/types";

/** 资产库选中项（含 URL 与名称，用于 @ 提及保留原始资产名） */
export interface PickedAssetItem {
  url: string;
  name: string;
}

interface AssetPickerProps {
  open: boolean;
  onClose: () => void;
  /** 可选媒体类型约束 */
  mediaType: "image" | "video" | "audio";
  /** 多选模式（参考图/参考视频）；false 为单选（首尾帧） */
  multiple?: boolean;
  /** 已选 URL 列表，用于去重与回显 */
  selectedUrls: string[];
  /** 确认回调，返回本次新选中的资产项（不含已选） */
  onConfirm: (items: PickedAssetItem[]) => void;
  /** 最大数量上限（含已选） */
  max?: number;
}

type EntityTypeFilter = "all" | "character" | "scene" | "object" | "screenshot" | "storyboard";

const ENTITY_TYPE_OPTIONS: { value: EntityTypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "character", label: "人物" },
  { value: "object", label: "物品" },
  { value: "scene", label: "场景" },
  { value: "screenshot", label: "截屏" },
  { value: "storyboard", label: "故事板" },
];

function entityTypeLabel(t: MediaAsset["entityType"]): string {
  if (t === "shot") return "镜头";
  if (t === "other") return "其他";
  return ASSET_TYPE_LABELS[t] ?? t;
}

export default function AssetPicker({
  open,
  onClose,
  mediaType,
  multiple = false,
  selectedUrls,
  onConfirm,
  max,
}: AssetPickerProps) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [seriesId, setSeriesId] = useState("");
  const [entityType, setEntityType] = useState<EntityTypeFilter>("all");
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [videoPreview, setVideoPreview] = useState<MediaAsset | null>(null);

  // ===== 弹窗 Portal / 拖拽 / 缩放 =====
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 896, height: 720 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const w = Math.min(896, window.innerWidth - 32);
    const h = Math.min(720, window.innerHeight - 32);
    setSize({ width: w, height: h });
    setPos({
      x: Math.max(16, Math.round((window.innerWidth - w) / 2)),
      y: Math.max(16, Math.round((window.innerHeight - h) / 2)),
    });
  }, [open]);

  // ESC 关闭（视频预览打开时优先关闭预览）+ 锁定 body 滚动
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !videoPreview) onClose();
    };
    document.addEventListener("keydown", onKey);
    if (!videoPreview) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      if (!videoPreview) document.body.style.overflow = "";
    };
  }, [open, onClose, videoPreview]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button, input, textarea, select")) return;
      e.preventDefault();
      dragState.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
      const onMove = (ev: MouseEvent) => {
        const st = dragState.current;
        if (!st) return;
        const dx = ev.clientX - st.startX;
        const dy = ev.clientY - st.startY;
        const minX = -size.width + 120;
        const maxX = window.innerWidth - 120;
        const minY = 0;
        const maxY = window.innerHeight - 48;
        setPos({
          x: Math.min(Math.max(minX, st.origX + dx), maxX),
          y: Math.min(Math.max(minY, st.origY + dy), maxY),
        });
      };
      const onUp = () => {
        dragState.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.userSelect = "none";
    },
    [pos.x, pos.y, size.width]
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeState.current = { startX: e.clientX, startY: e.clientY, origW: size.width, origH: size.height };
      const onMove = (ev: MouseEvent) => {
        const st = resizeState.current;
        if (!st) return;
        const dx = ev.clientX - st.startX;
        const dy = ev.clientY - st.startY;
        const newW = Math.min(Math.max(480, st.origW + dx), window.innerWidth - 16);
        const newH = Math.min(Math.max(360, st.origH + dy), window.innerHeight - 16);
        setSize({ width: newW, height: newH });
      };
      const onUp = () => {
        resizeState.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.userSelect = "none";
    },
    [size.width, size.height]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiClient.listMediaAssets();
      setItems(list.filter((it) => it.mediaType === mediaType));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [mediaType]);

  useEffect(() => {
    if (open) {
      setPickedIds([]);
      loadData();
    }
  }, [open, loadData]);

  // 视频预览：ESC 关闭 + 禁止滚动（捕获阶段拦截，避免同时关闭外层 Modal）
  useEffect(() => {
    if (!videoPreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setVideoPreview(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
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
      if (entityType !== "all" && item.entityType !== entityType) return false;
      return true;
    });
  }, [items, seriesId, entityType]);

  const allSelectedUrls = useMemo(() => new Set(selectedUrls), [selectedUrls]);
  const pickedIdSet = useMemo(() => new Set(pickedIds), [pickedIds]);
  const itemMap = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  const effectiveMax = max ?? (multiple ? 99 : 1);
  const totalSelected = selectedUrls.length + pickedIds.length;
  const remaining = Math.max(0, effectiveMax - totalSelected);

  function togglePick(item: MediaAsset) {
    if (pickedIdSet.has(item.id)) {
      setPickedIds(pickedIds.filter((id) => id !== item.id));
      return;
    }
    if (allSelectedUrls.has(item.url)) return;
    if (!multiple) {
      setPickedIds([item.id]);
      return;
    }
    if (remaining <= 0) return;
    setPickedIds([...pickedIds, item.id]);
  }

  function handleConfirm() {
    if (pickedIds.length === 0) {
      onClose();
      return;
    }
    const pickedItems: PickedAssetItem[] = pickedIds
      .map((id) => {
        const it = itemMap.get(id);
        return it ? { url: it.url, name: it.entityName } : null;
      })
      .filter((x): x is PickedAssetItem => !!x);
    onConfirm(pickedItems);
    setPickedIds([]);
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        style={{
          position: "absolute",
          left: pos.x,
          top: pos.y,
          width: size.width,
          height: size.height,
        }}
        className="flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div
          onMouseDown={handleDragStart}
          className="flex cursor-move items-center justify-between border-b border-slate-200 px-5 py-3.5"
        >
          <h3 className="select-none text-base font-semibold text-slate-800">
            {`从资产库选择${mediaType === "image" ? "图片" : mediaType === "audio" ? "音色" : "视频"}`}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="关闭"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
      {/* 过滤栏 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
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

        {mediaType === "image" && (
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-sm font-medium text-slate-500">类型</span>
            {ENTITY_TYPE_OPTIONS.map((opt) => (
              <FilterPill
                key={opt.value}
                active={entityType === opt.value}
                onClick={() => setEntityType(opt.value)}
              >
                {opt.label}
              </FilterPill>
            ))}
          </div>
        )}

        {multiple && max && (
          <span className="ml-auto text-xs text-slate-400">
            可再选 {remaining} 项（上限 {max}）
          </span>
        )}
      </div>

      {/* 内容区 */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
          <Spinner size={18} />
          <span>加载中…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="py-20 text-center text-slate-400">
          {mediaType === "audio" ? "暂无音色资产" : `暂无生成的${mediaType === "image" ? "图片" : "视频"}`}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-slate-400">没有匹配的资产</div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {filtered.map((item) => {
            const isPicked = pickedIdSet.has(item.id);
            const isAlready = allSelectedUrls.has(item.url);
            const disabled = isAlready || (!isPicked && remaining <= 0);
            return (
              <AssetPickCard
                key={item.id}
                item={item}
                picked={isPicked}
                alreadySelected={isAlready}
                disabled={disabled}
                onToggle={() => togglePick(item)}
                onPreviewVideo={() => setVideoPreview(item)}
              />
            );
          })}
        </div>
      )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <span className="mr-auto text-sm text-slate-500">
            {multiple ? `已选 ${pickedIds.length} 项` : pickedIds.length > 0 ? "已选 1 项" : "未选择"}
          </span>
          <Button variant="ghost" size="md" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={pickedIds.length === 0}
            onClick={handleConfirm}
          >
            确认{pickedIds.length > 0 ? `（${pickedIds.length}）` : ""}
          </Button>
        </div>
        {/* 右下角缩放手柄 */}
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 flex h-4 w-4 cursor-nwse-resize items-end justify-end text-slate-300 hover:text-slate-500"
          title="拖动缩放"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* 视频预览模态 */}
      {videoPreview && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setVideoPreview(null)}
        >
          <button
            onClick={() => setVideoPreview(null)}
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
            aria-label="关闭"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
    </div>,
    document.body
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-brand-600 text-warm-50"
          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function AssetPickCard({
  item,
  picked,
  alreadySelected,
  disabled,
  onToggle,
  onPreviewVideo,
}: {
  item: MediaAsset;
  picked: boolean;
  alreadySelected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onPreviewVideo: () => void;
}) {
  const isVideo = item.mediaType === "video";
  const isAudio = item.mediaType === "audio";

  const previewIcon = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M21 21l-4.35-4.35M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <div
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-white shadow-sm transition-all ${
        picked
          ? "border-brand-500 ring-2 ring-brand-500/30"
          : alreadySelected
            ? "border-slate-200 opacity-50"
            : disabled
              ? "border-slate-200 opacity-50"
              : "border-slate-200 hover:border-brand-300 hover:shadow-md"
      }`}
      onClick={disabled ? undefined : onToggle}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-slate-100">
        {isVideo ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <video muted preload="metadata" src={item.url} className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </>
        ) : isAudio ? (
          <div
            className="flex h-full w-full items-center justify-center bg-slate-50 p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <audio controls src={item.url} className="w-full" />
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={item.entityName} className="h-full w-full object-cover" />
        )}

        {/* 选中勾选角标 */}
        {(picked || alreadySelected) && (
          <div className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white shadow">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}

        {/* 已选标记 */}
        {alreadySelected && (
          <span className="absolute bottom-1 left-1 rounded bg-slate-700/80 px-1.5 py-0.5 text-[10px] text-white">
            已选
          </span>
        )}

        {/* 悬停预览按钮（左上角，点击仅预览不触发选中） */}
        <div
          className="absolute left-1 top-1 z-20 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {isVideo ? (
            <button
              type="button"
              onClick={onPreviewVideo}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
              title="预览"
              aria-label="预览"
            >
              {previewIcon}
            </button>
          ) : isAudio ? null : (
            <ImageLightbox src={item.url} alt={item.entityName}>
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
                title="预览"
                aria-label="预览"
              >
                {previewIcon}
              </button>
            </ImageLightbox>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-0.5 p-2">
        <div className="flex items-center gap-1">
          <span className="line-clamp-1 flex-1 text-xs font-medium text-slate-700">
            {item.entityName}
          </span>
          <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-500">
            {entityTypeLabel(item.entityType)}
          </span>
        </div>
        <span className="line-clamp-1 text-[10px] text-slate-400">
          {item.seriesTitle || "未命名企划"}
        </span>
      </div>
    </div>
  );
}
