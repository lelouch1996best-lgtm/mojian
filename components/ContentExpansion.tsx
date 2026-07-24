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
import { characterSettingsToText, getCharacterSettings, getLatestVersions } from "@/lib/character-settings";
import { objectSettingsToText, getLatestObjectVersions } from "@/lib/object-settings";
import { sceneSettingsToText, getLatestSceneVersions } from "@/lib/scene-settings";
import { extractShots, toShot, extractCharacters, toCharacterProfile } from "@/lib/utils";
import ExpansionContextModal, {
  type ExpansionContextSelection,
} from "./ExpansionContextModal";
import type {
  Shot,
  WorldSettings,
  CharacterProfile,
  ObjectProfile,
  SceneProfile,
  PreviousEpisodeContext,
} from "@/lib/types";

interface ContentExpansionProps {
  originalContent: string;
  expandedContent: string;
  /** 可选的前序剧集上下文列表，供扩写弹窗勾选（替换原自动拼接的 previousContext） */
  previousEpisodes?: PreviousEpisodeContext[];
  /** 系列级世界设定（优先使用，有值时不用全局） */
  worldSettings?: WorldSettings | null;
  /** 系列级人物设定（优先使用，有值时不用全局） */
  characterSettings?: CharacterProfile[] | null;
  /** 系列级物品设定 */
  objectSettings?: ObjectProfile[] | null;
  /** 系列级场景设定 */
  sceneSettings?: SceneProfile[] | null;
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
  previousEpisodes,
  worldSettings,
  characterSettings,
  objectSettings,
  sceneSettings,
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
  const [contextModalOpen, setContextModalOpen] = useState(false);
  const [globalWorldText, setGlobalWorldText] = useState("");
  const worldText = worldSettings ? worldSettingsToText(worldSettings) : globalWorldText;
  const [globalCharacters, setGlobalCharacters] = useState<CharacterProfile[]>([]);
  const effectiveCharacters = characterSettings ?? globalCharacters;

  useEffect(() => {
    if (!worldSettings) {
      getWorldSettings().then((ws) => setGlobalWorldText(worldSettingsToText(ws)));
    }
  }, [worldSettings]);

  useEffect(() => {
    if (!characterSettings) {
      getCharacterSettings().then(setGlobalCharacters);
    }
  }, [characterSettings]);
  const abortRef = useRef<AbortController | null>(null);

  const latestCharacters = useMemo(
    () => getLatestVersions(effectiveCharacters).filter((c) => c.name.trim()),
    [effectiveCharacters]
  );
  const latestObjects = useMemo(
    () => getLatestObjectVersions(objectSettings ?? []).filter((o) => o.name.trim()),
    [objectSettings]
  );
  const latestScenes = useMemo(
    () => getLatestSceneVersions(sceneSettings ?? []).filter((s) => s.name.trim()),
    [sceneSettings]
  );

  /** 将勾选的剧集按集序排列后拼接，并按约 3000 字上限截断（优先保留最近的剧集） */
  function buildPreviousContext(eps: PreviousEpisodeContext[]): string {
    const sorted = [...eps].sort((a, b) => a.orderIndex - b.orderIndex);
    const blocks = sorted.map((e) => `【第${e.orderIndex}集】\n${e.content}`);
    const ctx = blocks.join("\n\n");
    if (ctx.length <= 3000) return ctx;
    let truncated = "";
    for (let i = blocks.length - 1; i >= 0; i--) {
      const next = blocks[i] + (i < blocks.length - 1 ? "\n\n" : "") + truncated;
      if (next.length > 3000) break;
      truncated = blocks[i] + (i < blocks.length - 1 ? "\n\n" : "") + truncated;
    }
    return truncated || blocks[blocks.length - 1]?.slice(-3000) || "";
  }

  function handleExpand() {
    if (!originalContent.trim()) {
      setError("请先输入故事内容");
      return;
    }
    setError(null);
    const hasOptions =
      !!worldText.trim() ||
      latestCharacters.length > 0 ||
      latestObjects.length > 0 ||
      latestScenes.length > 0 ||
      (previousEpisodes?.length ?? 0) > 0;
    if (!hasOptions) {
      // 无可选上下文：跳过弹窗直接扩写
      runExpand({
        includeWorld: false,
        characterIds: [],
        objectIds: [],
        sceneIds: [],
        episodeIds: [],
      });
      return;
    }
    setContextModalOpen(true);
  }

  async function runExpand(sel: ExpansionContextSelection) {
    setContextModalOpen(false);
    setExpanding(true);
    onExpandedChange("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const world = sel.includeWorld ? worldText : "";
      const chars = latestCharacters.filter((c) => sel.characterIds.includes(c.id));
      const objs = latestObjects.filter((o) => sel.objectIds.includes(o.id));
      const scns = latestScenes.filter((s) => sel.sceneIds.includes(s.id));
      const prevCtx = buildPreviousContext(
        (previousEpisodes ?? []).filter((e) => sel.episodeIds.includes(e.id))
      );
      let acc = "";
      for await (const chunk of streamLLM(
        expansionMessages(
          originalContent,
          world,
          characterSettingsToText(chars),
          objectSettingsToText(objs),
          sceneSettingsToText(scns),
          prevCtx
        ),
        {
          signal: controller.signal,
          temperature: 0.8,
        }
      )) {
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
          <AiOptimizeButton
            text={originalContent}
            onOptimized={(v) => onOriginalChange(v)}
            disabled={expanding}
          />
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
          <AiOptimizeButton
            text={expandedContent}
            onOptimized={(v) => onExpandedChange(v)}
            disabled={expanding}
          />
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

      <ExpansionContextModal
        open={contextModalOpen}
        originalContent={originalContent}
        worldAvailable={!!worldText.trim()}
        characters={latestCharacters}
        objects={latestObjects}
        scenes={latestScenes}
        previousEpisodes={previousEpisodes ?? []}
        onConfirm={runExpand}
        onClose={() => setContextModalOpen(false)}
      />
    </div>
  );
}
