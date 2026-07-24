"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ImageLightbox from "./ImageLightbox";
import ImageActionToolbar from "./ImageActionToolbar";
import TaggedText from "./TaggedText";
import EditableCell from "./EditableCell";
import AiOptimizeButton from "./ui/AiOptimizeButton";
import Button from "./ui/Button";
import Spinner from "./ui/Spinner";
import type { Asset, CharacterProfile } from "@/lib/types";

interface CharacterAssetCardProps {
  asset: Asset;
  /** 与该人物同名的所有版本（已按 version 升序）；空数组表示未提取 */
  versions: CharacterProfile[];
  onUpdate: (field: keyof Asset, value: string) => void;
  onDelete?: () => void;
  /** 未提取时：是否正在生成图片 */
  isGenerating?: boolean;
  /** 未提取时：生成图片回调 */
  onGenerateImage?: () => void;
  /** 未提取时：本地上传图片回调（已有图也可重新上传） */
  onUploadImage?: (file: File) => void;
  /** 未提取时：是否正在上传图片 */
  isUploading?: boolean;
  /** 未提取时：重新生成外貌回调 */
  onRegenerate?: () => void;
  /** 未提取时：是否正在重新生成外貌 */
  isRegenerating?: boolean;
  /** 未提取时：提取到人物设定回调 */
  onExtract?: () => void;
  /** 系列ID，用于跳转到设定页面 */
  seriesId?: string;
}

