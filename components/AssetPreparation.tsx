"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "./ui/Button";
import ImageLightbox from "./ImageLightbox";
import { useErrorDialog } from "./ui/ConfirmDialog";
import CharacterAssetCard from "./CharacterAssetCard";
import ObjectAssetCard from "./ObjectAssetCard";
import SceneAssetCard from "./SceneAssetCard";
import { callLLM, streamLLM } from "@/lib/llm-client";
import { generateImage, DEFAULT_ASSET_IMAGE_CONFIG, getDefaultAssetImageConfig, isPollingSupported, getAllConfiguredImageModels } from "@/lib/image-client";
import { recoverImageTasks } from "@/lib/image-task-recovery";
import { type ModelOption } from "@/lib/model-presets";
import { ImageGenerationDialog, type ImageGenerationParams } from "./ImageGenerationDialog";
import { assetMessages, regenerateAssetMessages } from "@/lib/prompts";
import { isCosConfigured, uploadRefBase64, uploadRefFile } from "@/lib/cos-client";
import { recordMediaAsset } from "@/lib/storage";
import { getActiveStyle, getAssetTemplate, getAssetReferenceImage, styleToText, styleTemplateForType } from "@/lib/style-settings";
import { characterSettingsToText, getCharacterSettings, getLatestVersions } from "@/lib/character-settings";
import { getLatestObjectVersions } from "@/lib/object-settings";
import { getLatestSceneVersions } from "@/lib/scene-settings";
import {
  extractAllTags,
  extractAssets,
  normalizeAssetType,
  ASSET_TYPE_LABELS,
  uuid,
} from "@/lib/utils";
import type { AssetImageConfig, Asset, AssetStatus, AssetType, CharacterProfile, Episode, ObjectProfile, SceneProfile, StyleSettings } from "@/lib/types";

interface AssetPreparationProps {
  episode: Episode;
  /** 所属企划标题（用于媒体资产账本记录） */
  seriesTitle?: string;
  onUpdateAsset: (id: string, field: keyof Asset, value: string) => void;
  onReplaceAssets: (assets: Asset[]) => void;
  /** 立即落盘当前 episode（绕过 1500ms 防抖）。用于 imageTaskId 等关键恢复字段，
   *  确保任务创建后即使立刻切路由/刷新，回来仍能恢复轮询。
   *  可传 mutate 基于快照构造补丁直写（组件卸载后仍有效）。 */
  onPersistNow?: (mutate?: (ep: Episode) => Episode) => void;
  onBackToStep2: () => void;
  /** 系列级风格设定设定（优先使用，不传则用全局） */
  seriesStyleSettings?: StyleSettings | null;
  /** 系列级人物设定（优先使用，不传则用全局） */
  characterSettings?: CharacterProfile[] | null;
  /** 保存人物设定（提取人物资产时调用） */
  onSaveCharacterSettings?: (characters: CharacterProfile[]) => void;
  /** 系列级物品设定 */
  objectSettings?: ObjectProfile[] | null;
  /** 保存物品设定（提取物品资产时调用） */
  onSaveObjectSettings?: (objects: ObjectProfile[]) => void;
  /** 系列级场景设定 */
  sceneSettings?: SceneProfile[] | null;
  /** 保存场景设定（提取场景资产时调用） */
  onSaveSceneSettings?: (scenes: SceneProfile[]) => void;
  /** 从所有分镜画面描述中移除某个标签的 @ 前缀（删除标注） */
  onRemoveTag?: (tagName: string) => void;
  /** 删除资产（同时清理分镜中的关联引用） */
  onDeleteAsset?: (assetId: string) => void;
}

const TYPE_OPTIONS: { value: AssetType; label: string }[] = [
  { value: "character", label: "人物" },
  { value: "scene", label: "场景" },
  { value: "object", label: "物品" },
];

const TYPE_BADGE_CLASS: Record<AssetType, string> = {
  character: "bg-[#FDF0E3] text-[#92400E]",
  scene: "bg-[#F7F8E8] text-[#4D7C0F]",
  object: "bg-[#FDF3E3] text-[#92400E]",
  screenshot: "bg-slate-100 text-slate-600",
  storyboard: "bg-amber-50 text-amber-700",
  generated: "bg-violet-50 text-violet-700",
};

/**
 * 根据标签列表，从人物/物品/场景设定中按名字匹配生成资产。
 * 匹配优先级：人物 > 物品 > 场景；同一标签只取首个命中类型，且跳过已存在的资产名。
 * 自动预填与「从设定中匹配添加」共用此逻辑。
 */
