"use client";

import { useMemo, useState } from "react";
import StoryboardRow from "./StoryboardRow";
import Button from "./ui/Button";
import Spinner from "./ui/Spinner";
import { callLLM } from "@/lib/llm-client";
import { taggingMessages } from "@/lib/prompts";
import { downloadJSON, extractTagItems, extractAllTags } from "@/lib/utils";
import type { Episode, Shot } from "@/lib/types";

interface StoryboardTableProps {
  episode: Episode;
  onUpdateShot: (id: string, field: keyof Shot, value: string) => void;
  /** 批量更新多个镜头的画面描述（用于智能标注） */
  onUpdateManyVisuals: (updates: { id: string; visualDescription: string }[]) => void;
  onAddRow: () => void;
  onDeleteRow: (id: string) => void;
  onMoveRow: (id: string, direction: "up" | "down") => void;
  onBackToStep1: () => void;
  onEnterStep3: () => void;
  /** 从所有分镜画面描述中移除某个标签的 @ 前缀（删除标注） */
  onRemoveTag?: (tagName: string) => void;
}

const COLUMNS = [
  { key: "duration", label: "时长", w: "80px" },
  { key: "visualDescription", label: "画面描述", w: "200px" },
  { key: "shotType", label: "景别", w: "90px" },
  { key: "lightingMood", label: "光影氛围", w: "130px" },
  { key: "dialogueVoiceover", label: "对白旁白", w: "150px" },
  { key: "soundEffects", label: "音效", w: "120px" },
  { key: "cameraMovement", label: "运镜", w: "90px" },
];

export default function StoryboardTable({
  episode,
  onUpdateShot,
  onUpdateManyVisuals,
  onAddRow,
  onDeleteRow,
  onMoveRow,
  onBackToStep1,
  onEnterStep3,
  onRemoveTag,
}: StoryboardTableProps) {
  const [tagging, setTagging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 当前已有标签（去重，按首次出现顺序）
  const tags = useMemo(() => extractAllTags(episode.shots), [episode.shots]);
  // 当前已有标签数（用于判断是否已标注过）
  const tagCount = tags.length;

  /** 智能标注：调用 LLM 给所有画面描述加 @标签 */
  async function handleTagging() {
    if (episode.shots.length === 0) return;
    setTagging(true);
    setError(null);
    try {
      const raw = await callLLM(taggingMessages(episode.shots), {
        responseFormat: "json_object",
        temperature: 0.3,
      });
      const items = extractTagItems(raw);
      if (items.length === 0) {
        setError("标注失败：未能解析返回结果，请重试");
        return;
      }
      const updates: { id: string; visualDescription: string }[] = [];
      for (const item of items) {
        const shot = episode.shots[item.index];
        if (shot && item.text) {
          updates.push({ id: shot.id, visualDescription: item.text });
        }
      }
      if (updates.length === 0) {
        setError("标注失败：未能匹配到镜头");
        return;
      }
      onUpdateManyVisuals(updates);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTagging(false);
    }
  }

  function handleExport() {
    const exportData = {
      title: episode.title,
      originalContent: episode.originalContent,
      expandedContent: episode.expandedContent,
      shots: episode.shots.map((s, i) => ({
        进号: i + 1,
        时长: s.duration,
        画面描述: s.visualDescription,
        景别: s.shotType,
        光影氛围: s.lightingMood,
        对白旁白: s.dialogueVoiceover,
        音效: s.soundEffects,
        运镜: s.cameraMovement,
      })),
    };
    const name = `${episode.title || "剧集"}_分镜.json`;
    downloadJSON(name, exportData);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBackToStep1}>
            ← 返回内容扩写
          </Button>
          <span className="text-sm text-slate-500">
            共 {episode.shots.length} 个镜头
            {tagCount > 0 && (
              <span className="ml-2 inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                已标注 {tagCount} 个资产
              </span>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTagging}
            loading={tagging}
            disabled={episode.shots.length === 0}
          >
            {tagging ? "标注中…" : "智能标注"}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport}>
            导出 JSON
          </Button>
          <Button size="sm" onClick={onEnterStep3} disabled={tagCount === 0}>
            下一步：资产准备 →
          </Button>
        </div>
      </div>

      {tagCount === 0 && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          提示：点击「智能标注」可自动识别画面描述中的人物、场景、物品，并用琥珀色 @标签 标注。标注完成后才能进入第三步资产准备。
        </div>
      )}

      {/* 标签列表 */}
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400">已标注标签：</span>
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
            >
              @{t}
              {onRemoveTag && (
                <button
                  type="button"
                  onClick={() => onRemoveTag(t)}
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-amber-400 hover:bg-amber-300 hover:text-red-600"
                  title={`移除「${t}」标注`}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="overflow-auto rounded-lg border border-slate-200 bg-white" style={{ maxHeight: "calc(100vh - 240px)" }}>
        <table className="border-collapse text-left">
          <thead className="sticky top-0 z-20">
            <tr className="bg-slate-100 text-xs font-semibold text-slate-600">
              <th className="sticky left-0 z-20 w-12 bg-slate-100 px-2 py-2.5 text-center">
                进号
              </th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className="whitespace-nowrap border-l border-slate-200 px-2 py-2.5"
                  style={{ minWidth: c.w }}
                >
                  {c.label}
                </th>
              ))}
              <th className="sticky right-0 z-20 w-20 bg-slate-100 px-2 py-2.5 text-center">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {episode.shots.map((shot, i) => (
              <StoryboardRow
                key={shot.id}
                shot={shot}
                index={i}
                isFirst={i === 0}
                isLast={i === episode.shots.length - 1}
                onUpdate={(field, value) => onUpdateShot(shot.id, field, value)}
                onDelete={() => onDeleteRow(shot.id)}
                onMove={(dir) => onMoveRow(shot.id, dir)}
              />
            ))}
            {episode.shots.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-sm text-slate-400">
                  暂无镜头，点击下方「添加行」手动新增，或返回第一步重新生成分镜
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onAddRow}>
          + 添加行
        </Button>
        {tagging && (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Spinner size={12} /> 正在标注…
          </span>
        )}
      </div>

      <p className="text-xs text-slate-400">
        提示：点击单元格可直接编辑；景别与运镜可下拉选择；画面描述中的琥珀色 @标签 由「智能标注」自动生成，是第三步资产准备的依据。
      </p>
    </div>
  );
}
