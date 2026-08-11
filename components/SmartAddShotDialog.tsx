"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import AtMentionTextarea, { type AtMentionOption } from "./AtMentionTextarea";
import { callLLM } from "@/lib/llm-client";
import { smartShotMessages } from "@/lib/prompts";
import { worldSettingsToText } from "@/lib/world-settings";
import { getLatestVersions } from "@/lib/character-settings";
import { getLatestObjectVersions } from "@/lib/object-settings";
import { getLatestSceneVersions } from "@/lib/scene-settings";
import { extractShots, toShot, extractTags, ensureExistingTagsPrefixed } from "@/lib/utils";
import type { Shot, WorldSettings, CharacterProfile, ObjectProfile, SceneProfile } from "@/lib/types";

interface SmartAddShotDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (shot: Shot) => void;
  title?: string;
  worldSettings?: WorldSettings | null;
  characterSettings?: CharacterProfile[] | null;
  objectSettings?: ObjectProfile[] | null;
  sceneSettings?: SceneProfile[] | null;
  /** @ 选中某个设定时回调（用于自动加入资产准备） */
  onAtMentionSelect?: (value: string) => void;
}

export function SmartAddShotDialog({
  open,
  onClose,
  onApply,
  title = "智能添加镜头",
  worldSettings,
  characterSettings,
  objectSettings,
  sceneSettings,
  onAtMentionSelect,
}: SmartAddShotDialogProps) {
  const [content, setContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const atMentionOptions: AtMentionOption[] = useMemo(() => {
    const worldText = worldSettings ? worldSettingsToText(worldSettings) : "";
    const options: AtMentionOption[] = [];
    if (worldText.trim()) {
      options.push({ label: "[世界] 世界设定", value: "世界设定" });
    }
    const latestCharacters = getLatestVersions(characterSettings ?? []).filter((c) => c.name.trim());
    const latestObjects = getLatestObjectVersions(objectSettings ?? []).filter((o) => o.name.trim());
    const latestScenes = getLatestSceneVersions(sceneSettings ?? []).filter((s) => s.name.trim());
    latestCharacters.forEach((c) => options.push({ label: `[人物] ${c.name}`, value: c.name }));
    latestObjects.forEach((o) => options.push({ label: `[物品] ${o.name}`, value: o.name }));
    latestScenes.forEach((s) => options.push({ label: `[场景] ${s.name}`, value: s.name }));
    return options;
  }, [worldSettings, characterSettings, objectSettings, sceneSettings]);

  useEffect(() => {
    if (open) {
      setContent("");
      setError(null);
      setGenerating(false);
    }
  }, [open]);

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
    const trimmed = content.trim();
    if (!trimmed || generating) return;
    setGenerating(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const raw = await callLLM(smartShotMessages(trimmed), {
        responseFormat: "json_object",
        temperature: 0.5,
        signal: controller.signal,
      });
      const rawShots = extractShots(raw);
      if (rawShots.length === 0) {
        setError("未解析到有效镜头数据，请重试");
        return;
      }
      const shot = toShot(rawShots[0]);
      const inputTags = extractTags(trimmed);
      if (inputTags.length > 0 && shot.visualDescription) {
        shot.visualDescription = ensureExistingTagsPrefixed(
          shot.visualDescription,
          inputTags,
        );
      }
      onApply(shot);
      onClose();
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setError((e as Error)?.message || "生成失败");
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [content, generating, onApply, onClose]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`✨ ${title}`}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={generating}>
            取消
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!content.trim()}
            loading={generating}
          >
            {generating ? "生成中…" : "生成并添加"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            镜头内容描述（可简写，AI 会自动扩写并补全时长、画面描述、景别等全部字段）
          </label>
          <AtMentionTextarea
            value={content}
            onChange={setContent}
            options={atMentionOptions}
            allowCreateTag
            onAtMentionSelect={onAtMentionSelect}
            disabled={generating}
            rows={6}
            placeholder="例如：主角推开木门走进昏暗的房间，发现桌上放着一封旧信"
            className="disabled:bg-slate-50"
          />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <p className="text-xs text-slate-400">
          提示：输入简短的镜头内容，AI 将扩写为完整画面并自动生成时长、画面描述、景别、光影氛围、对白旁白、音效、运镜等全部字段。
        </p>
      </div>
    </Modal>
  );
}

export default SmartAddShotDialog;
