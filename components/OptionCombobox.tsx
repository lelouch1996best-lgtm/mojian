"use client";

import { useEffect, useRef, useState } from "react";

interface OptionComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}

/**
 * 行内可输入下拉：聚焦/输入时弹出建议面板，可从选项选择或自由输入自定义值。
 * 复用本站 brand 设计 token：高亮项 bg-brand-50/text-brand-700，弹层 rounded-lg + shadow-lg。
 * 锚点定位 + 自动向上/向下翻转 + 滚动跟随 + 键盘导航（↑↓/Enter/Tab/Esc）。
 */
export default function OptionCombobox({
  value,
  onChange,
  options,
  placeholder = "",
  className = "",
}: OptionComboboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pos, setPos] = useState<{ top: number; bottom: number; left: number; width: number }>({
    top: 0,
    bottom: 0,
    left: 0,
    width: 0,
  });
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = open
    ? options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  const showDropdown = open && filtered.length > 0;

  function updatePos() {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setPos({ top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width });
  }

  function handleFocus() {
    setOpen(true);
    setActiveIndex(0);
    updatePos();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    onChange(v);
    setOpen(true);
    setActiveIndex(0);
    updatePos();
  }

  function selectOption(opt: string) {
    setQuery(opt);
    onChange(opt);
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showDropdown) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectOption(filtered[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }
  }

  function handleBlur() {
    closeTimeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 160);
  }

  function handleDropdownMouseDown(e: React.MouseEvent, opt: string) {
    e.preventDefault();
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    selectOption(opt);
  }

  useEffect(() => {
    if (!showDropdown) return;
    function handleScroll() {
      updatePos();
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDropdown]);

  useEffect(() => {
    if (showDropdown && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, showDropdown]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
      />
      {showDropdown &&
        (() => {
          const estHeight = Math.min(220, Math.max(1, filtered.length) * 30);
          const margin = 4;
          const belowSpace = window.innerHeight - pos.bottom;
          const aboveSpace = pos.top;
          const placeAbove = belowSpace < estHeight + margin && aboveSpace > belowSpace;
          const top = placeAbove
            ? Math.max(0, pos.top - margin - estHeight)
            : pos.bottom + margin;
          return (
            <div
              style={{
                top,
                left: pos.left,
                minWidth: Math.max(pos.width, 120),
                maxHeight: "220px",
              }}
              className="fixed z-50 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            >
              {filtered.map((opt, i) => (
                <div
                  key={opt}
                  ref={i === activeIndex ? highlightRef : null}
                  onMouseDown={(e) => handleDropdownMouseDown(e, opt)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`cursor-pointer px-3 py-1.5 text-xs ${
                    i === activeIndex
                      ? "bg-brand-50 text-brand-700"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {opt}
                </div>
              ))}
            </div>
          );
        })()}
    </div>
  );
}
