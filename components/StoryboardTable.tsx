"use client";

import { useMemo, useState } from "react";
import StoryboardRow from "./StoryboardRow";
import TagList from "./TagList";
import Button from "./ui/Button";
import Spinner from "./ui/Spinner";
import { SmartAddShotDialog } from "./SmartAddShotDialog";
import { useConfirm, useErrorDialog } from "./ui/ConfirmDialog";
import { callLLM } from "@/lib/llm-client";
import { taggingMessages, singleRowTaggingMessages, storyboardMessages } from "@/lib/prompts";
import { downloadJSON, extractTagItems, extractAllTags, extractTags, extractSingleTagText, ensureExistingTagsPrefixed, extractShots, toShot } from "@/lib/utils";
import { useSettingsMentionOptions } from "@/lib/use-settings-mention-options";
import type { Episode, Shot, WorldSettings, CharacterProfile, ObjectProfile, SceneProfile } from "@/lib/types";

interface StoryboardTableProps {
  episode: Episode;
  onUpdateShot: (id: string, field: keyof Shot, value: string) => void;
  /** 批量更新多个镜头的画面描述（用于智能标注） */
  onUpdateManyVisuals: (updates: { id: string; visualDescription: string }[]) => void;
  onAddRow: () => void;
  onAddSmartShot: (shot: Shot) => void;
  onDeleteRow: (id: string) => void;
  onMoveRow: (id: string, direction: "up" | "down") => void;
  onBackToStep1: () => void;
  onEnterStep3: () => void;
  /** 从所有分镜画面描述中移除某个标签的 @ 前缀（删除标注） */
  onRemoveTag?: (tagName: string) => void;
  /** 重新生成分镜：用全新 shots 替换现有分镜 */
  onReplaceShots?: (shots: Shot[]) => void;
  /** @ 选中某个设定时回调（用于自动加入资产准备） */
  onAtMentionSelect?: (value: string) => void;
  worldSettings?: WorldSettings | null;
  characterSettings?: CharacterProfile[] | null;
  objectSettings?: ObjectProfile[] | null;
  sceneSettings?: SceneProfile[] | null;
}

const COLUMNS = [
  { key: "duration", label: "时长", w: "80px" },
  { key: "visualDescription", label: "画面描述", w: "200px" },
  { key: "shotType", label: "景别", w: "100px" },
  { key: "lightingMood", label: "光影氛围", w: "130px" },
  { key: "dialogueVoiceover", label: "对白旁白", w: "150px" },
  { key: "soundEffects", label: "音效", w: "120px" },
  { key: "cameraMovement", label: "运镜", w: "100px" },
];

