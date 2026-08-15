import type { SceneProfile } from "@/lib/types";
import AssetImageZone from "@/components/AssetImageZone";

/** 单个场景版本卡片 */
export function SceneCard({
  scene,
  isLatest,
  onSetDefault,
  onUpdate,
  onDelete,
  onOpenDetail,
  onGenerateImage,
  isGenerating,
  onUploadImage,
  isUploading,
}: {
  scene: SceneProfile;
  isLatest: boolean;
  /** 设为默认（最新）版本；仅在多版本组中向非最新版本传入 */
  onSetDefault?: () => void;
  onUpdate: (field: keyof SceneProfile, value: string) => void;
  onDelete: () => void;
  onOpenDetail: () => void;
  onGenerateImage: () => void;
  isGenerating: boolean;
  onUploadImage: (file: File) => void;
  isUploading: boolean;
}) {
  return (
    <div className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md ${
      isLatest ? "border-brand-300" : "border-slate-200"
    }`}>
      {/* 图片区域 */}
      <AssetImageZone
        imageUrl={scene.imageUrl}
        name={scene.name}
        isGenerating={isGenerating}
        isUploading={isUploading}
        onGenerate={onGenerateImage}
        onUpload={onUploadImage}
        onPasteUrl={(url) => onUpdate("imageUrl", url)}
      >
        {/* 版本 badge */}
        <span className={`absolute left-2 top-2 rounded px-1.5 py-0.5 text-xs backdrop-blur ${
          isLatest ? "bg-brand-500/80 text-white" : "bg-black/20 text-white"
        }`}>
          {scene.versionLabel || `v${scene.version}`}
          {isLatest && " · 最新"}
        </span>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur transition-colors hover:bg-red-500"
            title="删除"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {!isLatest && onSetDefault && (
          <button
            type="button"
            onClick={onSetDefault}
            className="absolute bottom-2 left-2 flex h-7 w-7 items-center justify-center rounded bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/75 group-hover:opacity-100"
            title="将此版本设为默认（最新）版本"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6L12 17l-5.4 2.6 1.2-6L3.3 9.4l6.1-.8L12 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </AssetImageZone>

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

        <button onClick={onOpenDetail}
          className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-brand-500">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          查看详情
        </button>
      </div>
    </div>
  );
}
