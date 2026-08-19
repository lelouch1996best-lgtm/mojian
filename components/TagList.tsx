"use client";

interface TagListProps {
  tags: string[];
  onRemoveTag?: (tag: string) => void;
  title?: string;
  /** 空状态文案；不传则标签为空时整个列表不渲染 */
  emptyText?: string;
  /** 当提供时，集合内的标签显示为琥珀色（已处理），集合外显示为灰色（待处理） */
  activeTags?: Set<string>;
}

export default function TagList({
  tags,
  onRemoveTag,
  title = "标签：",
  emptyText,
  activeTags,
}: TagListProps) {
  if (tags.length === 0 && !emptyText) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-slate-400">{title}</span>
      {tags.length === 0 ? (
        <span className="text-xs text-slate-400">{emptyText}</span>
      ) : (
        tags.map((t) => {
          const isActive = !activeTags || activeTags.has(t);
          return (
            <span
              key={t}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                isActive
                  ? "bg-amber-100 text-amber-800"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              @{t}
              {onRemoveTag && (
                <button
                  type="button"
                  onClick={() => onRemoveTag(t)}
                  className={`flex h-3.5 w-3.5 items-center justify-center rounded-full hover:text-red-600 ${
                    isActive
                      ? "text-amber-400 hover:bg-amber-300"
                      : "text-slate-400 hover:bg-slate-300"
                  }`}
                  title={`移除「${t}」标注`}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </span>
          );
        })
      )}
    </div>
  );
}