export default function StoryboardTable({
  episode,
  onUpdateShot,
  onUpdateManyVisuals,
  onAddRow,
  onAddSmartShot,
  onDeleteRow,
  onMoveRow,
  onBackToStep1,
  onEnterStep3,
  onRemoveTag,
  onReplaceShots,
  onAtMentionSelect,
  worldSettings,
  characterSettings,
  objectSettings,
  sceneSettings,
}: StoryboardTableProps) {
  const [tagging, setTagging] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [rowTaggingId, setRowTaggingId] = useState<string | null>(null);
  const [smartAddOpen, setSmartAddOpen] = useState(false);
  const confirm = useConfirm();
  const showError = useErrorDialog();

  // 当前已有标签（去重，按首次出现顺序）
  const tags = useMemo(() => extractAllTags(episode.shots), [episode.shots]);
  // 当前已有标签数（用于判断是否已标注过）
  const tagCount = tags.length;
  // 系列设定（人物/物品/场景/世界）@ 补全选项，与第一步一致
  const settingsOptions = useSettingsMentionOptions({ worldSettings, characterSettings, objectSettings, sceneSettings });
  // 画面描述 @ 补全选项：系列设定优先，再补齐已添加的标签，并允许新建
  const atMentionOptions = useMemo(() => {
    const seen = new Set<string>();
    const merged: { label: string; value: string }[] = [];
    for (const o of settingsOptions) {
      if (!seen.has(o.value)) {
        seen.add(o.value);
        merged.push(o);
      }
    }
    for (const t of tags) {
      if (!seen.has(t)) {
        seen.add(t);
        merged.push({ label: t, value: t });
      }
    }
    return merged;
  }, [settingsOptions, tags]);

  /** 智能标注：调用 LLM 给所有画面描述加 @标签 */
  async function handleTagging() {
    if (episode.shots.length === 0) return;
    setTagging(true);
    try {
      const raw = await callLLM(taggingMessages(episode.shots), {
        responseFormat: "json_object",
        temperature: 0.3,
      });
      const items = extractTagItems(raw);
      if (items.length === 0) {
        showError("标注失败：未能解析返回结果，请重试");
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
        showError("标注失败：未能匹配到镜头");
        return;
      }
      onUpdateManyVisuals(updates);
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setTagging(false);
    }
  }

  /** 单行智能标注：仅标注当前镜头，保留已有 @标签，仅补充新标签 */
  async function handleRowTagging(shot: Shot) {
    if (!shot.visualDescription?.trim()) return;
    setRowTaggingId(shot.id);
    try {
      // 1) 代码先标记已有标签：提取当前行已标注的 @标签，作为不可丢失的基线
      const existingTags = extractTags(shot.visualDescription);
      // 2) 让 LLM 在保留已有标签的前提下，仅补充尚未标注的新实体
      const raw = await callLLM(singleRowTaggingMessages(shot, existingTags, tags), {
        responseFormat: "json_object",
        temperature: 0.3,
      });
      const text = extractSingleTagText(raw);
      if (!text) {
        showError("标注失败：未能解析返回结果，请重试");
        return;
      }
      // 3) 代码兜底：确保已有标签仍带 @ 前缀（防止 LLM 误删）
      const finalText = ensureExistingTagsPrefixed(text, existingTags);
      onUpdateShot(shot.id, "visualDescription", finalText);
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setRowTaggingId(null);
    }
  }

  /** 重新生成分镜：基于当前扩写内容重新拆分镜头，覆盖现有分镜 */
  async function handleRegenerate() {
    if (!onReplaceShots) return;
    const content = episode.expandedContent.trim() || episode.originalContent.trim();
    if (!content) {
      showError("缺少扩写内容，无法重新生成分镜，请返回第一步补充内容");
      return;
    }
    if (episode.shots.length > 0) {
      const ok = await confirm({
        message: "重新生成分镜将覆盖当前所有镜头（含已编辑内容、@标注与资产关联），且无法撤销。确定继续吗？",
        confirmText: "重新生成",
      });
      if (!ok) return;
    }
    setRegenerating(true);
    try {
      const raw = await callLLM(storyboardMessages(content), {
        responseFormat: "json_object",
        temperature: 0.5,
      });
      const rawShots = extractShots(raw);
      if (rawShots.length === 0) {
        showError("未能解析出分镜，请重试或调整扩写内容");
        return;
      }
      const shots = rawShots.map(toShot);
      onReplaceShots(shots);
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setRegenerating(false);
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

  /** 删除镜头（二次确认） */
  async function handleDeleteShot(shotId: string, index: number) {
    const ok = await confirm({
      message: `确定删除镜头 ${index + 1} 吗？该镜头的画面描述及 @标注 将一并移除，且无法撤销。`,
      confirmText: "删除",
    });
    if (ok) onDeleteRow(shotId);
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
            variant="ghost"
            size="sm"
            onClick={handleRegenerate}
            loading={regenerating}
            disabled={!onReplaceShots || (!episode.expandedContent.trim() && !episode.originalContent.trim())}
            title="基于当前扩写内容重新拆分镜头"
          >
            {regenerating ? "重新生成中…" : "↻ 重新生成分镜"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTagging}
            loading={tagging}
            disabled={episode.shots.length === 0 || rowTaggingId !== null}
          >
            {tagging ? "标注中…" : "智能标注"}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport}>
            导出 JSON
          </Button>
          <Button size="sm" onClick={onEnterStep3}>
            下一步：资产准备 -&gt;
          </Button>
        </div>
      </div>

      {tagCount === 0 && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          提示：点击「智能标注」可自动识别画面描述中的人物、场景、物品，并用琥珀色 @标签 标注，作为第三步资产准备的建议来源；也可直接进入资产准备手动添加。
        </div>
      )}

      {/* 标签列表 */}
      <TagList tags={tags} onRemoveTag={onRemoveTag} title="已标注标签：" />

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
                onDelete={() => handleDeleteShot(shot.id, i)}
                onMove={(dir) => onMoveRow(shot.id, dir)}
                atMentionOptions={atMentionOptions}
                onAtMentionSelect={onAtMentionSelect}
                onTagRow={() => handleRowTagging(shot)}
                rowTagging={rowTaggingId === shot.id}
                tagDisabled={tagging || rowTaggingId !== null || !shot.visualDescription?.trim()}
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
        <Button variant="secondary" size="sm" onClick={() => setSmartAddOpen(true)}>
          ✨ 智能添加行
        </Button>
        {tagging && (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Spinner size={12} /> 正在标注…
          </span>
        )}
        {regenerating && (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Spinner size={12} /> 正在重新生成分镜…
          </span>
        )}
      </div>

      <p className="text-xs text-slate-400">
        提示：点击单元格可直接编辑；景别与运镜可选择或自行输入；在画面描述中输入 @ 可弹出已添加标签并选择，输入新名称即可新建标签；琥珀色 @标签 是第三步资产准备的依据，可由「智能标注」自动生成或手动添加。
      </p>

      <SmartAddShotDialog
        open={smartAddOpen}
        onClose={() => setSmartAddOpen(false)}
        onApply={onAddSmartShot}
        title="智能添加行"
        worldSettings={worldSettings}
        characterSettings={characterSettings}
        objectSettings={objectSettings}
        sceneSettings={sceneSettings}
      />
    </div>
  );
}
