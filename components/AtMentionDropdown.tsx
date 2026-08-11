"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

export interface AtMentionOption {
  label: string;
  value: string;
}

/**
 * 触发 @ 补全的边界字符集：匹配光标前最近的 @关键词。
 * 字符集与 lib/utils.ts 的 extractTags 完全一致（· 为 U+30FB，构成 …-· 的有效范围），
 * 保证「触发插入的标签」与「extractTags 提取的标签」边界一致。
 */
const MENTION_REGEX = /@([^\s@，。、,\.！？!?\n：:；;）)、】"'`（）\[\]{}｜|《》〈〉…-\u30FB]*)$/;

interface UseAtMentionArgs {
  options: AtMentionOption[];
  allowCreateTag?: boolean;
  /** 读取当前文本（受控 value 或本地 draft） */
  getText: () => string;
  /** 写入新文本（onChange 或 setDraft） */
  setText: (text: string) => void;
  /** textarea/input 的 ref */
  inputRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  /** 选中某项后的回调（传入 value，即不含 @ 的名称） */
  onSelect?: (value: string) => void;
}

/**
 * @ 补全核心逻辑：触发检测、过滤、新建标签、键盘导航、插入、下拉定位与跟随。
 * 同时供 AtMentionTextarea（大文本框）与 EditableCell（行内单元格）复用，
 * 保证两处交互完全一致。
 */
export function useAtMention({
  options,
  allowCreateTag = false,
  getText,
  setText,
  inputRef,
  onSelect,
}: UseAtMentionArgs) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; bottom: number; left: number }>({
    top: 0,
    bottom: 0,
    left: 0,
  });
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 用 ref 持有最新的 getter/setter/回调，避免闭包捕获过期值
  const getTextRef = useRef(getText);
  getTextRef.current = getText;
  const setTextRef = useRef(setText);
  setTextRef.current = setText;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const filteredOptions =
    mentionQuery !== null && options.length > 0
      ? options.filter(
          (o) =>
            o.value.toLowerCase().includes(mentionQuery.toLowerCase()) ||
            o.label.toLowerCase().includes(mentionQuery.toLowerCase()),
        )
      : [];

  const trimmedQuery = mentionQuery !== null ? mentionQuery.trim() : "";
  const createOption: AtMentionOption | null =
    allowCreateTag &&
    trimmedQuery !== "" &&
    !options.some((o) => o.value.toLowerCase() === trimmedQuery.toLowerCase())
      ? { label: trimmedQuery, value: trimmedQuery }
      : null;

  const displayOptions = createOption ? [...filteredOptions, createOption] : filteredOptions;
  const showDropdown = mentionQuery !== null && displayOptions.length > 0;

  /** 计算下拉框位置（固定定位，记录 textarea rect，渲染时按剩余空间决定向上/向下弹出） */
  function updateDropdownPos() {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDropdownPos({ top: rect.top, bottom: rect.bottom, left: rect.left });
  }

  /** 输入后检测 @ 触发 */
  function detectFromEvent(e: ChangeEvent<HTMLTextAreaElement>) {
    if (options.length === 0 && !allowCreateTag) return;
    const text = e.target.value;
    const cursor = e.target.selectionStart ?? text.length;
    const textBefore = text.slice(0, cursor);
    const match = textBefore.match(MENTION_REGEX);
    if (match) {
      setMentionQuery(match[1]);
      setMentionIndex(0);
      updateDropdownPos();
    } else {
      setMentionQuery(null);
    }
  }

  /** 选中某个选项，将 @query 替换为 @value + 空格 */
  function selectMention(opt: AtMentionOption) {
    const el = inputRef.current as HTMLTextAreaElement | null;
    if (!el) return;
    const text = getTextRef.current();
    const cursor = el.selectionStart ?? text.length;
    const textBefore = text.slice(0, cursor);
    const textAfter = text.slice(cursor);

    const atIdx = textBefore.lastIndexOf("@");
    if (atIdx === -1) return;

    const newText = textBefore.slice(0, atIdx) + "@" + opt.value + " " + textAfter;
    setTextRef.current(newText);
    setMentionQuery(null);

    const newCursor = atIdx + opt.value.length + 2; // @ + value + 空格
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newCursor, newCursor);
    });

    onSelectRef.current?.(opt.value);
  }

  /**
   * textarea 键盘事件：处理下拉导航/确认/取消。
   * 返回 true 表示已消费该按键，调用方可据此跳过后续逻辑。
   */
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!showDropdown) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIndex((i) => Math.min(i + 1, displayOptions.length - 1));
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIndex((i) => Math.max(i - 1, 0));
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectMention(displayOptions[mentionIndex]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setMentionQuery(null);
      return true;
    }
    return false;
  }

  /** 点击下拉项时先取消 blur 延迟，再插入 */
  function handleDropdownMouseDown(e: MouseEvent, opt: AtMentionOption) {
    e.preventDefault(); // 阻止 textarea blur 先触发
    cancelScheduledClose();
    selectMention(opt);
  }

  function closeDropdown() {
    setMentionQuery(null);
  }

  /** blur 时延迟执行（关闭下拉或提交），留时间给下拉项 mousedown */
  function scheduleClose(fn: () => void, ms = 160) {
    closeTimeoutRef.current = setTimeout(fn, ms);
  }

  function cancelScheduledClose() {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }

  // 弹框打开时监听所有可滚动容器，滚动时实时跟随
  useEffect(() => {
    if (!showDropdown) return;
    function handleScroll() {
      updateDropdownPos();
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDropdown]);

  return {
    mentionIndex,
    displayOptions,
    createOption,
    showDropdown,
    dropdownPos,
    detectFromEvent,
    handleKeyDown,
    handleDropdownMouseDown,
    closeDropdown,
    scheduleClose,
    cancelScheduledClose,
    selectMention,
    updateDropdownPos,
  };
}

