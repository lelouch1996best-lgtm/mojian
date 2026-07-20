"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "./ui/Button";
import AiOptimizeButton from "./ui/AiOptimizeButton";
import Textarea from "./ui/Textarea";
import { streamLLM, callLLM } from "@/lib/llm-client";
import {
  expansionMessages,
  storyboardMessages,
  extractCharacterMessages,
} from "@/lib/prompts";
import { worldSettingsToText, getWorldSettings } from "@/lib/world-settings";
import { characterSettingsToText, getCharacterSettings } from "@/lib/character-settings";
import { extractShots, toShot, extractCharacters, toCharacterProfile } from "@/lib/utils";
import type { Shot, WorldSettings, CharacterProfile } from "@/lib/types";

interface ContentExpansionProps {
  originalContent: string;
  expandedContent: string;
  /** 前几集的扩写内容（按序号拼接），用于 AI 扩写时保持剧情连贯 */
  previousContext?: string;
  /** 系列级世界设定（优先使用，有值时不用全局） */
  worldSettings?: WorldSettings | null;
  /** 系列级人物设定（优先使用，有值时不用全局） */
  characterSettings?: CharacterProfile[] | null;
  onOriginalChange: (v: string) => void;
  onExpandedChange: (v: string) => void;
  onShotsGenerated: (shots: Shot[]) => void;
  onEnterStep2: () => void;
  /** 提取人物设定后的回调，返回合并结果用于 UI 提示 */
  onCharactersExtracted?: (characters: CharacterProfile[]) => Promise<{ added: number; overwritten: number; total: number; skipped: number }>;
}

export default function ContentExpansion({
  originalContent,
  expandedContent,
  previousContext,
  worldSettings,
  characterSettings,
  onOriginalChange,
  onExpandedChange,
  onShotsGenerated,
  onEnterStep2,
  onCharactersExtracted,
}: ContentExpansionProps) {
  const [expanding, setExpanding] = useState(false);
  const [generatingBoard, setGeneratingBoard] = useState(false);
  const [extractingCharacters, setExtractingCharacters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [globalWorldText, setGlobalWorldText] = useState("");
  const worldText = worldSettings ? worldSettingsToText(worldSettings) : globalWorldText;
  const [globalCharacterText, setGlobalCharacterText] = useState("");
  const characterText = characterSettings
    ? characterSettingsToText(characterSettings)
    : globalCharacterText;

  useEffect(() => {
    if (!worldSettings) {
      getWorldSettings().then((ws) => setGlobalWorldText(worldSettingsToText(ws)));
    }
  }, [worldSettings]);

  useEffect(() => {
    if (!characterSettings) {
      getCharacterSettings().then((cs) =>
        setGlobalCharacterText(characterSettingsToText(cs))
      );
    }
  }, [characterSettings]);
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
      for await (const chunk of streamLLM(expansionMessages(originalContent, worldText, characterText, previousContext), {
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
      const raw = await callLLM(storyboardMessages(content), {
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

  async function handleExtractCharacters() {
    const content = expandedContent.trim();
    if (!content) {
      setError("请先扩写内容");
      return;
    }
    setError(null);
    setNotice(null);
    setExtractingCharacters(true);
    try {
      const raw = await callLLM(extractCharacterMessages(content), {
        responseFormat: "json_object",
        temperature: 0.4,
      });
      const rawChars = extractCharacters(raw);
      if (rawChars.length === 0) {
        setError("未能提取出人物，请重试或调整扩写内容");
        return;
      }
      const characters = rawChars
        .map(toCharacterProfile)
        .filter((c) => c.name.trim());
      if (characters.length === 0) {
        setError("未能提取出有效人物");
        return;
      }
      if (onCharactersExtracted) {
        const result = await onCharactersExtracted(characters);
        const parts: string[] = [];
        if (result.added > 0) parts.push(`新增 ${result.added} 个`);
        if (result.overwritten > 0) parts.push(`覆盖 ${result.overwritten} 个`);
        if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 个`);
        if (parts.length > 0) {
          setNotice(`人物设定已更新：${parts.join("，")}（共 ${result.total} 条记录）`);
        } else {
          setNotice(`提取了 ${characters.length} 个人物，但全部已存在，未重复添加`);
        }
      } else {
        setNotice(`已提取 ${characters.length} 个人物设定`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExtractingCharacters(false);
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
          <AiOptimizeButton
            text={originalContent}
            onOptimized={(v) => onOriginalChange(v)}
            disabled={expanding}
          />
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
            variant="ghost"
            onClick={handleExtractCharacters}
            loading={extractingCharacters}
            disabled={expanding || !expandedContent.trim()}
          >
            提取人物设定
          </Button>
          <AiOptimizeButton
            text={expandedContent}
            onOptimized={(v) => onExpandedChange(v)}
            disabled={expanding}
          />
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

      {notice && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      )}
    </div>
  );
}
