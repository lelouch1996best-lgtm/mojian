"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "./ui/Button";
import Spinner from "./ui/Spinner";
import EditableCell from "./EditableCell";
import TaggedText from "./TaggedText";
import ImageLightbox from "./ImageLightbox";
import { callLLM } from "@/lib/llm-client";
import {
  createVideoTask,
  cancelVideoTask,
  pollVideoTask,
  isVideoConfigured,
} from "@/lib/video-client";
import { videoPromptMessages } from "@/lib/prompts";
import { isCosConfigured, getCosSettings } from "@/lib/cos-client";
import { getVideoStyleSuffix } from "@/lib/style-settings";
import { ASSET_TYPE_LABELS, extractTags } from "@/lib/utils";
import type { Asset, Episode, Shot, VideoStatus, StyleSettings } from "@/lib/types";

interface VideoGenerationProps {
  episode: Episode;
  onUpdateShot: (id: string, field: keyof Shot, value: string) => void;
  onUpdateVideoStatus: (id: string, status: VideoStatus) => void;
  onBackToStep3: () => void;
  /** 将资产关联到某个镜头（@ 补全选中时触发） */
  onLinkAsset: (shotId: string, assetId: string) => void;
  /** 解除镜头与资产的关联（× 按钮触发） */
  onUnlinkAsset: (shotId: string, assetId: string) => void;
  /** 系列级漫剧风格设定（优先使用，不传则用全局） */
  seriesStyleSettings?: StyleSettings | null;
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
  idle: "bg-slate-100 text-slate-500",
  queued: "bg-amber-50 text-amber-700",
  running: "bg-amber-100 text-amber-800",
  succeeded: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-600",
  expired: "bg-slate-100 text-slate-500",
  cancelled: "bg-slate-100 text-slate-500",
};

export default function VideoGeneration({
  episode,
  onUpdateShot,
  onUpdateVideoStatus,
  onBackToStep3,
  onLinkAsset,
  onUnlinkAsset,
  seriesStyleSettings,
}: VideoGenerationProps) {
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [videoGeneratingIds, setVideoGeneratingIds] = useState<Set<string>>(new Set());
  const [generatingAll, setGeneratingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [videoConfigured, setVideoConfigured] = useState(false);
  useEffect(() => { isVideoConfigured().then(setVideoConfigured); }, []);

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
      const videoSuffix = await getVideoStyleSuffix(seriesStyleSettings);
      const prompt = await callLLM(
        videoPromptMessages(shot, related, episode.assets, videoSuffix),
        { temperature: 0.6 }
      );
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
    const videoSuffix = await getVideoStyleSuffix(seriesStyleSettings);
    for (const shot of episode.shots) {
      setGeneratingIds((prev) => new Set(prev).add(shot.id));
      try {
        const related = getRelatedAssets(shot);
        const prompt = await callLLM(
          videoPromptMessages(shot, related, episode.assets, videoSuffix),
          { temperature: 0.6 }
        );
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
    onUpdateVideoStatus(shot.id, "queued");
    try {
      // 收集关联资产的图片 URL（作为参考图，已是 COS 公网 URL）
      const related = getRelatedAssets(shot);
      const imageUrls = related
        .map((a) => a.imageUrl)
        .filter((u): u is string => !!u);
      // 拼接视频风格后缀
      const suffix = getVideoStyleSuffix();
      const finalVideoPrompt = suffix
        ? `${shot.finalPrompt}，${suffix}`
        : shot.finalPrompt;
      const createResult = await createVideoTask(finalVideoPrompt, imageUrls);
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
          `镜头 ${episode.shots.indexOf(shot) + 1} 视频生成失败：${final.error ?? final.status}`
        );
      }
    } catch (e) {
      onUpdateVideoStatus(shot.id, "failed");
      setError(`镜头 ${episode.shots.indexOf(shot) + 1} 视频生成失败：${(e as Error).message}`);
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
    if (!isCosConfigured()) return;
    const cosSettings = getCosSettings();
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
      }
    } catch {
      // 转存失败不阻断流程，保留原始 URL（24h 内仍可访问）
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
              <span className="ml-2 inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
                全部提示词已就绪
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
              isGeneratingPrompt={generatingIds.has(shot.id)}
              isGeneratingVideo={videoGeneratingIds.has(shot.id)}
              videoConfigured={videoConfigured}
              onGeneratePrompt={() => generateOne(shot)}
              onGenerateVideo={() => generateVideo(shot)}
              onCancelVideo={() => cancelVideo(shot)}
              onUpdatePrompt={(v) => onUpdateShot(shot.id, "finalPrompt", v)}
              onUnlinkAsset={(assetId) => onUnlinkAsset(shot.id, assetId)}
              onLinkAsset={(assetId) => onLinkAsset(shot.id, assetId)}
            />
          ))}
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
  isGeneratingPrompt,
  isGeneratingVideo,
  videoConfigured,
  onGeneratePrompt,
  onGenerateVideo,
  onCancelVideo,
  onUpdatePrompt,
  onUnlinkAsset,
  onLinkAsset,
}: {
  shot: Shot;
  index: number;
  relatedAssets: Asset[];
  allAssets: Asset[];
  atMentionOptions: { label: string; value: string }[];
  isGeneratingPrompt: boolean;
  isGeneratingVideo: boolean;
  videoConfigured: boolean;
  onGeneratePrompt: () => void;
  onGenerateVideo: () => void;
  onCancelVideo: () => void;
  onUpdatePrompt: (v: string) => void;
  onUnlinkAsset: (assetId: string) => void;
  onLinkAsset: (assetId: string) => void;
}) {
  const hasPrompt = !!shot.finalPrompt;
  const videoStatus = shot.videoStatus ?? "idle";
  const isVideoReady = videoStatus === "succeeded" && !!shot.videoUrl;
  const isVideoBusy = videoStatus === "queued" || videoStatus === "running" || isGeneratingVideo;

  /** 当用户在提示词中通过 @ 补全选中资产时，自动关联到该镜头 */
  function handleMentionSelect(assetName: string) {
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
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">提示词 ✓</span>
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
          <div className="overflow-hidden rounded-lg bg-black">
            <video
              src={shot.videoUrl}
              controls
              className="max-h-64 w-full"
              preload="metadata"
            />
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
          <label className="mb-1 block text-xs font-medium text-slate-500">画面描述</label>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
            <TaggedText text={shot.visualDescription || "（无）"} />
          </div>
        </div>

        {/* 关联资产 */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">
            关联资产（参考图）{relatedAssets.length > 0 && ` · ${relatedAssets.length} 个`}
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

        {/* 视频提示词 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">视频提示词</label>
          {hasPrompt ? (
            <EditableCell
              value={shot.finalPrompt}
              onChange={onUpdatePrompt}
              placeholder="视频提示词…"
              multiline
              minWidth="100%"
              renderTags
              atMentionOptions={atMentionOptions}
              onAtMentionSelect={handleMentionSelect}
            />
          ) : (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/50 px-3 py-3 text-center">
              <p className="text-xs text-slate-400">
                {isGeneratingPrompt ? "正在生成…" : "点击下方按钮生成视频提示词"}
              </p>
            </div>
          )}
        </div>

        {/* 操作 */}
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <Button
            size="sm"
            variant={hasPrompt ? "ghost" : "secondary"}
            onClick={onGeneratePrompt}
            loading={isGeneratingPrompt}
            disabled={isGeneratingPrompt}
          >
            {hasPrompt ? "重新生成提示词" : "生成提示词"}
          </Button>
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
    </div>
  );
}
