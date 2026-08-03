"use client";

import Spinner from "./ui/Spinner";

interface ImageActionToolbarProps {
  /** 重新生成图片回调 */
  onRegenerate?: () => void;
  /** 是否正在重新生成 */
  isRegenerating?: boolean;
  /** 上传/替换图片回调 */
  onUpload?: () => void;
  /** 是否正在上传 */
  isUploading?: boolean;
  /** 粘贴图片 URL 回调（弹出输入框） */
  onPasteUrl?: () => void;
}

export default function ImageActionToolbar({
  onRegenerate,
  isRegenerating,
  onUpload,
  isUploading,
  onPasteUrl,
}: ImageActionToolbarProps) {
  return (
    <div className="absolute bottom-2 right-2 flex flex-row gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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

      {onUpload && (
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
      )}

      {onPasteUrl && (
        <ToolbarButton onClick={onPasteUrl} title="粘贴图片URL">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </ToolbarButton>
      )}
    </div>
  );
}

function ToolbarButton({
  onClick,
  title,
  disabled,
  loading,
  children,
}: {
  onClick?: () => void;
  title: string;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75 disabled:opacity-60"
    >
      {loading ? <Spinner size={14} /> : children}
    </button>
  );
}
