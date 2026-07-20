"use client";

interface TaggedTextProps {
  text: string;
  className?: string;
  /** 点击标签上的 × 时回调（传入不含 @ 的标签名）。不传则不显示删除按钮 */
  onRemoveTag?: (tagName: string) => void;
}

/**
 * 将文本中的 @名称（单个 @ 前缀，到空格/标点结束）渲染为蓝色高亮。
 * 普通文字保持原色，标签用蓝色加粗显示，@ 符号本身也着色。
 * 传入 onRemoveTag 时，每个标签后显示一个 × 删除按钮。
 */
export default function TaggedText({ text, className = "", onRemoveTag }: TaggedTextProps) {
  if (!text) return <span className={className} />;

  // 按标签切分：@ + 连续非空白非标点字符
  const re = /(@[^\s@，。、,\.！？!?\n：:；;）)、】"'`（）\[\]{}]+)/g;
  const parts = text.split(re);
  return (
    <span className={`${className} whitespace-pre-wrap break-words`}>
      {parts.map((part, i) => {
        if (part.startsWith("@")) {
          const tagName = part.slice(1);
          return (
            <span
              key={i}
              className="inline-flex items-center rounded bg-amber-50"
            >
              <span
                className="font-medium text-amber-700"
                title={onRemoveTag ? `点击 × 移除「${tagName}」标注` : `资产：${tagName}`}
              >
                {part}
              </span>
              {onRemoveTag && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveTag(tagName);
                  }}
                  className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-amber-400 hover:bg-amber-200 hover:text-red-600"
                  title={`移除「${tagName}」标注`}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
