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

/**
 * 构建系列设定（世界/人物/物品/场景）的 @ 补全选项。
 * 逻辑与第一步 ContentExpansion 完全一致：系列级优先，世界/人物设定缺失时回退全局。
 * 用于分镜生成页、视频编辑页的画面描述 @ 召唤已有设定资产。
 */
export function useSettingsMentionOptions(opts: {
  worldSettings?: WorldSettings | null;
  characterSettings?: CharacterProfile[] | null;
  objectSettings?: ObjectProfile[] | null;
  sceneSettings?: SceneProfile[] | null;
}): SettingsMentionOption[] {
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

  return useMemo(() => {
    const options: SettingsMentionOption[] = [];
    if (worldText.trim()) {
      options.push({ label: "[世界] 世界设定", value: "世界设定" });
    }
    latestCharacters.forEach((c) => options.push({ label: `[人物] ${c.name}`, value: c.name }));
    latestObjects.forEach((o) => options.push({ label: `[物品] ${o.name}`, value: o.name }));
    latestScenes.forEach((s) => options.push({ label: `[场景] ${s.name}`, value: s.name }));
    return options;
  }, [worldText, latestCharacters, latestObjects, latestScenes]);
}
