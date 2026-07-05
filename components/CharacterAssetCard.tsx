"use client";

import { useMemo, useState } from "react";
import ImageLightbox from "./ImageLightbox";
import TaggedText from "./TaggedText";
import type { Asset, CharacterProfile } from "@/lib/types";

interface CharacterAssetCardProps {
  asset: Asset;
  /** 与该人物同名的所有版本（已按 version 升序） */
  versions: CharacterProfile[];
  onUpdate: (field: keyof Asset, value: string) => void;
  /** 删除该资产 */
  onDelete?: () => void;
}

/**
 * 人物资产卡片 —— 关联人物设定，选择版本后直接复用人物图片与描述，无需重新生成。
 * 仅用于 type==="character" 且能匹配到人物设定版本的资产。
 */
export default function CharacterAssetCard({
  asset,
  versions,
  onUpdate,
  onDelete,
}: CharacterAssetCardProps) {
  // 当前选中版本：优先按 imageUrl 反查（刷新后可恢复选中态），否则取最新版本（数组末尾）
  const [selectedId, setSelectedId] = useState<string>(() => {
    const byImage = versions.find((v) => v.imageUrl && v.imageUrl === asset.imageUrl);
    return byImage?.id ?? versions[versions.length - 1]?.id ?? "";
  });

  const selected = useMemo(
    () => versions.find((v) => v.id === selectedId) ?? versions[versions.length - 1] ?? null,
    [versions, selectedId]
  );

  function handleSelectVersion(id: string) {
    setSelectedId(id);
    const v = versions.find((c) => c.id === id);
    if (!v) return;
    // 同步该版本信息到 asset，供下游分镜生成使用
    onUpdate("imageUrl", v.imageUrl ?? "");
    const descParts: string[] = [];
    if (v.personality.trim()) descParts.push(`性格：${v.personality.trim()}`);
    if (v.appearance.trim()) descParts.push(`外貌：${v.appearance.trim()}`);
    onUpdate("description", descParts.join("；"));
    onUpdate("imagePrompt", v.appearance.trim());
    onUpdate("status", v.imageUrl ? "ready" : "pending");
  }

  if (!selected) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-slate-200 bg-white text-xs text-slate-400">
        未匹配到人物设定
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* 图片区 */}
      <div className="relative flex aspect-[4/3] items-center justify-center bg-slate-50">
        {selected.imageUrl ? (
          <ImageLightbox src={selected.imageUrl} alt={asset.name} className="h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selected.imageUrl} alt={asset.name} className="h-full w-full object-cover" />
          </ImageLightbox>
        ) : (
          <div className="flex flex-col items-center gap-1 text-slate-300">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
              <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="text-xs">该版本暂无图片</span>
          </div>
        )}
        {/* 版本 badge */}
        <span className="absolute left-2 top-2 rounded bg-black/30 px-1.5 py-0.5 text-xs text-white backdrop-blur">
          {selected.versionLabel || `v${selected.version ?? 1}`}
        </span>
        {/* 删除按钮 */}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur transition-colors hover:bg-red-500"
            title="删除该资产"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* 内容区 */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <TaggedText text={`@${asset.name}`} className="text-sm font-semibold text-slate-800" />
          <span className="rounded bg-[#FDF0E3] px-1.5 py-0.5 text-xs text-[#92400E]">人物</span>
        </div>

        {/* 版本选择器 */}
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">人物版本</label>
          <select
            value={selectedId}
            onChange={(e) => handleSelectVersion(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.versionLabel || `v${v.version ?? 1}`}
                {v.imageUrl ? " · 有图" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* 描述（只读，来自人物设定） */}
        {selected.personality.trim() && (
          <div>
            <label className="mb-0.5 block text-xs text-slate-400">性格</label>
            <p className="whitespace-pre-wrap rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
              {selected.personality.trim()}
            </p>
          </div>
        )}
        {selected.appearance.trim() && (
          <div>
            <label className="mb-0.5 block text-xs text-slate-400">外貌</label>
            <p className="whitespace-pre-wrap rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
              {selected.appearance.trim()}
            </p>
          </div>
        )}

        <div className="mt-auto flex items-center gap-2 pt-1">
          <span className="text-xs text-slate-400">已关联人物设定</span>
          {selected.imageUrl ? (
            <span className="text-xs text-emerald-700">✓ 有图</span>
          ) : (
            <span className="text-xs text-amber-600">无图，请到人物设定补图</span>
          )}
        </div>
      </div>
    </div>
  );
}
