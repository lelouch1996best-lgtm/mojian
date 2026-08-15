"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Button from "./ui/Button";
import AiActionsButton, { type AiAction } from "./ui/AiActionsButton";
import { useConfirm } from "./ui/ConfirmDialog";
import AssetPicker, { type PickedAssetItem } from "./AssetPicker";
import PresetPicker from "./PresetPicker";
import ImageLightbox from "./ImageLightbox";
import { ImageConfigFields } from "./ImageConfigFields";
import { getImageModelCapability, findModelOption, type ModelOption } from "@/lib/model-presets";
import { optimizeTextMessages, generateFirstFramePromptMessages } from "@/lib/prompts";
import type { AssetImageConfig, PickedPresetItem } from "@/lib/types";
import { isMentionedInText } from "@/lib/utils";

/** 弹框确认时回传的完整生成参数 */
export interface ImageGenerationParams {
  /** 最终提示词（已按需拼接风格模板） */
  prompt: string;
  /** 参考图列表（URL 或 base64 data URI） */
  images: string[];
  /** 图片生成配置 */
  config: AssetImageConfig;
  /** 参考图名称列表（与 images 平行，用于 @名称->图片N 替换；未提供时回退 图片N） */
  imageLabels?: string[];
}

/** 根据 @ 提及标签构建正则（最长优先，避免短名误匹配长名前缀） */
function buildMentionRegex(values: string[]): RegExp | null {
  const unique = Array.from(new Set(values)).filter(Boolean);
  if (unique.length === 0) return null;
  const sorted = unique.sort((a, b) => b.length - a.length);
  const escaped = sorted.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`@(${escaped.join("|")})`, "g");
}

/** 模板参考图模式下的固定提示词（参考图作为图片1，由 @图片1 提及引用） */
const STYLE_REFERENCE_PHRASE = "请严格参考此@图片1风格。生成图片。";

/** 将提示词中的 @提及 标记去除 @ 前缀（仅在发送给模型时调用） */
function resolveMentions(text: string, values: string[]): string {
  const regex = buildMentionRegex(values);
  if (!regex) return text;
  return text.replace(regex, "$1");
}

