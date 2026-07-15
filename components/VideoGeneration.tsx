"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "./ui/Button";
import AiOptimizeButton from "./ui/AiOptimizeButton";
import Spinner from "./ui/Spinner";
import EditableCell from "./EditableCell";
import ImageLightbox from "./ImageLightbox";
import AssetPicker from "./AssetPicker";
import { callLLM } from "@/lib/llm-client";
import {
  createVideoTask,
  cancelVideoTask,
  pollVideoTask,
  getVideoSettings,
} from "@/lib/video-client";
import { videoPromptMessages } from "@/lib/prompts";
import { isCosConfigured, getCosSettings, uploadRefFile } from "@/lib/cos-client";
import { ASSET_TYPE_LABELS, extractTags, replaceAssetTagsWithImageNos } from "@/lib/utils";
import {
  DEFAULT_SHOT_VIDEO_CONFIG,
  getVideoModelCapability,
  getVideoModels,
  getDefaultModelValue,
  type ModelEntry,
  type VideoModelCapability,
} from "@/lib/model-presets";
import type {
  Asset,
  Episode,
  Shot,
  ShotVideoConfig,
  StyleSettings,
  VideoGenerationMode,
  VideoRatio,
  VideoResolution,
  VideoStatus,
} from "@/lib/types";

interface VideoGenerationProps {
  episode: Episode;
  onUpdateShot: (id: string, field: keyof Shot, value: string) => void;
  onUpdateVideoStatus: (id: string, status: VideoStatus) => void;
  /** 卡片级视频配置增量更新（合并写入 shot.videoConfig） */
  onUpdateVideoConfig: (id: string, patch: Partial<ShotVideoConfig>) => void;
  onBackToStep3: () => void;
  /** 将资产关联到某个镜头（@ 补全选中时触发） */
  onLinkAsset: (shotId: string, assetId: string) => void;
  /** 解除镜头与资产的关联（× 按钮触发） */
  onUnlinkAsset: (shotId: string, assetId: string) => void;
  /** 系列级漫剧风格设定（优先使用，不传则用全局） */
  seriesStyleSettings?: StyleSettings | null;
}

const MODE_LABELS: Record<VideoGenerationMode, string> = {
  "text2video": "文生视频",
  "first-frame": "图生视频-首帧",
  "first-last-frame": "图生视频-首尾帧",
  "multimodal-ref": "多模态参考生视频",
};

const RATIO_LABELS: Record<VideoRatio, string> = {
  "16:9": "16:9",
  "4:3": "4:3",
  "1:1": "1:1",
  "3:4": "3:4",
  "9:16": "9:16（竖屏）",
  "21:9": "21:9",
  "adaptive": "adaptive（自动）",
};

/**
 * 将配置收敛到模型能力范围内（切换模型时调用，避免残留不支持的参数）。
 * 纯函数，不修改入参。
 */
function sanitizeConfig(
  config: ShotVideoConfig,
  cap: VideoModelCapability
): ShotVideoConfig {
  const next: ShotVideoConfig = { ...config };
  if (!cap.modes.includes(next.mode)) next.mode = cap.modes[0];
  if (!cap.resolutions.includes(next.resolution)) next.resolution = cap.resolutions[0];
  if (!cap.ratios.includes(next.ratio)) next.ratio = cap.ratios[0];
  if (next.duration === -1) {
    if (!cap.durationAuto) next.duration = cap.durationRange[0];
  } else {
    const [min, max] = cap.durationRange;
    next.duration = Math.max(min, Math.min(max, next.duration));
  }
  if (!cap.audio && next.generateAudio) next.generateAudio = false;
  if (!cap.seed && next.seed !== -1) next.seed = -1;
  if (!cap.cameraFixed && next.cameraFixed) next.cameraFixed = false;
  if (!cap.webSearch && next.webSearch) next.webSearch = false;
  if (!cap.priority && next.priority !== 0) next.priority = 0;
  if (!cap.draft && next.draft) next.draft = false;
  return next;
}

const TYPE_BADGE_CLASS: Record<Asset["type"], string> = {
  character: "bg-[#FDF0E3] text-[#92400E]",
  scene: "bg-[#F7F8E8] text-[#4D7C0F]",
  object: "bg-[#FDF3E3] text-[#92400E]",
};

const STATUS_LABEL: Record<VideoStatus, string> = {
  idle: "未生成",
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  expired: "超时",
  cancelled: "已取消",
};

const STATUS_BADGE_CLASS: Record<VideoStatus, string> = {
  idle: "bg-slate-100 text-slate-500 font-medium",
  queued: "bg-amber-100 text-amber-700 font-medium",
  running: "bg-blue-100 text-blue-700 font-medium",
  succeeded: "bg-emerald-100 text-emerald-700 font-medium",
  failed: "bg-red-100 text-red-600 font-medium",
  expired: "bg-slate-100 text-slate-500 font-medium",
  cancelled: "bg-slate-100 text-slate-500 font-medium",
};

