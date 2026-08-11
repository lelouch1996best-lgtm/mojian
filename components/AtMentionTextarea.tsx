"use client";

import { useEffect, useRef, type TextareaHTMLAttributes } from "react";
import { useAtMention, AtMentionDropdown, type AtMentionOption } from "./AtMentionDropdown";

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

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
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
