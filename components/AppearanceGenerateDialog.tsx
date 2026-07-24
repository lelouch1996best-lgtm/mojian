"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { streamLLM } from "@/lib/llm-client";
import { generateAppearanceMessages } from "@/lib/prompts";

interface AppearanceGenerateDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (result: string) => void;
  initialPrompt: string;
  entityType: "character" | "object" | "scene";
}

export function AppearanceGenerateDialog({
  open,
  onClose,
  onApply,
  initialPrompt,
  entityType,
}: AppearanceGenerateDialogProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [result, setResult] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fieldLabel = entityType === "character" ? "外貌" : "外观";

  // 打开时重置为初始提示词与空结果
  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt);
      setResult("");
      setError(null);
      setGenerating(false);
    }
  }, [open, initialPrompt]);

  // 卸载/关闭时中断进行中的流
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleClose = useCallback(() => {
    if (generating) return;
    onClose();
  }, [generating, onClose]);

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || generating) return;
    setGenerating(true);
    setError(null);
    setResult("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let acc = "";
      for await (const chunk of streamLLM(
        generateAppearanceMessages(trimmed, entityType),
        { signal: controller.signal, temperature: 0.8 }
      )) {
        acc += chunk;
        setResult(acc);
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setError((e as Error)?.message || "生成失败");
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [prompt, generating, entityType]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleApply = useCallback(() => {
    const trimmed = result.trim();
    if (!trimmed || generating) return;
    onApply(trimmed);
  }, [result, generating, onApply]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`✨ 随机生成${fieldLabel}`}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={generating}>
            取消
          </Button>
          {generating ? (
            <Button variant="secondary" onClick={handleStop}>
              停止生成
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={handleGenerate}
              disabled={!prompt.trim()}
            >
              {result.trim() ? "重新生成" : `生成${fieldLabel}`}
            </Button>
          )}
          <Button onClick={handleApply} disabled={!result.trim() || generating}>
            应用
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            提示词（可编辑）
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={generating}
            rows={6}
            placeholder="从卡片字段自动提取的信息，可在此编辑后生成…"
            className="block w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            生成结果
            {generating && (
              <span className="ml-1.5 text-brand-500">生成中…</span>
            )}
          </label>
          <textarea
            value={result}
            onChange={(e) => setResult(e.target.value)}
            readOnly={generating}
            rows={6}
            placeholder={
              generating
                ? "正在生成…"
                : `点击下方「生成${fieldLabel}」按钮，结果将显示在此处，可编辑后应用`
            }
            className="block w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 read-only:bg-slate-50"
          />
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </Modal>
  );
}
