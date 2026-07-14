"use client";

import { useRef, useState } from "react";
import Button from "./Button";
import { streamLLM } from "@/lib/llm-client";
import { optimizeTextMessages } from "@/lib/prompts";

interface AiOptimizeButtonProps {
  text: string;
  onOptimized: (optimizedText: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function AiOptimizeButton({
  text,
  onOptimized,
  disabled = false,
  className = "",
}: AiOptimizeButtonProps) {
  const [optimizing, setOptimizing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function handleOptimize() {
    if (!text.trim()) return;
    setOptimizing(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let acc = "";
      for await (const chunk of streamLLM(optimizeTextMessages(text.trim()), {
        signal: controller.signal,
        temperature: 0.7,
      })) {
        acc += chunk;
        onOptimized(acc);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        // silently fail, user can retry
      }
    } finally {
      setOptimizing(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  if (optimizing) {
    return (
      <div className={`inline-flex items-center gap-1 ${className}`}>
        <Button variant="ghost" size="sm" onClick={handleStop}>
          停止优化
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleOptimize}
      disabled={disabled || !text.trim()}
      className={className}
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
  );
}
