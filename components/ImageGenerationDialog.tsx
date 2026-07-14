"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import AiOptimizeButton from "./ui/AiOptimizeButton";
import { ImageConfigFields } from "./ImageConfigFields";
import { getImageModelCapability } from "@/lib/model-presets";
import type { AssetImageConfig, ImageGenSettings } from "@/lib/types";
import type { ModelEntry } from "@/lib/model-presets";

/** 弹框确认时回传的完整生成参数 */
export interface ImageGenerationParams {
  /** 最终提示词（已按需拼接风格模板） */
  prompt: string;
  /** 参考图列表（URL 或 base64 data URI） */
  images: string[];
  /** 图片生成配置 */
  config: AssetImageConfig;
}

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
  initialConfig,
  images,
  onImagesChange,
  onUploadFiles,
  provider,
  imageModels,
  title = "图片生成",
  confirmText = "生成图片",
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (params: ImageGenerationParams) => void;
  initialPrompt: string;
  styleTemplate?: string;
  initialConfig: AssetImageConfig;
  /** 参考图列表（受控：由父组件持有，弹框关闭后不丢失） */
  images: string[];
  /** 参考图变更回调（添加/移除时触发） */
  onImagesChange: (images: string[]) => void;
  /** 文件上传回调（上传到 COS 并返回 URL 列表）；未提供时回退为 base64 data URI */
  onUploadFiles?: (files: File[]) => Promise<string[]>;
  provider: ImageGenSettings["provider"];
  imageModels: ModelEntry[];
  title?: string;
  confirmText?: string;
  loading?: boolean;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [config, setConfig] = useState<AssetImageConfig>(initialConfig);
  const [useTemplate, setUseTemplate] = useState(!!styleTemplate);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // @ 提及状态
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const maxRefImages = getImageModelCapability(config.model, imageModels).maxRefImages;

  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt);
      setConfig(initialConfig);
      setUseTemplate(!!styleTemplate);
      setShowAdvanced(false);
      setImgError(null);
      setMentionQuery(null);
    }
  }, [open, initialPrompt, initialConfig, styleTemplate]);

  const update = (patch: Partial<AssetImageConfig>) =>
    setConfig((c) => ({ ...c, ...patch }));

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
    const slots = maxRefImages - images.length;
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
        onImagesChange([...images, ...newImages.filter(Boolean)]);
      }
    } catch (e) {
      setImgError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function removeImage(index: number) {
    onImagesChange(images.filter((_, i) => i !== index));
  }

  // ===== @ 提及：候选选项（基于已上传参考图） =====
  const mentionOptions = images.map((src, i) => ({
    label: `图片${i + 1}`,
    value: `图片${i + 1}`,
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

  /** 选中某个选项，将 @query 替换为「图片N 」 */
  function selectMention(opt: { label: string; value: string }) {
    if (!textareaRef.current) return;
    const ta = textareaRef.current;
    const cursor = ta.selectionStart ?? prompt.length;
    const textBefore = prompt.slice(0, cursor);
    const textAfter = prompt.slice(cursor);

    const atIdx = textBefore.lastIndexOf("@");
    if (atIdx === -1) return;

    const newText = textBefore.slice(0, atIdx) + opt.value + " " + textAfter;
    setPrompt(newText);
    setMentionQuery(null);

    const newCursor = atIdx + opt.value.length + 1;
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                prompt: useTemplate && styleTemplate
                  ? `${prompt.trim()}，${styleTemplate}`
                  : prompt.trim(),
                images,
                config,
              })
            }
            loading={loading}
            disabled={!canConfirm}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* 提示词编辑区 */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-slate-600">
              提示词
              {images.length > 0 && (
                <span className="ml-1 text-slate-400">（输入 @ 可引用参考图）</span>
              )}
            </label>
            <div className="flex items-center gap-2">
              <AiOptimizeButton text={prompt} onOptimized={setPrompt} />
              <span className={`text-xs ${promptLen > 300 ? "text-amber-500" : "text-slate-400"}`}>
                {promptLen} 字
              </span>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={handleTextareaChange}
            onBlur={handleTextareaBlur}
            onKeyDown={handleTextareaKeyDown}
            placeholder="描述要生成的图片内容，建议不超过 300 个汉字…"
            rows={4}
            className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
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
          {styleTemplate && (
            <label className="mt-1.5 flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={useTemplate}
                onChange={(e) => setUseTemplate(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-xs text-slate-500">
                附带漫剧风格模板
                {useTemplate && (
                  <span className="ml-1 truncate text-slate-400" title={styleTemplate}>
                    （{styleTemplate.slice(0, 40)}…）
                  </span>
                )}
              </span>
            </label>
          )}
        </div>

        {/* 参考图上传（单图/多图生图） */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-slate-600">
              参考图 <span className="text-slate-400">（可选，支持单图/多图生图）</span>
            </label>
            <span className="text-xs text-slate-400">{images.length}/{maxRefImages}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {images.map((src, i) => (
              <div key={i} className="group relative h-16 w-16 overflow-hidden rounded-md border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`参考图${i + 1}`} className="h-full w-full object-cover" />
                <span className="absolute bottom-0 left-0 bg-black/50 px-1 text-[10px] text-white">
                  {i + 1}
                </span>
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
              </div>
            ))}
            {images.length < maxRefImages && (
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
                {imageModels.find((m) => m.value === config.model)?.label ?? config.model} · {config.resolution} · {config.aspectRatio}
              </span>
            )}
          </button>
          {showAdvanced && (
            <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <ImageConfigFields
                value={config}
                onChange={update}
                provider={provider}
                imageModels={imageModels}
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
