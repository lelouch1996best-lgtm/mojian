"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "./ui/Button";
import Spinner from "./ui/Spinner";
import EditableCell from "./EditableCell";
import TaggedText from "./TaggedText";
import ImageLightbox from "./ImageLightbox";
import CharacterAssetCard from "./CharacterAssetCard";
import ObjectAssetCard from "./ObjectAssetCard";
import SceneAssetCard from "./SceneAssetCard";
import { callLLM } from "@/lib/llm-client";
import { generateImage, getImageSettings } from "@/lib/image-client";
import { assetMessages } from "@/lib/prompts";
import { getCosSettings, isCosConfigured } from "@/lib/cos-client";
import { getActiveStyle, getAssetTemplate, styleToText } from "@/lib/style-settings";
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
import type { Asset, AssetStatus, AssetType, CharacterProfile, Episode, ObjectProfile, SceneProfile, StyleSettings } from "@/lib/types";

interface AssetPreparationProps {
  episode: Episode;
  onUpdateAsset: (id: string, field: keyof Asset, value: string) => void;
  onReplaceAssets: (assets: Asset[]) => void;
  onBackToStep2: () => void;
  /** 系列级漫剧风格设定（优先使用，不传则用全局） */
  seriesStyleSettings?: StyleSettings | null;
  /** 系列级人物设定（优先使用，不传则用全局） */
  characterSettings?: CharacterProfile[] | null;
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
};

