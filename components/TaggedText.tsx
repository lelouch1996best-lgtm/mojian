"use client";

interface TaggedTextProps {
  text: string;
  className?: string;
}

/**
 * 将文本中的 @名称（单个 @ 前缀，到空格/标点结束）渲染为蓝色高亮。
 * 普通文字保持原色，标签用蓝色加粗显示，@ 符号本身也着色。
 */
export default function TaggedText({ text, className = "" }: TaggedTextProps) {
  if (!text) return <span className={className} />;

  // 按标签切分：@ + 连续非空白非标点字符
  const re = /(@[^\s@，。、,\.！？!?\n：:；;）)、】"'`（）\[\]{}]+)/g;
  const parts = text.split(re);
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.startsWith("@")) {
          // 标签：@符号 + 名称整体着色
          return (
            <span
              key={i}
              className="font-medium text-amber-700"
              title={`资产：${part.slice(1)}`}
            >
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
