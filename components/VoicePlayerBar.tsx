"use client";

import { useRef, useState } from "react";
import Spinner from "./ui/Spinner";

interface VoicePlayerBarProps {
  voiceUrl?: string;
  name: string;
  versionLabel?: string;
  version?: number;
  isGenerating: boolean;
  isUploading: boolean;
  onGenerate: () => void;
  onAddFromAsset: () => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
}

/** 人物音色条：播放/进度/下载/重新生成/移除，以及无音色时的生成/上传/资产库入口 */
export default function VoicePlayerBar({
  voiceUrl,
  name,
  versionLabel,
  version,
  isGenerating,
  isUploading,
  onGenerate,
  onAddFromAsset,
  onUpload,
  onRemove,
}: VoicePlayerBarProps) {
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
    if (!voiceUrl) return;
    const a = document.createElement("a");
    a.href = voiceUrl;
    a.download = `${name || "voice"}-${versionLabel || `v${version}`}.mp3`;
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
    <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2">
      <span className="shrink-0 text-xs font-semibold text-black">🎙️ 音色</span>
      {voiceUrl && !isGenerating ? (
        <div className="flex w-full items-center gap-1.5">
          <audio
            ref={voiceAudioRef}
            src={voiceUrl}
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
                <button onClick={() => { onGenerate(); setVoiceMenuOpen(false); }} disabled={isGenerating}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50">
                  {isGenerating ? (
                    <Spinner size={12} />
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M21 12a9 9 0 11-3-6.7M21 4v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {isGenerating ? "生成中…" : "重新生成"}
                </button>
                <button onClick={() => { onRemove(); setVoiceMenuOpen(false); }} disabled={isGenerating}
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
      ) : isGenerating || isUploading ? (
        <div className="flex w-full items-center gap-1 text-xs text-slate-400">
          <Spinner size={12} />
          <span>{isUploading ? "上传中…" : "生成中…"}</span>
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
              if (file) onUpload(file);
              e.target.value = "";
            }}
          />
          <button onClick={onGenerate} title="生成音色"
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
          <button onClick={onAddFromAsset} title="从资产库添加"
            className="flex items-center rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
                stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
