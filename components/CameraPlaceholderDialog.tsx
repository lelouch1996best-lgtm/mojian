"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface CameraPlaceholderDialogProps {
  open: boolean;
  content: string;
  refImageOptions: string[];
  onClose: () => void;
  onConfirm: (generated: string) => void;
}

/** 解析运镜文本中的 {{占位符}}，去重保序 */
function parsePlaceholders(content: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of Array.from(content.matchAll(/\{\{(.+?)\}\}/g))) {
    const name = m[1].trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

export default function CameraPlaceholderDialog({
  open,
  content,
  refImageOptions,
  onClose,
  onConfirm,
}: CameraPlaceholderDialogProps) {
  const placeholders = useMemo(() => parsePlaceholders(content), [content]);
  const [selections, setSelections] = useState<Record<string, string>>({});

  // Portal / 拖拽
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 560, height: 520 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const w = Math.min(560, window.innerWidth - 32);
    const h = Math.min(520, window.innerHeight - 32);
    setSize({ width: w, height: h });
    setPos({
      x: Math.max(16, Math.round((window.innerWidth - w) / 2)),
      y: Math.max(16, Math.round((window.innerHeight - h) / 2)),
    });
  }, [open]);

  // 打开时重置选择
  useEffect(() => {
    if (open) setSelections({});
  }, [open, content]);

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

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button, input, textarea, select")) return;
      e.preventDefault();
      dragState.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
      const onMove = (ev: MouseEvent) => {
        const st = dragState.current;
        if (!st) return;
        const dx = ev.clientX - st.startX;
        const dy = ev.clientY - st.startY;
        const minX = -size.width + 120;
        const maxX = window.innerWidth - 120;
        const minY = 0;
        const maxY = window.innerHeight - 48;
        setPos({
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
    [pos.x, pos.y, size.width]
  );

  const allFilled =
    placeholders.length === 0 || placeholders.every((ph) => selections[ph]);

  const preview = useMemo(() => {
    let text = content;
    for (const ph of placeholders) {
      const sel = selections[ph];
      if (sel) {
        const escaped = ph.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        text = text.replace(new RegExp(`\\{\\{${escaped}\\}\\}`, "g"), `@${sel} `);
      }
    }
    return text;
  }, [content, placeholders, selections]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div
        style={{ position: "absolute", left: pos.x, top: pos.y, width: size.width, height: size.height }}
        className="flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div
          onMouseDown={handleDragStart}
          className="flex cursor-move items-center justify-between border-b border-slate-200 px-5 py-3.5"
        >
          <h3 className="select-none text-base font-semibold text-slate-800">填充运镜占位符</h3>
          <button
            onClick={onClose}
            className="text-slate-400 transition-colors hover:text-slate-600"
            aria-label="关闭"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {refImageOptions.length === 0 ? (
            <p className="py-6 text-center text-sm text-amber-600">
              当前多模态卡片尚未添加参考图，请先在参考图区添加图片资产后再使用运镜占位符。
            </p>
          ) : placeholders.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              该运镜未包含占位符，可直接确认插入。
            </p>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-slate-500">
                为每个占位符选择一张已添加的参考图，将替换为 <code className="rounded bg-slate-100 px-1">@参考图名</code> 引用。
              </p>
              {placeholders.map((ph) => (
                <div key={ph} className="flex items-center gap-2">
                  <span className="w-40 shrink-0 truncate font-mono text-xs text-slate-600" title={ph}>
                    {`{{${ph}}}`}
                  </span>
                  <select
                    value={selections[ph] ?? ""}
                    onChange={(e) =>
                      setSelections((prev) => ({ ...prev, [ph]: e.target.value }))
                    }
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  >
                    <option value="">请选择参考图</option>
                    {refImageOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {placeholders.length > 0 && refImageOptions.length > 0 && (
            <div className="space-y-1">
              <span className="text-sm text-slate-500">预览</span>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
                {preview}
              </pre>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(preview)}
            disabled={!allFilled}
            className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
          >
            确认插入
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
