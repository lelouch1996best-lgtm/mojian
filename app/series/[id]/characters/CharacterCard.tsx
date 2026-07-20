import { useRef, useState } from "react";
import type { CharacterProfile } from "@/lib/types";
import Spinner from "@/components/ui/Spinner";
import ImageLightbox from "@/components/ImageLightbox";

/** 单个人物版本卡片 */
export function CharacterCard({
  character,
  isLatest,
  expanded,
  onToggle,
  onUpdate,
  onDelete,
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
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (field: keyof CharacterProfile, value: string) => void;
  onDelete: () => void;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceFileInputRef = useRef<HTMLInputElement>(null);
  const voiceMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const [voiceMenuPos, setVoiceMenuPos] = useState<{ top: number; right: number } | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement>(null);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState(0);
  const toggleVoicePlay = () => {
    const a = voiceAudioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play().catch(() => setVoicePlaying(false));
    } else {
      a.pause();
    }
  };
  const seekVoice = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = voiceAudioRef.current;
    if (!a || !a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    a.currentTime = Math.max(0, Math.min(1, ratio)) * a.duration;
  };
  const downloadVoice = () => {
    if (!character.voiceUrl) return;
    const a = document.createElement("a");
    a.href = character.voiceUrl;
    a.download = `${character.name || "voice"}-${character.versionLabel || `v${character.version}`}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setVoiceMenuOpen(false);
  };
  const openVoiceMenu = () => {
    const btn = voiceMenuButtonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setVoiceMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setVoiceMenuOpen(true);
  };
  return (
    <div className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md ${
      isLatest ? "border-brand-300" : "border-slate-200"
    }`}>
      {/* 图片区域 */}
      <div className="relative flex h-28 items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        {character.imageUrl ? (
          <ImageLightbox src={character.imageUrl} alt={character.name} className="h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={character.imageUrl} alt={character.name} className="h-full w-full object-cover" />
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
                <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
        {isGenerating && character.imageUrl && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-black/40 backdrop-blur-sm">
            <Spinner size={24} />
            <span className="text-xs text-white">重新生成中…</span>
          </div>
        )}
        {/* 上传中遮罩（已有图片时覆盖在图片上） */}
        {isUploading && character.imageUrl && (
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
          {character.versionLabel || `v${character.version}`}
          {isLatest && " · 最新"}
        </span>
        {/* 重新生成按钮 */}
        {character.imageUrl && !isGenerating && (
          <button onClick={onGenerateImage}
            className="absolute bottom-2 right-2 rounded-md bg-white/80 p-1.5 text-slate-500 backdrop-blur transition-colors hover:text-brand-500"
            title="重新生成图片">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M21 12a9 9 0 11-3-6.7M21 4v4h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {/* 上传替换按钮 */}
        {character.imageUrl && !isUploading && (
          <button onClick={() => fileInputRef.current?.click()}
            className="absolute right-2 top-10 rounded-md bg-white/80 p-1.5 text-slate-500 backdrop-blur transition-colors hover:text-brand-500"
            title="上传替换图片">
            {isUploading ? (
              <Spinner size={14} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 16V4m0 0L8 8m4-4l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
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
        <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2">
          <span className="shrink-0 text-xs font-semibold text-black">🎙️ 音色</span>
          {character.voiceUrl && !isGeneratingVoice ? (
            <div className="flex w-full items-center gap-1.5">
              <audio
                ref={voiceAudioRef}
                src={character.voiceUrl}
                preload="metadata"
                onPlay={() => setVoicePlaying(true)}
                onPause={() => setVoicePlaying(false)}
                onEnded={() => { setVoicePlaying(false); setVoiceProgress(0); }}
                onLoadedMetadata={() => { setVoicePlaying(false); setVoiceProgress(0); }}
                onTimeUpdate={() => {
                  const a = voiceAudioRef.current;
                  if (a && a.duration) setVoiceProgress((a.currentTime / a.duration) * 100);
                }}
                className="hidden"
              />
              <button
                onClick={toggleVoicePlay}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white/90 text-slate-500 shadow-sm backdrop-blur transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-500"
                title={voicePlaying ? "暂停" : "播放"}
              >
                {voicePlaying ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="5" width="4" height="14" rx="1" />
                    <rect x="14" y="5" width="4" height="14" rx="1" />
                  </svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              <div
                onClick={seekVoice}
                className="group relative h-1 flex-1 cursor-pointer rounded-full bg-slate-200"
              >
                <div
                  className="absolute left-0 top-0 h-full rounded-full bg-brand-400 transition-all"
                  style={{ width: `${voiceProgress}%` }}
                />
                <div
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-white bg-brand-400 opacity-0 shadow transition-opacity group-hover:opacity-100"
                  style={{ left: `calc(${voiceProgress}% - 5px)` }}
                />
              </div>
              <button
                ref={voiceMenuButtonRef}
                onClick={openVoiceMenu}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white/90 text-slate-500 shadow-sm backdrop-blur transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-500"
                title="音色操作"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="12" cy="6" r="1.25" />
                  <circle cx="12" cy="12" r="1.25" />
                  <circle cx="12" cy="18" r="1.25" />
                </svg>
              </button>
              {voiceMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setVoiceMenuOpen(false)} />
                  <div
                    className="fixed z-50 w-32 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                    style={{ top: voiceMenuPos?.top ?? 0, right: voiceMenuPos?.right ?? 0 }}
                  >
                    <button onClick={downloadVoice}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      下载音频
                    </button>
                    <button onClick={() => { onGenerateVoice(); setVoiceMenuOpen(false); }} disabled={isGeneratingVoice}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50">
                      {isGeneratingVoice ? (
                        <Spinner size={12} />
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <path d="M21 12a9 9 0 11-3-6.7M21 4v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      {isGeneratingVoice ? "生成中…" : "重新生成"}
                    </button>
                    <button onClick={() => { onRemoveVoice(); setVoiceMenuOpen(false); }} disabled={isGeneratingVoice}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-500 transition-colors hover:bg-slate-50 disabled:opacity-50">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7"
                          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      移除音色
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : isGeneratingVoice || isUploadingVoice ? (
            <div className="flex w-full items-center gap-1 text-xs text-slate-400">
              <Spinner size={12} />
              <span>{isUploadingVoice ? "上传中…" : "生成中…"}</span>
            </div>
          ) : (
            <div className="flex w-full items-center justify-end gap-1.5">
              <input
                ref={voiceFileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadVoice(file);
                  e.target.value = "";
                }}
              />
              <button onClick={onGenerateVoice} title="生成音色"
                className="flex items-center rounded border border-brand-200 bg-brand-50 px-1.5 py-1 text-brand-600 transition-colors hover:border-brand-300 hover:bg-brand-100">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button onClick={() => voiceFileInputRef.current?.click()} title="上传本地音频"
                className="flex items-center rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M12 16V4m0 0L8 8m4-4l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
              <button onClick={onAddVoiceFromAsset} title="从资产库添加"
                className="flex items-center rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
                    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {character.genderAge.trim() && !expanded && (
          <p className="mt-1.5 text-xs text-slate-400">{character.genderAge}</p>
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
            <div className="grid grid-cols-2 gap-2">
              <Field label="🎭 角色定位">
                <input type="text" value={character.role}
                  onChange={(e) => onUpdate("role", e.target.value)}
                  placeholder="主角、配角…" className="char-input" />
              </Field>
              <Field label="👤 性别年龄">
                <input type="text" value={character.genderAge}
                  onChange={(e) => onUpdate("genderAge", e.target.value)}
                  placeholder="男，25岁" className="char-input" />
              </Field>
            </div>
            <Field label="🎨 外貌" hint="外貌特征、穿着打扮">
              <textarea value={character.appearance}
                onChange={(e) => onUpdate("appearance", e.target.value)}
                placeholder="如：短发，戴黑框眼镜，常穿深色风衣…"
                className="char-input resize-y" rows={3} />
            </Field>
            <Field label="💭 性格" hint="性格特点、行为方式">
              <textarea value={character.personality}
                onChange={(e) => onUpdate("personality", e.target.value)}
                placeholder="如：冷静内敛，不善言辞但观察力敏锐…"
                className="char-input resize-y" rows={2} />
            </Field>
            <Field label="📖 背景故事">
              <textarea value={character.background}
                onChange={(e) => onUpdate("background", e.target.value)}
                placeholder="如：曾是一名记者，因报道失误转行…"
                className="char-input resize-y" rows={3} />
            </Field>
            <Field label="🔗 人物关系" hint="与其他人物的关系">
              <textarea value={character.relationships}
                onChange={(e) => onUpdate("relationships", e.target.value)}
                placeholder="如：小红的丈夫，老张的下属…"
                className="char-input resize-y" rows={2} />
            </Field>
          </div>
        )}
      </div>

      <style jsx>{`
        :global(.char-input) {
          width: 100%; border-radius: 6px; border: 1px solid #e7e5e4;
          background: #fff; padding: 6px 10px; font-size: 13px; color: #44403c;
        }
        :global(.char-input:focus) {
          outline: none; border-color: #d97706; box-shadow: 0 0 0 2px rgba(217,119,6,0.2);
        }
        :global(.char-input::placeholder) { color: #a8a29e; }
      `}</style>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-xs font-semibold text-black">{label}</label>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
