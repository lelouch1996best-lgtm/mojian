"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "./ui/Button";
import Spinner from "./ui/Spinner";
import EditableCell from "./EditableCell";
import TaggedText from "./TaggedText";
import ImageLightbox from "./ImageLightbox";
import { callLLM } from "@/lib/llm-client";
import { generateImage, getImageSettings } from "@/lib/image-client";
import { assetMessages } from "@/lib/prompts";
import { getCosSettings, isCosConfigured } from "@/lib/cos-client";
import { getActiveStyle, getAssetTemplate, styleToText } from "@/lib/style-settings";
import {
  extractAllTags,
  extractAssets,
  normalizeAssetType,
  ASSET_TYPE_LABELS,
} from "@/lib/utils";
import type { Asset, AssetType, Episode, StyleSettings } from "@/lib/types";

interface AssetPreparationProps {
  episode: Episode;
  onUpdateAsset: (id: string, field: keyof Asset, value: string) => void;
  onReplaceAssets: (assets: Asset[]) => void;
  onBackToStep2: () => void;
  /** 系列级漫剧风格设定（优先使用，不传则用全局） */
  seriesStyleSettings?: StyleSettings | null;
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
}: AssetPreparationProps) {
  const [generating, setGenerating] = useState(false);
  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set());
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // 添加资产表单状态
  const [showAddCard, setShowAddCard] = useState(false);
  const [newAssetName, setNewAssetName] = useState("");
  const [newAssetType, setNewAssetType] = useState<AssetType>("character");

  // COS 配置（async）
  const [cosConfigured, setCosConfigured] = useState(false);
  useEffect(() => { isCosConfigured().then(setCosConfigured); }, []);

  // 当前所有镜头里的 @标签@（去重，按首次出现顺序）
  const tags = useMemo(() => extractAllTags(episode.shots), [episode.shots]);

  // 图片 API 是否已配置
  const [imageConfigured, setImageConfigured] = useState(false);
  useEffect(() => { getImageSettings().then((s) => setImageConfigured(!!s?.apiKey)); }, []);

  // 已有资产按 name 索引，判断哪些标签还没建资产
  const existingNames = useMemo(
    () => new Set(episode.assets.map((a) => a.name)),
    [episode.assets]
  );
  const missingTags = tags.filter((t) => !existingNames.has(t));

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
      const raw = await callLLM(assetMessages(tags, episode.expandedContent, styleText), {
        responseFormat: "json_object",
        temperature: 0.5,
      });
      const rawAssets = extractAssets(raw);
      if (rawAssets.length === 0) {
        setError("未能解析出资产，请重试");
        return;
      }
      // 保留已有的 imageUrl / status，按 name 匹配
      const prevByName = new Map(episode.assets.map((a) => [a.name, a]));
      const next: Asset[] = rawAssets
        .filter((r) => r.name)
        .map((r) => {
          const prev = prevByName.get(r.name!);
          return {
            id: prev?.id ?? crypto.randomUUID(),
            name: r.name!,
            type: normalizeAssetType(r.type),
            description: r.description ?? "",
            imagePrompt: r.imagePrompt ?? "",
            imageUrl: prev?.imageUrl ?? "",
            status: prev?.status ?? "pending",
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
    const cosSettings = getCosSettings();
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
    const pending = episode.assets.filter((a) => a.imagePrompt && a.status !== "ready");
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
    const cosSettings = getCosSettings();
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
    setNewAssetName("");
    setNewAssetType("character");
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
          <span className="font-medium text-amber-700">@标签@</span>。点击「一键生成资产信息」后，AI
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
                className={`rounded px-2 py-0.5 text-xs ${
                  has
                    ? "bg-amber-100 text-amber-800"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                @{t}
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
          {episode.assets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              isGenerating={generatingImageIds.has(asset.id)}
              isUploading={uploadingIds.has(asset.id)}
              cosConfigured={cosConfigured}
              onUpdate={(field, value) => onUpdateAsset(asset.id, field, value)}
              onGenerateImage={() => handleGenerateImage(asset)}
              onUpload={() => handleUploadToCos(asset)}
            />
          ))}
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
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => { setShowAddCard(false); setNewAssetName(""); setNewAssetType("character"); setError(null); }}>取消</Button>
                </div>
              </div>
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
}: {
  asset: Asset;
  isGenerating: boolean;
  isUploading: boolean;
  cosConfigured: boolean;
  onUpdate: (field: keyof Asset, value: string) => void;
  onGenerateImage: () => void;
  onUpload: () => void;
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