export default function AssetPreparation({
  episode,
  onUpdateAsset,
  onReplaceAssets,
  onBackToStep2,
  seriesStyleSettings,
  characterSettings,
  objectSettings,
  onSaveObjectSettings,
  sceneSettings,
  onSaveSceneSettings,
  onRemoveTag,
  onDeleteAsset,
}: AssetPreparationProps) {
  const [generating, setGenerating] = useState(false);
  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set());
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

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

  // 图片 API 是否已配置
  const [imageConfigured, setImageConfigured] = useState(false);
  useEffect(() => { getImageSettings().then((s) => setImageConfigured(!!s?.apiKey)); }, []);

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

  // 自动预填：进入 Step3 时，若有人物设定且尚无资产，自动预填人物资产卡片
  const didPrefill = useRef(false);
  useEffect(() => {
    if (didPrefill.current) return;
    const chars = getLatestVersions(characterSettings ?? []);
    if (chars.length === 0) return;
    if (episode.assets.length > 0) return;
    didPrefill.current = true;
    const prefilled: Asset[] = chars
      .filter((c) => c.name.trim())
      .map((c) => {
        const descParts: string[] = [];
        if (c.personality.trim()) descParts.push(`性格：${c.personality.trim()}`);
        if (c.appearance.trim()) descParts.push(`外貌：${c.appearance.trim()}`);
        return {
          id: uuid(),
          name: c.name.trim(),
          type: "character" as AssetType,
          description: descParts.join("；"),
          imagePrompt: c.appearance.trim(),
          imageUrl: c.imageUrl ?? "",
          status: (c.imageUrl ? "ready" : "pending") as AssetStatus,
        };
      });
    if (prefilled.length > 0) {
      onReplaceAssets(prefilled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterSettings, episode.assets.length]);

  // 已有资产按 name 索引，判断哪些标签还没建资产
  const existingNames = useMemo(
    () => new Set(episode.assets.map((a) => a.name)),
    [episode.assets]
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
      appearance: asset.imagePrompt.trim(),
      purpose: asset.description.trim(),
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
      appearance: asset.imagePrompt.trim(),
      lightingMood: "",
      origin: "",
      imageUrl: asset.imageUrl || "",
    };
    onSaveSceneSettings([...(sceneSettings ?? []), newScene]);
  }

  /** 一键生成：把所有标签交给 LLM，返回分类 + 图片提示词，覆盖现有资产 */
  async function handleGenerateAll() {
    if (tags.length === 0) {
      setError("没有可用的标签，请先在第二步做智能标注");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const styleText = styleToText(await getActiveStyle(seriesStyleSettings));
      const raw = await callLLM(assetMessages(tags, episode.expandedContent, styleText, characterText), {
        responseFormat: "json_object",
        temperature: 0.5,
      });
      const rawAssets = extractAssets(raw);
      if (rawAssets.length === 0) {
        setError("未能解析出资产，请重试");
        return;
      }
      // 保留已有的 imageUrl / status，按 name 匹配；同时匹配人物/物品设定中的图片
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
      const prevByName = new Map(episode.assets.map((a) => [a.name, a]));
      const next: Asset[] = rawAssets
        .filter((r) => r.name)
        .map((r) => {
          const prev = prevByName.get(r.name!);
          const charImage = charImageByName.get(r.name!.trim());
          const objImage = objectImageByName.get(r.name!.trim());
          const sceneImage = sceneImageByName.get(r.name!.trim());
          const imageUrl = prev?.imageUrl ?? charImage ?? objImage ?? sceneImage ?? "";
          return {
            id: prev?.id ?? crypto.randomUUID(),
            name: r.name!,
            type: normalizeAssetType(r.type),
            description: r.description ?? "",
            imagePrompt: r.imagePrompt ?? "",
            imageUrl,
            status: imageUrl ? "ready" : (prev?.status ?? "pending"),
          };
        });
      onReplaceAssets(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  /** 单个资产生成图片（调用火山引擎 Seedream API） */
  async function handleGenerateImage(asset: Asset) {
    if (!asset.imagePrompt) {
      setError(`资产「${asset.name}」还没有图片提示词，请先生成资产信息`);
      return;
    }
    if (!imageConfigured) {
      setError("未配置图片生成 API，请先前往「图片 API 设置」页配置");
      return;
    }
    setError(null);
    await generateImageForAsset(asset);
  }

  /** 单个资产生成图片 + 自动转存 COS */
  async function generateImageForAsset(asset: Asset) {
    setGeneratingImageIds((prev) => new Set(prev).add(asset.id));
    onUpdateAsset(asset.id, "status", "pending");
    try {
      // 拼接风格模板到图片提示词末尾
      const template = getAssetTemplate(asset.type, seriesStyleSettings);
      const finalPrompt = template
        ? `${asset.imagePrompt}，${template}`
        : asset.imagePrompt;
      const result = await generateImage(finalPrompt);
      onUpdateAsset(asset.id, "imageUrl", result.imageUrl);
      onUpdateAsset(asset.id, "status", "ready");

      // 自动转存到 COS（Seedream 图片 URL 只有 24h 有效期）
      await transferImageToCos(asset, result.imageUrl);
    } catch (e) {
      onUpdateAsset(asset.id, "status", "failed");
      setError(`「${asset.name}」图片生成失败：${(e as Error).message}`);
    } finally {
      setGeneratingImageIds((prev) => {
        const next = new Set(prev);
        next.delete(asset.id);
        return next;
      });
    }
  }

  /** 将 Seedream 生成的图片 URL 转存到 COS（24h 过期保护） */
  async function transferImageToCos(asset: Asset, sourceUrl: string) {
    if (!cosConfigured) return;
    const cosSettings = await getCosSettings();
    if (!cosSettings) return;

    try {
      const res = await fetch("/api/cos/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl,
          settings: cosSettings,
          prefix: "ai-script/assets",
        }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        onUpdateAsset(asset.id, "imageUrl", data.url);
      }
    } catch {
      // 转存失败不阻断流程，保留原始 URL（24h 内仍可访问）
    }
  }

  /** 批量生成所有资产的图片 */
  async function handleGenerateAllImages() {
    if (!imageConfigured) {
      setError("未配置图片生成 API，请先前往「图片 API 设置」页配置");
      return;
    }
    const pending = episode.assets.filter((a) => {
      if (!a.imagePrompt || a.status === "ready") return false;
      // 已关联人物设定的人物资产用人物图片，不参与 AI 生图
      if (a.type === "character" && (characterVersionsByName.get(a.name.trim())?.length ?? 0) > 0) {
        return false;
      }
      // 已关联物品设定的物品资产用物品图片，不参与 AI 生图
      if (a.type === "object" && (objectVersionsByName.get(a.name.trim())?.length ?? 0) > 0) {
        return false;
      }
      // 已关联场景设定的场景资产用场景图片，不参与 AI 生图
      if (a.type === "scene" && (sceneVersionsByName.get(a.name.trim())?.length ?? 0) > 0) {
        return false;
      }
      return true;
    });
    if (pending.length === 0) {
      setError("没有待生成图片的资产");
      return;
    }
    setError(null);
    // 顺序生成，避免触发上游限流
    for (const asset of pending) {
      try {
        await generateImageForAsset(asset);
      } catch (e) {
        // generateImageForAsset 内部已设 failed + setError
        break;
      }
    }
  }

  /** 上传本地图片到 COS */
  async function handleUploadToCos(asset: Asset) {
    if (!cosConfigured) {
      setError("未配置 COS 存储，请先在设置中配置腾讯云 COS");
      return;
    }
    const cosSettings = await getCosSettings();
    if (!cosSettings) {
      setError("COS 设置读取失败");
      return;
    }

    // 打开文件选择器
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      setError(null);
      setUploadingIds((prev) => new Set(prev).add(asset.id));

      try {
        // 读取为 base64
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("文件读取失败"));
          reader.readAsDataURL(file);
        });

        // 调用 COS 上传 API
        const res = await fetch("/api/cos/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base64,
            fileName: `asset-${asset.name}-${file.name}`,
            settings: cosSettings,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.url) {
          throw new Error(data.error ?? "上传失败");
        }

        onUpdateAsset(asset.id, "imageUrl", data.url);
        onUpdateAsset(asset.id, "status", "ready");
      } catch (e) {
        setError(`「${asset.name}」上传失败：${(e as Error).message}`);
      } finally {
        setUploadingIds((prev) => {
          const next = new Set(prev);
          next.delete(asset.id);
          return next;
        });
      }
    };
    input.click();
  }

  /** 添加新资产（占位卡片表单提交） */
  function handleAddAsset() {
    const name = newAssetName.trim();
    if (!name) {
      setError("请输入资产名称");
      return;
    }
    if (episode.assets.some((a) => a.name === name)) {
      setError(`资产「${name}」已存在`);
      return;
    }
    const newAsset: Asset = {
      id: crypto.randomUUID(),
      name,
      type: newAssetType,
      description: "",
      imagePrompt: "",
      imageUrl: "",
      status: "pending",
    };
    onReplaceAssets([...episode.assets, newAsset]);
    resetAddCard();
  }

  /** 从已有设定添加资产 */
  function handleAddFromSettings() {
    if (!selectedSettingId) {
      setError("请选择一个设定");
      return;
    }
    let newAsset: Asset | null = null;
    if (newAssetType === "character") {
      const c = getLatestVersions(characterSettings ?? []).find((x) => x.id === selectedSettingId);
      if (!c) return;
      const descParts: string[] = [];
      if (c.personality.trim()) descParts.push(`性格：${c.personality.trim()}`);
      if (c.appearance.trim()) descParts.push(`外貌：${c.appearance.trim()}`);
      newAsset = {
        id: crypto.randomUUID(),
        name: c.name.trim(),
        type: "character",
        description: descParts.join("；"),
        imagePrompt: c.appearance.trim(),
        imageUrl: c.imageUrl ?? "",
        status: (c.imageUrl ? "ready" : "pending") as AssetStatus,
      };
    } else if (newAssetType === "object") {
      const o = getLatestObjectVersions(objectSettings ?? []).find((x) => x.id === selectedSettingId);
      if (!o) return;
      const descParts: string[] = [];
      if (o.appearance.trim()) descParts.push(`外观：${o.appearance.trim()}`);
      if (o.purpose.trim()) descParts.push(`功能：${o.purpose.trim()}`);
      newAsset = {
        id: crypto.randomUUID(),
        name: o.name.trim(),
        type: "object",
        description: descParts.join("；"),
        imagePrompt: o.appearance.trim(),
        imageUrl: o.imageUrl ?? "",
        status: (o.imageUrl ? "ready" : "pending") as AssetStatus,
      };
    } else {
      const s = getLatestSceneVersions(sceneSettings ?? []).find((x) => x.id === selectedSettingId);
      if (!s) return;
      const descParts: string[] = [];
      if (s.appearance.trim()) descParts.push(`外观：${s.appearance.trim()}`);
      if (s.lightingMood.trim()) descParts.push(`氛围：${s.lightingMood.trim()}`);
      newAsset = {
        id: crypto.randomUUID(),
        name: s.name.trim(),
        type: "scene",
        description: descParts.join("；"),
        imagePrompt: s.appearance.trim(),
        imageUrl: s.imageUrl ?? "",
        status: (s.imageUrl ? "ready" : "pending") as AssetStatus,
      };
    }
    if (!newAsset) return;
    if (episode.assets.some((a) => a.name === newAsset!.name)) {
      setError(`资产「${newAsset!.name}」已存在`);
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
    setError(null);
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
            共 {tags.length} 个标签 · 已生成 {episode.assets.length} 个资产
            {missingTags.length > 0 && (
              <span className="ml-2 text-amber-600">
                （{missingTags.length} 个标签待生成）
              </span>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!imageConfigured ? (
            <span className="inline-flex cursor-pointer items-center rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-100" onClick={() => window.history.back()}>
              图片 API 未配置，请返回首页打开「设置」
            </span>
          ) : (
            <span className="text-xs text-emerald-700">图片 API 已配置 ✓</span>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleGenerateAllImages}
            disabled={episode.assets.length === 0 || !imageConfigured}
          >
            批量生成图片
          </Button>
          <Button
            onClick={handleGenerateAll}
            loading={generating}
            disabled={tags.length === 0}
          >
            {generating ? "生成中…" : "一键生成资产信息"}
          </Button>
        </div>
      </div>

      {/* 图片 API 未配置提示 */}
      {!imageConfigured && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          图片生成 API 尚未配置。请返回首页，打开右上角「设置」弹窗，点击底部「图片生成 API（火山引擎 Seedream）」折叠区域填写。
        </div>
      )}

      {/* COS 未配置提示 */}
      {!cosConfigured && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          COS 存储尚未配置。上传本地图片需要配置腾讯云 COS。请打开右上角「设置」弹窗，点击「腾讯云 COS 存储」折叠区域填写。
        </div>
      )}

      {/* 说明区 */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 text-xs leading-relaxed text-slate-600">
        <p className="mb-1 font-medium text-slate-700">第三步 · 资产准备</p>
        <p>
          系统已从第二步的分镜画面描述中识别出以下{" "}
          <span className="font-medium text-amber-700">@标签</span>。点击「一键生成资产信息」后，AI
          会为每个标签分类（人物/场景/物品）并生成用于图片生成的中文提示词。随后可对每个资产生成参考图片（图片 API 待接入）。
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

      {error && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {error}
        </div>
      )}

      {/* 资产卡片网格 */}
      {episode.assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/50 py-16 text-center">
          <div className="mb-2 text-4xl opacity-40">🖼️</div>
          <p className="text-sm text-slate-500">
            还没有资产生成。点击上方「一键生成资产信息」开始。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {episode.assets.map((asset) => {
            // 人物资产若匹配到人物设定版本，则用人物资产卡片（可选择版本、复用图片）
            const charVersions =
              asset.type === "character" ? characterVersionsByName.get(asset.name.trim()) : undefined;
            if (charVersions && charVersions.length > 0) {
              return (
                <CharacterAssetCard
                  key={asset.id}
                  asset={asset}
                  versions={charVersions}
                  onUpdate={(field, value) => onUpdateAsset(asset.id, field, value)}
                  onDelete={onDeleteAsset ? () => onDeleteAsset(asset.id) : undefined}
                />
              );
            }
            // 物品资产若匹配到物品设定版本，则用物品资产卡片（可选择版本、复用图片）
            const objVersions =
              asset.type === "object" ? objectVersionsByName.get(asset.name.trim()) : undefined;
            if (objVersions && objVersions.length > 0) {
              return (
                <ObjectAssetCard
                  key={asset.id}
                  asset={asset}
                  versions={objVersions}
                  onUpdate={(field, value) => onUpdateAsset(asset.id, field, value)}
                  onDelete={onDeleteAsset ? () => onDeleteAsset(asset.id) : undefined}
                />
              );
            }
            // 场景资产若匹配到场景设定版本，则用场景资产卡片（可选择版本、复用图片）
            const sceneVersions =
              asset.type === "scene" ? sceneVersionsByName.get(asset.name.trim()) : undefined;
            if (sceneVersions && sceneVersions.length > 0) {
              return (
                <SceneAssetCard
                  key={asset.id}
                  asset={asset}
                  versions={sceneVersions}
                  onUpdate={(field, value) => onUpdateAsset(asset.id, field, value)}
                  onDelete={onDeleteAsset ? () => onDeleteAsset(asset.id) : undefined}
                />
              );
            }
            return (
              <AssetCard
                key={asset.id}
                asset={asset}
                isGenerating={generatingImageIds.has(asset.id)}
                isUploading={uploadingIds.has(asset.id)}
                cosConfigured={cosConfigured}
                onUpdate={(field, value) => onUpdateAsset(asset.id, field, value)}
                onGenerateImage={() => handleGenerateImage(asset)}
                onUpload={() => handleUploadToCos(asset)}
                onExtractObject={
                  asset.type === "object" && onSaveObjectSettings
                    ? () => handleExtractObject(asset)
                    : undefined
                }
                onExtractScene={
                  asset.type === "scene" && onSaveSceneSettings
                    ? () => handleExtractScene(asset)
                    : undefined
                }
                onDelete={onDeleteAsset ? () => onDeleteAsset(asset.id) : undefined}
              />
            );
          })}
          {/* 添加资产占位卡片 */}
          {!showAddCard ? (
            <button
              onClick={() => { setShowAddCard(true); setError(null); }}
              className="group flex aspect-[4/3] min-h-[220px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white/60 text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-500"
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="opacity-50 group-hover:opacity-80 transition-opacity">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
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
      )}
    </div>
  );
}

/** 单个资产卡片 */
function AssetCard({
  asset,
  isGenerating,
  isUploading,
  cosConfigured,
  onUpdate,
  onGenerateImage,
  onUpload,
  onExtractObject,
  onExtractScene,
  onDelete,
}: {
  asset: Asset;
  isGenerating: boolean;
  isUploading: boolean;
  cosConfigured: boolean;
  onUpdate: (field: keyof Asset, value: string) => void;
  onGenerateImage: () => void;
  onUpload: () => void;
  onExtractObject?: () => void;
  onExtractScene?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* 图片区 */}
      <div className="relative flex aspect-[4/3] items-center justify-center bg-slate-50">
        {asset.imageUrl ? (
          <ImageLightbox src={asset.imageUrl} alt={asset.name} className="h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset.imageUrl}
              alt={asset.name}
              className="h-full w-full object-cover"
            />
          </ImageLightbox>
        ) : isGenerating ? (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <Spinner size={28} />
            <span className="text-xs">生成中…</span>
          </div>
        ) : isUploading ? (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <Spinner size={28} />
            <span className="text-xs">上传中…</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-slate-300">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <rect
                x="3"
                y="4"
                width="18"
                height="16"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="9" cy="10" r="2" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M3 17l5-5 4 4 3-3 6 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-xs">图片待生成</span>
          </div>
        )}
        {/* 删除按钮 */}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur transition-colors hover:bg-red-500"
            title="删除该资产"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* 内容区 */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <TaggedText
            text={`@${asset.name}`}
            className="text-sm font-semibold text-slate-800"
          />
          <select
            value={asset.type}
            onChange={(e) => onUpdate("type", e.target.value as AssetType)}
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
              TYPE_BADGE_CLASS[asset.type]
            } border-0 focus:outline-none`}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {ASSET_TYPE_LABELS[o.value]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-0.5 block text-xs text-slate-400">描述</label>
          <EditableCell
            value={asset.description}
            onChange={(v) => onUpdate("description", v)}
            placeholder="资产描述…"
            multiline
            minWidth="100%"
          />
        </div>

        <div>
          <label className="mb-0.5 block text-xs text-slate-400">图片提示词</label>
          <EditableCell
            value={asset.imagePrompt}
            onChange={(v) => onUpdate("imagePrompt", v)}
            placeholder="用于图片生成的提示词…"
            multiline
            minWidth="100%"
          />
        </div>

        <div className="mt-auto flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant={asset.imageUrl ? "ghost" : "secondary"}
            className="flex-1"
            onClick={onGenerateImage}
            loading={isGenerating}
            disabled={!asset.imagePrompt || isGenerating}
          >
            {asset.imageUrl ? "重新生成" : "生成图片"}
          </Button>
          {cosConfigured && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onUpload}
              loading={isUploading}
              disabled={isUploading || isGenerating}
              title="上传本地图片到 COS 存储"
            >
              上传
            </Button>
          )}
          {onExtractObject && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onExtractObject}
              disabled={isGenerating || isUploading}
              title="提取到物品设定，可关联多版本图片"
            >
              提取到物品设定
            </Button>
          )}
          {onExtractScene && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onExtractScene}
              disabled={isGenerating || isUploading}
              title="提取到场景设定，可关联多版本图片"
            >
              提取到场景设定
            </Button>
          )}
          {asset.status === "failed" && (
            <span className="text-xs text-red-500">失败</span>
          )}
          {asset.status === "ready" && asset.imageUrl && (
            <span className="text-xs text-emerald-700">✓</span>
          )}
        </div>
      </div>
    </div>
  );
}
