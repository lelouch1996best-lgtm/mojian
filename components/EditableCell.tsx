"use client";

import { useEffect, useRef, useState } from "react";
import TaggedText from "./TaggedText";

export interface AtMentionOption {
  label: string;
  value: string;
}

interface EditableCellProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  minWidth?: string;
  /** 显示态是否把 @名称@ 渲染为蓝色标签 */
  renderTags?: boolean;
  /**
   * 当输入 @ 时弹出的可选项列表（仅 multiline 模式下生效）。
   * label 为展示文本，value 为插入的名称（不含 @）。
   */
  atMentionOptions?: AtMentionOption[];
  /**
   * 当用户选中某个 @ 补全项时回调（在文本替换之后触发）。
   * 传入选中项的 value（即资产名称）。
   */
  onAtMentionSelect?: (value: string) => void;
}

/**
 * 行内编辑单元格：点击进入编辑态，失焦或 Ctrl+Enter 提交。
 * multiline + atMentionOptions 时支持 @ 触发下拉补全。
 */
export default function EditableCell({
  value,
  onChange,
  placeholder = "",
  multiline = false,
  minWidth = "120px",
  renderTags = false,
  atMentionOptions,
  onAtMentionSelect,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  // @ 下拉状态
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = 未触发，"" 或字符串 = 触发后关键词
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      const el = inputRef.current;
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    setMentionQuery(null);
    if (draft !== value) onChange(draft);
  }

  function cancel() {
    setEditing(false);
    setDraft(value);
    setMentionQuery(null);
  }

  /** 计算下拉框位置（固定定位，紧贴 textarea 下方） */
  function updateDropdownPos() {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
    });
  }

  /** textarea 输入时检测 @ 触发 */
  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newDraft = e.target.value;
    setDraft(newDraft);

    if (!atMentionOptions || atMentionOptions.length === 0) return;

    const cursor = e.target.selectionStart ?? newDraft.length;
    const textBefore = newDraft.slice(0, cursor);

    // 从光标往前找最近的 @，且 @ 前面是行首或空白/标点
    const match = textBefore.match(/@([^\s@，。、,\.！？!?\n：:；;）)、】"'`（）\[\]{}｜|《》〈〉…—·]*)$/);
    if (match) {
      setMentionQuery(match[1]); // 可以是空字符串（刚输入 @）
      setMentionIndex(0);
      updateDropdownPos();
    } else {
      setMentionQuery(null);
    }
  }

  /** 过滤选项 */
  const filteredOptions =
    mentionQuery !== null && atMentionOptions
      ? atMentionOptions.filter((o) =>
          o.value.toLowerCase().includes(mentionQuery.toLowerCase()) ||
          o.label.toLowerCase().includes(mentionQuery.toLowerCase())
        )
      : [];

  const showDropdown = mentionQuery !== null && filteredOptions.length > 0;

  /** 选中某个选项，将 @query 替换为 @value + 空格 */
  function selectMention(opt: AtMentionOption) {
    if (!inputRef.current) return;
    const ta = inputRef.current as HTMLTextAreaElement;
    const cursor = ta.selectionStart ?? draft.length;
    const textBefore = draft.slice(0, cursor);
    const textAfter = draft.slice(cursor);

    // 找到光标前最近的 @
    const atIdx = textBefore.lastIndexOf("@");
    if (atIdx === -1) return;

    const newText = textBefore.slice(0, atIdx) + "@" + opt.value + " " + textAfter;
    setDraft(newText);
    setMentionQuery(null);

    // 光标移到插入位置之后
    const newCursor = atIdx + opt.value.length + 2; // @ + value + 空格
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
    });

    // 通知父组件
    onAtMentionSelect?.(opt.value);
  }

  /** textarea 键盘事件 */
  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showDropdown) {
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
        return;
      }
    }

    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
    if (e.key === "Escape" && !showDropdown) {
      e.preventDefault();
      cancel();
    }
  }

  /** blur 时延迟关闭，留时间给下拉项 mousedown */
  function handleTextareaBlur() {
    closeTimeoutRef.current = setTimeout(() => {
      commit();
    }, 160);
  }

  /** 点击下拉项时先取消 blur 延迟 */
  function handleDropdownMouseDown(e: React.MouseEvent, opt: AtMentionOption) {
    e.preventDefault(); // 阻止 textarea blur 先触发
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    selectMention(opt);
  }

  if (editing) {
    if (multiline) {
      return (
        <div className="relative">
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={handleTextareaChange}
            onBlur={handleTextareaBlur}
            onKeyDown={handleTextareaKeyDown}
            rows={3}
            className="w-full resize-y rounded border border-brand-400 bg-white px-2 py-1 text-xs leading-relaxed text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            style={{ minWidth }}
          />
          {showDropdown && (
            <div
              style={{ top: dropdownPos.top, left: dropdownPos.left }}
              className="fixed z-50 min-w-[160px] max-w-[260px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
            >
              {filteredOptions.map((opt, i) => (
                <div
                  key={opt.value}
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
            </div>
          )}
        </div>
      );
    }
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        className="w-full rounded border border-brand-400 bg-white px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        style={{ minWidth }}
      />
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="min-h-[24px] cursor-text rounded px-2 py-1 text-xs leading-relaxed text-slate-700 hover:bg-brand-50/60"
      style={{ minWidth }}
      title="点击编辑"
    >
      {value ? (
        renderTags ? (
          <TaggedText text={value} />
        ) : (
          value
        )
      ) : (
        <span className="text-slate-300">{placeholder || "点击编辑"}</span>
      )}
    </div>
  );
}
