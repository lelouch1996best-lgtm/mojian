"use client";

import { useRef, useState, type ReactNode } from "react";
import Spinner from "./ui/Spinner";
import ImageLightbox from "./ImageLightbox";
import ImageActionToolbar from "./ImageActionToolbar";
import ImageUrlPastePanel from "./ImageUrlPastePanel";

interface AssetImageZoneProps {
  imageUrl?: string;
  name: string;
  isGenerating: boolean;
  isUploading: boolean;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onPasteUrl: (url: string) => void;
  /** 图片区高度，卡片用 h-28，弹框可用 h-40 等 */
  height?: string;
  /** 叠加在图片区上的额外内容（如版本 badge、删除按钮） */
  children?: ReactNode;
}

/** 人物/物品/场景通用的形象图区域：展示、生成、上传、粘贴 URL、操作工具栏 */
export default function AssetImageZone({
  imageUrl,
  name,
  isGenerating,
  isUploading,
  onGenerate,
  onUpload,
  onPasteUrl,
  height = "h-28",
  children,
}: AssetImageZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlPasteOpen, setUrlPasteOpen] = useState(false);

  return (
    <div className={`group relative flex ${height} items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100`}>
      {imageUrl ? (
        <ImageLightbox src={imageUrl} alt={name} className="h-full w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
        </ImageLightbox>
      ) : isGenerating ? (
        <div className="flex flex-col items-center gap-1 text-slate-400">
          <Spinner size={24} />
          <span className="text-xs">生成中…</span>
        </div>
      ) : isUploading ? (
        <div className="flex flex-col items-center gap-1 text-slate-400">
          <Spinner size={24} />
          <span className="text-xs">上传中…</span>
        </div>
      ) : (
        !urlPasteOpen && (
          <div className="flex items-center gap-4 text-slate-300">
            <button onClick={onGenerate}
              className="flex flex-col items-center gap-1 transition-colors hover:text-brand-500">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 7V5a1 1 0 011-1h6a1 1 0 011 1v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="text-xs">生成图片</span>
            </button>
            <button onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center gap-1 transition-colors hover:text-brand-500">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path d="M12 16V4m0 0L8 8m4-4l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="text-xs">上传图片</span>
            </button>
            <button onClick={() => setUrlPasteOpen(true)}
              className="flex flex-col items-center gap-1 transition-colors hover:text-brand-500">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-xs">粘贴URL</span>
            </button>
          </div>
        )
      )}
      {/* 重新生成中遮罩（已有图片时覆盖在图片上） */}
      {isGenerating && imageUrl && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-black/40 backdrop-blur-sm">
          <Spinner size={24} />
          <span className="text-xs text-white">重新生成中…</span>
        </div>
      )}
      {/* 上传中遮罩（已有图片时覆盖在图片上） */}
      {isUploading && imageUrl && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-black/40 backdrop-blur-sm">
          <Spinner size={24} />
          <span className="text-xs text-white">上传中…</span>
        </div>
      )}
      <input ref={fileInputRef} type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = "";
        }} />
      {imageUrl && !isGenerating && !isUploading && !urlPasteOpen && (
        <ImageActionToolbar
          onRegenerate={onGenerate}
          onUpload={() => fileInputRef.current?.click()}
          onPasteUrl={() => setUrlPasteOpen(true)}
        />
      )}
      {urlPasteOpen && (
        <ImageUrlPastePanel
          onConfirm={(url) => { onPasteUrl(url); setUrlPasteOpen(false); }}
          onCancel={() => setUrlPasteOpen(false)}
        />
      )}
      {children}
    </div>
  );
}