/** 将提示词中的 @提及 渲染为高亮片段（用于输入框叠加层显示） */
function renderHighlightedText(text: string, values: string[]): ReactNode[] {
  const regex = buildMentionRegex(values);
  if (!regex) return [text];
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={key++} className="rounded bg-amber-100 text-amber-700">
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

/** 提示词区的 AI 动作下拉配置（优化文本 / 生成首帧提示词） */
const PROMPT_AI_ACTIONS: AiAction[] = [
  {
    key: "optimize",
    label: "优化文本",
    buildMessages: (text) => optimizeTextMessages(text),
    temperature: 0.7,
  },
  {
    key: "firstFrame",
    label: "生成首帧提示词",
    buildMessages: (text) => generateFirstFramePromptMessages(text),
    temperature: 0.7,
  },
];

/**
 * 图片生成弹框（人物 / 物品 / 场景设定 & 资产准备共用）。
 * 包含：提示词编辑区（支持 @ 引用参考图）、参考图上传（单图/多图生图）、风格模板开关、高级参数折叠区。
 * 参考图为受控状态（由父组件管理），确保关闭/重开弹框时图片不丢失。
 * 确认时通过 onConfirm 回传 { prompt, images, config }，由调用方触发实际生图。
 */
export function ImageGenerationDialog({
  open,
  onClose,
  onConfirm,
  initialPrompt,
  styleTemplate,
  templateReferenceImage,
  initialConfig,
  images,
  onImagesChange,
  imageLabels,
  onImageLabelsChange,
  onUploadFiles,
  imageOptions,
  title = "图片生成",
  confirmText = "生成图片",
  loading = false,
  extraHeader,
  promptHeaderExtra,
  promptFooterExtra,
  keepMentionPrefix = false,
  enablePresetPrompt = false,
  defaultSeriesId,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (params: ImageGenerationParams) => void;
  initialPrompt: string;
  styleTemplate?: string;
  /** 风格模板的参考图 URL；存在时默认启用参考图模式（提示词拼接固定句，参考图作为图片1） */
  templateReferenceImage?: string;
  initialConfig: AssetImageConfig;
  /** 参考图列表（受控：由父组件持有，弹框关闭后不丢失） */
  images: string[];
  /** 参考图变更回调（添加/移除时触发） */
  onImagesChange: (images: string[]) => void;
  /** 参考图名称列表（与 images 平行，用于 @ 提及保留原始资产名；未提供时回退 图片N） */
  imageLabels?: string[];
  /** 参考图名称变更回调（与 onImagesChange 平行触发） */
  onImageLabelsChange?: (labels: string[]) => void;
  /** 文件上传回调（上传到 COS 并返回 URL 列表）；未提供时回退为 base64 data URI */
  onUploadFiles?: (files: File[]) => Promise<string[]>;
  /** 所有已配置供应商的图片模型聚合列表（模型选择弹框 + 能力查询使用） */
  imageOptions: ModelOption[];
  title?: string;
  confirmText?: string;
  loading?: boolean;
  /** 弹框顶部的额外 UI（如自定义开关） */
  extraHeader?: React.ReactNode;
  /** 「提示词」标题栏右侧的额外 UI（AI 优化按钮左侧），例如「生成提示词」按钮 */
  promptHeaderExtra?: React.ReactNode;
  /** 提示词输入框下方的额外 UI（styleTemplate 复选框相邻位置），例如自定义模板开关 */
  promptFooterExtra?: React.ReactNode;
  /** 确认时是否保留 @ 提及前缀（默认 false 会去除 @ 前缀）。故事板等需要后续做 @名称->图片N 替换的场景应设为 true */
  keepMentionPrefix?: boolean;
  /** 是否启用「添加提示词 -> 从预设库获取」按钮（提示词标题栏右侧） */
  enablePresetPrompt?: boolean;
  /** 从资产库选择参考图时默认筛选的企划 ID（当前企划） */
  defaultSeriesId?: string;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [aiRunning, setAiRunning] = useState(false);
  const [config, setConfig] = useState<AssetImageConfig>(initialConfig);
  const [useTemplate, setUseTemplate] = useState(!!styleTemplate);
  const [useImageRef, setUseImageRef] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [presetPromptOpen, setPresetPromptOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();

  // @ 提及状态
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [scrollPos, setScrollPos] = useState({ top: 0, left: 0 });
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [hasScrollbar, setHasScrollbar] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ===== 弹窗 Portal / 拖拽 / 缩放 =====
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 576, height: 680 });
  const dialogRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  // 仅在客户端挂载后才渲染 portal（避免 SSR 报错）
  useEffect(() => {
    setMounted(true);
  }, []);

  // 打开时居中并重置尺寸
  useEffect(() => {
    if (!open) return;
    const w = Math.min(576, window.innerWidth - 32);
    const h = Math.min(680, window.innerHeight - 32);
    setSize({ width: w, height: h });
    setPos({
      x: Math.max(16, Math.round((window.innerWidth - w) / 2)),
      y: Math.max(16, Math.round((window.innerHeight - h) / 2)),
    });
  }, [open]);

  // ESC 关闭 + 锁定 body 滚动
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

  /** 标题栏按下：开始拖拽 */
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      // 点击关闭按钮等可交互元素时不触发拖拽
      if ((e.target as HTMLElement).closest("button, input, textarea, select")) return;
      e.preventDefault();
      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };
      const onMove = (ev: MouseEvent) => {
        const st = dragState.current;
        if (!st) return;
        const dx = ev.clientX - st.startX;
        const dy = ev.clientY - st.startY;
        // 约束：至少保留标题栏在视口内可见
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

  /** 右下角缩放手柄按下：开始缩放 */
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeState.current = {
        startX: e.clientX,
        startY: e.clientY,
        origW: size.width,
        origH: size.height,
      };
      const onMove = (ev: MouseEvent) => {
        const st = resizeState.current;
        if (!st) return;
        const dx = ev.clientX - st.startX;
        const dy = ev.clientY - st.startY;
        const newW = Math.min(Math.max(400, st.origW + dx), window.innerWidth - 16);
        const newH = Math.min(Math.max(320, st.origH + dy), window.innerHeight - 16);
        setSize({ width: newW, height: newH });
      };
      const onUp = () => {
        resizeState.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.userSelect = "none";
    },
    [size.width, size.height]
  );


  // 所选模型条目（按 provider+model 精确匹配，回退首个 model 值匹配）
  const selectedImageOption = findModelOption(imageOptions, config.provider, config.model);
  const maxRefImages = getImageModelCapability(
    config.model,
    selectedImageOption ? [selectedImageOption.entry] : undefined,
    config.provider
  ).maxRefImages;

  // 模板参考图模式：模板参考图不进入父组件 images，仅在弹框内组合为「有效图片」
  // 有效图片首位为模板参考图（标签 图片1），其后为父组件传入的参考图（位置标签顺延）
  const baseLabels = imageLabels ?? images.map(() => "");
  const effectiveImages = useImageRef && templateReferenceImage
    ? [templateReferenceImage, ...images]
    : images;
  const effectiveLabels = useImageRef && templateReferenceImage
    ? ["图片1", ...baseLabels]
    : baseLabels;
  // @ 提及标签：优先使用资产原名（effectiveLabels），无则回退 图片N
  const mentionValues = effectiveImages.map((_, i) => effectiveLabels[i] || `图片${i + 1}`);

  // 风格后缀（固定顺序：文字模板在前，参考图固定句在后），两者可同时启用
  const refSuffix = `${STYLE_REFERENCE_PHRASE}`;
  const tplSuffix = styleTemplate ? `，${styleTemplate}` : "";

  /** 剥离已知的文字模板后缀与参考图固定句后缀，返回用户编辑的主体提示词 */
  function stripKnownSuffixes(p: string): string {
    let base = p;
    if (base.endsWith(refSuffix)) base = base.slice(0, -refSuffix.length);
    if (tplSuffix && base.endsWith(tplSuffix)) base = base.slice(0, -tplSuffix.length);
    return base;
  }

  /** 基于主体提示词，按开关状态重新拼接后缀（文字模板 → 参考图固定句） */
  function rebuildWithSuffixes(base: string, useTpl: boolean, useRef: boolean): string {
    let p = base;
    if (useTpl && tplSuffix) p = `${p}${tplSuffix}`;
    if (useRef) p = `${p}${refSuffix}`;
    return p;
  }

  useEffect(() => {
    if (open) {
      // 文字模板与参考图可同时启用；有参考图时默认启用参考图模式，有文字模板时默认启用文字模板
      const useRef = !!templateReferenceImage;
      const useTpl = !!styleTemplate;
      setUseImageRef(useRef);
      setUseTemplate(useTpl);
      setPrompt(rebuildWithSuffixes(initialPrompt, useTpl, useRef));
      setConfig(initialConfig);
      setShowAdvanced(false);
      setImgError(null);
      setMentionQuery(null);
    }
  }, [open, initialPrompt, initialConfig, styleTemplate, templateReferenceImage]);

  // 弹框打开时重置滚动位置
  useEffect(() => {
    if (open) setScrollPos({ top: 0, left: 0 });
  }, [open]);

  // 检测 textarea 是否出现垂直滚动条：仅在出现时才让 overlay 预留 scrollbar-gutter，避免无滚动条时右侧多出空白
  const checkScrollbar = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    setHasScrollbar(ta.scrollHeight > ta.clientHeight);
  };
  useEffect(() => {
    if (!open) return;
    checkScrollbar();
    const ta = textareaRef.current;
    if (!ta) return;
    const ro = new ResizeObserver(checkScrollbar);
    ro.observe(ta);
    return () => ro.disconnect();
  }, [open, prompt]);

  const update = (patch: Partial<AssetImageConfig>) =>
    setConfig((c) => ({ ...c, ...patch }));

  /** 追加参考图（同时同步名称数组） */
  function appendImages(urls: string[], labels: string[]) {
    onImagesChange([...images, ...urls]);
    if (onImageLabelsChange) {
      const base = imageLabels ?? images.map(() => "");
      onImageLabelsChange([...base, ...labels]);
    }
  }

  /** 移除指定索引的参考图（同时同步名称数组） */
  function removeImageAt(index: number) {
    onImagesChange(images.filter((_, i) => i !== index));
    if (onImageLabelsChange) {
      const base = imageLabels ?? images.map(() => "");
      onImageLabelsChange(base.filter((_, i) => i !== index));
    }
  }

  /** 读取本地文件为 base64 data URI */
  function readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsDataURL(file);
    });
  }

  async function handleAddFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImgError(null);
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/bmp", "image/gif", "image/tiff", "image/heic", "image/heif"];
    const slots = maxRefImages - effectiveImages.length;
    if (slots <= 0) {
      setImgError(`该模型最多 ${maxRefImages} 张参考图`);
      return;
    }
    const toRead = Array.from(files).slice(0, slots);
    const valid: File[] = [];
    for (const f of toRead) {
      if (!allowed.includes(f.type)) {
        setImgError(`不支持的格式：${f.type || "未知"}，仅支持 png/jpg/webp/bmp/gif/tiff/heic`);
        continue;
      }
      if (f.size > 30 * 1024 * 1024) {
        setImgError(`图片「${f.name}」超过 30MB 限制`);
        continue;
      }
      valid.push(f);
    }
    if (valid.length === 0) return;

    setUploading(true);
    try {
      let newImages: string[];
      if (onUploadFiles) {
        newImages = await onUploadFiles(valid);
      } else {
        newImages = [];
        for (const f of valid) {
          newImages.push(await readFileAsDataURL(f));
        }
      }
      if (newImages.length > 0) {
        const validUrls = newImages.filter(Boolean);
        appendImages(validUrls, validUrls.map(() => ""));
      }
    } catch (e) {
      setImgError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function removeImage(effectiveIndex: number) {
    // 参考图模式下首位为模板参考图，由 toggle 控制，不可单独移除
    if (useImageRef && templateReferenceImage) {
      if (effectiveIndex === 0) return;
      removeImageAt(effectiveIndex - 1);
    } else {
      removeImageAt(effectiveIndex);
    }
  }

  // ===== @ 提及：候选选项（基于有效参考图，优先使用资产原名） =====
  const mentionOptions = effectiveImages.map((src, i) => ({
    label: mentionValues[i],
    value: mentionValues[i],
    src,
  }));

  const filteredOptions =
    mentionQuery !== null
      ? mentionOptions.filter(
          (o) =>
            o.value.toLowerCase().includes(mentionQuery.toLowerCase()) ||
            o.label.toLowerCase().includes(mentionQuery.toLowerCase())
        )
      : [];

  const showDropdown = mentionQuery !== null && filteredOptions.length > 0;

  /** 计算下拉框位置 */
  function updateDropdownPos() {
    if (!textareaRef.current) return;
    const rect = textareaRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
    });
  }

  /** textarea 输入时检测 @ 触发 */
  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newPrompt = e.target.value;
    setPrompt(newPrompt);

    if (mentionOptions.length === 0) {
      setMentionQuery(null);
      return;
    }

    const cursor = e.target.selectionStart ?? newPrompt.length;
    const textBefore = newPrompt.slice(0, cursor);

    const match = textBefore.match(/@([^\s@，。、,\.！？!?\n：:；;）)、】"'`（）\[\]{}｜|《》〈〉…\-·]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionIndex(0);
      updateDropdownPos();
    } else {
      setMentionQuery(null);
    }
  }

  /** 选中某个选项，将 @query 替换为「@图片N 」（保留 @ 标记用于高亮，发送时再去除） */
  function selectMention(opt: { label: string; value: string }) {
    if (!textareaRef.current) return;
    const ta = textareaRef.current;
    const cursor = ta.selectionStart ?? prompt.length;
    const textBefore = prompt.slice(0, cursor);
    const textAfter = prompt.slice(cursor);

    const atIdx = textBefore.lastIndexOf("@");
    if (atIdx === -1) return;

    const mention = "@" + opt.value;
    const newText = textBefore.slice(0, atIdx) + mention + " " + textAfter;
    setPrompt(newText);
    setMentionQuery(null);

    const newCursor = atIdx + mention.length + 1;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
    });
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
  }

  /** blur 时延迟关闭下拉 */
  function handleTextareaBlur() {
    closeTimeoutRef.current = setTimeout(() => {
      setMentionQuery(null);
    }, 160);
  }

  /** 点击下拉项时先取消 blur 延迟 */
  function handleDropdownMouseDown(e: React.MouseEvent, opt: { label: string; value: string }) {
    e.preventDefault();
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    selectMention(opt);
  }

  const promptLen = prompt.trim().length;
  const canConfirm = promptLen > 0 && !loading;

  /**
   * 确认生图：检测提示词中未使用的参考图，按需弹框确认后过滤 + 重编号。
   * - 检测：每张参考图的提及标签（资产名 / 图片N）是否出现在最终提示词中
   * - 过滤：移除未使用的参考图链接，同步过滤 imageLabels
   * - 重编号：对默认标签「图片N」按新下标重写提示词中的引用（资产名不变）；
   *   单遍查表替换避免「从大到小顺序替换」时新旧编号冲突导致级联误替换
   */
  async function handleConfirm() {
    const base = keepMentionPrefix ? prompt : resolveMentions(prompt, mentionValues);
    const resolved = base.trim();

    // 仅当标签以 @ 提及形式出现时才视为「已使用」：避免裸文本（如「韩立」）被误判为引用，
    // 导致未 @ 的资产图片也被当作参考图上传。基于原始 prompt 检测（保留 @ 前缀）。
    // 「的」作为额外尾部边界，使「@韩立的风格」中的 @韩立 被识别为已引用。
    const usedFlags = effectiveImages.map((_, i) => {
      // 模板参考图（图片1）由 STYLE_REFERENCE_PHRASE「请严格参考此@图片1风格。」固定引用，
      // 「图片1」后接「风」非边界字符，边界检测会漏判，故开启参考图模式时首位始终视为已使用
      if (useImageRef && templateReferenceImage && i === 0) return true;
      return isMentionedInText(prompt, mentionValues[i], "的");
    });
    const hasUnused = effectiveImages.length > 0 && usedFlags.some((used) => !used);

    if (hasUnused) {
      const unusedLabels = mentionValues.filter((_, i) => !usedFlags[i]);
      const ok = await confirm({
        message: `检测到以下参考图未在提示词中使用：\n${unusedLabels.map((l) => `• ${l}`).join("\n")}\n是否继续？`,
        confirmText: "是",
        cancelText: "否",
        variant: "primary",
      });
      if (!ok) return;
    }

    let finalPrompt = resolved;
    let finalImages = effectiveImages;
    let finalImageLabels = effectiveLabels;

    if (hasUnused) {
      const filteredImages: string[] = [];
      const filteredLabels: string[] = [];
      const oldToNewIndex: number[] = [];
      effectiveImages.forEach((img, i) => {
        if (usedFlags[i]) {
          oldToNewIndex[i] = filteredImages.length;
          filteredImages.push(img);
          filteredLabels.push(effectiveLabels[i] ?? "");
        } else {
          oldToNewIndex[i] = -1;
        }
      });

      // 构建默认标签「图片N」的旧编号 -> 新编号映射（仅默认标签需要重编号；
      // 资产名 / 参考图N 等稳定标签由后续 replaceAssetTagsWithImageNos 按名称映射，无需在此重编号）
      const oldToNewNo = new Map<number, number>();
      for (let oldIdx = 0; oldIdx < effectiveImages.length; oldIdx++) {
        const newIdx = oldToNewIndex[oldIdx];
        if (newIdx === -1) continue;
        const oldLabel = mentionValues[oldIdx];
        const oldN = oldIdx + 1;
        const newN = newIdx + 1;
        if (oldLabel === `图片${oldN}` && oldN !== newN) {
          oldToNewNo.set(oldN, newN);
        }
      }
      // 单遍替换 图片N -> 图片{新编号}：基于原始编号查表，避免「从大到小顺序替换」造成级联误替换
      // （如 图片4->图片3 后，原有的 图片3 再被替换为 图片2，导致两个引用塌缩为同一编号）
      if (oldToNewNo.size > 0) {
        finalPrompt = finalPrompt.replace(/图片(\d+)/g, (m, numStr) => {
          const newN = oldToNewNo.get(parseInt(numStr, 10));
          return newN != null ? `图片${newN}` : m;
        });
      }

      finalImages = filteredImages;
      finalImageLabels = filteredLabels;
    }

    onConfirm({
      prompt: finalPrompt,
      images: finalImages,
      config,
      imageLabels: finalImageLabels,
    });
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        style={{
          position: "absolute",
          left: pos.x,
          top: pos.y,
          width: size.width,
          height: size.height,
        }}
        className="flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        {title && (
          <div
            onMouseDown={handleDragStart}
            className="flex cursor-move items-center justify-between border-b border-slate-200 px-5 py-3.5"
          >
            <h3 className="select-none text-base font-semibold text-slate-800">{title}</h3>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 transition-colors"
              aria-label="关闭"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-4">
        {extraHeader}
        {/* 提示词编辑区 */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-slate-600">
              提示词
              {effectiveImages.length > 0 && (
                <span className="ml-1 text-slate-400">（输入 @ 可引用参考图）</span>
              )}
            </label>
            <div className="flex items-center gap-2">
              {enablePresetPrompt && (
                <div className="group relative">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-brand-600 hover:bg-brand-50 hover:text-brand-700"
                    title="从预设库获取提示词文本"
                  >
                    <svg className="mr-0.5 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M12 8v8M8 12h8" />
                    </svg>
                    添加提示词
                    <svg className="ml-0.5 h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </Button>
                  <div className="absolute right-0 top-full z-50 hidden flex-col pt-1 group-hover:flex">
                    <div className="w-max min-w-[8rem] rounded-md border border-slate-100 bg-white py-1 shadow-lg">
                      <button
                        type="button"
                        onClick={() => setPresetPromptOpen(true)}
                        className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-brand-50 hover:text-brand-700"
                      >
                        从预设库获取
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {promptHeaderExtra}
              <AiActionsButton
                text={prompt}
                onResult={setPrompt}
                actions={PROMPT_AI_ACTIONS}
                onRunningChange={setAiRunning}
              />
              <span className={`text-xs ${promptLen > 300 ? "text-amber-500" : "text-slate-400"}`}>
                {promptLen} 字
              </span>
            </div>
          </div>
          <div className="relative">
            <div
              ref={overlayRef}
              aria-hidden
              className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-md border border-transparent px-3 py-2 text-sm leading-6 tracking-normal text-slate-700${hasScrollbar ? " [scrollbar-gutter:stable]" : ""}`}
            >
              <div style={{ transform: `translate(${-scrollPos.left}px, ${-scrollPos.top}px)` }}>
                {renderHighlightedText(prompt, mentionValues)}
              </div>
            </div>
            <textarea
              ref={textareaRef}
              value={prompt}
              readOnly={aiRunning}
              onChange={handleTextareaChange}
              onScroll={(e) => {
                const ta = e.currentTarget;
                setScrollPos({ top: ta.scrollTop, left: ta.scrollLeft });
              }}
              onBlur={handleTextareaBlur}
              onKeyDown={handleTextareaKeyDown}
              placeholder="描述要生成的图片内容，建议不超过 300 个汉字…"
              rows={4}
              className="block relative w-full resize-y rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm leading-6 tracking-normal text-transparent caret-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          {showDropdown && (
            <div
              style={{ top: dropdownPos.top, left: dropdownPos.left }}
              className="fixed z-50 min-w-[180px] max-w-[280px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
            >
              {filteredOptions.map((opt, i) => (
                <div
                  key={opt.value}
                  onMouseDown={(e) => handleDropdownMouseDown(e, opt)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-xs ${
                    i === mentionIndex
                      ? "bg-brand-50 text-brand-700"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={opt.src} alt={opt.label} className="h-6 w-6 rounded object-cover" />
                  <span className="font-medium text-amber-600">@</span>
                  {opt.label}
                </div>
              ))}
            </div>
          )}
          {templateReferenceImage && (
            <label className="mt-1.5 flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={useImageRef}
                onChange={(e) => {
                  const use = e.target.checked;
                  setUseImageRef(use);
                  setPrompt((prev) => rebuildWithSuffixes(stripKnownSuffixes(prev), useTemplate, use));
                }}
                className="h-3.5 w-3.5 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
              />
              <span className="text-xs text-slate-500">
                使用参考图（提示词参考）
                {useImageRef && (
                  <span className="ml-1 text-slate-400">（参考图作为图片1，提示词已拼接固定句）</span>
                )}
              </span>
            </label>
          )}
          {styleTemplate && (
            <label className="mt-1.5 flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={useTemplate}
                onChange={(e) => {
                  const use = e.target.checked;
                  setUseTemplate(use);
                  setPrompt((prev) => rebuildWithSuffixes(stripKnownSuffixes(prev), use, useImageRef));
                }}
                className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-xs text-slate-500">
                使用模板提示词
                {useTemplate && (
                  <span className="ml-1 truncate text-slate-400" title={styleTemplate}>
                    （{styleTemplate.slice(0, 40)}…）
                  </span>
                )}
              </span>
            </label>
          )}
          {promptFooterExtra && <div className="mt-1.5">{promptFooterExtra}</div>}
        </div>

        {/* 参考图上传（单图/多图生图） */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-slate-600">
              参考图 <span className="text-slate-400">（可选，支持单图/多图生图）</span>
            </label>
            <span className="text-xs text-slate-400">{effectiveImages.length}/{maxRefImages}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {effectiveImages.map((src, i) => {
              const isTemplateRef = useImageRef && templateReferenceImage && i === 0;
              return (
                <div
                  key={i}
                  className={`group relative h-16 w-16 overflow-hidden rounded-md border ${isTemplateRef ? "border-amber-400 ring-1 ring-amber-300" : "border-slate-200"}`}
                  title={mentionValues[i]}
                >
                  <ImageLightbox src={src} alt={mentionValues[i]} className="h-full w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={mentionValues[i]} className="h-full w-full object-cover" />
                  </ImageLightbox>
                  {isTemplateRef && (
                    <span className="absolute left-0 top-0 rounded-br bg-amber-500 px-1 text-[9px] font-medium text-white">
                      提示词参考
                    </span>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 truncate bg-black/55 px-1 text-[10px] text-white">
                    {mentionValues[i]}
                  </span>
                  {!isTemplateRef && (
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl-md bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      title="移除"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
            {effectiveImages.length < maxRefImages && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-slate-300 text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-500 disabled:opacity-50"
              >
                {uploading ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    <span className="text-[10px]">上传中</span>
                  </>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span className="text-[10px]">添加</span>
                  </>
                )}
              </button>
            )}
            {effectiveImages.length < maxRefImages && (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-brand-300 text-brand-500 transition-colors hover:border-brand-400 hover:bg-brand-50"
                title="从资产库选择已生成的图片"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                </svg>
                <span className="text-[10px]">资产库</span>
              </button>
            )}
          </div>
          {imgError && <p className="mt-1 text-xs text-red-500">{imgError}</p>}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/bmp,image/gif,image/tiff,image/heic,image/heif"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleAddFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* 高级参数（可折叠） */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-slate-600"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}
            >
              <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {showAdvanced ? "收起高级参数" : "高级参数"}
            {!showAdvanced && (
              <span className="max-w-[220px] truncate text-slate-500">
                {selectedImageOption?.entry.label ?? config.model} · {config.resolution} · {config.aspectRatio}
              </span>
            )}
          </button>
          {showAdvanced && (
            <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <ImageConfigFields
                value={config}
                onChange={update}
                imageOptions={imageOptions}
              />
            </div>
          )}
        </div>
        </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button
            onClick={() => {
              void handleConfirm();
            }}
            loading={loading}
            disabled={!canConfirm}
          >
            {confirmText}
          </Button>
        </div>
        {/* 右下角缩放手柄 */}
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 flex h-4 w-4 cursor-nwse-resize items-end justify-end text-slate-300 hover:text-slate-500"
          title="拖动缩放"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      <AssetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        mediaType="image"
        multiple
        selectedUrls={images}
        max={maxRefImages - (useImageRef && templateReferenceImage ? 1 : 0)}
        defaultSeriesId={defaultSeriesId}
        onConfirm={(items: PickedAssetItem[]) => {
          if (items.length > 0) {
            appendImages(
              items.map((i) => i.url),
              items.map((i) => i.name)
            );
          }
          setPickerOpen(false);
        }}
      />

      <PresetPicker
        open={presetPromptOpen}
        onClose={() => setPresetPromptOpen(false)}
        type="text"
        multiple
        onConfirm={(items: PickedPresetItem[]) => {
          const texts = items
            .map((i) => i.content ?? "")
            .filter((t) => t.trim());
          if (texts.length > 0) {
            const block = texts.join("\n");
            const base = stripKnownSuffixes(prompt);
            const newBase = base.trim() ? `${base.trim()}\n${block}` : block;
            setPrompt(rebuildWithSuffixes(newBase, useTemplate, useImageRef));
          }
          setPresetPromptOpen(false);
        }}
      />
    </div>,
    document.body
  );
}