export default function VideoGeneration({
  episode,
  onUpdateShot,
  onUpdateVideoStatus,
  onUpdateVideoConfig,
  onBackToStep3,
  onLinkAsset,
  onUnlinkAsset,
  seriesStyleSettings,
}: VideoGenerationProps) {
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [videoGeneratingIds, setVideoGeneratingIds] = useState<Set<string>>(new Set());
  const [generatingAll, setGeneratingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [videoModels, setVideoModels] = useState<ModelEntry[]>([]);

  const [videoConfigured, setVideoConfigured] = useState(false);
  useEffect(() => {
    (async () => {
      const settings = await getVideoSettings();
      const provider = settings?.provider ?? "ark";
      setVideoConfigured(!!settings?.apiKey);
      setVideoModels(await getVideoModels(provider));
    })();
  }, [seriesStyleSettings]);

  const assetById = useMemo(() => {
    const m = new Map<string, Asset>();
    for (const a of episode.assets) {
      m.set(a.id, a);
    }
    return m;
  }, [episode.assets]);

  // 资产按名称索引（小写匹配），用于自动关联
  const assetIdByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of episode.assets) {
      m.set(a.name.toLowerCase(), a.id);
    }
    return m;
  }, [episode.assets]);

  // 进入 Step4 时，根据画面描述中的 @标签自动关联资产（仅执行一次）
  const didAutoLink = useRef(false);
  useEffect(() => {
    if (didAutoLink.current) return;
    if (episode.assets.length === 0 || episode.shots.length === 0) return;
    didAutoLink.current = true;
    for (const shot of episode.shots) {
      const tagNames = extractTags(shot.visualDescription);
      if (tagNames.length === 0) continue;
      for (const tagName of tagNames) {
        const assetId = assetIdByName.get(tagName.toLowerCase());
        if (assetId && !shot.relatedAssetIds?.includes(assetId)) {
          onLinkAsset(shot.id, assetId);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.assets.length, episode.shots.length, assetIdByName, onLinkAsset]);

  // @ 补全选项（供所有 VideoCard 共享）
  const atMentionOptions = useMemo(
    () => episode.assets.map((a) => ({ label: a.name, value: a.name })),
    [episode.assets]
  );

  /** 根据镜头的 relatedAssetIds 获取关联资产列表 */
  function getRelatedAssets(shot: Shot): Asset[] {
    if (!shot.relatedAssetIds || shot.relatedAssetIds.length === 0) return [];
    const result: Asset[] = [];
    for (const id of shot.relatedAssetIds) {
      const a = assetById.get(id);
      if (a) result.push(a);
    }
    return result;
  }

  async function generateOne(shot: Shot) {
    setGeneratingIds((prev) => new Set(prev).add(shot.id));
    setError(null);
    try {
      const related = getRelatedAssets(shot);
      const messages = videoPromptMessages(shot, related);
      console.log("[VideoPrompt] 镜头提示词生成 messages：", messages);
      const prompt = await callLLM(messages, { temperature: 0.6 });
      console.log("[VideoPrompt] 镜头提示词生成结果：", prompt);
      onUpdateShot(shot.id, "finalPrompt", prompt.trim());
    } catch (e) {
      setError(`镜头 ${episode.shots.indexOf(shot) + 1} 提示词生成失败：${(e as Error).message}`);
    } finally {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(shot.id);
        return next;
      });
    }
  }

  async function generateAll() {
    setGeneratingAll(true);
    setError(null);
    for (const shot of episode.shots) {
      setGeneratingIds((prev) => new Set(prev).add(shot.id));
      try {
        const related = getRelatedAssets(shot);
        const messages = videoPromptMessages(shot, related);
        console.log("[VideoPrompt] 镜头提示词生成 messages：", messages);
        const prompt = await callLLM(messages, { temperature: 0.6 });
        console.log("[VideoPrompt] 镜头提示词生成结果：", prompt);
        onUpdateShot(shot.id, "finalPrompt", prompt.trim());
      } catch (e) {
        setError(`镜头 ${episode.shots.indexOf(shot) + 1} 提示词生成失败：${(e as Error).message}`);
        break;
      } finally {
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(shot.id);
          return next;
        });
      }
    }
    setGeneratingAll(false);
  }

  /** 生成单个镜头的视频 */
  async function generateVideo(shot: Shot) {
    if (!shot.finalPrompt) {
      setError(`镜头 ${episode.shots.indexOf(shot) + 1} 还没有视频提示词，请先生成`);
      return;
    }
    if (!videoConfigured) {
      setError("未配置视频生成 API，请先在设置中配置");
      return;
    }
    setVideoGeneratingIds((prev) => new Set(prev).add(shot.id));
    setError(null);

    // 卡片级视频配置（缺省时使用默认模型构建并收敛到能力范围内）
    const defaultVidModel = getDefaultModelValue(videoModels) ?? DEFAULT_SHOT_VIDEO_CONFIG.model;
    const config = shot.videoConfig
      ? shot.videoConfig
      : sanitizeConfig(
          { ...DEFAULT_SHOT_VIDEO_CONFIG, model: defaultVidModel },
          getVideoModelCapability(defaultVidModel, videoModels)
        );
    const shotIndex = episode.shots.indexOf(shot) + 1;

    // 收集关联资产的图片 URL（已是 COS 公网 URL）
    const related = getRelatedAssets(shot);
    const relatedImageUrls = related
      .map((a) => a.imageUrl)
      .filter((u): u is string => !!u);

    // 构造 @资产名称 -> 图片编号/去除@ 映射
    // 有图的资产替换为 图片N（编号与参考图上传顺序一致）；无图的资产去掉 @ 保留名称
    let imgNo = 0;
    const assetImageNo = new Map<string, number | null>();
    for (const a of related) {
      assetImageNo.set(a.name, a.imageUrl ? ++imgNo : null);
    }

    // 按 mode 派生输入素材并校验
    let firstFrameUrl: string | undefined;
    let lastFrameUrl: string | undefined;
    let referenceImageUrls: string[] | undefined;
    if (config.mode === "first-frame") {
      firstFrameUrl = config.firstFrameImageUrl;
      if (!firstFrameUrl) {
        setError(`镜头 ${shotIndex} 首帧模式需要上传首帧图片，请在卡片参数中上传`);
        setVideoGeneratingIds((prev) => { const n = new Set(prev); n.delete(shot.id); return n; });
        return;
      }
    } else if (config.mode === "first-last-frame") {
      firstFrameUrl = config.firstFrameImageUrl;
      lastFrameUrl = config.lastFrameImageUrl;
      if (!firstFrameUrl || !lastFrameUrl) {
        setError(`镜头 ${shotIndex} 首尾帧模式需要上传首帧与尾帧图片，请在卡片参数中上传`);
        setVideoGeneratingIds((prev) => { const n = new Set(prev); n.delete(shot.id); return n; });
        return;
      }
    } else if (config.mode === "multimodal-ref") {
      referenceImageUrls = [...relatedImageUrls, ...(config.referenceImageAssetUrls ?? [])];
      const vidCount = config.referenceVideoUrls?.length ?? 0;
      if (referenceImageUrls.length === 0 && vidCount === 0) {
        setError(`镜头 ${shotIndex} 多模态参考模式需至少提供 1 张参考图（关联资产/asset://素材）或 1 个参考视频`);
        setVideoGeneratingIds((prev) => { const n = new Set(prev); n.delete(shot.id); return n; });
        return;
      }
    }

    onUpdateVideoStatus(shot.id, "queued");
    try {
      // 发送给 Seedance API 前确定性替换 @资产名称 -> 图片N（兜底，不依赖 LLM 自觉）
      // 同时将 @视频N/@音频N 去掉 @（Seedance 多模态参考用「视频N」「音频N」指代素材）
      const finalVideoPrompt = replaceAssetTagsWithImageNos(shot.finalPrompt, assetImageNo)
        .replace(/@视频(\d+)/g, "视频$1")
        .replace(/@音频(\d+)/g, "音频$1");
      const createResult = await createVideoTask({
        prompt: finalVideoPrompt,
        config,
        firstFrameUrl,
        lastFrameUrl,
        referenceImageUrls,
        referenceVideoUrls: config.referenceVideoUrls,
        referenceAudioUrls: config.referenceAudioUrls,
      });
      onUpdateShot(shot.id, "videoTaskId", createResult.taskId);
      onUpdateVideoStatus(shot.id, "running");

      // 轮询任务状态
      const final = await pollVideoTask(
        createResult.taskId,
        (r) => {
          if (r.status === "queued" || r.status === "running") {
            onUpdateVideoStatus(shot.id, r.status);
          }
        },
        10000,
        10 * 60 * 1000
      );

      if (final.status === "succeeded" && final.videoUrl) {
        onUpdateShot(shot.id, "videoUrl", final.videoUrl);
        onUpdateVideoStatus(shot.id, "succeeded");

        // 自动转存到 COS（Seedance 视频 URL 只有 24h 有效期）
        await transferVideoToCos(shot, final.videoUrl);
      } else {
        onUpdateVideoStatus(shot.id, final.status === "expired" ? "expired" : "failed");
        setError(
          `镜头 ${shotIndex} 视频生成失败：${final.error ?? final.status}`
        );
      }
    } catch (e) {
      onUpdateVideoStatus(shot.id, "failed");
      setError(`镜头 ${shotIndex} 视频生成失败：${(e as Error).message}`);
    } finally {
      setVideoGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(shot.id);
        return next;
      });
    }
  }

  /** 批量生成所有镜头视频 */
  async function generateAllVideos() {
    if (!videoConfigured) {
      setError("未配置视频生成 API");
      return;
    }
    const pending = episode.shots.filter(
      (s) => s.finalPrompt && s.videoStatus !== "succeeded"
    );
    if (pending.length === 0) {
      setError("没有待生成视频的镜头");
      return;
    }
    setError(null);
    for (const shot of pending) {
      await generateVideo(shot);
    }
  }

  /** 取消排队中的视频任务 */
  async function cancelVideo(shot: Shot) {
    if (!shot.videoTaskId) return;
    setError(null);
    try {
      await cancelVideoTask(shot.videoTaskId);
      onUpdateVideoStatus(shot.id, "cancelled");
    } catch (e) {
      setError(`取消失败：${(e as Error).message}`);
    }
  }

  /** 将 Seedance 生成的视频转存到 COS（24h 过期保护） */
  async function transferVideoToCos(shot: Shot, sourceUrl: string) {
    if (!(await isCosConfigured())) return;
    const cosSettings = await getCosSettings();
    if (!cosSettings) return;

    try {
      const res = await fetch("/api/cos/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl,
          settings: cosSettings,
          prefix: "ai-script/videos",
        }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        onUpdateShot(shot.id, "videoUrl", data.url);
      } else {
        console.error("视频转存 COS 失败：", data.error ?? res.status);
      }
    } catch (e) {
      console.error("视频转存 COS 失败：", (e as Error).message);
    }
  }

  const allReady = episode.shots.length > 0 && episode.shots.every((s) => s.finalPrompt);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBackToStep3}>
            ← 返回资产准备
          </Button>
          <span className="text-sm text-slate-500">
            共 {episode.shots.length} 个镜头
            {allReady && (
              <span className="ml-2 inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                ✅ 全部提示词已就绪
              </span>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={generateAll}
            loading={generatingAll}
            disabled={episode.shots.length === 0}
          >
            {generatingAll ? "批量生成中…" : "一键生成全部提示词"}
          </Button>
          <Button
            size="sm"
            onClick={generateAllVideos}
            disabled={!videoConfigured || !allReady}
            title={!videoConfigured ? "请先配置视频 API" : !allReady ? "请先生成全部提示词" : ""}
          >
            批量生成视频
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50/40 px-4 py-3 text-xs leading-relaxed text-slate-600">
        <p className="mb-1 font-medium text-slate-700">第四步 · 视频生成</p>
        <p>
          每张卡片对应分镜表中的一个镜头。系统根据画面描述中的 @标签 自动关联第三步的资产，
          调用 LLM 生成视频提示词（基于关联资产的外观描述，保证画面主体一致性）。
          关联的资产图片（COS 公网 URL）作为参考图（首帧/参考帧）一起传给火山引擎 Seedance 视频模型。
          视频生成为异步任务，提交后需轮询状态（约 1-5 分钟）。
        </p>
        {!videoConfigured && (
          <p className="mt-2 text-amber-600">
            ⚠ 视频生成 API 未配置，请点击右上角「设置」展开「视频生成 API」区域配置。
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {episode.shots.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/50 py-16 text-center">
          <div className="mb-2 text-4xl opacity-40">🎬</div>
          <p className="text-sm text-slate-500">暂无镜头，请返回第二步生成分镜</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {episode.shots.map((shot, i) => (
            <VideoCard
              key={shot.id}
              shot={shot}
              index={i}
              relatedAssets={getRelatedAssets(shot)}
              allAssets={episode.assets}
              atMentionOptions={atMentionOptions}
              videoModels={videoModels}
              isGeneratingPrompt={generatingIds.has(shot.id)}
              isGeneratingVideo={videoGeneratingIds.has(shot.id)}
              videoConfigured={videoConfigured}
              onGeneratePrompt={() => generateOne(shot)}
              onGenerateVideo={() => generateVideo(shot)}
              onCancelVideo={() => cancelVideo(shot)}
              onUpdatePrompt={(v) => onUpdateShot(shot.id, "finalPrompt", v)}
              onUpdateVisualDescription={(v) => onUpdateShot(shot.id, "visualDescription", v)}
              onUpdateVideoConfig={(patch) => onUpdateVideoConfig(shot.id, patch)}
              onUnlinkAsset={(assetId) => onUnlinkAsset(shot.id, assetId)}
              onLinkAsset={(assetId) => onLinkAsset(shot.id, assetId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 首帧/尾帧图片上传组件（带缩略图预览） */
function FrameImageUpload({
  label,
  url,
  uploading,
  onUpload,
  onRemove,
}: {
  label: string;
  url?: string;
  uploading: boolean;
  onUpload: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] text-slate-500">{label}</span>
      {url ? (
        <div className="group relative">
          <ImageLightbox src={url} alt={label} className="block">
            <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={label} className="h-24 w-full object-cover" />
            </div>
          </ImageLightbox>
          <button
            onClick={onRemove}
            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-400 text-[10px] leading-none text-white hover:bg-red-500"
            title={`移除${label}`}
          >
            ×
          </button>
          <button
            onClick={onUpload}
            className="absolute bottom-1 right-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100"
          >
            更换
          </button>
        </div>
      ) : (
        <button
          onClick={onUpload}
          disabled={uploading}
          className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 bg-white text-[11px] text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-600"
        >
          {uploading ? (
            <>
              <Spinner size={16} /> 上传中…
            </>
          ) : (
            <>+ 上传{label}</>
          )}
        </button>
      )}
    </div>
  );
}

/** 参考视频/音频上传区（竖方框卡片样式，与关联资产卡片一致） */
function MediaUploadArea({
  label,
  icon,
  mediaType,
  items,
  uploading,
  max,
  onUpload,
  onRemove,
  // onAddAsset, // 添加素材ID功能暂时隐藏
}: {
  label: string;
  icon: string;
  mediaType: "video" | "audio";
  items: string[];
  uploading: boolean;
  max: number;
  onUpload: () => void;
  onRemove: (index: number) => void;
  // onAddAsset: () => void; // 添加素材ID功能暂时隐藏
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [thumbErrors, setThumbErrors] = useState<Set<number>>(new Set());

  const markThumbError = (i: number) =>
    setThumbErrors((prev) => new Set(prev).add(i));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500">
          {label}（{items.length}/{max}）
        </span>
        {/* 添加素材ID功能暂时隐藏
        {items.length < max && (
          <Button size="sm" variant="ghost" onClick={onAddAsset}>
            + 素材ID
          </Button>
        )}
        */}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((u, i) => (
          <div
            key={u}
            className={`relative flex w-20 flex-col items-center gap-1 rounded-md border p-1 ${u.startsWith("asset://") ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}
          >
            <button
              onClick={() => onRemove(i)}
              className="absolute -right-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-slate-300 text-[10px] leading-none text-white transition-colors hover:bg-red-400"
              title={`移除${label}${i + 1}`}
            >
              ×
            </button>
            <button
              onClick={() => setPreviewUrl(u)}
              className="flex h-16 w-full items-center justify-center overflow-hidden rounded bg-slate-50 transition-opacity hover:opacity-80"
              title={`点击预览${label}${i + 1}`}
            >
              {u.startsWith("asset://") ? (
                <span className="text-2xl">{icon}</span>
              ) : mediaType === "video" && !thumbErrors.has(i) ? (
                <div className="relative h-full w-full">
                  <video
                    src={u}
                    className="h-full w-full object-cover"
                    muted
                    preload="metadata"
                    onError={() => markThumbError(i)}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white">
                      ▶
                    </span>
                  </div>
                </div>
              ) : (
                <span className="text-2xl">{icon}</span>
              )}
            </button>
            <span className="w-full truncate text-center text-[11px] font-medium text-slate-700">
              {u.startsWith("asset://") ? `素材${i + 1}` : `${label.replace("参考", "")}${i + 1}`}
            </span>
          </div>
        ))}
        {items.length < max && (
          <button
            onClick={onUpload}
            disabled={uploading}
            className="flex w-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 bg-white p-1 text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-600 disabled:opacity-50"
          >
            <div className="flex h-16 w-full items-center justify-center rounded bg-slate-50">
              {uploading ? <Spinner size={16} /> : <span className="text-xl">+</span>}
            </div>
            <span className="text-[10px]">上传{label.replace("参考", "")}</span>
          </button>
        )}
      </div>

      {/* 播放预览 lightbox */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            onClick={() => setPreviewUrl(null)}
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
            aria-label="关闭"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {mediaType === "video" ? (
            <video
              src={previewUrl}
              controls
              autoPlay
              className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="w-full max-w-md rounded-lg bg-white/10 p-8" onClick={(e) => e.stopPropagation()}>
              <audio src={previewUrl} controls autoPlay className="w-full" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 单个视频生成卡片 */
function VideoCard({
  shot,
  index,
  relatedAssets,
  allAssets,
  atMentionOptions,
  videoModels,
  isGeneratingPrompt,
  isGeneratingVideo,
  videoConfigured,
  onGeneratePrompt,
  onGenerateVideo,
  onCancelVideo,
  onUpdatePrompt,
  onUpdateVisualDescription,
  onUpdateVideoConfig,
  onUnlinkAsset,
  onLinkAsset,
}: {
  shot: Shot;
  index: number;
  relatedAssets: Asset[];
  allAssets: Asset[];
  atMentionOptions: { label: string; value: string }[];
  videoModels: ModelEntry[];
  isGeneratingPrompt: boolean;
  isGeneratingVideo: boolean;
  videoConfigured: boolean;
  onGeneratePrompt: () => void;
  onGenerateVideo: () => void;
  onCancelVideo: () => void;
  onUpdatePrompt: (v: string) => void;
  onUpdateVisualDescription: (v: string) => void;
  onUpdateVideoConfig: (patch: Partial<ShotVideoConfig>) => void;
  onUnlinkAsset: (assetId: string) => void;
  onLinkAsset: (assetId: string) => void;
}) {
  const hasPrompt = !!shot.finalPrompt;
  const videoStatus = shot.videoStatus ?? "idle";
  const isVideoReady = videoStatus === "succeeded" && !!shot.videoUrl;
  const isVideoBusy = videoStatus === "queued" || videoStatus === "running" || isGeneratingVideo;

  // 卡片级视频配置（缺省时使用默认模型构建并收敛到能力范围内）
  const defaultVidModel = getDefaultModelValue(videoModels) ?? DEFAULT_SHOT_VIDEO_CONFIG.model;
  const config = shot.videoConfig
    ? shot.videoConfig
    : sanitizeConfig(
        { ...DEFAULT_SHOT_VIDEO_CONFIG, model: defaultVidModel },
        getVideoModelCapability(defaultVidModel, videoModels)
      );
  const cap = getVideoModelCapability(config.model, videoModels);
  const [showVideoConfig, setShowVideoConfig] = useState(false);
  const [showInputMaterials, setShowInputMaterials] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<"video" | "audio" | "firstFrame" | "lastFrame" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pickerTarget, setPickerTarget] = useState<"firstFrame" | "lastFrame" | "refImage" | "refVideo" | null>(null);
  // 添加素材ID功能暂时隐藏
  // const [assetInputKind, setAssetInputKind] = useState<"image" | "video" | "audio" | null>(null);
  // const [assetInputValue, setAssetInputValue] = useState("");

  // @ 补全选项：资产 + 卡片级参考视频/音频（仅在 multimodal-ref 模式下有视频/音频）
  const cardMentionOptions = useMemo(() => {
    const opts = [...atMentionOptions];
    if (config.mode === "multimodal-ref") {
      (config.referenceVideoUrls ?? []).forEach((_, i) => {
        opts.push({ label: `视频${i + 1}`, value: `视频${i + 1}` });
      });
      (config.referenceAudioUrls ?? []).forEach((_, i) => {
        opts.push({ label: `音频${i + 1}`, value: `音频${i + 1}` });
      });
    }
    return opts;
  }, [atMentionOptions, config.mode, config.referenceVideoUrls, config.referenceAudioUrls]);

  /** 切换模型时收敛配置到新模型能力范围内 */
  function changeModel(newModel: string) {
    const newCap = getVideoModelCapability(newModel, videoModels);
    const sanitized = sanitizeConfig({ ...config, model: newModel }, newCap);
    onUpdateVideoConfig(sanitized);
  }

  /** 上传参考素材（视频/音频/首帧图/尾帧图）到 COS，回填 URL 到配置 */
  function handleUploadRef(kind: "video" | "audio" | "firstFrame" | "lastFrame") {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = kind === "video" ? "video/*" : kind === "audio" ? "audio/*" : "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploadingKind(kind);
      setUploadError(null);
      try {
        const url = await uploadRefFile(file, `${kind}-${shot.id}`);
        if (kind === "video") {
          const arr = config.referenceVideoUrls ?? [];
          if (arr.length >= 3) { setUploadError("参考视频最多 3 个"); return; }
          onUpdateVideoConfig({ referenceVideoUrls: [...arr, url] });
        } else if (kind === "audio") {
          const arr = config.referenceAudioUrls ?? [];
          if (arr.length >= 3) { setUploadError("参考音频最多 3 个"); return; }
          onUpdateVideoConfig({ referenceAudioUrls: [...arr, url] });
        } else if (kind === "firstFrame") {
          onUpdateVideoConfig({ firstFrameImageUrl: url });
        } else {
          onUpdateVideoConfig({ lastFrameImageUrl: url });
        }
      } catch (e) {
        setUploadError((e as Error).message);
      } finally {
        setUploadingKind(null);
      }
    };
    input.click();
  }

  /* 添加素材ID功能暂时隐藏
   * 添加 asset:// 素材（预置虚拟人像/已授权真人素材）到参考列表
  function handleAddAsset(kind: "image" | "video" | "audio") {
    const raw = assetInputValue.trim();
    if (!raw) return;
    const url = raw.startsWith("asset://") ? raw : `asset://${raw}`;
    setUploadError(null);
    if (kind === "image") {
      onUpdateVideoConfig({
        referenceImageAssetUrls: [...(config.referenceImageAssetUrls ?? []), url],
      });
    } else if (kind === "video") {
      const arr = config.referenceVideoUrls ?? [];
      if (arr.length >= 3) { setUploadError("参考视频最多 3 个"); return; }
      onUpdateVideoConfig({ referenceVideoUrls: [...arr, url] });
    } else {
      const arr = config.referenceAudioUrls ?? [];
      if (arr.length >= 3) { setUploadError("参考音频最多 3 个"); return; }
      onUpdateVideoConfig({ referenceAudioUrls: [...arr, url] });
    }
    setAssetInputKind(null);
    setAssetInputValue("");
  }
  */

  /** 当用户在提示词中通过 @ 补全选中资产时，自动关联到该镜头；视频/音频无需关联 */
  function handleMentionSelect(assetName: string) {
    if (assetName.startsWith("视频") || assetName.startsWith("音频")) return;
    const asset = allAssets.find(
      (a) => a.name === assetName || a.name.toLowerCase() === assetName.toLowerCase()
    );
    if (asset && !shot.relatedAssetIds?.includes(asset.id)) {
      onLinkAsset(asset.id);
    }
  }

  // 抑制未使用警告（allAssets 保留以备将来扩展）
  void allAssets;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* 卡片头 */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
            {index + 1}
          </span>
          <span className="text-sm font-medium text-slate-700">镜头 {index + 1}</span>
          {shot.duration && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{shot.duration}</span>
          )}
          {shot.shotType && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{shot.shotType}</span>
          )}
          {shot.cameraMovement && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{shot.cameraMovement}镜</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {hasPrompt && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">✅ 提示词已就绪</span>
          )}
          {videoStatus !== "idle" && (
            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE_CLASS[videoStatus]}`}>
              {isVideoBusy && <Spinner size={10} />}
              {STATUS_LABEL[videoStatus]}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* 视频预览区（如有） */}
        {isVideoReady ? (
          <div className="space-y-2">
            <div className="overflow-hidden rounded-lg bg-black">
              <video
                src={shot.videoUrl}
                controls
                className="max-h-64 w-full"
                preload="metadata"
              />
            </div>
            <a
              href={shot.videoUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              下载视频
            </a>
          </div>
        ) : isVideoBusy ? (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-900 text-white">
            <div className="flex flex-col items-center gap-2">
              <Spinner size={28} />
              <span className="text-xs">{STATUS_LABEL[videoStatus] || "处理中…"}（约 1-5 分钟）</span>
            </div>
          </div>
        ) : null}

        {/* 画面描述 */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-black">🖼️ 画面描述</label>
          <EditableCell
            value={shot.visualDescription}
            onChange={onUpdateVisualDescription}
            placeholder="（无）"
            multiline
            minWidth="100%"
            renderTags
            atMentionOptions={cardMentionOptions}
            onAtMentionSelect={handleMentionSelect}
          />
        </div>

        {/* 关联资产（按生成模式动态显示：多模态参考显示参考图；首帧/首尾帧模式隐藏并提示；文生视频整块隐藏） */}
        {config.mode === "multimodal-ref" ? (
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-black">
              🔗 关联资产（参考图）{relatedAssets.length > 0 && ` · ${relatedAssets.length} 个`}
            </label>
            {relatedAssets.length === 0 ? (
              <p className="text-xs text-slate-400">本镜头画面描述中无 @标签，未关联任何资产</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {relatedAssets.map((a) => (
                  <div
                    key={a.id}
                    className="relative flex w-20 flex-col items-center gap-1 rounded-md border border-slate-200 bg-white p-1.5"
                    title={a.description}
                  >
                    {/* 解除关联按钮 */}
                    <button
                      onClick={() => onUnlinkAsset(a.id)}
                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-300 text-[10px] leading-none text-white hover:bg-red-400 transition-colors"
                      title={`解除「${a.name}」与本镜头的关联`}
                    >
                      ×
                    </button>
                    <div className="flex h-16 w-full items-center justify-center overflow-hidden rounded bg-slate-50">
                      {a.imageUrl ? (
                        <ImageLightbox src={a.imageUrl} alt={a.name} className="h-full w-full">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={a.imageUrl} alt={a.name} className="h-full w-full object-cover" />
                        </ImageLightbox>
                      ) : (
                        <span className="text-xs text-slate-300">无图</span>
                      )}
                    </div>
                    <span className={`w-full truncate rounded px-1 py-0.5 text-center text-[10px] ${TYPE_BADGE_CLASS[a.type]}`}>
                      {ASSET_TYPE_LABELS[a.type]}
                    </span>
                    <span className="w-full truncate text-center text-[11px] font-medium text-slate-700">
                      {a.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {relatedAssets.length > 0 && relatedAssets.every((a) => !a.description) && (
              <p className="mt-1 text-xs text-amber-600">
                ⚠ 关联资产尚未生成描述（请返回第三步生成资产信息），提示词可能无法准确引用资产特征
              </p>
            )}
          </div>
        ) : (config.mode === "first-frame" || config.mode === "first-last-frame") ? (
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-black">🔗 关联资产（参考图）</label>
            <p className="text-xs text-amber-600">⚠ 首帧或首尾帧模式不可与多模态混用</p>
          </div>
        ) : null}

        {/* 输入素材（按生成模式动态显示：首帧/首尾帧/多模态参考各显其上传，文生视频整块隐藏） */}
        {config.mode !== "text2video" && (
          <div className="rounded-md border border-slate-200 bg-slate-50/40">
            <button
              type="button"
              onClick={() => setShowInputMaterials(!showInputMaterials)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-black"
            >
              <span className="flex items-center gap-1.5">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className={`transition-transform ${showInputMaterials ? "rotate-90" : ""}`}>
                  <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                🖼️ 输入素材
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                {config.mode === "first-frame" && (config.firstFrameImageUrl ? "已上传首帧" : "未上传")}
                {config.mode === "first-last-frame" && (
                  `${config.firstFrameImageUrl ? "首✓" : "首✗"} ${config.lastFrameImageUrl ? "尾✓" : "尾✗"}`
                )}
                {config.mode === "multimodal-ref" && (
                  `${config.referenceVideoUrls?.length ?? 0}视频 · ${config.referenceAudioUrls?.length ?? 0}音频`
                )}
              </span>
            </button>
            {showInputMaterials && (
              <div className="space-y-2.5 border-t border-slate-200 px-3 py-3">
                {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}

                {config.mode === "first-frame" && (
                  <div className="space-y-2">
                    <FrameImageUpload
                      label="首帧图片"
                      url={config.firstFrameImageUrl}
                      uploading={uploadingKind === "firstFrame"}
                      onUpload={() => handleUploadRef("firstFrame")}
                      onRemove={() => onUpdateVideoConfig({ firstFrameImageUrl: undefined })}
                    />
                    <div className="flex items-center justify-center">
                      <Button size="sm" variant="ghost" onClick={() => setPickerTarget("firstFrame")}>
                        从资产库选
                      </Button>
                    </div>
                  </div>
                )}
                {config.mode === "first-last-frame" && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2.5">
                      <FrameImageUpload
                        label="首帧图片"
                        url={config.firstFrameImageUrl}
                        uploading={uploadingKind === "firstFrame"}
                        onUpload={() => handleUploadRef("firstFrame")}
                        onRemove={() => onUpdateVideoConfig({ firstFrameImageUrl: undefined })}
                      />
                      <FrameImageUpload
                        label="尾帧图片"
                        url={config.lastFrameImageUrl}
                        uploading={uploadingKind === "lastFrame"}
                        onUpload={() => handleUploadRef("lastFrame")}
                        onRemove={() => onUpdateVideoConfig({ lastFrameImageUrl: undefined })}
                      />
                    </div>
                    <div className="flex items-center justify-center gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setPickerTarget("firstFrame")}>
                        首帧：从资产库选
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPickerTarget("lastFrame")}>
                        尾帧：从资产库选
                      </Button>
                    </div>
                  </div>
                )}
                {config.mode === "multimodal-ref" && (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-400">
                      参考图取全部关联资产。
                    </p>

                    {/* 参考图：关联资产 + asset:// 素材 */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-slate-500">参考图：关联资产 {relatedAssets.filter((a) => a.imageUrl).length} 张</span>
                      <Button size="sm" variant="ghost" onClick={() => setPickerTarget("refImage")}>
                        + 从资产库选
                      </Button>
                    </div>
                    {(config.referenceImageAssetUrls?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {config.referenceImageAssetUrls!.map((u, i) => (
                          <span key={u} className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
                            参考图素材{i + 1}
                            <button onClick={() => onUpdateVideoConfig({ referenceImageAssetUrls: config.referenceImageAssetUrls!.filter((_, j) => j !== i) })} className="text-amber-400 hover:text-red-500">×</button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 参考视频：虚线框上传 + asset:// 素材 */}
                    <MediaUploadArea
                      label="参考视频"
                      icon="📹"
                      mediaType="video"
                      items={config.referenceVideoUrls ?? []}
                      uploading={uploadingKind === "video"}
                      max={3}
                      onUpload={() => handleUploadRef("video")}
                      onRemove={(i) => onUpdateVideoConfig({ referenceVideoUrls: (config.referenceVideoUrls ?? []).filter((_, j) => j !== i) })}
                      // onAddAsset={() => { setAssetInputKind("video"); setAssetInputValue(""); }} // 添加素材ID功能暂时隐藏
                    />
                    {(config.referenceVideoUrls?.length ?? 0) < 3 && (
                      <div className="flex justify-center">
                        <Button size="sm" variant="ghost" onClick={() => setPickerTarget("refVideo")}>
                          从资产库选视频
                        </Button>
                      </div>
                    )}

                    {/* 参考音频：虚线框上传 + asset:// 素材 */}
                    <MediaUploadArea
                      label="参考音频"
                      icon="🎵"
                      mediaType="audio"
                      items={config.referenceAudioUrls ?? []}
                      uploading={uploadingKind === "audio"}
                      max={3}
                      onUpload={() => handleUploadRef("audio")}
                      onRemove={(i) => onUpdateVideoConfig({ referenceAudioUrls: (config.referenceAudioUrls ?? []).filter((_, j) => j !== i) })}
                      // onAddAsset={() => { setAssetInputKind("audio"); setAssetInputValue(""); }} // 添加素材ID功能暂时隐藏
                    />

                    {/* 添加素材ID功能暂时隐藏
                    {assetInputKind && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-500">{assetInputKind === "image" ? "参考图" : assetInputKind === "video" ? "视频" : "音频"}素材</span>
                        <input
                          value={assetInputValue}
                          onChange={(e) => setAssetInputValue(e.target.value)}
                          placeholder="素材 ID（如 asset-2026xxxx-xxxx），可带 asset:// 前缀"
                          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-[11px] focus:border-brand-400 focus:outline-none"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); handleAddAsset(assetInputKind); }
                            if (e.key === "Escape") { setAssetInputKind(null); setAssetInputValue(""); }
                          }}
                        />
                        <Button size="sm" variant="primary" onClick={() => handleAddAsset(assetInputKind)}>添加</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setAssetInputKind(null); setAssetInputValue(""); }}>取消</Button>
                      </div>
                    )}
                    */}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 视频参数（卡片级，按模型能力动态渲染） */}
        <div className="rounded-md border border-slate-200 bg-slate-50/40">
          <button
            type="button"
            onClick={() => setShowVideoConfig(!showVideoConfig)}
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-black"
          >
            <span className="flex items-center gap-1.5">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className={`transition-transform ${showVideoConfig ? "rotate-90" : ""}`}>
                <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              ⚙️ 视频参数
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="truncate max-w-[140px]">{videoModels.find((m) => m.value === config.model)?.label ?? config.model}</span>
              <span className="rounded bg-slate-200 px-1 py-0.5">{MODE_LABELS[config.mode]}</span>
              <span>{config.resolution} · {config.duration === -1 ? "自动" : `${config.duration}s`}</span>
            </span>
          </button>
          {showVideoConfig && (
            <div className="space-y-2.5 border-t border-slate-200 px-3 py-3">
              <div className="grid grid-cols-2 gap-2.5">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">模型</span>
                  <select value={config.model} onChange={(e) => changeModel(e.target.value)} className="input">
                    {videoModels.map((m) => (
                      <option key={m.value} value={m.value}>{m.label ?? m.value}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">生成模式</span>
                  <select value={config.mode} onChange={(e) => onUpdateVideoConfig({ mode: e.target.value as VideoGenerationMode })} className="input">
                    {cap.modes.map((m) => (
                      <option key={m} value={m}>{MODE_LABELS[m]}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">分辨率</span>
                  <select value={config.resolution} onChange={(e) => onUpdateVideoConfig({ resolution: e.target.value as VideoResolution })} className="input">
                    {cap.resolutions.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">宽高比</span>
                  <select value={config.ratio} onChange={(e) => onUpdateVideoConfig({ ratio: e.target.value as VideoRatio })} className="input">
                    {cap.ratios.map((r) => (
                      <option key={r} value={r}>{RATIO_LABELS[r]}</option>
                    ))}
                  </select>
                </label>
                <label className="col-span-2 block">
                  <span className="mb-1 block text-[11px] text-slate-500">时长（秒）{cap.durationAuto && " · 支持自动"}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={cap.durationRange[0]}
                      max={cap.durationRange[1]}
                      value={config.duration === -1 ? "" : config.duration}
                      disabled={config.duration === -1}
                      onChange={(e) => onUpdateVideoConfig({ duration: Number(e.target.value) })}
                      className="input"
                    />
                    {cap.durationAuto && (
                      <label className="flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-500">
                        <input
                          type="checkbox"
                          checked={config.duration === -1}
                          onChange={(e) => onUpdateVideoConfig({ duration: e.target.checked ? -1 : cap.durationRange[0] })}
                          className="h-3.5 w-3.5"
                        />
                        自动
                      </label>
                    )}
                  </div>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-0.5">
                <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                  <input type="checkbox" checked={config.watermark} onChange={(e) => onUpdateVideoConfig({ watermark: e.target.checked })} className="h-3.5 w-3.5" />
                  水印
                </label>
                {cap.audio && (
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <input type="checkbox" checked={config.generateAudio} onChange={(e) => onUpdateVideoConfig({ generateAudio: e.target.checked })} className="h-3.5 w-3.5" />
                    有声视频
                  </label>
                )}
                {!cap.audio && config.generateAudio && (
                  <span className="text-[11px] text-slate-400">当前模型不支持有声，已自动关闭</span>
                )}
              </div>

              {/* 高级参数（种子/固定镜头/返回尾帧/联网搜索/优先级/样片） */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-0.5">
                {cap.seed && (
                  <label className="flex items-center gap-1 text-[11px] text-slate-600">
                    <span>种子</span>
                    <input
                      type="number"
                      value={config.seed < 0 ? "" : config.seed}
                      onChange={(e) => onUpdateVideoConfig({ seed: e.target.value === "" ? -1 : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                      placeholder="随机"
                      className="w-16 rounded border border-slate-300 px-1 py-0.5 text-[11px]"
                    />
                  </label>
                )}
                {cap.cameraFixed && (
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <input type="checkbox" checked={config.cameraFixed} onChange={(e) => onUpdateVideoConfig({ cameraFixed: e.target.checked })} className="h-3.5 w-3.5" />
                    固定镜头
                  </label>
                )}
                <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                  <input type="checkbox" checked={config.returnLastFrame} onChange={(e) => onUpdateVideoConfig({ returnLastFrame: e.target.checked })} className="h-3.5 w-3.5" />
                  返回尾帧
                </label>
                {cap.webSearch && (
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <input type="checkbox" checked={config.webSearch} onChange={(e) => onUpdateVideoConfig({ webSearch: e.target.checked })} className="h-3.5 w-3.5" />
                    联网搜索
                  </label>
                )}
                {cap.priority && (
                  <label className="flex items-center gap-1 text-[11px] text-slate-600">
                    <span>优先级</span>
                    <input
                      type="number"
                      min={0}
                      max={9}
                      value={config.priority}
                      onChange={(e) => onUpdateVideoConfig({ priority: Math.max(0, Math.min(9, parseInt(e.target.value, 10) || 0)) })}
                      className="w-12 rounded border border-slate-300 px-1 py-0.5 text-[11px]"
                    />
                  </label>
                )}
                {cap.draft && (
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <input type="checkbox" checked={config.draft} onChange={(e) => onUpdateVideoConfig({ draft: e.target.checked })} className="h-3.5 w-3.5" />
                    样片模式
                  </label>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 视频提示词 */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs font-semibold text-black">
            <span>📝 视频提示词</span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={hasPrompt ? "ghost" : "secondary"}
                onClick={onGeneratePrompt}
                loading={isGeneratingPrompt}
                disabled={isGeneratingPrompt}
              >
                {hasPrompt ? "重新生成" : "生成提示词"}
              </Button>
              <AiOptimizeButton
                text={shot.finalPrompt}
                onOptimized={onUpdatePrompt}
              />
            </div>
          </div>
          <EditableCell
            value={shot.finalPrompt}
            onChange={onUpdatePrompt}
            placeholder="输入视频提示词，或点击上方按钮生成…"
            multiline
            minWidth="100%"
            renderTags
            atMentionOptions={cardMentionOptions}
            onAtMentionSelect={handleMentionSelect}
          />
        </div>

        {/* 操作 */}
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <Button
            size="sm"
            variant="primary"
            onClick={onGenerateVideo}
            disabled={!hasPrompt || isVideoBusy || !videoConfigured}
            loading={isGeneratingVideo}
            title={!videoConfigured ? "请先在设置中配置视频 API" : !hasPrompt ? "请先生成提示词" : ""}
          >
            {isVideoReady ? "重新生成视频" : "生成视频"}
          </Button>
          {(videoStatus === "queued" || videoStatus === "running") && shot.videoTaskId && (
            <Button variant="ghost" size="sm" onClick={onCancelVideo}>
              取消
            </Button>
          )}
          {isGeneratingPrompt && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <Spinner size={11} /> 调用 LLM 中…
            </span>
          )}
        </div>
      </div>

      {pickerTarget && (
        <AssetPicker
          open={!!pickerTarget}
          onClose={() => setPickerTarget(null)}
          mediaType={pickerTarget === "refVideo" ? "video" : "image"}
          multiple={pickerTarget === "refImage" || pickerTarget === "refVideo"}
          max={
            pickerTarget === "refVideo" ? 3 : pickerTarget === "refImage" ? 10 : 1
          }
          selectedUrls={
            pickerTarget === "firstFrame"
              ? config.firstFrameImageUrl ? [config.firstFrameImageUrl] : []
              : pickerTarget === "lastFrame"
                ? config.lastFrameImageUrl ? [config.lastFrameImageUrl] : []
                : pickerTarget === "refImage"
                  ? config.referenceImageAssetUrls ?? []
                  : config.referenceVideoUrls ?? []
          }
          onConfirm={(urls) => {
            if (urls.length === 0) {
              setPickerTarget(null);
              return;
            }
            if (pickerTarget === "firstFrame") {
              onUpdateVideoConfig({ firstFrameImageUrl: urls[0] });
            } else if (pickerTarget === "lastFrame") {
              onUpdateVideoConfig({ lastFrameImageUrl: urls[0] });
            } else if (pickerTarget === "refImage") {
              onUpdateVideoConfig({
                referenceImageAssetUrls: [
                  ...(config.referenceImageAssetUrls ?? []),
                  ...urls,
                ],
              });
            } else if (pickerTarget === "refVideo") {
              const existing = config.referenceVideoUrls ?? [];
              onUpdateVideoConfig({
                referenceVideoUrls: [...existing, ...urls].slice(0, 3),
              });
            }
            setPickerTarget(null);
          }}
        />
      )}
    </div>
  );
}
