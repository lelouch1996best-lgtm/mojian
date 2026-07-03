"use client";

import type { Series } from "@/lib/types";
import { formatTime } from "@/lib/utils";

interface SeriesListProps {
  series: Series[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate?: () => void;
}

export default function SeriesList({ series, onOpen, onDelete, onCreate }: SeriesListProps) {
  if (series.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {onCreate && (
          <button
            onClick={onCreate}
            className="group flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white/60 text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-500"
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="opacity-50 group-hover:opacity-80 transition-opacity">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="text-sm font-medium">新建企划</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {series.map((s) => (
        <div
          key={s.id}
          onClick={() => onOpen(s.id)}
          className="group flex cursor-pointer flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:shadow-md hover:border-brand-300"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <h3 className="line-clamp-1 font-semibold text-slate-800">
              {s.title || "未命名企划"}
            </h3>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s.id);
              }}
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
              {s.description || "（暂无描述）"}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {s.episodeOrder.length} 集
            </span>
            <span className="text-xs text-slate-400">
              {formatTime(s.updatedAt)}
            </span>
          </div>
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
          <span className="text-sm font-medium">新建企划</span>
        </button>
      )}
    </div>
  );
}
