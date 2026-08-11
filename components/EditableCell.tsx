"use client";

import { useEffect, useRef, useState } from "react";
import TaggedText from "./TaggedText";
import { useAtMention, AtMentionDropdown, type AtMentionOption } from "./AtMentionDropdown";

export type { AtMentionOption };

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
  /** 显示态是否把 @名称 渲染为蓝色标签 */
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
  /** 禁用编辑（优化等生成期间锁定，禁止进入编辑态/输入） */
  disabled?: boolean;
}

/**
 * 行内编辑单元格：点击进入编辑态，失焦或 Ctrl+Enter 提交。
 * multiline + atMentionOptions 时支持 @ 触发下拉补全（逻辑与 AtMentionTextarea 共用 useAtMention）。
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
  disabled = false,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  const at = useAtMention({
    options: atMentionOptions ?? [],
    allowCreateTag,
    getText: () => draft,
    setText: setDraft,
    inputRef,
    onSelect: onAtMentionSelect,
  });

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
    at.closeDropdown();
    if (draft !== value) onChange(draft);
  }

  function cancel() {
    setEditing(false);
    setDraft(value);
    at.closeDropdown();
  }

  /** textarea 输入时更新 draft 并检测 @ 触发 */
  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value);
    at.detectFromEvent(e);
  }

  /** textarea 键盘事件 */
  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (at.handleKeyDown(e)) return;

    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
    if (e.key === "Escape" && !at.showDropdown) {
      e.preventDefault();
      cancel();
    }
  }

  /** blur 时延迟提交，留时间给下拉项 mousedown */
  function handleTextareaBlur() {
    at.scheduleClose(commit);
  }

  if (editing) {
    if (multiline) {
      return (
        <div className="relative">
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            readOnly={disabled}
            onChange={handleTextareaChange}
            onBlur={handleTextareaBlur}
            onKeyDown={handleTextareaKeyDown}
            rows={minHeight ? 1 : 3}
            className={`w-full rounded border border-brand-400 bg-white px-2 py-1 text-xs leading-relaxed text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${minHeight ? "resize-none" : "resize-y"}`}
            style={{ minWidth, ...(minHeight ? { minHeight } : {}), ...(maxHeight ? { maxHeight, overflowY: "auto" } : {}) }}
          />
          {at.showDropdown && (
            <AtMentionDropdown
              displayOptions={at.displayOptions}
              createOption={at.createOption}
              mentionIndex={at.mentionIndex}
              dropdownPos={at.dropdownPos}
              onItemMouseDown={at.handleDropdownMouseDown}
            />
          )}
        </div>
      );
    }
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={draft}
        readOnly={disabled}
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
      onClick={disabled ? undefined : () => setEditing(true)}
      className={`min-h-[24px] whitespace-pre-wrap break-words rounded px-2 py-1 text-xs leading-relaxed text-slate-700 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-text hover:bg-brand-50/60"}${maxHeight ? " overflow-y-auto" : ""}`}
      style={{ minWidth, ...(maxHeight ? { maxHeight } : {}) }}
      title={disabled ? "优化中，请稍候" : "点击编辑"}
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
