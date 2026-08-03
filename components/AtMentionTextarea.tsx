"use client";

import { useEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";

export interface AtMentionOption {
  label: string;
  value: string;
}

interface AtMentionTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  options: AtMentionOption[];
  autoGrow?: boolean;
}

export default function AtMentionTextarea({
  value,
  onChange,
  options,
  autoGrow = true,
  className = "",
  rows = 3,
  ...rest
}: AtMentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; bottom: number; left: number }>({ top: 0, bottom: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!autoGrow || !textareaRef.current) return;
    const el = textareaRef.current;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, autoGrow]);

  function updateDropdownPos() {
    if (!textareaRef.current) return;
    const rect = textareaRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
    });
  }

  const filteredOptions =
    mentionQuery !== null && options.length > 0
      ? options.filter(
          (o) =>
            o.value.toLowerCase().includes(mentionQuery.toLowerCase()) ||
            o.label.toLowerCase().includes(mentionQuery.toLowerCase())
        )
      : [];

  const showDropdown = mentionQuery !== null && filteredOptions.length > 0;

  useEffect(() => {
    if (!showDropdown) return;
    function handleScroll() {
      updateDropdownPos();
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [showDropdown]);

  useEffect(() => {
    if (showDropdown && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [mentionIndex, showDropdown]);

  function selectMention(opt: AtMentionOption) {
    if (!textareaRef.current) return;
    const ta = textareaRef.current;
    const cursor = ta.selectionStart ?? value.length;
    const textBefore = value.slice(0, cursor);
    const textAfter = value.slice(cursor);
    const atIdx = textBefore.lastIndexOf("@");
    if (atIdx === -1) return;

    const newText = textBefore.slice(0, atIdx) + "@" + opt.value + " " + textAfter;
    onChange(newText);
    setMentionQuery(null);

    const newCursor = atIdx + opt.value.length + 2;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
    });
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newValue = e.target.value;
    onChange(newValue);

    if (options.length === 0) return;

    const cursor = e.target.selectionStart ?? newValue.length;
    const textBefore = newValue.slice(0, cursor);
    const match = textBefore.match(/@([^\s@，。、,\.！？!?\n：:；;）)、】"'`（）\[\]{}｜|《》〈〉…—·]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionIndex(0);
      updateDropdownPos();
    } else {
      setMentionQuery(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIndex((i) => Math.min(i + 1, filteredOptions.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectMention(filteredOptions[mentionIndex]);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setMentionQuery(null);
    }
  }

  function handleBlur() {
    closeTimeoutRef.current = setTimeout(() => {
      setMentionQuery(null);
    }, 160);
  }

  function handleDropdownMouseDown(e: React.MouseEvent, opt: AtMentionOption) {
    e.preventDefault();
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    selectMention(opt);
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        rows={rows}
        className={`block w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${className}`}
        {...rest}
      />
      {mounted && showDropdown && (() => {
        const estHeight = Math.min(200, Math.max(1, filteredOptions.length) * 36);
        const margin = 4;
        const belowSpace = window.innerHeight - dropdownPos.bottom;
        const aboveSpace = dropdownPos.top;
        const placeAbove = belowSpace < estHeight + margin && aboveSpace > belowSpace;
        const top = placeAbove
          ? Math.max(0, dropdownPos.top - margin - estHeight)
          : dropdownPos.bottom + margin;
        return createPortal(
          <div
            style={{ top, left: dropdownPos.left, maxHeight: "200px" }}
            className="fixed z-[9999] min-w-[160px] max-w-[260px] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
          >
            {filteredOptions.map((opt, i) => (
              <div
                key={opt.value}
                ref={i === mentionIndex ? highlightRef : null}
                onMouseDown={(e) => handleDropdownMouseDown(e, opt)}
                className={`cursor-pointer px-3 py-2 text-xs ${
                  i === mentionIndex
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="font-medium text-amber-600">@</span>
                {opt.label}
              </div>
            ))}
          </div>,
          document.body
        );
      })()}
    </div>
  );
}
