"use client";

import { useEffect, useCallback, useState } from "react";

interface ImageLightboxProps {
  /** 图片 URL */
  src: string;
  /** 图片 alt 文本 */
  alt?: string;
  /** 缩略图渲染内容（点击打开灯箱） */
  children: React.ReactNode;
  /** 缩略图容器 className */
  className?: string;
}

/**
 * 图片放大预览组件 —— 包裹任意内容作为缩略图，点击后全屏灯箱预览。
 * 支持 ESC / 点击遮罩 / 关闭按钮 三种方式关闭。
 */
export default function ImageLightbox({
  src,
  alt = "",
  children,
  className = "",
}: ImageLightboxProps) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  /** 下载图片：优先 fetch blob 触发下载（兼容跨域），失败则新窗口打开 */
  const download = useCallback(async () => {
    const fromUrl = src.split("/").pop()?.split("?")[0] ?? "";
    const fileName = fromUrl && fromUrl.includes(".")
      ? decodeURIComponent(fromUrl)
      : `${alt || "image"}.png`;
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, "_blank");
    }
  }, [src, alt]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, close]);

  // 打开时禁止页面滚动
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {/* 缩略图区域 */}
      <div
        className={`cursor-pointer ${className}`}
        onClick={() => setOpen(true)}
        title="点击放大预览"
      >
        {children}
      </div>

      {/* 全屏灯箱 */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm animate-fade-in"
          onClick={close}
        >
          {/* 关闭按钮 */}
          <button
            onClick={close}
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
            aria-label="关闭"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6L6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {/* 下载按钮 */}
          <button
            onClick={(e) => { e.stopPropagation(); download(); }}
            className="absolute right-16 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
            aria-label="下载"
            title="下载图片"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {/* 图片 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
