import { useRef } from "react";
import type { SceneProfile } from "@/lib/types";
import Spinner from "@/components/ui/Spinner";
import ImageLightbox from "@/components/ImageLightbox";
import ImageActionToolbar from "@/components/ImageActionToolbar";

/** 单个场景版本卡片 */
export function SceneCard({
  scene,
  isLatest,
  expanded,
  onToggle,
  onUpdate,
  onDelete,
  onGenerateImage,
  isGenerating,
  onUploadImage,
  isUploading,
  onRandomAppearance,
}: {
  scene: SceneProfile;
  isLatest: boolean;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (field: keyof SceneProfile, value: string) => void;
  onDelete: () => void;
  onGenerateImage: () => void;
  isGenerating: boolean;
  onUploadImage: (file: File) => void;
  isUploading: boolean;
  onRandomAppearance: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md ${
      isLatest ? "border-brand-300" : "border-slate-200"
    }`}>
      {/* 图片区域 */}
      <div className="group relative flex h-28 items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        {scene.imageUrl ? (
          <ImageLightbox src={scene.imageUrl} alt={scene.name} className="h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={scene.imageUrl} alt={scene.name} className="h-full w-full object-cover" />
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
        {/* 重新生成中遮罩（已有图片时覆盖在图片上） */}
        {isGenerating && scene.imageUrl && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-black/40 backdrop-blur-sm">
            <Spinner size={24} />
            <span className="text-xs text-white">重新生成中…</span>
          </div>
        )}
        {/* 上传中遮罩（已有图片时覆盖在图片上） */}
        {isUploading && scene.imageUrl && (
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
            if (file) onUploadImage(file);
            e.target.value = "";
          }} />
        {/* 版本 badge */}
        <span className={`absolute left-2 top-2 rounded px-1.5 py-0.5 text-xs backdrop-blur ${
          isLatest ? "bg-brand-500/80 text-white" : "bg-black/20 text-white"
        }`}>
          {scene.versionLabel || `v${scene.version}`}
          {isLatest && " · 最新"}
        </span>
        {scene.imageUrl && !isGenerating && !isUploading && (
          <ImageActionToolbar
            onRegenerate={onGenerateImage}
            onUpload={() => fileInputRef.current?.click()}
            onDelete={onDelete}
          />
        )}
      </div>

      {/* 卡片内容 */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs font-semibold text-black">📝 名称</span>
          <input type="text" value={scene.name}
            onChange={(e) => onUpdate("name", e.target.value)} placeholder="场景名称"
            className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
        </div>

        {/* 版本标签编辑 */}
        <div className="mt-2 flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs font-semibold text-black">🏷️ 版本标签</span>
          <input type="text" value={scene.versionLabel}
            onChange={(e) => onUpdate("versionLabel", e.target.value)}
            placeholder="如：白天、夜晚、战火后…"
            className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-600 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
        </div>

        {scene.category.trim() && !expanded && (
          <p className="mt-1.5 text-xs text-slate-400">{scene.category}</p>
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
            <Field label="📦 分类" hint="室内/室外/特定地点等">
              <input type="text" value={scene.category}
                onChange={(e) => onUpdate("category", e.target.value)}
                placeholder="如：室内、室外、奇幻地…" className="scene-input" />
            </Field>
            <Field label="🎨 外观描述" hint="视觉特征、布局、建筑风格" action={
              <button onClick={onRandomAppearance} title="随机生成外观"
                className="text-xs text-brand-600 transition-colors hover:text-brand-700">
                ✨
              </button>
            }>
              <textarea value={scene.appearance}
                onChange={(e) => onUpdate("appearance", e.target.value)}
                placeholder="如：古朴的木质茶馆，挂着红灯笼，门前有石阶流水…"
                className="scene-input resize-y" rows={3} />
            </Field>
            <Field label="💡 光影氛围" hint="光线、色调、氛围">
              <textarea value={scene.lightingMood}
                onChange={(e) => onUpdate("lightingMood", e.target.value)}
                placeholder="如：黄昏暖光、逆光剪影、冷色调月光…"
                className="scene-input resize-y" rows={2} />
            </Field>
            <Field label="📖 来源背景">
              <textarea value={scene.origin}
                onChange={(e) => onUpdate("origin", e.target.value)}
                placeholder="如：主角家族传承的老宅，隐藏在深巷百年…"
                className="scene-input resize-y" rows={3} />
            </Field>
          </div>
        )}
      </div>

      <style jsx>{`
        :global(.scene-input) {
          width: 100%; border-radius: 6px; border: 1px solid #e7e5e4;
          background: #fff; padding: 6px 10px; font-size: 13px; color: #44403c;
        }
        :global(.scene-input:focus) {
          outline: none; border-color: #d97706; box-shadow: 0 0 0 2px rgba(217,119,6,0.2);
        }
        :global(.scene-input::placeholder) { color: #a8a29e; }
      `}</style>
    </div>
  );
}

function Field({ label, hint, action, children }: { label: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-xs font-semibold text-black">{label}</label>
        <div className="flex items-center gap-1.5">
          {hint && <span className="text-xs text-slate-400">{hint}</span>}
          {action}
        </div>
      </div>
      {children}
    </div>
  );
}
