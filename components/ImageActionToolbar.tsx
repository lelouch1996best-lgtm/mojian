"use client";

import Spinner from "./ui/Spinner";

interface ImageActionToolbarProps {
  /** 重新生成图片回调 */
  onRegenerate?: () => void;
  /** 是否正在重新生成 */
  isRegenerating?: boolean;
  /** 上传/替换图片回调 */
  onUpload: () => void;
  /** 是否正在上传 */
  isUploading?: boolean;
  /** 删除回调 */
  onDelete: () => void;
}

export default function ImageActionToolbar({
  onRegenerate,
  isRegenerating,
  onUpload,
  isUploading,
  onDelete,
}: ImageActionToolbarProps) {
  return (
    <div className="absolute right-2 top-2 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      {onRegenerate && (
        <ToolbarButton
          onClick={onRegenerate}
          title="重新生成图片"
          disabled={isRegenerating}
          loading={isRegenerating}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M21 12a9 9 0 11-3-6.7M21 4v4h-4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </ToolbarButton>
      )}

      <ToolbarButton
        onClick={onUpload}
        title="上传替换图片"
        disabled={isUploading}
        loading={isUploading}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 16V4m0 0l-4 4m4-4l4 4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </ToolbarButton>

      <ToolbarButton
        onClick={onDelete}
        title="删除此版本"
        danger
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 002 2h8a2 2 0 002-2l1-13M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  onClick,
  title,
  disabled,
  loading,
  danger,
  children,
}: {
  onClick?: () => void;
  title: string;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded bg-black/55 text-white backdrop-blur-sm transition-colors disabled:opacity-60 ${
        danger ? "hover:bg-red-500" : "hover:bg-black/75"
      }`}
    >
      {loading ? <Spinner size={14} /> : children}
    </button>
  );
}
