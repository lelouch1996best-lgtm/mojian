"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ImageLightbox from "./ImageLightbox";
import ImageActionToolbar from "./ImageActionToolbar";
import ImageUrlPastePanel from "./ImageUrlPastePanel";
import TaggedText from "./TaggedText";
import EditableCell from "./EditableCell";
import AiOptimizeButton from "./ui/AiOptimizeButton";
import Button from "./ui/Button";
import Spinner from "./ui/Spinner";
import type { Asset, ObjectProfile } from "@/lib/types";

interface ObjectAssetCardProps {
  asset: Asset;
  /** 与该物品同名的所有版本（已按 version 升序）；空数组表示未提取 */
  versions: ObjectProfile[];
  onUpdate: (field: keyof Asset, value: string) => void;
  onDelete?: () => void;
  isGenerating?: boolean;
  onGenerateImage?: () => void;
  /** 未提取时：本地上传图片回调（已有图也可重新上传） */
  onUploadImage?: (file: File) => void;
  /** 未提取时：是否正在上传图片 */
  isUploading?: boolean;
  /** 未提取时：重新生成外观回调 */
  onRegenerate?: () => void;
  /** 未提取时：是否正在重新生成外观 */
  isRegenerating?: boolean;
  /** 停止重新生成外观 */
  onCancelRegenerate?: () => void;
  onExtract?: () => void;
  seriesId?: string;
}

export default function ObjectAssetCard({
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
  onCancelRegenerate,
  onExtract,
  seriesId,
}: ObjectAssetCardProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlPasteOpen, setUrlPasteOpen] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const extracted = versions.length > 0;

  const [selectedId, setSelectedId] = useState<string>(() => {
    const byImage = versions.find((v) => v.imageUrl && v.imageUrl === asset.imageUrl);
    if (byImage) return byImage.id;
    // 首次添加资产时默认选最新（默认）版本：优先 isDefault，回退最高 version
    const defaultVersion = versions.find((v) => v.isDefault);
    return defaultVersion?.id ?? versions[versions.length - 1]?.id ?? "";
  });

  const selected = useMemo(
    () => versions.find((v) => v.id === selectedId)
      ?? versions.find((v) => v.isDefault)
      ?? versions[versions.length - 1]
      ?? null,
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

  useEffect(() => {
    if (versions.length === 0) return;
    if (selectedId && versions.some((v) => v.id === selectedId)) return;
    const byImage = versions.find((v) => v.imageUrl && v.imageUrl === asset.imageUrl);
    if (byImage) { setSelectedId(byImage.id); return; }
    const defaultVersion = versions.find((v) => v.isDefault);
    setSelectedId(defaultVersion?.id ?? versions[versions.length - 1]?.id ?? "");
  }, [versions, selectedId, asset.imageUrl]);

  function handleSelectVersion(id: string) {
    setSelectedId(id);
    const v = versions.find((o) => o.id === id);
    if (!v) return;
    onUpdate("imageUrl", v.imageUrl ?? "");
    onUpdate("description", v.appearance.trim());
    onUpdate("status", v.imageUrl ? "ready" : "pending");
  }

  function handleGotoSettings() {
    if (seriesId) router.push(`/series/${seriesId}/objects`);
  }

  if (extracted && !selected) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-slate-200 bg-white text-xs text-slate-400">
        未匹配到物品设定
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
                <path d="M3 7l9-4 9 4-9 4-9-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M3 7v10l9 4 9-4V7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M12 11v10" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
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
          !urlPasteOpen && (
            <div className="flex items-center gap-6 text-slate-300">
              {onGenerateImage && (
                <button
                  onClick={onGenerateImage}
                  className="flex flex-col items-center gap-1 transition-colors hover:text-brand-500"
                >
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                    <path d="M3 7l9-4 9 4-9 4-9-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M3 7v10l9 4 9-4V7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M12 11v10" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
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
              <button
                onClick={() => setUrlPasteOpen(true)}
                className="flex flex-col items-center gap-1 transition-colors hover:text-brand-500"
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-xs">粘贴URL</span>
              </button>
            </div>
          )
        )}
        {isGenerating && asset.imageUrl && !extracted && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-black/40 backdrop-blur-sm">
            <Spinner size={24} />
            <span className="text-xs text-white">重新生成中…</span>
          </div>
        )}
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
        {!extracted && asset.imageUrl && !isGenerating && !isUploading && !urlPasteOpen && (
          <ImageActionToolbar
            onRegenerate={onGenerateImage}
            isRegenerating={isGenerating}
            onUpload={onUploadImage ? () => fileInputRef.current?.click() : undefined}
            isUploading={isUploading}
            onPasteUrl={() => setUrlPasteOpen(true)}
          />
        )}
        {urlPasteOpen && !extracted && (
          <ImageUrlPastePanel
            onConfirm={(url) => { onUpdate("imageUrl", url); onUpdate("status", "ready"); setUrlPasteOpen(false); }}
            onCancel={() => setUrlPasteOpen(false)}
          />
        )}
      </div>

      {/* 内容区 */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <TaggedText text={`@${asset.name}`} className="text-sm font-semibold text-slate-800" />
          <span className="rounded bg-[#FDF0E3] px-1.5 py-0.5 text-xs text-[#92400E]">物品</span>
        </div>

        {extracted ? (
          <>
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-black">🔄 物品版本</label>
              <select
                value={selectedId}
                onChange={(e) => handleSelectVersion(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.versionLabel || `v${v.version ?? 1}`}
                    {v.isDefault ? " · 默认" : ""}
                    {v.imageUrl ? " · 有图" : ""}
                  </option>
                ))}
              </select>
            </div>

            {selected!.appearance.trim() && (
              <div>
                <label className="mb-0.5 block text-xs font-semibold text-black">🎨 外观</label>
                <p className="whitespace-pre-wrap rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                  {selected!.appearance.trim()}
                </p>
              </div>
            )}

            <div className="mt-auto flex items-center gap-2 pt-1">
              {seriesId && (
                <Button size="sm" variant="ghost" onClick={handleGotoSettings}>
                  前往物品设定 →
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
                <span>🎨 外观</span>
                <div className="flex items-center gap-1">
                  {onRegenerate && (
                    isRegenerating ? (
                      <Button size="sm" variant="ghost" onClick={onCancelRegenerate} title="点击停止">
                        <Spinner size={11} /> 停止
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={onRegenerate}>
                        重新生成外观
                      </Button>
                    )
                  )}
                  <AiOptimizeButton
                    text={asset.description}
                    onOptimized={(v) => onUpdate("description", v)}
                    disabled={isRegenerating}
                    onRunningChange={setOptimizing}
                  />
                </div>
              </div>
              <EditableCell
                value={asset.description}
                onChange={(v) => onUpdate("description", v)}
                placeholder="描述物品外观特征…"
                multiline
                minWidth="100%"
                disabled={isRegenerating || optimizing}
              />
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
              {onExtract && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onExtract}
                  disabled={isGenerating || isUploading}
                  title="提取到物品设定，可关联多版本图片"
                >
                  提取到物品设定
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
