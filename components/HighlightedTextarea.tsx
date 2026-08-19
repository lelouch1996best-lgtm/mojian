"use client";

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from "react";
import { renderMentionSpans } from "@/lib/utils";

/**
 * textarea 与 overlay 共用的布局样式片段：字号/行高/字间距/padding/换行必须完全一致，
 * 才能保证两层文字像素级对齐。
 */
const TEXTAREA_LAYOUT_CLASS =
  "px-3 py-2 text-sm leading-6 tracking-normal break-words whitespace-pre-wrap";

interface HighlightedTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  /**
   * 需要 high­light 的 @ 标签名列表（不含 @ 前缀）。
   * 为空数组或不传时，退化为普通实色 textarea（无 overlay）。
   */
  highlightValues?: string[];
  /** 高亮 span 的 className，默认 "rounded bg-amber-100 text-amber-700" */
  highlightClassName?: string;
  /** 外层容器附加 className（用于边框/圆角/聚焦样式等） */
  wrapperClassName?: string;
  /**
   * textarea 与 overlay 共用的布局样式（padding/字号/行高/换行等）。
   * 不传时使用默认 TEXTAREA_LAYOUT_CLASS。传入时覆盖默认值，两层文字必须保持像素级对齐。
   */
  layoutClassName?: string;
  /**
   * 原生 textarea 的 onChange 事件回调（在 value 更新前触发，可拿到 selectionStart 等）。
   * 供需要 @ 下拉检测的调用方（useAtMention.detectFromEvent）使用。
   */
  onTextareaChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

/**
 * 编辑态可高亮 @标签 的 textarea。
 * 实现原理（与 ImageGenerationDialog 一致）：
 *   relative 容器内叠两层：
 *   - 下层 overlay（pointer-events-none absolute inset-0）：渲染高亮文本，不可交互
 *   - 上层 textarea（text-transparent caret-slate-700 bg-transparent）：用户实际输入/光标/选区
 *   滚动同步：textarea onScroll → scrollPos state → overlay transform translate(-left,-top)
 *   滚动条 gutter 对齐：ResizeObserver 检测 scrollHeight>clientHeight，给 overlay 加 [scrollbar-gutter:stable]
 */
const HighlightedTextarea = forwardRef<HTMLTextAreaElement, HighlightedTextareaProps>(
  function HighlightedTextarea(
    {
      value,
      onChange,
      onTextareaChange,
      highlightValues,
      highlightClassName = "rounded bg-amber-100 text-amber-700",
      wrapperClassName = "",
      layoutClassName,
      onScroll,
      className = "",
      ...rest
    },
    forwardedRef,
  ) {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);
    // 合并 forwardedRef 与内部 ref（autoGrow 等需要访问 DOM）
    const setRef = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === "function") {
        forwardedRef(el);
      } else if (forwardedRef) {
        (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
      }
    };

    const [scrollPos, setScrollPos] = useState({ top: 0, left: 0 });
    const [hasScrollbar, setHasScrollbar] = useState(false);

    const values = highlightValues ?? [];
    const hasHighlight = values.length > 0;
    const layout = layoutClassName ?? TEXTAREA_LAYOUT_CLASS;

    // 检测是否出现垂直滚动条：仅在出现时才让 overlay 预留 scrollbar-gutter，避免无滚动条时右侧多出空白
    const checkScrollbar = () => {
      const ta = innerRef.current;
      if (!ta) return;
      setHasScrollbar(ta.scrollHeight > ta.clientHeight);
    };
    useEffect(() => {
      checkScrollbar();
    }, [value]);
    useEffect(() => {
      const ta = innerRef.current;
      if (!ta) return;
      const ro = new ResizeObserver(checkScrollbar);
      ro.observe(ta);
      return () => ro.disconnect();
    }, []);

    function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
      // 先通知调用方做 @ 下拉检测（需原生事件），再更新受控 value
      onTextareaChange?.(e);
      onChange(e.target.value);
    }

    function handleScroll(e: React.UIEvent<HTMLTextAreaElement>) {
      const ta = e.currentTarget;
      setScrollPos({ top: ta.scrollTop, left: ta.scrollLeft });
      onScroll?.(e);
    }

    // 无高亮需求时退化为普通实色 textarea（保持原有 AtMentionTextarea/EditableCell 视觉）
    if (!hasHighlight) {
      return (
        <textarea
          ref={setRef}
          value={value}
          onChange={handleChange}
          onScroll={onScroll}
          className={`block w-full resize-y rounded-md border border-slate-300 bg-white ${className} ${layout} text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30`}
          {...rest}
        />
      );
    }

    return (
      <div className={`relative ${wrapperClassName}`}>
        {/* 下层：高亮叠加层（不可交互，仅渲染高亮文本） */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 overflow-hidden border border-transparent ${layout} text-slate-700${
            hasScrollbar ? " [scrollbar-gutter:stable]" : ""
          }`}
        >
          <div style={{ transform: `translate(${-scrollPos.left}px, ${-scrollPos.top}px)` }}>
            {renderMentionSpans(value, values).map((span, i) =>
              span.highlighted ? (
                <span key={i} className={highlightClassName}>
                  {span.text}
                </span>
              ) : (
                <span key={i}>{span.text}</span>
              ),
            )}
          </div>
        </div>
        {/*
          上层：透明文本的真实 textarea（光标/输入/选区/键盘在此）。
          layout 放在 className 之后：用 layout 的行高/字号覆盖调用方 className 中可能存在的
          布局覆盖（如 leading-relaxed），确保与 overlay 行高完全一致，两层文字像素级对齐。
        */}
        <textarea
          ref={setRef}
          value={value}
          onChange={handleChange}
          onScroll={handleScroll}
          className={`block relative w-full resize-y rounded-md border border-slate-300 ${className} ${layout} !bg-transparent text-transparent caret-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30`}
          {...rest}
        />
      </div>
    );
  },
);

export default HighlightedTextarea;