export default function CharacterAssetCard({
  asset,
  versions,
  onUpdate,
  onDelete,
  isGenerating = false,
  onGenerateImage,
  onUploadImage,
  isUploading = false,
  onRegenerate,
  isRegenerating = false,
  onExtract,
  seriesId,
}: CharacterAssetCardProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extracted = versions.length > 0;

  const [selectedId, setSelectedId] = useState<string>(() => {
    const byImage = versions.find((v) => v.imageUrl && v.imageUrl === asset.imageUrl);
    return byImage?.id ?? versions[versions.length - 1]?.id ?? "";
  });

  const selected = useMemo(
    () => versions.find((v) => v.id === selectedId) ?? versions[versions.length - 1] ?? null,
    [versions, selectedId]
  );

  useEffect(() => {
    if (!extracted || !selected) return;
    if (selected.imageUrl !== asset.imageUrl) {
      onUpdate("imageUrl", selected.imageUrl ?? "");
      onUpdate("description", selected.appearance.trim());
      onUpdate("status", selected.imageUrl ? "ready" : "pending");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extracted, selected, asset.imageUrl]);

  function handleSelectVersion(id: string) {
    setSelectedId(id);
    const v = versions.find((c) => c.id === id);
    if (!v) return;
    onUpdate("imageUrl", v.imageUrl ?? "");
    onUpdate("description", v.appearance.trim());
    onUpdate("status", v.imageUrl ? "ready" : "pending");
  }

  function handleGotoSettings() {
    if (seriesId) router.push(`/series/${seriesId}/characters`);
  }

  if (extracted && !selected) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-slate-200 bg-white text-xs text-slate-400">
        未匹配到人物设定
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* 图片区 */}
      <div className="group relative flex aspect-[4/3] items-center justify-center bg-slate-50">
        {extracted ? (
          selected!.imageUrl ? (
            <ImageLightbox src={selected!.imageUrl} alt={asset.name} className="h-full w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selected!.imageUrl} alt={asset.name} className="h-full w-full object-cover" />
            </ImageLightbox>
          ) : (
            <div className="flex flex-col items-center gap-1 text-slate-300">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="text-xs">该版本暂无图片</span>
            </div>
          )
        ) : asset.imageUrl ? (
          <ImageLightbox src={asset.imageUrl} alt={asset.name} className="h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset.imageUrl} alt={asset.name} className="h-full w-full object-cover" />
          </ImageLightbox>
        ) : isGenerating ? (
          <div className="flex flex-col items-center gap-1 text-slate-400">
            <Spinner size={28} />
            <span className="text-xs">生成中…</span>
          </div>
        ) : isUploading ? (
          <div className="flex flex-col items-center gap-1 text-slate-400">
            <Spinner size={28} />
            <span className="text-xs">上传中…</span>
          </div>
        ) : (
          <div className="flex items-center gap-6 text-slate-300">
            {onGenerateImage && (
              <button
                onClick={onGenerateImage}
                className="flex flex-col items-center gap-1 transition-colors hover:text-brand-500"
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="text-xs">生成图片</span>
              </button>
            )}
            {onUploadImage && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-1 transition-colors hover:text-brand-500"
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                  <path d="M12 16V4m0 0L8 8m4-4l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="text-xs">上传图片</span>
              </button>
            )}
          </div>
        )}
        {/* 重新生成中遮罩（已有图片时） */}
        {isGenerating && asset.imageUrl && !extracted && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-black/40 backdrop-blur-sm">
            <Spinner size={24} />
            <span className="text-xs text-white">重新生成中…</span>
          </div>
        )}
        {/* 上传中遮罩（已有图片时） */}
        {isUploading && asset.imageUrl && !extracted && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-black/40 backdrop-blur-sm">
            <Spinner size={24} />
            <span className="text-xs text-white">上传中…</span>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUploadImage?.(file);
            e.target.value = "";
          }}
        />
        {extracted && selected && (
          <span className="absolute left-2 top-2 rounded bg-black/30 px-1.5 py-0.5 text-xs text-white backdrop-blur">
            {selected.versionLabel || `v${selected.version ?? 1}`}
          </span>
        )}
        {versions.some((v) => !!v.voiceUrl) && (
          <span
            className="absolute left-2 top-9 flex items-center gap-1 rounded-full bg-brand-500/90 px-2 py-0.5 text-[10px] font-medium text-white shadow backdrop-blur"
            title="已关联音色，视频生成时将作为参考音频传入"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            已关联音色
          </span>
        )}
        {/* 无图或已提取时右上角删除按钮 */}
        {onDelete && (!asset.imageUrl || extracted) && (
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
        {/* 有图时悬浮操作栏 */}
        {!extracted && asset.imageUrl && !isGenerating && !isUploading && (
          <ImageActionToolbar
            onRegenerate={onGenerateImage}
            isRegenerating={isGenerating}
            onUpload={onUploadImage ? () => fileInputRef.current?.click() : undefined}
            isUploading={isUploading}
            onDelete={onDelete}
          />
        )}
      </div>

      {/* 内容区 */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <TaggedText text={`@${asset.name}`} className="text-sm font-semibold text-slate-800" />
          <span className="rounded bg-[#FDF0E3] px-1.5 py-0.5 text-xs text-[#92400E]">人物</span>
        </div>

        {extracted ? (
          <>
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-black">🔄 人物版本</label>
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

            {selected!.appearance.trim() && (
              <div>
                <label className="mb-0.5 block text-xs font-semibold text-black">👤 外貌</label>
                <p className="whitespace-pre-wrap rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                  {selected!.appearance.trim()}
                </p>
              </div>
            )}

            <div className="mt-auto flex items-center gap-2 pt-1">
              {seriesId && (
                <Button size="sm" variant="ghost" onClick={handleGotoSettings}>
                  前往人物设定 →
                </Button>
              )}
              {selected!.imageUrl ? (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">✅ 有图</span>
              ) : (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">⚠️ 无图，请到设定补图</span>
              )}
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="mb-0.5 flex items-center justify-between text-xs font-semibold text-black">
                <span>👤 外貌</span>
                <div className="flex items-center gap-1">
                  {onRegenerate && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onRegenerate}
                      loading={isRegenerating}
                      disabled={isRegenerating}
                    >
                      重新生成外貌
                    </Button>
                  )}
                  <AiOptimizeButton
                    text={asset.description}
                    onOptimized={(v) => onUpdate("description", v)}
                    disabled={isRegenerating}
                  />
                </div>
              </div>
              <EditableCell
                value={asset.description}
                onChange={(v) => onUpdate("description", v)}
                placeholder="描述人物外貌特征…"
                multiline
                minWidth="100%"
              />
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
              {onExtract && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onExtract}
                  disabled={isGenerating || isUploading}
                  title="提取到人物设定，可关联多版本图片"
                >
                  提取到人物设定
                </Button>
              )}
              {asset.status === "failed" && (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-600">❌ 生成失败</span>
              )}
              {asset.status === "ready" && asset.imageUrl && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">✅ 图片就绪</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