function buildAssetsFromSettings(
  tagNames: string[],
  existingNames: Set<string>,
  characterSettings: CharacterProfile[] | null | undefined,
  objectSettings: ObjectProfile[] | null | undefined,
  sceneSettings: SceneProfile[] | null | undefined,
): Asset[] {
  const charByName = new Map<string, CharacterProfile>();
  for (const c of getLatestVersions(characterSettings ?? [])) {
    if (c.name.trim()) charByName.set(c.name.trim().toLowerCase(), c);
  }
  const objectByName = new Map<string, ObjectProfile>();
  for (const o of getLatestObjectVersions(objectSettings ?? [])) {
    if (o.name.trim()) objectByName.set(o.name.trim().toLowerCase(), o);
  }
  const sceneByName = new Map<string, SceneProfile>();
  for (const s of getLatestSceneVersions(sceneSettings ?? [])) {
    if (s.name.trim()) sceneByName.set(s.name.trim().toLowerCase(), s);
  }
  const usedNames = new Set(existingNames);
  const matchedKeys = new Set<string>();
  const result: Asset[] = [];
  for (const tag of tagNames) {
    const key = tag.trim().toLowerCase();
    if (matchedKeys.has(key)) continue;
    let asset: Asset | null = null;
    const c = charByName.get(key);
    if (c) {
      asset = {
        id: crypto.randomUUID(),
        name: c.name.trim(),
        type: "character",
        description: c.appearance.trim(),
        imageUrl: c.imageUrl ?? "",
        status: (c.imageUrl ? "ready" : "pending") as AssetStatus,
      };
    } else {
      const o = objectByName.get(key);
      if (o) {
        asset = {
          id: crypto.randomUUID(),
          name: o.name.trim(),
          type: "object",
          description: o.appearance.trim(),
          imageUrl: o.imageUrl ?? "",
          status: (o.imageUrl ? "ready" : "pending") as AssetStatus,
        };
      } else {
        const s = sceneByName.get(key);
        if (s) {
          asset = {
            id: crypto.randomUUID(),
            name: s.name.trim(),
            type: "scene",
            description: s.appearance.trim(),
            imageUrl: s.imageUrl ?? "",
            status: (s.imageUrl ? "ready" : "pending") as AssetStatus,
          };
        }
      }
    }
    if (!asset) continue;
    if (usedNames.has(asset.name)) continue;
    usedNames.add(asset.name);
    matchedKeys.add(key);
    result.push(asset);
  }
  return result;
}

