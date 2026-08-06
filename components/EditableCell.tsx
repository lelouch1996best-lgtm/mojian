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
  /** textarea 最小高度；设置后编辑态自动随内容增高（不低于该高度），并禁用手动 resize */
  minHeight?: string;
  /** 编辑态/显示态最大高度，超出后内部滚动 */
  maxHeight?: string;
  /** 显示态是否把 @名称@ 渲染为蓝色标签 */
  renderTags?: boolean;
  /** 点击标签上的 × 移除标注时回调（传入不含 @ 的标签名） */
  onRemoveTag?: (tagName: string) => void;
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
  /**
   * 是否允许在 @ 下拉中新建一个当前不存在的标签。
   * 开启后，当输入的关键词非空且与已有选项不完全重复时，下拉末尾会追加"新建标签"项。
   */
  allowCreateTag?: boolean;
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
  minHeight,
  maxHeight,
  renderTags = false,
  onRemoveTag,
  atMentionOptions,
  onAtMentionSelect,
  allowCreateTag = false,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  // @ 下拉状态
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = 未触发，"" 或字符串 = 触发后关键词
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; bottom: number; left: number }>({ top: 0, bottom: 0, left: 0 });
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

  /** 自动增高：内容高度大于最小高度时撑高，否则保持最小高度；不超过最大高度 */
  function autoGrow() {
    const ta = inputRef.current as HTMLTextAreaElement | null;
    if (!ta || !minHeight) return;
    ta.style.height = "auto";
    // scrollHeight 可能因亚像素取整略小于实际需要，多加 2px 避免出现滚动条
    const contentHeight = ta.scrollHeight + 2;
    const minPx = parseInt(minHeight, 10) || 0;
    const maxPx = maxHeight ? parseInt(maxHeight, 10) || Infinity : Infinity;
    ta.style.height = Math.min(Math.max(contentHeight, minPx), maxPx) + "px";
  }

  useEffect(() => {
    if (editing && minHeight) {
      autoGrow();
    }
  }, [editing, draft, minHeight]);

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

  /** 计算下拉框位置（固定定位，记录 textarea rect，渲染时按剩余空间决定向上/向下弹出） */
  function updateDropdownPos() {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
    });
  }

  /** textarea 输入时检测 @ 触发 */
  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newDraft = e.target.value;
    setDraft(newDraft);

    const hasOptions = !!atMentionOptions && atMentionOptions.length > 0;
    if (!hasOptions && !allowCreateTag) return;

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

  /** 允许新建标签：输入关键词非空且与已有选项不完全重复时，追加"新建标签"项 */
  const trimmedQuery = mentionQuery !== null ? mentionQuery.trim() : "";
  const createOption: AtMentionOption | null =
    allowCreateTag &&
    trimmedQuery !== "" &&
    !(atMentionOptions ?? []).some(
      (o) => o.value.toLowerCase() === trimmedQuery.toLowerCase()
    )
      ? { label: trimmedQuery, value: trimmedQuery }
      : null;

  const displayOptions = createOption
    ? [...filteredOptions, createOption]
    : filteredOptions;

  const showDropdown = mentionQuery !== null && displayOptions.length > 0;

  // 弹框打开时监听所有可滚动容器，滚动时实时跟随
  useEffect(() => {
    if (!showDropdown) return;

    function handleScroll() {
      updateDropdownPos();
    }

    // 捕获阶段监听，捕获所有祖先滚动容器的 scroll 事件
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDropdown]);

  // 键盘上下移动时，高亮项自动滚入弹框视口
  useEffect(() => {
    if (showDropdown && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [mentionIndex, showDropdown]);

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
        setMentionIndex((i) => Math.min(i + 1, displayOptions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectMention(displayOptions[mentionIndex]);
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
            rows={minHeight ? 1 : 3}
            className={`w-full rounded border border-brand-400 bg-white px-2 py-1 text-xs leading-relaxed text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${minHeight ? "resize-none" : "resize-y"}`}
            style={{ minWidth, ...(minHeight ? { minHeight } : {}), ...(maxHeight ? { maxHeight, overflowY: "auto" } : {}) }}
          />
          {showDropdown && (() => {
            // 下方/上方剩余空间，估算菜单高度（每项约 36px，上限 200px）
            const estHeight = Math.min(200, Math.max(1, displayOptions.length) * 36);
            const margin = 4;
            const belowSpace = window.innerHeight - dropdownPos.bottom;
            const aboveSpace = dropdownPos.top;
            const placeAbove = belowSpace < estHeight + margin && aboveSpace > belowSpace;
            const top = placeAbove
              ? Math.max(0, dropdownPos.top - margin - estHeight)
              : dropdownPos.bottom + margin;
            return (
              <div
                style={{ top, left: dropdownPos.left, maxHeight: "200px" }}
                className="fixed z-50 min-w-[160px] max-w-[260px] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
              >
                {displayOptions.map((opt, i) => {
                  const isCreate = opt === createOption;
                  return (
                    <div
                      key={isCreate ? `__create__${opt.value}` : opt.value}
                      ref={i === mentionIndex ? highlightRef : null}
                      onMouseDown={(e) => handleDropdownMouseDown(e, opt)}
                      className={`cursor-pointer px-3 py-2 text-xs ${
                        i === mentionIndex
                          ? "bg-brand-50 text-brand-700"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {isCreate ? (
                        <span>
                          <span className="font-medium text-emerald-600">+ 新建标签</span>{" "}
                          <span className="font-medium text-amber-600">@{opt.label}</span>
                        </span>
                      ) : (
                        <span>
                          <span className="font-medium text-amber-600">@</span>
                          {opt.label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
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
      className={`min-h-[24px] cursor-text whitespace-pre-wrap break-words rounded px-2 py-1 text-xs leading-relaxed text-slate-700 hover:bg-brand-50/60${maxHeight ? " overflow-y-auto" : ""}`}
      style={{ minWidth, ...(maxHeight ? { maxHeight } : {}) }}
      title="点击编辑"
    >
      {value ? (
        renderTags ? (
          <TaggedText text={value} onRemoveTag={onRemoveTag} />
        ) : (
          value
        )
      ) : (
        <span className="text-slate-300">{placeholder || "点击编辑"}</span>
      )}
    </div>
  );
}
