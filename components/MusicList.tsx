"use client";

import type { ReactNode } from "react";
import type { Music, MusicMode, MusicStatus } from "@/lib/types";
import Button from "./ui/Button";

interface MusicListProps {
  musics: Music[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate?: () => void;
  settingsButtons?: ReactNode;
}

const MODE_LABELS: Record<MusicMode, string> = {
  inspiration: "灵感",
  custom: "自定义",
  remix: "二创",
};

const STATUS_LABELS: Partial<Record<MusicStatus, string>> = {
  pending: "生成中",
  completed: "完成",
  failed: "失败",
};

const STATUS_BADGE_CLASS: Partial<Record<MusicStatus, string>> = {
  pending: "bg-amber-100 text-amber-700",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-600",
};

function formatDuration(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MusicList({ musics, onOpen, onDelete, onCreate, settingsButtons }: MusicListProps) {
  const createCard = onCreate && (
    <button
      onClick={onCreate}
      className="group flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white/60 text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-500"
    >
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="opacity-50 group-hover:opacity-80 transition-opacity">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span className="text-sm font-medium">新建音乐</span>
    </button>
  );

  if (musics.length === 0) {
    return (
      <div>
        {settingsButtons}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {createCard}
        </div>
      </div>
    );
  }

  return (
    <div>
      {settingsButtons}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {musics.map((music) => {
        const firstTrack = music.tracks[0];
        return (
          <div
            key={music.id}
            className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:shadow-md hover:border-brand-300"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <h3 className="line-clamp-1 font-semibold text-slate-800">
                <span className="mr-1.5 rounded bg-brand-100 px-1.5 py-0.5 text-xs font-normal text-brand-700">
                  {MODE_LABELS[music.mode]}
                </span>
                {music.status !== "idle" && (
                  <span className={`mr-1.5 rounded px-1.5 py-0.5 text-xs font-normal ${STATUS_BADGE_CLASS[music.status]}`}>
                    {STATUS_LABELS[music.status]}
                  </span>
                )}
                {music.title || "未命名音乐"}
              </h3>
              <button
                onClick={() => onDelete(music.id)}
                className="text-slate-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                aria-label="删除"
                title="删除"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            <div className="mb-3 flex-1">
              <div className="flex items-center gap-3">
                {firstTrack?.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={firstTrack.coverUrl}
                    alt={music.title || "音乐封面"}
                    className="h-14 w-14 shrink-0 rounded-lg border border-slate-200 object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-300">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M9 18V5l12-2v13"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.8" />
                    </svg>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm text-slate-600">
                    {firstTrack?.title || music.title || "未命名音乐"}
                  </p>
                  {firstTrack?.duration != null && (
                    <p className="mt-0.5 text-xs text-slate-400">
                      时长 {formatDuration(firstTrack.duration)}
                    </p>
                  )}
                </div>
              </div>
              {firstTrack?.audioUrl && (
                <audio controls src={firstTrack.audioUrl} className="mt-3 w-full" />
              )}
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3 w-full"
              onClick={() => onOpen(music.id)}
            >
              进入编辑
            </Button>
          </div>
        );
      })}
      {createCard}
      </div>
    </div>
  );
}
