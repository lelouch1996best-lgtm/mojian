"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "./ui/Button";
import Textarea from "./ui/Textarea";
import { streamLLM, callLLM } from "@/lib/llm-client";
import {
  expansionMessages,
  storyboardMessages,
} from "@/lib/prompts";
import { worldSettingsToText, getWorldSettings } from "@/lib/world-settings";
import { extractShots, toShot } from "@/lib/utils";
import type { Shot, WorldSettings } from "@/lib/types";

interface ContentExpansionProps {
  originalContent: string;
  expandedContent: string;
  /** 前几集的扩写内容（按序号拼接），用于 AI 扩写时保持剧情连贯 */
  previousContext?: string;
  /** 系列级世界设定（优先使用，有值时不用全局） */
  worldSettings?: WorldSettings | null;
  onOriginalChange: (v: string) => void;
  onExpandedChange: (v: string) => void;
  onShotsGenerated: (shots: Shot[]) => void;
  onEnterStep2: () => void;
}

export default function ContentExpansion({
  originalContent,
  expandedContent,
  previousContext,
  worldSettings,
  onOriginalChange,
  onExpandedChange,
  onShotsGenerated,
  onEnterStep2,
}: ContentExpansionProps) {
  const [expanding, setExpanding] = useState(false);
  const [generatingBoard, setGeneratingBoard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalWorldText, setGlobalWorldText] = useState("");
  const worldText = worldSettings ? worldSettingsToText(worldSettings) : globalWorldText;

  useEffect(() => {
    if (!worldSettings) {
      getWorldSettings().then((ws) => setGlobalWorldText(worldSettingsToText(ws)));
    }
  }, [worldSettings]);
  const abortRef = useRef<AbortController | null>(null);

  async function handleExpand() {
    if (!originalContent.trim()) {
      setError("请先输入故事内容");
      return;
    }
    setError(null);
    setExpanding(true);
    onExpandedChange("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let acc = "";
      for await (const chunk of streamLLM(expansionMessages(originalContent, worldText, previousContext), {
        signal: controller.signal,
        temperature: 0.8,
      })) {
        acc += chunk;
        onExpandedChange(acc);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
      }
    } finally {
      setExpanding(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  async function handleGenerateStoryboard() {
    const content = expandedContent.trim() || originalContent.trim();
    if (!content) {
      setError("请先输入或扩写内容");
      return;
    }
    setError(null);
    setGeneratingBoard(true);
    try {
      const raw = await callLLM(storyboardMessages(content, worldText), {
        responseFormat: "json_object",
        temperature: 0.5,
      });
      const rawShots = extractShots(raw);
      if (rawShots.length === 0) {
        setError("未能解析出分镜，请重试或调整扩写内容");
        return;
      }
      const shots = rawShots.map(toShot);
      onShotsGenerated(shots);
      onEnterStep2();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGeneratingBoard(false);
    }
  }

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            第一步 · 输入故事内容
          </h2>
        </div>
        <Textarea
          value={originalContent}
          onChange={(e) => onOriginalChange(e.target.value)}
          placeholder="输入你的故事大概、剧情梗概、想要表达的内容…&#10;例如：一个雨天，女孩在咖啡馆等一个不会来的人，窗外雨声渐大，她慢慢喝完最后一口咖啡。"
          rows={5}
          className="min-h-[120px] leading-relaxed"
          disabled={expanding}
        />
        <div className="mt-2 flex items-center gap-2">
          <Button onClick={handleExpand} loading={expanding} disabled={!originalContent.trim()}>
            AI 扩写
          </Button>
          {expanding && (
            <Button variant="ghost" onClick={handleStop}>
              停止
            </Button>
          )}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            扩写结果 <span className="text-xs font-normal text-slate-400">（可编辑）</span>
          </h2>
        </div>
        <Textarea
          value={expandedContent}
          onChange={(e) => onExpandedChange(e.target.value)}
          placeholder={expanding ? "正在生成…" : "扩写后的内容将显示在这里，你可以手动修改"}
          rows={10}
          className="min-h-[200px] leading-relaxed"
          disabled={expanding}
        />
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleGenerateStoryboard}
            loading={generatingBoard}
            disabled={expanding || (!expandedContent.trim() && !originalContent.trim())}
          >
            生成分镜 →
          </Button>
          <span className="text-xs text-slate-400">
            将根据扩写内容自动拆分为镜头
          </span>
        </div>
      </section>

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}