interface AtMentionDropdownProps {
  displayOptions: AtMentionOption[];
  createOption: AtMentionOption | null;
  mentionIndex: number;
  dropdownPos: { top: number; bottom: number; left: number };
  onItemMouseDown: (e: MouseEvent, opt: AtMentionOption) => void;
}

/**
 * @ 补全下拉菜单：通过 portal 渲染到 document.body，按上下剩余空间自动向上/向下弹出，
 * 支持普通选项与「+ 新建标签」项的差异化渲染。
 */
export function AtMentionDropdown({
  displayOptions,
  createOption,
  mentionIndex,
  dropdownPos,
  onItemMouseDown,
}: AtMentionDropdownProps) {
  const highlightRef = useRef<HTMLDivElement | null>(null);

  // 键盘上下移动时，高亮项自动滚入弹框视口
  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: "nearest" });
  }, [mentionIndex]);

  const estHeight = Math.min(200, Math.max(1, displayOptions.length) * 36);
  const margin = 4;
  const belowSpace = window.innerHeight - dropdownPos.bottom;
  const aboveSpace = dropdownPos.top;
  const placeAbove = belowSpace < estHeight + margin && aboveSpace > belowSpace;
  const top = placeAbove ? Math.max(0, dropdownPos.top - margin - estHeight) : dropdownPos.bottom + margin;

  return createPortal(
    <div
      style={{ top, left: dropdownPos.left, maxHeight: "200px" }}
      className="fixed z-[9999] min-w-[160px] max-w-[260px] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
    >
      {displayOptions.map((opt, i) => {
        const isCreate = opt === createOption;
        return (
          <div
            key={isCreate ? `__create__${opt.value}` : opt.value}
            ref={i === mentionIndex ? highlightRef : null}
            onMouseDown={(e) => onItemMouseDown(e, opt)}
            className={`cursor-pointer px-3 py-2 text-xs ${
              i === mentionIndex ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-50"
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
    </div>,
    document.body,
  );
}
