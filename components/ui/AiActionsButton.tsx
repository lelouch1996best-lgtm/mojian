"use client";

import { useEffect, useRef, useState } from "react";
import Button from "./Button";
import { callLLM } from "@/lib/llm-client";
import type { LLMMessage } from "@/lib/types";

export interface AiAction {
  key: string;
  label: string;
  buildMessages: (text: string) => LLMMessage[];
  temperature?: number;
}

interface AiActionsButtonProps {
  text: string;
  onResult: (result: string) => void;
  actions: AiAction[];
  disabled?: boolean;
  className?: string;
  triggerLabel?: string;
  onRunningChange?: (running: boolean) => void;
}

export default function AiActionsButton({
  text,
  onResult,
  actions,
  disabled = false,
  className = "",
  triggerLabel = "AI 优化",
  onRunningChange,
}: AiActionsButtonProps) {
  const [runningKey, setRunningKey] = useState<string | null>(null);
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

  const runningAction = actions.find((a) => a.key === runningKey) ?? null;
  const idleDisabled = disabled || !text.trim();

  async function runAction(action: AiAction) {
    if (!text.trim()) return;
    setError(null);
    setRunningKey(action.key);
    onRunningChange?.(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await callLLM(action.buildMessages(text.trim()), {
        signal: controller.signal,
        temperature: action.temperature ?? 0.7,
      });
      if (mountedRef.current) onResult(result);
    } catch (e) {
      if (mountedRef.current && (e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : `${action.label}失败，请重试`);
      }
    } finally {
      if (mountedRef.current) {
        setRunningKey(null);
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
      {runningAction ? (
        <Button variant="ghost" size="sm" onClick={handleStop} title={`正在${runningAction.label}…，点击停止`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="mr-0.5 animate-spin" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          停止{runningAction.label}
        </Button>
      ) : (
        <div className="group relative">
          <Button
            variant="ghost"
            size="sm"
            disabled={idleDisabled}
            title="AI 文本工具"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="mr-0.5">
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
            {triggerLabel}
            <svg className="ml-0.5 h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </Button>
          {!idleDisabled && (
            <div className="absolute right-0 top-full z-50 hidden flex-col pt-1 group-hover:flex">
              <div className="w-max min-w-[8rem] rounded-md border border-slate-100 bg-white py-1 shadow-lg">
                {actions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    onClick={() => runAction(action)}
                    className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-brand-50 hover:text-brand-700"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {error && (
        <span className="mt-0.5 max-w-[16rem] truncate text-xs text-red-500" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
