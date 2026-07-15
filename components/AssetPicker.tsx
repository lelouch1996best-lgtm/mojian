"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import ImageLightbox from "@/components/ImageLightbox";
import { apiClient } from "@/lib/api-client";
import { ASSET_TYPE_LABELS } from "@/lib/utils";
import type { AssetLibraryItem } from "@/lib/types";

interface AssetPickerProps {
  open: boolean;
  onClose: () => void;
  /** 可选媒体类型约束 */
  mediaType: "image" | "video";
  /** 多选模式（参考图/参考视频）；false 为单选（首尾帧） */
  multiple?: boolean;
  /** 已选 URL 列表，用于去重与回显 */
  selectedUrls: string[];
  /** 确认回调，返回本次新选中的 URL 列表（不含已选） */
  onConfirm: (urls: string[]) => void;
  /** 最大数量上限（含已选） */
  max?: number;
}

type EntityTypeFilter = "all" | "character" | "scene" | "object";

const ENTITY_TYPE_OPTIONS: { value: EntityTypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "character", label: "人物" },
  { value: "object", label: "物品" },
  { value: "scene", label: "场景" },
];

function entityTypeLabel(t: AssetLibraryItem["entityType"]): string {
  if (t === "shot") return "镜头";
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
  const [items, setItems] = useState<AssetLibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [seriesId, setSeriesId] = useState("");
  const [entityType, setEntityType] = useState<EntityTypeFilter>("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [videoPreview, setVideoPreview] = useState<AssetLibraryItem | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiClient.listAssetLibrary();
      setItems(list.filter((it) => it.mediaType === mediaType));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [mediaType]);

  useEffect(() => {
    if (open) {
      setPicked([]);
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

  const allSelected = useMemo(() => new Set(selectedUrls), [selectedUrls]);
  const pickedSet = useMemo(() => new Set(picked), [picked]);

  const effectiveMax = max ?? (multiple ? 99 : 1);
  const totalSelected = selectedUrls.length + picked.length;
  const remaining = Math.max(0, effectiveMax - totalSelected);

  function togglePick(url: string) {
    if (pickedSet.has(url)) {
      setPicked(picked.filter((u) => u !== url));
      return;
    }
    if (allSelected.has(url)) return;
    if (!multiple) {
      setPicked([url]);
      return;
    }
    if (remaining <= 0) return;
    setPicked([...picked, url]);
  }

  function handleConfirm() {
    if (picked.length === 0) {
      onClose();
      return;
    }
    onConfirm(picked);
    setPicked([]);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`从资产库选择${mediaType === "image" ? "图片" : "视频"}`}
      width="max-w-4xl"
      footer={
        <>
          <span className="mr-auto text-sm text-slate-500">
            {multiple ? `已选 ${picked.length} 项` : picked.length > 0 ? "已选 1 项" : "未选择"}
          </span>
          <Button variant="ghost" size="md" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={picked.length === 0}
            onClick={handleConfirm}
          >
            确认{picked.length > 0 ? `（${picked.length}）` : ""}
          </Button>
        </>
      }
    >
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
        <div className="py-20 text-center text-slate-400">暂无生成的{mediaType === "image" ? "图片" : "视频"}</div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-slate-400">没有匹配的资产</div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {filtered.map((item) => {
            const isPicked = pickedSet.has(item.url);
            const isAlready = allSelected.has(item.url);
            const disabled = isAlready || (!isPicked && remaining <= 0);
            return (
              <AssetPickCard
                key={item.id}
                item={item}
                picked={isPicked}
                alreadySelected={isAlready}
                disabled={disabled}
                onToggle={() => togglePick(item.url)}
                onPreviewVideo={() => setVideoPreview(item)}
              />
            );
          })}
        </div>
      )}

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
    </Modal>
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
  item: AssetLibraryItem;
  picked: boolean;
  alreadySelected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onPreviewVideo: () => void;
}) {
  const isVideo = item.mediaType === "video";

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
          ) : (
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
