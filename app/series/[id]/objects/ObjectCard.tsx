import { useRef } from "react";
import type { ObjectProfile } from "@/lib/types";
import Spinner from "@/components/ui/Spinner";
import ImageLightbox from "@/components/ImageLightbox";

/** 单个物品版本卡片 */
export function ObjectCard({
  object,
  isLatest,
  expanded,
  onToggle,
  onUpdate,
  onDelete,
  onGenerateImage,
  isGenerating,
  onUploadImage,
  isUploading,
}: {
  object: ObjectProfile;
  isLatest: boolean;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (field: keyof ObjectProfile, value: string) => void;
  onDelete: () => void;
  onGenerateImage: () => void;
  isGenerating: boolean;
  onUploadImage: (file: File) => void;
  isUploading: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md ${
      isLatest ? "border-brand-300" : "border-slate-200"
    }`}>
      {/* 图片区域 */}
      <div className="relative flex h-28 items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        {object.imageUrl ? (
          <ImageLightbox src={object.imageUrl} alt={object.name} className="h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={object.imageUrl} alt={object.name} className="h-full w-full object-cover" />
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
          <div className="flex items-center gap-4 text-slate-300">
            <button onClick={onGenerateImage}
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
          </div>
        )}
        <input ref={fileInputRef} type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUploadImage(file);
            e.target.value = "";
          }} />
        {/* 版本 badge */}
        <span className={`absolute left-2 top-2 rounded px-1.5 py-0.5 text-xs backdrop-blur ${
          isLatest ? "bg-brand-500/80 text-white" : "bg-black/20 text-white"
        }`}>
          {object.versionLabel || `v${object.version}`}
          {isLatest && " · 最新"}
        </span>
        {/* 重新生成按钮 */}
        {object.imageUrl && !isGenerating && (
          <button onClick={onGenerateImage}
            className="absolute bottom-2 right-2 rounded-md bg-white/80 p-1.5 text-slate-500 backdrop-blur transition-colors hover:text-brand-500"
            title="重新生成图片">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M21 12a9 9 0 11-3-6.7M21 4v4h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {/* 删除按钮 */}
        <button onClick={onDelete}
          className="absolute right-2 top-2 rounded-md bg-white/80 p-1 text-slate-400 backdrop-blur transition-colors hover:text-red-500"
          title="删除此版本">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7"
              stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* 卡片内容 */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <input type="text" value={object.name}
            onChange={(e) => onUpdate("name", e.target.value)} placeholder="物品名称"
            className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
          {object.category.trim() && (
            <span className="shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              {object.category.trim()}
            </span>
          )}
        </div>

        {/* 版本标签编辑 */}
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-slate-400">版本标签</span>
          <input type="text" value={object.versionLabel}
            onChange={(e) => onUpdate("versionLabel", e.target.value)}
            placeholder="如：初始形态、觉醒后…"
            className="flex-1 rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 focus:border-brand-400 focus:outline-none" />
        </div>

        {object.category.trim() && !expanded && (
          <p className="mt-1.5 text-xs text-slate-400">{object.category}</p>
        )}

        <button onClick={onToggle}
          className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-brand-500">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {expanded ? "收起详情" : "展开详情"}
        </button>

        {expanded && (
          <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
            <Field label="分类" hint="武器/道具/载具等">
              <input type="text" value={object.category}
                onChange={(e) => onUpdate("category", e.target.value)}
                placeholder="如：法器、载具、生活道具…" className="obj-input" />
            </Field>
            <Field label="外观" hint="外观特征、材质造型">
              <textarea value={object.appearance}
                onChange={(e) => onUpdate("appearance", e.target.value)}
                placeholder="如：青铜长剑，剑身刻有云纹，剑柄缠红绳…"
                className="obj-input resize-y" rows={3} />
            </Field>
            <Field label="功能用途" hint="功能、效果、用法">
              <textarea value={object.purpose}
                onChange={(e) => onUpdate("purpose", e.target.value)}
                placeholder="如：可斩妖除魔，剑气可破护体罡气…"
                className="obj-input resize-y" rows={2} />
            </Field>
            <Field label="来源背景">
              <textarea value={object.origin}
                onChange={(e) => onUpdate("origin", e.target.value)}
                placeholder="如：上古仙人遗落凡间的法器，传承数千年…"
                className="obj-input resize-y" rows={3} />
            </Field>
          </div>
        )}
      </div>

      <style jsx>{`
        :global(.obj-input) {
          width: 100%; border-radius: 6px; border: 1px solid #e7e5e4;
          background: #fff; padding: 6px 10px; font-size: 13px; color: #44403c;
        }
        :global(.obj-input:focus) {
          outline: none; border-color: #d97706; box-shadow: 0 0 0 2px rgba(217,119,6,0.2);
        }
        :global(.obj-input::placeholder) { color: #a8a29e; }
      `}</style>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-xs font-medium text-slate-600">{label}</label>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
