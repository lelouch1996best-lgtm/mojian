"use client";

import { useEffect, useMemo, useRef, type TextareaHTMLAttributes } from "react";
import { useAtMention, AtMentionDropdown, type AtMentionOption } from "./AtMentionDropdown";
import HighlightedTextarea from "./HighlightedTextarea";
import { extractTags } from "@/lib/utils";

export type { AtMentionOption };

interface AtMentionTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  options: AtMentionOption[];
  autoGrow?: boolean;
  /**
   * 是否允许在 @ 下拉中新建一个当前不存在的标签。
   * 开启后，当输入的关键词非空且与已有选项不完全重复时，下拉末尾会追加"新建标签"项。
   */
  allowCreateTag?: boolean;
  /**
   * 当用户选中某个 @ 补全项时回调（在文本替换之后触发）。
   * 传入选中项的 value（即不含 @ 的名称）。
   */
  onAtMentionSelect?: (value: string) => void;
}

export default function AtMentionTextarea({
  value,
  onChange,
  options,
  autoGrow = true,
  allowCreateTag = false,
  onAtMentionSelect,
  className = "",
  rows = 3,
  ...rest
}: AtMentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!autoGrow || !textareaRef.current) return;
    const el = textareaRef.current;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, autoGrow]);

  const at = useAtMention({
    options,
    allowCreateTag,
    getText: () => value,
    setText: onChange,
    inputRef: textareaRef,
    onSelect: onAtMentionSelect,
  });

  // 高亮 @ 标签来源：可选选项 + 文本中已出现的标签（兼容 allowCreateTag 新建后未在 options 中的情况）
  const highlightValues = useMemo(() => {
    const set = new Set<string>();
    options.forEach((o) => set.add(o.value));
    extractTags(value).forEach((t) => set.add(t));
    return Array.from(set);
  }, [options, value]);

  // 原生 onChange：先检测 @ 触发，再由 HighlightedTextarea 回调 onChange 更新 value
  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    at.detectFromEvent(e);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    at.handleKeyDown(e);
  }

  function handleBlur() {
    at.scheduleClose(() => at.closeDropdown());
  }

  return (
    <div className="relative">
      <HighlightedTextarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onTextareaChange={handleTextareaChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        highlightValues={highlightValues}
        rows={rows}
        className={className}
        {...rest}
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
