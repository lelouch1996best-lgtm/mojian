import { useEffect, useMemo, useState } from "react";
import type { WorldSettings, CharacterProfile, ObjectProfile, SceneProfile } from "@/lib/types";
import { worldSettingsToText, getWorldSettings } from "@/lib/world-settings";
import { getCharacterSettings, getLatestVersions } from "@/lib/character-settings";
import { getLatestObjectVersions } from "@/lib/object-settings";
import { getLatestSceneVersions } from "@/lib/scene-settings";

export interface SettingsMentionOption {
  label: string;
  value: string;
}

export interface SettingsMentionData {
  /** @ 补全选项（[世界]/[人物]/[物品]/[场景] 前缀） */
  options: SettingsMentionOption[];
  /** 世界设定文本（系列级优先，缺失时回退全局） */
  worldText: string;
  /** 人物设定最新版本（系列级优先，缺失时回退全局） */
  latestCharacters: CharacterProfile[];
  /** 物品设定最新版本 */
  latestObjects: ObjectProfile[];
  /** 场景设定最新版本 */
  latestScenes: SceneProfile[];
}

/**
 * 构建系列设定（世界/人物/物品/场景）的 @ 补全选项，并暴露中间数据供其他用途复用。
 * 逻辑：系列级优先，世界/人物设定缺失时回退全局。
 * 用于内容扩写、分镜生成页、视频编辑页的画面描述 @ 召唤已有设定资产。
 */
export function useSettingsMentionOptions(opts: {
  worldSettings?: WorldSettings | null;
  characterSettings?: CharacterProfile[] | null;
  objectSettings?: ObjectProfile[] | null;
  sceneSettings?: SceneProfile[] | null;
}): SettingsMentionData {
  const { worldSettings, characterSettings, objectSettings, sceneSettings } = opts;

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

  const latestCharacters = useMemo(
    () => getLatestVersions(effectiveCharacters).filter((c) => c.name.trim()),
    [effectiveCharacters],
  );
  const latestObjects = useMemo(
    () => getLatestObjectVersions(objectSettings ?? []).filter((o) => o.name.trim()),
    [objectSettings],
  );
  const latestScenes = useMemo(
    () => getLatestSceneVersions(sceneSettings ?? []).filter((s) => s.name.trim()),
    [sceneSettings],
  );

  const options = useMemo(() => {
    const list: SettingsMentionOption[] = [];
    if (worldText.trim()) {
      list.push({ label: "[世界] 世界设定", value: "世界设定" });
    }
    latestCharacters.forEach((c) => list.push({ label: `[人物] ${c.name}`, value: c.name }));
    latestObjects.forEach((o) => list.push({ label: `[物品] ${o.name}`, value: o.name }));
    latestScenes.forEach((s) => list.push({ label: `[场景] ${s.name}`, value: s.name }));
    return list;
  }, [worldText, latestCharacters, latestObjects, latestScenes]);

  return { options, worldText, latestCharacters, latestObjects, latestScenes };
}