export default function AssetPreparation({
  episode,
  seriesTitle,
  onUpdateAsset,
  onReplaceAssets,
  onPersistNow,
  onBackToStep2,
  seriesStyleSettings,
  characterSettings,
  onSaveCharacterSettings,
  objectSettings,
  onSaveObjectSettings,
  sceneSettings,
  onSaveSceneSettings,
  onRemoveTag,
  onDeleteAsset,
}: AssetPreparationProps) {
  const [generating, setGenerating] = useState(false);
  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set());
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const showError = useErrorDialog();

  // 添加资产表单状态
  const [showAddCard, setShowAddCard] = useState(false);
  const [newAssetName, setNewAssetName] = useState("");
  const [newAssetType, setNewAssetType] = useState<AssetType>("character");
  // 添加模式：新建 / 从设定选择
  const [addMode, setAddMode] = useState<"new" | "select">("new");
  const [selectedSettingId, setSelectedSettingId] = useState("");

  // COS 配置（async）
  const [cosConfigured, setCosConfigured] = useState(false);
  useEffect(() => { isCosConfigured().then(setCosConfigured); }, []);

  // 当前所有镜头里的 @标签（去重，按首次出现顺序）
  const tags = useMemo(() => extractAllTags(episode.shots), [episode.shots]);

  // 第三步资产准备仅展示人物/场景/物品类型；截屏、故事板等资产不在第三步展示
  const preparationAssets = useMemo(
    () => episode.assets.filter((a) => a.type === "character" || a.type === "scene" || a.type === "object"),
    [episode.assets]
  );

  const [imageConfigured, setImageConfigured] = useState(false);
  // 所有「已配置 API Key」图片供应商的全部模型（聚合，供模型选择弹框使用）
  const [imageOptions, setImageOptions] = useState<ModelOption[]>([]);
  useEffect(() => {
    (async () => {
      // 任意供应商有 apiKey 即视为已配置（聚合所有已配置供应商的模型）
      const options = await getAllConfiguredImageModels();
      setImageOptions(options);
      setImageConfigured(options.length > 0);
    })();
    // 用户自定义的图片默认生成参数（每次打开弹框时作为基础）
    getDefaultAssetImageConfig().then(setDefaultImageConfig);
  }, []);

  // 组件级 AbortController：卸载（切步骤/路由离开/刷新）时取消所有进行中的图片生成轮询，
  // 避免孤儿轮询与重新挂载后的恢复轮询产生重复。
  // 同步初始化（而非在 useEffect 中创建），确保首次渲染即可向 generateImage 传递 signal。
  const abortRef = useRef<AbortController | null>(null);
  if (abortRef.current === null) abortRef.current = new AbortController();
  useEffect(() => {
    const ac = abortRef.current!;
    return () => ac.abort();
  }, []);

  // 始终指向最新 episode 的 ref，供恢复轮询的异步回调读取最新资产状态做去重/已完成判断，
  // 避免闭包捕获过期数据导致重复处理或漏处理。
  const episodeRef = useRef(episode);
  episodeRef.current = episode;

  // 进入 Step3 时，恢复未完成的资产生图任务订阅（刷新/切页后任务不丢失）。
  // 服务端任务中心负责轮询上游/COS 转存/容错，前端仅订阅本地任务状态；
  // 切页/卸载仅取消前端等待（cleanup abort），任务在服务端继续，imageTaskId 保留待下次恢复。
  const resumeRef = useRef(false);
  useEffect(() => {
    if (resumeRef.current) return;
    // 数据就绪守卫：图片配置异步加载完成后才执行（episode 由父页加载完成后才渲染本组件），
    // 防止空数据时消耗 run-once 守卫
    if (!imageConfigured || imageOptions.length === 0) return;
    resumeRef.current = true;
    const ac = new AbortController();

    // 切页/刷新回来后，立即根据 imageTaskId 恢复资产生成中占位。
    // 仅对有 imageTaskId 且 status==="pending" 的资产恢复（已完成的不显示）；
    // 不能用 imageUrl 判断——重新生成场景下资产带有旧图，会被误判跳过
    const pendingAssets = (episodeRef.current.assets ?? []).filter(
      (a) => a.imageTaskId && a.status === "pending"
    );
    if (pendingAssets.length > 0) {
      setGeneratingImageIds((prev) => {
        const next = new Set(prev);
        pendingAssets.forEach((a) => next.add(a.id));
        return next;
      });
    }

    // 仅对支持轮询的模型恢复（按创建任务时的供应商路由凭证）
    const entries = pendingAssets
      .filter((a) =>
        isPollingSupported(
          a.imageConfig?.model ?? imageOptions[0]?.entry.value ?? "",
          a.imageTaskProvider ?? a.imageConfig?.provider
        )
      )
      .map((a) => ({
        key: a.id,
        jobId: a.imageTaskId!,
        provider: a.imageTaskProvider ?? a.imageConfig?.provider,
      }));

    const clearPlaceholder = (assetId: string) =>
      setGeneratingImageIds((prev) => {
        const next = new Set(prev);
        next.delete(assetId);
        return next;
      });

    recoverImageTasks(entries, {
      onDone: (assetId, imageUrl) => {
        // 读取最新资产状态做去重判断（避免闭包捕获过期数据；切页期间原订阅可能已完成写回）
        // 注意必须同时检查 status：重新生成场景下资产带有旧图，仅看 imageUrl 会误杀本次恢复结果
        const latestAsset = episodeRef.current.assets.find((a) => a.id === assetId);
        if (!latestAsset) {
          clearPlaceholder(assetId);
          return;
        }
        if (latestAsset.status === "ready" && latestAsset.imageUrl) {
          // 已被其他路径完成，仅清理残留 taskId，不覆盖已写入的 COS 持久 URL
          onUpdateAsset(assetId, "imageTaskId", "");
          clearPlaceholder(assetId);
          return;
        }
        // imageUrl 已经服务端 COS 转存，直接写回，无需前端再转存
        onUpdateAsset(assetId, "imageUrl", imageUrl);
        onUpdateAsset(assetId, "status", "ready");
        onUpdateAsset(assetId, "imageTaskId", "");
        void recordMediaAsset({
          mediaType: "image",
          url: imageUrl,
          entityType: latestAsset.type,
          entityName: latestAsset.name || "未命名资产",
          prompt: latestAsset.description || "",
          source: "asset",
          seriesId: episode.seriesId,
          seriesTitle: seriesTitle ?? "",
          episodeId: episode.id,
          episodeTitle: episode.title,
        });
        clearPlaceholder(assetId);
      },
      onFailed: (assetId, error) => {
        // 仅真实失败（API 错误/超时）才回调：置 failed 并清除 imageTaskId；
        // 取消（切页/卸载）不回调，imageTaskId 保留待下次恢复
        onUpdateAsset(assetId, "status", "failed");
        onUpdateAsset(assetId, "imageTaskId", "");
        const name = episodeRef.current.assets.find((a) => a.id === assetId)?.name;
        showError(`「${name || "未命名资产"}」图片生成失败：${error}`);
        clearPlaceholder(assetId);
      },
    }, ac.signal);

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageConfigured, imageOptions]);

  // 图片生成弹框状态（单资产生成时使用）
  const [genTargetAssetId, setGenTargetAssetId] = useState<string | null>(null);
  const [genConfigOpen, setGenConfigOpen] = useState(false);
  const [genInitialPrompt, setGenInitialPrompt] = useState("");
  const [genStyleTemplate, setGenStyleTemplate] = useState<string | null>(null);
  const [genTemplateReferenceImage, setGenTemplateReferenceImage] = useState<string | null>(null);
  const [genImageConfig, setGenImageConfig] = useState<AssetImageConfig>(DEFAULT_ASSET_IMAGE_CONFIG);
  const [defaultImageConfig, setDefaultImageConfig] = useState<AssetImageConfig>(DEFAULT_ASSET_IMAGE_CONFIG);
  const [genInitialRefImages, setGenInitialRefImages] = useState<string[]>([]);

  // 人物设定文本（系列级优先，否则回退全局）
  const [globalCharacterText, setGlobalCharacterText] = useState("");
  const characterText = characterSettings
    ? characterSettingsToText(characterSettings)
    : globalCharacterText;
  useEffect(() => {
    if (!characterSettings) {
      getCharacterSettings().then((cs) =>
        setGlobalCharacterText(characterSettingsToText(cs))
      );
    }
  }, [characterSettings]);

  // 自动预填：进入 Step3 时，若尚无资产，按分镜 @标签从设定中预填人物/物品/场景资产卡片
  const didPrefill = useRef(false);
  useEffect(() => {
    if (didPrefill.current) return;
    const chars = getLatestVersions(characterSettings ?? []);
    if (chars.length === 0) return;
    if (preparationAssets.length > 0) return;
    didPrefill.current = true;
    const prefilled = buildAssetsFromSettings(tags, new Set(), characterSettings, objectSettings, sceneSettings);
    if (prefilled.length > 0) {
      // 保留已有的截屏/故事板等非资产准备类型资产
      const preserved = episode.assets.filter((a) => a.type === "screenshot" || a.type === "storyboard");
      onReplaceAssets([...prefilled, ...preserved]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterSettings, preparationAssets.length]);

  // 已有资产按 name 索引，判断哪些标签还没建资产
  const existingNames = useMemo(
    () => new Set(preparationAssets.map((a) => a.name)),
    [preparationAssets]
  );
  const missingTags = tags.filter((t) => !existingNames.has(t));

  // 可从设定中选择的列表（过滤掉已添加为资产的），按当前选择的类型动态切换
  const availableSettings = useMemo(() => {
    if (newAssetType === "character") {
      return getLatestVersions(characterSettings ?? [])
        .filter((c) => c.name.trim() && !existingNames.has(c.name.trim()))
        .map((c) => ({ id: c.id, label: c.name.trim(), sub: c.versionLabel || `v${c.version ?? 1}`, hasImage: !!c.imageUrl }));
    }
    if (newAssetType === "object") {
      return getLatestObjectVersions(objectSettings ?? [])
        .filter((o) => o.name.trim() && !existingNames.has(o.name.trim()))
        .map((o) => ({ id: o.id, label: o.name.trim(), sub: o.versionLabel || `v${o.version ?? 1}`, hasImage: !!o.imageUrl }));
    }
    return getLatestSceneVersions(sceneSettings ?? [])
      .filter((s) => s.name.trim() && !existingNames.has(s.name.trim()))
      .map((s) => ({ id: s.id, label: s.name.trim(), sub: s.versionLabel || `v${s.version ?? 1}`, hasImage: !!s.imageUrl }));
  }, [newAssetType, characterSettings, objectSettings, sceneSettings, existingNames]);

  // 按人物姓名索引所有版本（升序），用于人物资产卡片选择版本
  const characterVersionsByName = useMemo(() => {
    const map = new Map<string, CharacterProfile[]>();
    for (const c of characterSettings ?? []) {
      const key = c.name.trim();
      if (!key) continue;
      const arr = map.get(key);
      if (arr) arr.push(c);
      else map.set(key, [c]);
    }
    for (const arr of Array.from(map.values())) {
      arr.sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
    }
    return map;
  }, [characterSettings]);

  // 按物品姓名索引所有版本（升序），用于物品资产卡片选择版本
  const objectVersionsByName = useMemo(() => {
    const map = new Map<string, ObjectProfile[]>();
    for (const o of objectSettings ?? []) {
      const key = o.name.trim();
      if (!key) continue;
      const arr = map.get(key);
      if (arr) arr.push(o);
      else map.set(key, [o]);
    }
    for (const arr of Array.from(map.values())) {
      arr.sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
    }
    return map;
  }, [objectSettings]);

  // 按场景姓名索引所有版本（升序），用于场景资产卡片选择版本
  const sceneVersionsByName = useMemo(() => {
    const map = new Map<string, SceneProfile[]>();
    for (const s of sceneSettings ?? []) {
      const key = s.name.trim();
      if (!key) continue;
      const arr = map.get(key);
      if (arr) arr.push(s);
      else map.set(key, [s]);
    }
    for (const arr of Array.from(map.values())) {
      arr.sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
    }
    return map;
  }, [sceneSettings]);

  /** 把人物资产提取到人物设定（作为 v1 版本保存） */
  function handleExtractCharacter(asset: Asset) {
    if (!onSaveCharacterSettings) return;
    const newChar: CharacterProfile = {
      id: uuid(),
      characterId: uuid(),
      version: 1,
      versionLabel: "v1",
      name: asset.name.trim(),
      role: "",
      genderAge: "",
      appearance: asset.description.trim(),
      personality: "",
      background: "",
      relationships: "",
      imageUrl: asset.imageUrl || "",
    };
    onSaveCharacterSettings([...(characterSettings ?? []), newChar]);
  }

  /** 把物品资产提取到物品设定（作为 v1 版本保存） */
  function handleExtractObject(asset: Asset) {
    if (!onSaveObjectSettings) return;
    const newObj: ObjectProfile = {
      id: uuid(),
      objectId: uuid(),
      version: 1,
      versionLabel: "v1",
      name: asset.name.trim(),
      category: "",
      appearance: asset.description.trim(),
      purpose: "",
      origin: "",
      imageUrl: asset.imageUrl || "",
    };
    onSaveObjectSettings([...(objectSettings ?? []), newObj]);
  }

  /** 把场景资产提取到场景设定（作为 v1 版本保存） */
  function handleExtractScene(asset: Asset) {
    if (!onSaveSceneSettings) return;
    const newScene: SceneProfile = {
      id: uuid(),
      sceneId: uuid(),
      version: 1,
      versionLabel: "v1",
      name: asset.name.trim(),
      category: "",
      appearance: asset.description.trim(),
      lightingMood: "",
      origin: "",
      imageUrl: asset.imageUrl || "",
    };
    onSaveSceneSettings([...(sceneSettings ?? []), newScene]);
  }

  /** 一键生成：仅为未匹配到资产的标签生成提示词并创建资产，已有资产保持不变 */
  async function handleGenerateAll() {
    if (tags.length === 0) {
      showError("没有可用的标签，请先在第二步做智能标注");
      return;
    }
    if (missingTags.length === 0) {
      showError("所有标签均已匹配到资产，无需生成");
      return;
    }
    setGenerating(true);
    try {
      const styleText = styleToText(await getActiveStyle(seriesStyleSettings));
      const raw = await callLLM(assetMessages(missingTags, episode.expandedContent, styleText, characterText), {
        responseFormat: "json_object",
        temperature: 0.5,
      });
      const rawAssets = extractAssets(raw);
      if (rawAssets.length === 0) {
        showError("未能解析出资产，请重试");
        return;
      }
      // 匹配人物/物品/场景设定中的图片，为新生成的资产预填参考图
      const charImageByName = new Map<string, string>();
      for (const c of getLatestVersions(characterSettings ?? [])) {
        if (c.imageUrl) charImageByName.set(c.name.trim(), c.imageUrl);
      }
      const objectImageByName = new Map<string, string>();
      for (const o of getLatestObjectVersions(objectSettings ?? [])) {
        if (o.imageUrl) objectImageByName.set(o.name.trim(), o.imageUrl);
      }
      const sceneImageByName = new Map<string, string>();
      for (const s of getLatestSceneVersions(sceneSettings ?? [])) {
        if (s.imageUrl) sceneImageByName.set(s.name.trim(), s.imageUrl);
      }
      // 仅为未匹配标签创建新资产；跳过与已有资产重名的项，防止 LLM 输出偏差导致重复
      const newAssets: Asset[] = rawAssets
        .filter((r) => r.name && !existingNames.has(r.name!.trim()))
        .map((r) => {
          const name = r.name!.trim();
          const imageUrl = charImageByName.get(name) ?? objectImageByName.get(name) ?? sceneImageByName.get(name) ?? "";
          return {
            id: crypto.randomUUID(),
            name,
            type: normalizeAssetType(r.type),
            description: r.description ?? "",
            imageUrl,
            status: (imageUrl ? "ready" : "pending") as AssetStatus,
          };
        });
      if (newAssets.length === 0) {
        showError("未能生成新的资产，请重试");
        return;
      }
      // 保留全部已有资产，仅追加新生成的资产
      onReplaceAssets([...episode.assets, ...newAssets]);
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  /** 从设定中匹配添加：根据当前未建立资产的标签，按名字匹配人物/物品/场景设定并批量添加 */
  function handleMatchFromSettings() {
    if (missingTags.length === 0) {
      showError("所有标签均已匹配到资产，无需添加");
      return;
    }
    const newAssets = buildAssetsFromSettings(missingTags, existingNames, characterSettings, objectSettings, sceneSettings);
    if (newAssets.length === 0) {
      showError("未在设定中匹配到这些标签对应的人物/物品/场景");
      return;
    }
    onReplaceAssets([...episode.assets, ...newAssets]);
  }

  /** 重新生成单个资产的外貌/外观描述（流式） */
  async function handleRegenerateAsset(asset: Asset) {
    setRegeneratingIds((prev) => new Set(prev).add(asset.id));
    try {
      const style = await getActiveStyle(seriesStyleSettings);
      const styleText = styleTemplateForType(style, asset.type);
      const messages = regenerateAssetMessages(asset.name, asset.type, episode.expandedContent, styleText);
      let acc = "";
      for await (const chunk of streamLLM(messages, { temperature: 0.7 })) {
        acc += chunk;
        onUpdateAsset(asset.id, "description", acc);
      }
    } catch (e) {
      showError(`「${asset.name}」重新生成失败：${(e as Error).message}`);
    } finally {
      setRegeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(asset.id);
        return next;
      });
    }
  }

  /** 打开图片生成弹框（先做必要校验） */
  async function openGenerateImageDialog(asset: Asset) {
    if (!imageConfigured) {
      showError("未配置图片生成 API，请先前往「图片 API 设置」页配置");
      return;
    }
    const prompt = asset.description.trim() || asset.name.trim();
    const template = await getAssetTemplate(asset.type, seriesStyleSettings);
    setGenStyleTemplate(template);
    const refImage = await getAssetReferenceImage(asset.type, seriesStyleSettings);
    setGenTemplateReferenceImage(refImage ?? null);
    setGenInitialPrompt(prompt);
    // 合并默认配置 + 卡片级覆盖；若合并后模型所属供应商未配置 apiKey（不在 imageOptions 中），清空 model 让用户自选
    const merged: AssetImageConfig = { ...defaultImageConfig, ...(asset.imageConfig ?? {}) };
    const modelAvailable = !!merged.model && imageOptions.some(
      (o) => o.provider === merged.provider && o.entry.value === merged.model
    );
    setGenImageConfig(modelAvailable ? merged : { ...merged, model: "" });
    setGenInitialRefImages(asset.imageConfig?.referenceImages ?? []);
    setGenTargetAssetId(asset.id);
    setGenConfigOpen(true);
  }

  /** 单个资产生成图片（任务完成后服务端已转存 COS，前端无需再转存） */
  async function generateImageForAsset(asset: Asset, params: ImageGenerationParams) {
    setGeneratingImageIds((prev) => new Set(prev).add(asset.id));
    onUpdateAsset(asset.id, "status", "pending");
    try {
      // 弹框确认：提示词已由弹框处理（含风格模板），直接使用
      const prompt = params.prompt;
      const images = params.images.length > 0 ? params.images : undefined;
      const config = params.config;
      const result = await generateImage(prompt, config, images, (jobId) => {
        // 异步任务创建后立即持久化 jobId + imageTaskProvider，刷新页面后可恢复订阅（按 provider 路由凭证）
        onUpdateAsset(asset.id, "imageTaskId", jobId);
        if (config.provider) onUpdateAsset(asset.id, "imageTaskProvider", config.provider);
        // 立即落盘（mutation 直写）：提交在飞时切页，组件卸载后 setState 无效，
        // mutation 基于卸载前快照直写是 taskId 不丢的唯一保障
        onPersistNow?.((ep) => ({
          ...ep,
          assets: ep.assets.map((a) =>
            a.id === asset.id
              ? { ...a, imageTaskId: jobId, ...(config.provider ? { imageTaskProvider: config.provider } : {}) }
              : a
          ),
        }));
      }, abortRef.current?.signal, { cosPrefix: "ai-script/assets" });
      // imageUrl 已经服务端 COS 转存，直接写回
      onUpdateAsset(asset.id, "imageUrl", result.imageUrl);
      onUpdateAsset(asset.id, "status", "ready");
      onUpdateAsset(asset.id, "imageTaskId", "");

      void recordMediaAsset({
        mediaType: "image",
        url: result.imageUrl,
        entityType: asset.type,
        entityName: asset.name || "未命名资产",
        prompt: asset.description || "",
        source: "asset",
        seriesId: episode.seriesId,
        seriesTitle: seriesTitle ?? "",
        episodeId: episode.id,
        episodeTitle: episode.title,
      });
    } catch (e) {
      // 切页/卸载导致轮询被取消时，保留 imageTaskId 以便重新挂载后恢复；
      // 仅在真实失败（API 错误/超时）时置 failed 并清除 imageTaskId。
      // 注意：不依赖共享 abortRef.signal.aborted 判断——一旦组件卸载所有并发轮询共享的 signal 被 abort，
      // 真实失败（如上游返回 failed）也会被误判为"已取消"而静默，导致既不报错也不回写图片。
      const isAborted = (e as Error)?.name === "AbortError" || (e as Error)?.message === "已取消";
      if (!isAborted) {
        onUpdateAsset(asset.id, "status", "failed");
        onUpdateAsset(asset.id, "imageTaskId", "");
        showError(`「${asset.name}」图片生成失败：${(e as Error).message}`);
      }
    } finally {
      setGeneratingImageIds((prev) => {
        const next = new Set(prev);
        next.delete(asset.id);
        return next;
      });
    }
  }

  /** 本地上传图片到 COS 并回填到资产（已有图也可重新上传覆盖） */
  async function handleUploadImage(asset: Asset, file: File) {
    if (!cosConfigured) {
      showError("未配置 COS 存储，请先前往「设置」配置腾讯云 COS");
      return;
    }
    setUploadingIds((prev) => new Set(prev).add(asset.id));
    try {
      const url = await uploadRefFile(file, `asset-${asset.name || asset.id}`);
      onUpdateAsset(asset.id, "imageUrl", url);
      onUpdateAsset(asset.id, "status", "ready");
      onUpdateAsset(asset.id, "imageTaskId", "");
      void recordMediaAsset({
        mediaType: "image",
        url,
        entityType: asset.type,
        entityName: asset.name || "未命名资产",
        prompt: asset.description || "",
        source: "manual",
        seriesId: episode.seriesId,
        seriesTitle: seriesTitle ?? "",
        episodeId: episode.id,
        episodeTitle: episode.title,
      });
    } catch (e) {
      showError(`「${asset.name}」图片上传失败：${(e as Error).message}`);
    } finally {
      setUploadingIds((prev) => {
        const next = new Set(prev);
        next.delete(asset.id);
        return next;
      });
    }
  }

  /** 添加新资产（占位卡片表单提交） */
  function handleAddAsset() {
    const name = newAssetName.trim();
    if (!name) {
      showError("请输入资产名称");
      return;
    }
    if (episode.assets.some((a) => a.name === name)) {
      showError(`资产「${name}」已存在`);
      return;
    }
    const newAsset: Asset = {
      id: crypto.randomUUID(),
      name,
      type: newAssetType,
      description: "",
      imageUrl: "",
      status: "pending",
    };
    onReplaceAssets([...episode.assets, newAsset]);
    resetAddCard();
  }

  /** 从已有设定添加资产 */
  function handleAddFromSettings() {
    if (!selectedSettingId) {
      showError("请选择一个设定");
      return;
    }
    let newAsset: Asset | null = null;
    if (newAssetType === "character") {
      const c = getLatestVersions(characterSettings ?? []).find((x) => x.id === selectedSettingId);
      if (!c) return;
      newAsset = {
        id: crypto.randomUUID(),
        name: c.name.trim(),
        type: "character",
        description: c.appearance.trim(),
        imageUrl: c.imageUrl ?? "",
        status: (c.imageUrl ? "ready" : "pending") as AssetStatus,
      };
    } else if (newAssetType === "object") {
      const o = getLatestObjectVersions(objectSettings ?? []).find((x) => x.id === selectedSettingId);
      if (!o) return;
      newAsset = {
        id: crypto.randomUUID(),
        name: o.name.trim(),
        type: "object",
        description: o.appearance.trim(),
        imageUrl: o.imageUrl ?? "",
        status: (o.imageUrl ? "ready" : "pending") as AssetStatus,
      };
    } else {
      const s = getLatestSceneVersions(sceneSettings ?? []).find((x) => x.id === selectedSettingId);
      if (!s) return;
      newAsset = {
        id: crypto.randomUUID(),
        name: s.name.trim(),
        type: "scene",
        description: s.appearance.trim(),
        imageUrl: s.imageUrl ?? "",
        status: (s.imageUrl ? "ready" : "pending") as AssetStatus,
      };
    }
    if (!newAsset) return;
    if (episode.assets.some((a) => a.name === newAsset!.name)) {
      showError(`资产「${newAsset!.name}」已存在`);
      return;
    }
    onReplaceAssets([...episode.assets, newAsset]);
    resetAddCard();
  }

  /** 重置添加卡片状态 */
  function resetAddCard() {
    setNewAssetName("");
    setNewAssetType("character");
    setSelectedSettingId("");
    setAddMode("new");
    setShowAddCard(false);
  }

  return (
    <div className="space-y-4">
      {/* 顶栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBackToStep2}>
            ← 返回分镜
          </Button>
          <span className="text-sm text-slate-500">
            共 {tags.length} 个标签 · 已生成 {preparationAssets.length} 个资产
            {missingTags.length > 0 && (
              <span className="ml-2 text-amber-600">
                （{missingTags.length} 个标签待生成）
              </span>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!imageConfigured ? (
            <span className="inline-flex cursor-pointer items-center rounded-md border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-200" onClick={() => { window.location.href = "/settings"; }}>
              ⚠️ 图片 API 未配置，请前往「设置」页面
            </span>
          ) : (
            <span className="inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">✅ 图片 API 已配置</span>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleMatchFromSettings}
            disabled={missingTags.length === 0}
            title={missingTags.length === 0 ? "没有未匹配的标签" : "根据未匹配标签，从设定中批量添加人物/物品/场景"}
          >
            从设定中匹配添加
          </Button>
          <Button
            size="sm"
            onClick={handleGenerateAll}
            loading={generating}
            disabled={tags.length === 0 || missingTags.length === 0}
            title={missingTags.length === 0 ? "所有标签均已匹配到资产" : undefined}
          >
            {generating ? "生成中…" : missingTags.length === 0 ? "已全部生成" : "一键生成资产信息"}
          </Button>
        </div>
      </div>

      {/* 说明区 */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 text-xs leading-relaxed text-slate-600">
        <p className="mb-1 font-medium text-slate-700">第三步 · 资产准备</p>
        <p>
          系统已从第二步的分镜画面描述中识别出以下{" "}
          <span className="font-medium text-amber-700">@标签</span>。点击「一键生成资产信息」后，AI
          会为每个标签分类（人物/场景/物品）并生成用于图片生成的中文提示词。随后可对每个资产生成参考图片。
        </p>
      </div>

      {/* 标签预览 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-400">标签：</span>
        {tags.length === 0 ? (
          <span className="text-xs text-slate-400">无（请返回第二步做智能标注）</span>
        ) : (
          tags.map((t) => {
            const has = existingNames.has(t);
            return (
              <span
                key={t}
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                  has
                    ? "bg-amber-100 text-amber-800"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                @{t}
                {onRemoveTag && (
                  <button
                    type="button"
                    onClick={() => onRemoveTag(t)}
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-slate-400 hover:bg-slate-300 hover:text-red-600"
                    title={`移除「${t}」标注`}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </span>
            );
          })
        )}
      </div>

      {/* 资产卡片网格 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {preparationAssets.map((asset) => {
          const commonProps = {
            asset,
            onUpdate: (field: keyof Asset, value: string) => onUpdateAsset(asset.id, field, value),
            onDelete: onDeleteAsset ? () => onDeleteAsset(asset.id) : undefined,
            seriesId: episode.seriesId,
            isGenerating: generatingImageIds.has(asset.id),
            onGenerateImage: () => openGenerateImageDialog(asset),
            isUploading: uploadingIds.has(asset.id),
            onUploadImage: (file: File) => handleUploadImage(asset, file),
            isRegenerating: regeneratingIds.has(asset.id),
            onRegenerate: () => handleRegenerateAsset(asset),
          };

          if (asset.type === "character") {
            const versions = characterVersionsByName.get(asset.name.trim()) ?? [];
            return (
              <CharacterAssetCard
                key={asset.id}
                {...commonProps}
                versions={versions}
                onExtract={onSaveCharacterSettings ? () => handleExtractCharacter(asset) : undefined}
              />
            );
          }
          if (asset.type === "object") {
            const versions = objectVersionsByName.get(asset.name.trim()) ?? [];
            return (
              <ObjectAssetCard
                key={asset.id}
                {...commonProps}
                versions={versions}
                onExtract={onSaveObjectSettings ? () => handleExtractObject(asset) : undefined}
              />
            );
          }
          const versions = sceneVersionsByName.get(asset.name.trim()) ?? [];
          return (
            <SceneAssetCard
              key={asset.id}
              {...commonProps}
              versions={versions}
              onExtract={onSaveSceneSettings ? () => handleExtractScene(asset) : undefined}
            />
          );
        })}
        {/* 添加资产占位卡片 */}
        {!showAddCard ? (
          <button
            onClick={() => { setShowAddCard(true); }}
            className="group flex aspect-[4/3] min-h-[220px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white/60 text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-500"
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="text-xs font-medium">添加资产</span>
          </button>
        ) : (
          <div className="flex flex-col overflow-hidden rounded-xl border-2 border-dashed border-brand-400 bg-white shadow-sm">
            {/* 模式切换 */}
            <div className="flex border-b border-slate-200">
              <button
                type="button"
                onClick={() => { setAddMode("new"); setSelectedSettingId(""); }}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${addMode === "new" ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-50"}`}
              >
                新建资产
              </button>
              <button
                type="button"
                onClick={() => { setAddMode("select"); setNewAssetName(""); }}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${addMode === "select" ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-50"}`}
              >
                从设定选择
              </button>
            </div>
            {addMode === "new" ? (
              <>
                <div className="flex aspect-[4/3] items-center justify-center bg-slate-50">
                  <div className="flex flex-col items-center gap-2 px-4 text-center">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-brand-400">
                      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M12 10v6M9 13h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <span className="text-xs font-medium text-slate-500">新建资产</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2.5 p-3">
                  <div>
                    <label className="mb-0.5 block text-xs text-slate-400">资产名称</label>
                    <input
                      type="text"
                      value={newAssetName}
                      onChange={(e) => setNewAssetName(e.target.value)}
                      placeholder="如：小明、咖啡馆"
                      className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddAsset(); }}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-xs text-slate-400">类型</label>
                    <select
                      value={newAssetType}
                      onChange={(e) => setNewAssetType(e.target.value as AssetType)}
                      className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                    >
                      {TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" className="flex-1" onClick={handleAddAsset}>确认</Button>
                    <Button variant="ghost" size="sm" className="flex-1" onClick={resetAddCard}>取消</Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-2.5 p-3">
                <div>
                  <label className="mb-0.5 block text-xs text-slate-400">设定类型</label>
                  <select
                    value={newAssetType}
                    onChange={(e) => { setNewAssetType(e.target.value as AssetType); setSelectedSettingId(""); }}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                  >
                    {TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}设定</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-400">选择设定</label>
                  {availableSettings.length === 0 ? (
                    <p className="rounded-md bg-slate-50 px-2.5 py-2 text-xs text-slate-400">
                      暂无可选的{ASSET_TYPE_LABELS[newAssetType]}设定，或已全部添加
                    </p>
                  ) : (
                    <div className="max-h-48 space-y-1 overflow-y-auto">
                      {availableSettings.map((s) => (
                        <label
                          key={s.id}
                          className={`flex cursor-pointer items-center justify-between rounded-md border px-2.5 py-1.5 text-sm transition-colors ${selectedSettingId === s.id ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="setting-select"
                              value={s.id}
                              checked={selectedSettingId === s.id}
                              onChange={() => setSelectedSettingId(s.id)}
                              className="h-3.5 w-3.5"
                            />
                            {s.label}
                            <span className="text-xs text-slate-400">{s.sub}</span>
                          </span>
                          {s.hasImage && <span className="text-xs text-emerald-600">有图</span>}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" className="flex-1" onClick={handleAddFromSettings} disabled={!selectedSettingId}>确认添加</Button>
                  <Button variant="ghost" size="sm" className="flex-1" onClick={resetAddCard}>取消</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <ImageGenerationDialog
        open={genConfigOpen}
        onClose={() => setGenConfigOpen(false)}
        initialPrompt={genInitialPrompt}
        styleTemplate={genStyleTemplate ?? undefined}
        templateReferenceImage={genTemplateReferenceImage ?? undefined}
        initialConfig={genImageConfig}
        images={genInitialRefImages}
        onImagesChange={setGenInitialRefImages}
        imageOptions={imageOptions}
        loading={genTargetAssetId ? generatingImageIds.has(genTargetAssetId) : false}
        onConfirm={async (params) => {
          // 模型为空时直接提示，不关闭弹框，让用户在弹框中选择模型
          if (!params.config.model) {
            showError("未选择图片生成模型，请先在弹框中选择一个模型后再生成");
            return;
          }
          setGenConfigOpen(false);
          setGenImageConfig(params.config);

          const targetAsset = episode.assets.find((a) => a.id === genTargetAssetId);

          // 上传 base64 参考图到 COS，获取 URL 用于持久化
          // 注意：params.images 可能含风格模板参考图（http URL），持久化时需过滤，避免污染资产 referenceImages
          const refImageForFilter = genTemplateReferenceImage;
          let refUrls: string[] = [];
          if (params.images.length > 0) {
            if (cosConfigured) {
              refUrls = await Promise.all(
                params.images.map(async (img, i) => {
                  if (img.startsWith("http")) return img;
                  try {
                    return await uploadRefBase64(img, `ref-${targetAsset?.name ?? "asset"}-${i + 1}`);
                  } catch {
                    return img;
                  }
                })
              );
            } else {
              refUrls = params.images;
            }
          }
          // 数据隔离：剔除风格模板参考图，仅持久化用户自添加的参考图
          if (refImageForFilter) {
            refUrls = refUrls.filter((u) => u !== refImageForFilter);
          }

          if (genTargetAssetId) {
            const configWithRefs = { ...params.config, referenceImages: refUrls };
            onUpdateAsset(genTargetAssetId, "imageConfig" as keyof Asset, configWithRefs as unknown as string);
          }
          if (targetAsset) void generateImageForAsset(targetAsset, params);
        }}
      />
    </div>
  );
}
