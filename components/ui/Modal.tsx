"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** z-index 层级类名，默认 z-50。详情弹框等「父级弹框」用 z-40，工具弹框保持 z-50 以浮于其上 */
  zIndexClass?: string;
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = "max-w-lg",
  zIndexClass = "z-50",
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dialogRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    baseLeft: number;
    baseTop: number;
    width: number;
    height: number;
  } | null>(null);

  // 仅在客户端挂载后才渲染 portal（避免 SSR 报错）
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // 每次打开重置拖拽偏移，回到 flex 居中的初始位置
  useEffect(() => {
    if (open) setDragOffset({ x: 0, y: 0 });
  }, [open]);

  /** 标题栏按下：基于 transform 偏移拖拽（保留 flex 居中作为初始位置） */
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      // 点击关闭按钮等可交互元素时不触发拖拽
      if ((e.target as HTMLElement).closest("button, input, textarea, select")) return;
      e.preventDefault();
      const rect = dialogRef.current?.getBoundingClientRect();
      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: dragOffset.x,
        origY: dragOffset.y,
        // 还原 offset=0（居中）时的视口位置，用于计算拖拽边界
        baseLeft: rect ? rect.left - dragOffset.x : 0,
        baseTop: rect ? rect.top - dragOffset.y : 0,
        width: rect?.width ?? 600,
        height: rect?.height ?? 400,
      };
      const onMove = (ev: MouseEvent) => {
        const st = dragState.current;
        if (!st) return;
        const dx = ev.clientX - st.startX;
        const dy = ev.clientY - st.startY;
        // 约束：至少保留 120px 标题栏在水平视口内、标题栏在垂直视口内可见
        const minX = -st.baseLeft - st.width + 120;
        const maxX = window.innerWidth - st.baseLeft - 120;
        const minY = -st.baseTop;
        const maxY = window.innerHeight - st.baseTop - 48;
        setDragOffset({
          x: Math.min(Math.max(minX, st.origX + dx), maxX),
          y: Math.min(Math.max(minY, st.origY + dy), maxY),
        });
      };
      const onUp = () => {
        dragState.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.userSelect = "none";
    },
    [dragOffset.x, dragOffset.y]
  );

  if (!open || !mounted) return null;

  return createPortal(
    <div className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-4`}>
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
        className={`relative z-10 w-full ${width} rounded-xl bg-white shadow-2xl flex flex-col max-h-[90vh]`}
      >
        {title && (
          <div
            onMouseDown={handleDragStart}
            className="flex cursor-move items-center justify-between border-b border-slate-200 px-5 py-3.5"
          >
            <h3 className="select-none text-base font-semibold text-slate-800">{title}</h3>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 transition-colors"
              aria-label="关闭"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
