"use client";

import { useEffect, useRef, useState } from "react";
import Button from "./Button";
import { callLLM } from "@/lib/llm-client";
import { optimizeTextMessages } from "@/lib/prompts";
import type { LLMMessage } from "@/lib/types";

interface AiOptimizeButtonProps {
  text: string;
  onOptimized: (optimizedText: string) => void;
  disabled?: boolean;
  className?: string;
  onRunningChange?: (running: boolean) => void;
  /** 自定义提示词构造函数，默认使用通用文本润色 optimizeTextMessages */
  buildMessages?: (text: string) => LLMMessage[];
}

export default function AiOptimizeButton({
  text,
  onOptimized,
  disabled = false,
  className = "",
  onRunningChange,
  buildMessages = optimizeTextMessages,
}: AiOptimizeButtonProps) {
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  async function handleOptimize() {
    if (!text.trim()) return;
    setError(null);
    setOptimizing(true);
    onRunningChange?.(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await callLLM(buildMessages(text.trim()), {
        signal: controller.signal,
        temperature: 0.7,
      });
      if (mountedRef.current) onOptimized(result);
    } catch (e) {
      if (mountedRef.current && (e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : "优化失败，请重试");
      }
    } finally {
      if (mountedRef.current) {
        setOptimizing(false);
        onRunningChange?.(false);
      }
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  return (
    <div className={`inline-flex flex-col items-start ${className}`}>
      {optimizing ? (
        <Button variant="ghost" size="sm" onClick={handleStop} title="点击停止">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="mr-0.5 animate-spin" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          停止优化
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleOptimize}
          disabled={disabled || !text.trim()}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            className="mr-0.5"
          >
            <path
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M18.259 8.715L18 9.75l-.259-1.035a2.5 2.5 0 0 0-1.456-1.456L15.25 7l1.035-.259a2.5 2.5 0 0 0 1.456-1.456L18 4.25l.259 1.035a2.5 2.5 0 0 0 1.456 1.456L20.75 7l-1.035.259a2.5 2.5 0 0 0-1.456 1.456z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          AI 优化
        </Button>
      )}
      {error && (
        <span className="mt-0.5 max-w-[16rem] truncate text-xs text-red-500" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
