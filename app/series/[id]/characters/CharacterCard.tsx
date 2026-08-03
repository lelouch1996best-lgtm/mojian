import type { CharacterProfile } from "@/lib/types";
import AssetImageZone from "@/components/AssetImageZone";
import VoicePlayerBar from "@/components/VoicePlayerBar";

/** 单个人物版本卡片 */
export function CharacterCard({
  character,
  isLatest,
  onUpdate,
  onDelete,
  onOpenDetail,
  onGenerateImage,
  isGenerating,
  onUploadImage,
  isUploading,
  onGenerateVoice,
  isGeneratingVoice,
  onAddVoiceFromAsset,
  onUploadVoice,
  isUploadingVoice,
  onRemoveVoice,
}: {
  character: CharacterProfile;
  isLatest: boolean;
  onUpdate: (field: keyof CharacterProfile, value: string) => void;
  onDelete: () => void;
  onOpenDetail: () => void;
  onGenerateImage: () => void;
  isGenerating: boolean;
  onUploadImage: (file: File) => void;
  isUploading: boolean;
  onGenerateVoice: () => void;
  isGeneratingVoice: boolean;
  onAddVoiceFromAsset: () => void;
  onUploadVoice: (file: File) => void;
  isUploadingVoice: boolean;
  onRemoveVoice: () => void;
}) {
  return (
    <div className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md ${
      isLatest ? "border-brand-300" : "border-slate-200"
    }`}>
      {/* 图片区域 */}
      <AssetImageZone
        imageUrl={character.imageUrl}
        name={character.name}
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
          {character.versionLabel || `v${character.version}`}
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
      </AssetImageZone>

      {/* 卡片内容 */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs font-semibold text-black">📝 名称</span>
          <input type="text" value={character.name}
            onChange={(e) => onUpdate("name", e.target.value)} placeholder="人物姓名"
            className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
        </div>

        {/* 版本标签编辑 */}
        <div className="mt-2 flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs font-semibold text-black">🏷️ 版本标签</span>
          <input type="text" value={character.versionLabel}
            onChange={(e) => onUpdate("versionLabel", e.target.value)}
            placeholder="如：少年期、觉醒后…"
            className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-600 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
        </div>

        {/* 音色段 */}
        <VoicePlayerBar
          voiceUrl={character.voiceUrl}
          name={character.name}
          versionLabel={character.versionLabel}
          version={character.version}
          isGenerating={isGeneratingVoice}
          isUploading={isUploadingVoice}
          onGenerate={onGenerateVoice}
          onAddFromAsset={onAddVoiceFromAsset}
          onUpload={onUploadVoice}
          onRemove={onRemoveVoice}
        />

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
