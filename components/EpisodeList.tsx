"use client";

import type { ReactNode } from "react";
import type { Episode } from "@/lib/types";
import { formatTime } from "@/lib/utils";
import Button from "./ui/Button";

interface EpisodeListProps {
  episodes: Episode[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate?: () => void;
  settingsButtons?: ReactNode;
}

export default function EpisodeList({ episodes, onOpen, onDelete, onCreate, settingsButtons }: EpisodeListProps) {
  return (
    <div>
      {settingsButtons}
      {episodes.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {onCreate && (
            <button
              onClick={onCreate}
              className="group flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white/60 text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-500"
            >
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="opacity-50 group-hover:opacity-80 transition-opacity">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span className="text-sm font-medium">新建剧集</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {episodes.map((ep, i) => (
            <div
              key={ep.id}
              className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:shadow-md hover:border-brand-300"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="line-clamp-1 font-semibold text-slate-800">
                  <span className="mr-1.5 rounded bg-brand-100 px-1.5 py-0.5 text-xs font-normal text-brand-700">
                    第{i + 1}集
                  </span>
                  {ep.title || "未命名剧集"}
                </h3>
                <button
                  onClick={() => onDelete(ep.id)}
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
                <p className="line-clamp-2 text-sm text-slate-500">
                  {ep.expandedContent || ep.originalContent || "（暂无内容）"}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {formatTime(ep.updatedAt)}
                </span>
                <span className="text-xs text-slate-400">
                  {ep.shots.length} 个镜头
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3 w-full"
                onClick={() => onOpen(ep.id)}
              >
                进入编辑
              </Button>
            </div>
          ))}
          {onCreate && (
            <button
              onClick={onCreate}
              className="group flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white/60 text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-500"
            >
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="opacity-50 group-hover:opacity-80 transition-opacity">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span className="text-sm font-medium">新建剧集</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
