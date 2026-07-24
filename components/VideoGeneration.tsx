"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "./ui/Button";
import AiOptimizeButton from "./ui/AiOptimizeButton";
import Spinner from "./ui/Spinner";
import Modal from "./ui/Modal";
import { useConfirm, useErrorDialog } from "./ui/ConfirmDialog";
import EditableCell from "./EditableCell";
import ImageLightbox from "./ImageLightbox";
import AssetPicker from "./AssetPicker";
import PresetPicker from "./PresetPicker";
import { callLLM } from "@/lib/llm-client";
import {
  createVideoTask,
  cancelVideoTask,
  pollVideoTask,
  getVideoSettings,
  isGrokVideoModel,
  getAllConfiguredVideoModels,
} from "@/lib/video-client";
import {
  videoPromptMessages,
  wrapStoryboardTemplate,
  buildShotInfoBlock,
} from "@/lib/prompts";
import { isCosConfigured, transferAsset, uploadRefFile, uploadRefBase64 } from "@/lib/cos-client";
import { recordMediaAsset } from "@/lib/storage";
import { generateImage, getImageSettings, DEFAULT_ASSET_IMAGE_CONFIG, getDefaultAssetImageConfig, resumeImageGeneration, getAllConfiguredImageModels } from "@/lib/image-client";
import { ASSET_TYPE_LABELS, emptyAsset, extractTags, replaceAssetTagsWithImageNos } from "@/lib/utils";
import {
  DEFAULT_SHOT_VIDEO_CONFIG,
  getDefaultShotVideoConfig,
  getVideoModelCapability,
  findModelOption,
  type ModelOption,
  type VideoModelCapability,
} from "@/lib/model-presets";
import { ImageGenerationDialog, type ImageGenerationParams } from "./ImageGenerationDialog";
import { ModelPicker } from "./ModelPicker";
import type {
  Asset,
  AssetImageConfig,
  CharacterProfile,
  Episode,
  PickedPresetItem,
  Shot,
  ShotVideoConfig,
  StyleSettings,
  VideoGenSettings,
  VideoGenerationMode,
  VideoRatio,
  VideoResolution,
  VideoStatus,
} from "@/lib/types";
import { getLatestVersions } from "@/lib/character-settings";
import { getStoryboardTemplateSync } from "@/lib/style-settings";

interface VideoGenerationProps {
  episode: Episode;
  /** 所属企划标题（用于媒体资产账本记录） */
  seriesTitle?: string;
  onUpdateShot: (id: string, field: keyof Shot, value: string) => void;
  onUpdateVideoStatus: (id: string, status: VideoStatus, error?: string) => void;
  /** 卡片级视频配置增量更新（合并写入 shot.videoConfig） */
  onUpdateVideoConfig: (id: string, patch: Partial<ShotVideoConfig>) => void;
  onBackToStep3: () => void;
  /** 新增一个空镜头（在镜头列表末尾追加） */
  onAddRow?: () => void;
  /** 删除指定镜头 */
  onDeleteRow?: (shotId: string) => void;
  /** 上移/下移镜头（交换相邻顺序） */
  onMoveRow?: (shotId: string, direction: "up" | "down") => void;
  /** 将资产关联到某个镜头（@ 补全选中时触发） */
  onLinkAsset: (shotId: string, assetId: string) => void;
  /** 解除镜头与资产的关联（× 按钮触发） */
  onUnlinkAsset: (shotId: string, assetId: string) => void;
  /** 将截屏资产保存到当前剧集 */
  onAddScreenshot: (asset: Asset) => void;
  /** 立即落盘当前 episode（绕过 1500ms 防抖）。用于 imageTaskId 等关键恢复字段，
   *  确保故事板任务创建后即使立刻切路由/刷新，回来仍能恢复轮询。 */
  onPersistNow?: () => void;
  /** 系列级风格设定设定（优先使用，不传则用全局） */
  seriesStyleSettings?: StyleSettings | null;
  /** 系列级人物设定（用于在视频提示词末尾注入角色音色） */
  characterSettings?: CharacterProfile[] | null;
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
  "3:2": "3:2",
  "2:3": "2:3（竖屏）",
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
  if (cap.watermark === false && next.watermark) next.watermark = false;
  return next;
}

/**
 * 计算下一个本地上传参考图的编号（避免与已有"参考图N"重名）。
 * 取现有"参考图N"中的最大编号 + 1；无匹配时返回 1。
 */
function nextRefImgNumber(names: string[] | undefined): number {
  let max = 0;
  for (const n of names ?? []) {
    const m = /^参考图(\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/** 读取参考图在索引 i 处的显示名（缺省回退"参考图N"，N=i+1，兼容旧数据） */
function getRefImgName(names: string[] | undefined, i: number): string {
  return names?.[i]?.trim() || `参考图${i + 1}`;
}

/**
 * 扫描提示词中的 @角色名，返回带 voiceUrl 的人物名称集合（大小写不敏感）。
 * 目前用于在合并参考音色时做名称过滤。
 */

const TYPE_BADGE_CLASS: Record<Asset["type"], string> = {
  character: "bg-[#FDF0E3] text-[#92400E]",
  scene: "bg-[#F7F8E8] text-[#4D7C0F]",
  object: "bg-[#FDF3E3] text-[#92400E]",
  screenshot: "bg-slate-100 text-slate-600",
  storyboard: "bg-amber-50 text-amber-700",
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

const SHOT_TYPES = ["特写", "近景", "中景", "全景", "远景"];
const CAMERA_MOVES = ["推", "拉", "摇", "移", "跟", "固定"];

/** 在视频提示词末尾用代码拼接音色绑定句式（不依赖 LLM 生成） */
function appendVoiceClauses(
  basePrompt: string,
  related: Pick<Asset, "name" | "type">[],
  characterVoiceNames: Set<string>
): string {
  const voiced = related.filter(
    (a) => a.type === "character" && characterVoiceNames.has(a.name.toLowerCase())
  );
  if (!voiced.length) return basePrompt;
  const clauses = voiced
    .map((a) => `@${a.name} 的音色参考@${a.name}音频`)
    .join(" ，");
  let p = basePrompt.trim();
  if (!/[。.！？!?]$/.test(p)) p += "。";
  return `${p}\n【音色参考】${clauses} 。`;
}

export default function VideoGeneration({
  episode,
  seriesTitle,
  onUpdateShot,
  onUpdateVideoStatus,
  onUpdateVideoConfig,
  onBackToStep3,
  onAddRow,
  onDeleteRow,
  onMoveRow,
  onLinkAsset,
  onUnlinkAsset,
  onAddScreenshot,
  onPersistNow,
  seriesStyleSettings,
  characterSettings,
}: VideoGenerationProps) {
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [videoGeneratingIds, setVideoGeneratingIds] = useState<Set<string>>(new Set());
  const [generatingStoryboardIds, setGeneratingStoryboardIds] = useState<Set<string>>(new Set());
  const [capturingIds, setCapturingIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [generatingAll, setGeneratingAll] = useState(false);
  const showError = useErrorDialog();
  const confirm = useConfirm();

  // 所有「已配置 API Key」视频供应商的全部模型（聚合，供卡片模型选择弹框使用）
  const [videoOptions, setVideoOptions] = useState<ModelOption[]>([]);
  // 用户自定义的默认生成参数（设置页维护；初始值为代码兜底，加载完成后覆盖）
  const [defaultVideoConfig, setDefaultVideoConfig] = useState<ShotVideoConfig>(DEFAULT_SHOT_VIDEO_CONFIG);
  const [defaultImageConfig, setDefaultImageConfig] = useState<AssetImageConfig>(DEFAULT_ASSET_IMAGE_CONFIG);

  const [videoConfigured, setVideoConfigured] = useState(false);
  useEffect(() => {
    (async () => {
      const settings = await getVideoSettings();
      setVideoConfigured(!!settings?.apiKey);
      setVideoOptions(await getAllConfiguredVideoModels());
    })();
    getDefaultShotVideoConfig().then(setDefaultVideoConfig);
  }, [seriesStyleSettings]);

  // 图片生成 API 状态（供镜头故事板生成使用）
  const [imageConfigured, setImageConfigured] = useState(false);
  // 所有「已配置 API Key」图片供应商的全部模型（聚合，供故事板模型选择弹框使用）
  const [imageOptions, setImageOptions] = useState<ModelOption[]>([]);
  useEffect(() => {
    (async () => {
      const s = await getImageSettings();
      setImageConfigured(!!s?.apiKey);
      setImageOptions(await getAllConfiguredImageModels());
    })();
    getDefaultAssetImageConfig().then(setDefaultImageConfig);
  }, []);

  // 组件级 AbortController：卸载（切步骤/路由离开/刷新）时取消所有进行中的轮询，
  // 避免孤儿轮询与重新挂载后的恢复轮询产生重复。
  // 同步初始化（而非在 useEffect 中创建），确保首次渲染即可向 VideoCard 传递 signal。
  const abortRef = useRef<AbortController | null>(null);
  if (abortRef.current === null) abortRef.current = new AbortController();
  useEffect(() => {
    const ac = abortRef.current!;
    return () => ac.abort();
  }, []);

  const assetById = useMemo(() => {
    const m = new Map<string, Asset>();
    for (const a of episode.assets) {
      m.set(a.id, a);
    }
    return m;
  }, [episode.assets]);

  // 始终指向最新 episode 的 ref，供异步回调（故事板恢复轮询的 .then）读取最新状态做去重判断，
  // 避免闭包捕获过期 episode 导致重复入库或漏入库。
  const episodeRef = useRef(episode);
  episodeRef.current = episode;

  // 资产按名称索引（小写匹配），用于自动关联
  const assetIdByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of episode.assets) {
      m.set(a.name.toLowerCase(), a.id);
    }
    return m;
  }, [episode.assets]);

  // 已关联音色的人物名称集合（小写），用于卡片角标与 LLM 提示词
  const characterVoiceNames = useMemo(() => {
    const s = new Set<string>();
    for (const c of getLatestVersions(characterSettings ?? [])) {
      if (c.voiceUrl && c.name) s.add(c.name.toLowerCase());
    }
    return s;
  }, [characterSettings]);

  // 当前选中风格的故事板提示词模板（来自风格设定，可在企划风格设定页编辑）
  const storyboardTemplate = useMemo(
    () => getStoryboardTemplateSync(seriesStyleSettings),
    [seriesStyleSettings],
  );

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

  // 进入 Step4 时，恢复未完成的视频任务轮询（刷新/切页后任务不丢失）。
  // 仅在确认视频 API 已配置、AbortController 就绪后执行一次。
  const didResumeRef = useRef(false);
  useEffect(() => {
    if (didResumeRef.current) return;
    if (!videoConfigured || !abortRef.current) return;
    didResumeRef.current = true;
    const signal = abortRef.current.signal;
    for (const shot of episode.shots) {
      if (shot.videoStatus !== "queued" && shot.videoStatus !== "running") continue;
      if (shot.videoTaskId) {
        setVideoGeneratingIds((prev) => new Set(prev).add(shot.id));
        pollAndFinalize(shot, shot.videoTaskId, signal, { silent: true, provider: shot.videoTaskProvider }).finally(() => {
          setVideoGeneratingIds((prev) => {
            const next = new Set(prev);
            next.delete(shot.id);
            return next;
          });
        });
      } else {
        // 任务从未创建或 taskId 丢失 -> 重置为未生成，允许重新生成
        onUpdateVideoStatus(shot.id, "idle");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoConfigured]);

  // 切页/刷新回来后，立即根据 imageTaskId 恢复故事板生成中占位（不等待 imageConfigured 加载完成）。
  // 仅以 imageTaskId 为准（重新生成时旧 storyboardUrl 仍在，但不阻断占位恢复）。
  const didRestoreStoryboardLoading = useRef(false);
  useEffect(() => {
    if (didRestoreStoryboardLoading.current) return;
    didRestoreStoryboardLoading.current = true;
    const ids = episode.shots.filter((s) => s.imageTaskId).map((s) => s.id);
    if (ids.length > 0) {
      setGeneratingStoryboardIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.shots]);

  // 进入 Step4 时，恢复未完成的故事板图片生成轮询（刷新/切页后任务不丢失）。
  const storyboardResumeRef = useRef(false);
  const storyboardPollAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (storyboardResumeRef.current) return;
    if (!imageConfigured || imageOptions.length === 0) return;
    storyboardResumeRef.current = true;
    const ac = new AbortController();
    storyboardPollAbortRef.current = ac;

    for (const shot of episode.shots) {
      if (!shot.imageTaskId) continue;
      // 进入恢复时立即显示占位（重新生成场景下旧 storyboardUrl 仍在，但 imageTaskId 表明有进行中任务）
      setGeneratingStoryboardIds((prev) => new Set(prev).add(shot.id));

      resumeImageGeneration(shot.imageTaskId, shot.imageTaskProvider, undefined, ac.signal)
        .then(async (result) => {
          let finalUrl = result.imageUrl;
          // 读取最新 episode 状态做去重判断（避免闭包捕获过期数据；切页期间原轮询可能已完成并写入新 storyboardUrl）
          const latest = episodeRef.current;
          const latestShot = latest.shots.find((s) => s.id === shot.id);
          if (latestShot && latestShot.imageTaskId !== shot.imageTaskId) {
            // taskId 已变化（被新的生成覆盖），不处理这次结果
            return;
          }
          onUpdateShot(shot.id, "storyboardUrl", finalUrl);
          onUpdateShot(shot.id, "imageTaskId", "");
          // 转存到存储（Seedream 图片 URL 只有 24h 有效期）
          try {
            if (await isCosConfigured()) {
              const { url } = await transferAsset(result.imageUrl, "ai-script/storyboards");
              finalUrl = url;
              onUpdateShot(shot.id, "storyboardUrl", finalUrl);
            }
          } catch (e) {
            console.error("故事板转存存储失败：", (e as Error).message);
          }

          // 计算故事板名称（用于参考图显示名 + 资产名，与 handleGenerateStoryboard 保持一致）
          const shotIdx = latest.shots.findIndex((s) => s.id === shot.id) + 1;
          const existingStoryboards = latest.assets.filter(
            (a) => a.type === "storyboard" && a.shotId === shot.id
          );
          const nextIdx = existingStoryboards.length + 1;
          const storyboardName = `${latest.title || "未命名剧集"}-镜头${shotIdx}-故事板${nextIdx}`;

          // 生成成功后直接放入参考图（保留故事板名称，便于 @ 引用）
          const existingRefImgs = latestShot?.videoConfig?.referenceImageAssetUrls ?? [];
          const existingRefNames = latestShot?.videoConfig?.referenceImageAssetNames ?? [];
          if (!existingRefImgs.includes(finalUrl)) {
            onUpdateVideoConfig(shot.id, {
              referenceImageAssetUrls: [...existingRefImgs, finalUrl],
              referenceImageAssetNames: [...existingRefNames, storyboardName],
            });
          }

          // 保存为故事板资产（避免重复入库）
          const storyboardExists = latest.assets.some(
            (a) => a.type === "storyboard" && a.imageUrl === finalUrl
          );
          if (!storyboardExists) {
            const asset: Asset = {
              ...emptyAsset(storyboardName, "storyboard"),
              imageUrl: finalUrl,
              status: "ready",
              shotId: shot.id,
            };
            onAddScreenshot(asset);
          }
        })
        .catch((err) => {
          // 切页/卸载导致轮询被取消时，保留 imageTaskId 以便下次重新挂载后继续恢复；
          // 仅在真实失败（API 错误/超时）时清除 imageTaskId
          const isAborted = ac.signal.aborted || (err as Error)?.name === "AbortError" || (err as Error)?.message === "已取消";
          if (!isAborted) {
            onUpdateShot(shot.id, "imageTaskId", "");
          }
        })
        .finally(() => {
          setGeneratingStoryboardIds((prev) => {
            const next = new Set(prev);
            next.delete(shot.id);
            return next;
          });
        });
    }

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageConfigured, imageOptions]);

  // @ 补全选项（供所有 VideoCard 共享）：仅包含第三步资产准备中的人物/场景/物品
  const atMentionOptions = useMemo(
    () => episode.assets
      .filter((a) => a.type === "character" || a.type === "scene" || a.type === "object")
      .map((a) => ({ label: a.name, value: a.name })),
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
    try {
      const related = getRelatedAssets(shot);
      const messages = videoPromptMessages(shot, related);
      console.log("[VideoPrompt] 镜头提示词生成 messages：", messages);
      const prompt = await callLLM(messages, { temperature: 0.6 });
      console.log("[VideoPrompt] 镜头提示词生成结果：", prompt);
      onUpdateShot(shot.id, "finalPrompt", prompt.trim());
    } catch (e) {
      showError(`镜头 ${episode.shots.indexOf(shot) + 1} 提示词生成失败：${(e as Error).message}`);
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
        showError(`镜头 ${episode.shots.indexOf(shot) + 1} 提示词生成失败：${(e as Error).message}`);
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

  /**
   * 轮询视频任务并收尾：成功则写入 videoUrl 并转存 COS，失败/超时则更新状态。
   * 被 abort（组件卸载）时直接返回，不改动 videoStatus，保留 running 供下次挂载恢复。
   * @param silent 后台恢复时为 true，不弹错误横幅
   * @param provider 任务创建时的供应商，按此选择查询端点与凭证（支持跨供应商恢复）
   */
  async function pollAndFinalize(
    shot: Shot,
    taskId: string,
    signal: AbortSignal,
    opts?: { silent?: boolean; provider?: VideoGenSettings["provider"] }
  ) {
    const shotIndex = episode.shots.indexOf(shot) + 1;
    try {
      const final = await pollVideoTask(
        taskId,
        (r) => {
          if (r.status === "queued" || r.status === "running") {
            onUpdateVideoStatus(shot.id, r.status);
          }
        },
        10000,
        10 * 60 * 1000,
        signal,
        opts?.provider
      );
      if (signal.aborted) return;
      if (final.status === "succeeded" && final.videoUrl) {
        onUpdateShot(shot.id, "videoUrl", final.videoUrl);
        onUpdateVideoStatus(shot.id, "succeeded");
        // 自动转存到 COS（视频 URL 有有效期）
        const finalVideoUrl = await transferVideoToCos(shot, final.videoUrl);
        // 若 API 返回了尾帧图像，自动转存并保存为截屏资产
        if (final.lastFrameUrl) {
          await saveReturnedLastFrame(shot, final.lastFrameUrl);
        }
        // 记录视频资产到独立账本
        const desc = (shot.visualDescription || "").trim();
        const videoName = desc ? (desc.length > 20 ? desc.slice(0, 20) + "…" : desc) : `镜头${shotIndex}`;
        void recordMediaAsset({
          mediaType: "video",
          url: finalVideoUrl,
          entityType: "shot",
          entityName: videoName,
          prompt: shot.finalPrompt || "",
          source: "shot",
          seriesId: episode.seriesId,
          seriesTitle: seriesTitle ?? "",
          episodeId: episode.id,
          episodeTitle: episode.title,
        });
      } else if (final.status === "cancelled") {
        onUpdateVideoStatus(shot.id, "cancelled");
      } else {
        onUpdateVideoStatus(shot.id, shot.videoUrl ? "succeeded" : (final.status === "expired" ? "expired" : "failed"), final.error ?? final.status);
        if (!opts?.silent) {
          showError(`镜头 ${shotIndex} 视频生成失败：${final.error ?? final.status}`);
        }
      }
    } catch (e) {
      if (signal.aborted) return;
      onUpdateVideoStatus(shot.id, shot.videoUrl ? "succeeded" : "failed", (e as Error).message);
      if (!opts?.silent) {
        showError(`镜头 ${shotIndex} 视频生成失败：${(e as Error).message}`);
      }
    }
  }

  /** 生成单个镜头的视频 */
  async function generateVideo(shot: Shot, opts?: { skipUnusedRefCheck?: boolean }) {
    if (!shot.finalPrompt) {
      showError(`镜头 ${episode.shots.indexOf(shot) + 1} 还没有视频提示词，请先生成`);
      return;
    }
    if (!videoConfigured) {
      showError("未配置视频生成 API，请先在设置中配置");
      return;
    }
    setVideoGeneratingIds((prev) => new Set(prev).add(shot.id));

    // 卡片级视频配置（缺省时使用用户自定义默认参数构建并收敛到能力范围内）
    const defaultVidOption = findModelOption(videoOptions, defaultVideoConfig.provider, defaultVideoConfig.model);
    const defaultVidCap = getVideoModelCapability(
      defaultVideoConfig.model,
      defaultVidOption ? [defaultVidOption.entry] : undefined
    );
    const config = shot.videoConfig
      ? shot.videoConfig
      : sanitizeConfig({ ...defaultVideoConfig }, defaultVidCap);
    const shotIndex = episode.shots.indexOf(shot) + 1;

    // 判断某个 @资源名 是否在 finalPrompt 中被 @ 引用（用词边界避免子串误匹配，如 @林 vs @林坤）
    const prompt = shot.finalPrompt || "";
    const boundaryCharClass = "[\\s，。、,\\.！？!?\\n：:；;）)、】\"'`（）\\[\\]{}｜|《》〈〉…\\-·@的]";
    function mentionedInPrompt(name: string): boolean {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // 匹配 @name 后接边界字符或字符串结尾
      const re = new RegExp(`@${escaped}(?=${boundaryCharClass}|$)`);
      return re.test(prompt);
    }

    // 校验：multimodal-ref 模式下若存在未 @ 引用的素材（参考图 / 参考视频 / 参考音频 / 人物音色），弹框确认
    // 点否：关闭弹框，用户继续编辑；点是：继续生成（后续过滤逻辑会自动丢弃未使用的素材）
    if (!opts?.skipUnusedRefCheck && config.mode === "multimodal-ref") {
      const relatedForCheck = getRelatedAssets(shot);
      const latestCharactersForCheck = getLatestVersions(characterSettings ?? []);

      const unusedImages: string[] = [];
      const unusedVideos: string[] = [];
      const unusedAudios: string[] = [];

      // 参考图：关联资产图片 + 手动参考图（标签可能为资产名或 参考图N）
      relatedForCheck.forEach((a) => {
        if (a.imageUrl && !mentionedInPrompt(a.name)) unusedImages.push(a.name);
      });
      (config.referenceImageAssetUrls ?? []).forEach((_, i) => {
        const tag = getRefImgName(config.referenceImageAssetNames, i);
        if (!mentionedInPrompt(tag)) unusedImages.push(tag);
      });

      // 参考视频：@视频N
      (config.referenceVideoUrls ?? []).forEach((_, i) => {
        if (!mentionedInPrompt(`视频${i + 1}`)) unusedVideos.push(`视频${i + 1}`);
      });

      // 参考音频：@音频N
      (config.referenceAudioUrls ?? []).forEach((_, i) => {
        if (!mentionedInPrompt(`音频${i + 1}`)) unusedAudios.push(`音频${i + 1}`);
      });

      // 人物音色：@人物名音频（仅当该人物已配置 voiceUrl 才算可用素材）
      relatedForCheck
        .filter((a) => a.type === "character")
        .forEach((a) => {
          const matched = latestCharactersForCheck.find(
            (c) => c.name && c.name.toLowerCase() === a.name.toLowerCase()
          );
          if (matched?.voiceUrl && !mentionedInPrompt(`${a.name}音频`)) {
            unusedAudios.push(`${a.name}音频`);
          }
        });

      const total = unusedImages.length + unusedVideos.length + unusedAudios.length;
      if (total > 0) {
        const sections: string[] = [];
        if (unusedImages.length > 0) {
          sections.push(`【参考图】\n${unusedImages.map((n) => `• ${n}`).join("\n")}`);
        }
        if (unusedVideos.length > 0) {
          sections.push(`【参考视频】\n${unusedVideos.map((n) => `• ${n}`).join("\n")}`);
        }
        if (unusedAudios.length > 0) {
          sections.push(`【参考音频】\n${unusedAudios.map((n) => `• ${n}`).join("\n")}`);
        }
        const ok = await confirm({
          message: `检测到以下素材未在提示词中使用：\n${sections.join("\n")}\n是否继续？`,
          confirmText: "是",
          cancelText: "否",
          variant: "primary",
        });
        if (!ok) {
          setVideoGeneratingIds((prev) => { const n = new Set(prev); n.delete(shot.id); return n; });
          return;
        }
      }
    }

    // 关联资产（提前收集，供下方 Grok 校验与参考图收集共用）
    const related = getRelatedAssets(shot);

    // 校验：Grok 模型不支持参考视频/音频，multimodal-ref 模式下若提示词里 @ 了视频/音频则提示会被忽略
    if (isGrokVideoModel(config.model) && config.mode === "multimodal-ref") {
      // 参考视频：@视频N；参考音频：@音频N；人物音色：@人物名音频
      const hasRefVideo = (config.referenceVideoUrls ?? []).some((_, i) => mentionedInPrompt(`视频${i + 1}`));
      const hasRefAudio = (config.referenceAudioUrls ?? []).some((_, i) => mentionedInPrompt(`音频${i + 1}`));
      const hasCharacterVoice = related.some(
        (a) => a.type === "character" && mentionedInPrompt(`${a.name}音频`)
      );
      if (hasRefVideo || hasRefAudio || hasCharacterVoice) {
        const items: string[] = [];
        if (hasRefVideo) items.push("参考视频");
        if (hasRefAudio || hasCharacterVoice) items.push("参考音频");
        const ok = await confirm({
          message: `当前模型 Grok Imagine 1.5 不支持${items.join("和")}，继续生成时将自动忽略${items.join("和")}，仅使用参考图。\n是否继续？`,
          confirmText: "继续",
          cancelText: "取消",
          variant: "primary",
        });
        if (!ok) {
          setVideoGeneratingIds((prev) => { const n = new Set(prev); n.delete(shot.id); return n; });
          return;
        }
      }
    }

    // 收集关联资产的图片 URL：仅保留在 finalPrompt 中被 @ 到的资产（未 @ 的不作为参考图传给 API）
    const usedRelated = related.filter((a) => mentionedInPrompt(a.name));
    const relatedImageUrls = usedRelated
      .map((a) => a.imageUrl)
      .filter((u): u is string => !!u);

    // 构造 @资产名称 -> 图片编号 映射（仅包含实际使用的）
    // 编号顺序与 referenceImageUrls 数组一致：关联资产 -> 手动参考图
    let imgNo = 0;
    const assetImageNo = new Map<string, number | null>();
    for (const a of usedRelated) {
      assetImageNo.set(a.name, a.imageUrl ? ++imgNo : null);
    }
    // 无图但被 @ 到的关联资产：保留在映射中（值为 null），触发替换时去掉 @
    for (const a of related) {
      if (!a.imageUrl && mentionedInPrompt(a.name)) {
        if (!assetImageNo.has(a.name)) assetImageNo.set(a.name, null);
      }
    }

    // 手动上传的参考图：仅保留被 @（参考图N 或资产原名）引用的
    const allRefImgUrls = config.referenceImageAssetUrls ?? [];
    const usedRefImgUrls: string[] = [];
    allRefImgUrls.forEach((url, i) => {
      const tag = getRefImgName(config.referenceImageAssetNames, i);
      if (mentionedInPrompt(tag)) {
        usedRefImgUrls.push(url);
        assetImageNo.set(tag, ++imgNo);
      }
    });

    // 按 mode 派生输入素材并校验
    let firstFrameUrl: string | undefined;
    let lastFrameUrl: string | undefined;
    let referenceImageUrls: string[] | undefined;
    let usedReferenceVideoUrls: string[] | undefined;
    let mergedAudioUrls: string[] | undefined;
    let usedCharacterAudioNames: string[] = [];
    let usedRefAudioIndexes: number[] = [];
    if (config.mode === "first-frame") {
      firstFrameUrl = config.firstFrameImageUrl;
      if (!firstFrameUrl) {
        showError(`镜头 ${shotIndex} 首帧模式需要上传首帧图片，请在卡片参数中上传`);
        setVideoGeneratingIds((prev) => { const n = new Set(prev); n.delete(shot.id); return n; });
        return;
      }
    } else if (config.mode === "first-last-frame") {
      firstFrameUrl = config.firstFrameImageUrl;
      lastFrameUrl = config.lastFrameImageUrl;
      if (!firstFrameUrl || !lastFrameUrl) {
        showError(`镜头 ${shotIndex} 首尾帧模式需要上传首帧与尾帧图片，请在卡片参数中上传`);
        setVideoGeneratingIds((prev) => { const n = new Set(prev); n.delete(shot.id); return n; });
        return;
      }
    } else if (config.mode === "multimodal-ref") {
      // 参考图：只包含被 @ 到的关联资产图片 + 被 @ 到的手动参考图（故事板已作为普通参考图存在于 referenceImageAssetUrls）
      referenceImageUrls = [
        ...relatedImageUrls,
        ...usedRefImgUrls,
      ];

      // 参考视频：只保留被 @视频N 引用的
      const allRefVideoUrls = config.referenceVideoUrls ?? [];
      usedReferenceVideoUrls = allRefVideoUrls.filter((_, i) => mentionedInPrompt(`视频${i + 1}`));

      const vidCount = usedReferenceVideoUrls.length;
      if (referenceImageUrls.length === 0 && vidCount === 0) {
        showError(`镜头 ${shotIndex} 多模态参考模式需至少提供 1 张参考图（在提示词中 @ 关联资产或参考图）或 1 个参考视频（在提示词中 @视频N）`);
        setVideoGeneratingIds((prev) => { const n = new Set(prev); n.delete(shot.id); return n; });
        return;
      }

      // 参考音频：只保留被 @音频N 引用的
      const allRefAudioUrls = config.referenceAudioUrls ?? [];
      const usedRefAudioUrls: string[] = [];
      allRefAudioUrls.forEach((url, i) => {
        if (mentionedInPrompt(`音频${i + 1}`)) {
          usedRefAudioUrls.push(url);
          usedRefAudioIndexes.push(i);
        }
      });

      // 人物音色：只保留被 @人物名音频 引用的关联人物
      const latestCharacters = getLatestVersions(characterSettings ?? []);
      const characterVoiceUrls: string[] = [];
      related
        .filter((a) => a.type === "character")
        .forEach((a) => {
          if (!mentionedInPrompt(`${a.name}音频`)) return;
          const matched = latestCharacters.find(
            (c) => c.name && c.name.toLowerCase() === a.name.toLowerCase()
          );
          if (matched?.voiceUrl) {
            characterVoiceUrls.push(matched.voiceUrl);
            usedCharacterAudioNames.push(a.name);
          }
        });

      // 合并去重，Seedance 上限 3 条
      mergedAudioUrls = Array.from(
        new Set([...usedRefAudioUrls, ...characterVoiceUrls])
      ).slice(0, 3);
    }

    // 构建音频编号映射（与 mergedAudioUrls 顺序一致）：手动音频优先（先加入 mergedAudioUrls），随后人物音色
    const audioNameToNo = new Map<string, number>();
    let audioNo = 0;
    usedRefAudioIndexes.forEach((i) => {
      audioNameToNo.set(`音频${i + 1}`, ++audioNo);
    });
    usedCharacterAudioNames.forEach((name) => {
      audioNameToNo.set(`${name}音频`, ++audioNo);
    });

    onUpdateVideoStatus(shot.id, "queued");
    try {
      // 发送给 Seedance API 前确定性替换 @资产名称 -> 图片N（兜底，不依赖 LLM 自觉）
      // 同时将 @视频N/@人物音频N 等音频标签映射为 音频N
      let finalVideoPrompt = shot.finalPrompt;

      // 先把音色参考句式中的 @人物名 替换为图片N，避免 "@林坤的音色参考" 里的 @林坤 因后接"的"而无法被通用替换命中
      const imageEntries = Array.from(assetImageNo.entries()).filter(([, no]) => no != null) as [string, number][];
      imageEntries.sort((a, b) => b[0].length - a[0].length);
      for (const [name, no] of imageEntries) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        finalVideoPrompt = finalVideoPrompt.replace(
          new RegExp(`@${escaped}(?=的音色参考)`, "g"),
          `图片${no}`
        );
      }

      finalVideoPrompt = replaceAssetTagsWithImageNos(finalVideoPrompt, assetImageNo);

      // 参考视频编号重映射：过滤后的数组下标可能与原始下标不同（如原 @视频3 过滤后变成"视频1"）
      // 先按原始下标 -> 新下标构建映射，从大到小替换避免误匹配
      const videoIndexMap = new Map<number, number>();
      let newVideoNo = 0;
      (config.referenceVideoUrls ?? []).forEach((_, origIdx) => {
        if (mentionedInPrompt(`视频${origIdx + 1}`)) {
          videoIndexMap.set(origIdx + 1, ++newVideoNo);
        }
      });
      // 按原始编号从大到小替换，避免连续替换（如 @视频10 被误匹配为 @视频1）
      const videoOrigNos = Array.from(videoIndexMap.keys()).sort((a, b) => b - a);
      for (const origNo of videoOrigNos) {
        const newNo = videoIndexMap.get(origNo)!;
        const re = new RegExp(`@视频${origNo}(?![0-9])`, "g");
        finalVideoPrompt = finalVideoPrompt.replace(re, `视频${newNo}`);
      }

      // 替换 @人物音频 -> 音频N（按名称长度降序避免子串误匹配，如「音频1」与「林坤音频」）
      const audioEntries = Array.from(audioNameToNo.entries()).sort(
        (a, b) => b[0].length - a[0].length
      );
      const boundary = "[\\s，。、,\\.！？!?\\n：:；;）)、】\"'`（）\\[\\]{}｜|《》〈〉…\\-·@]";
      for (const [name, no] of audioEntries) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`@${escaped}(?=${boundary}|$)`, "g");
        finalVideoPrompt = finalVideoPrompt.replace(re, `音频${no}`);
      }

      // 兜底：把残留的 @音频N（手动输入/补全的原始格式）也去掉 @
      finalVideoPrompt = finalVideoPrompt.replace(/@音频(\d+)/g, "音频$1");

      // 处理音色参考句式的粘连：把 "X的音色参考" 前的逗号改为句号+空格
      finalVideoPrompt = finalVideoPrompt
        .replace(/([，,])\s*([^，。,\n]+的音色参考)/g, "。 $2")
        // 清理可能产生的连续句号与句号后多余空格
        .replace(/。\s*。/g, "。")
        .replace(/。\s+([，,])/g, "。$1");
      const createResult = await createVideoTask({
        prompt: finalVideoPrompt,
        config,
        firstFrameUrl,
        lastFrameUrl,
        referenceImageUrls,
        referenceVideoUrls: config.referenceVideoUrls,
        referenceAudioUrls: mergedAudioUrls,
      });
      onUpdateShot(shot.id, "videoTaskId", createResult.taskId);
      if (createResult.provider) {
        onUpdateShot(shot.id, "videoTaskProvider", createResult.provider);
      }
      onUpdateVideoStatus(shot.id, "running");

      // 轮询任务状态并收尾（内部已捕获轮询错误，仅 createTask 阶段错误会落到 catch）
      await pollAndFinalize(shot, createResult.taskId, abortRef.current!.signal, { provider: createResult.provider });
    } catch (e) {
      onUpdateVideoStatus(shot.id, shot.videoUrl ? "succeeded" : "failed", (e as Error).message);
      showError(`镜头 ${shotIndex} 视频生成失败：${(e as Error).message}`);
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
      showError("未配置视频生成 API");
      return;
    }
    const pending = episode.shots.filter(
      (s) => s.finalPrompt && s.videoStatus !== "succeeded"
    );
    if (pending.length === 0) {
      showError("没有待生成视频的镜头");
      return;
    }
    for (const shot of pending) {
      await generateVideo(shot, { skipUnusedRefCheck: true });
    }
  }

  /** 取消排队中的视频任务（APIMart 为本地取消，ark 为上游 DELETE） */
  async function cancelVideo(shot: Shot) {
    if (!shot.videoTaskId) return;
    try {
      await cancelVideoTask(shot.videoTaskId, shot.videoTaskProvider);
      onUpdateVideoStatus(shot.id, "cancelled");
    } catch (e) {
      showError(`取消失败：${(e as Error).message}`);
    }
  }

  /** 将 Seedance 生成的视频转存到存储（24h 过期保护），返回最终 URL */
  async function transferVideoToCos(shot: Shot, sourceUrl: string): Promise<string> {
    if (!(await isCosConfigured())) return sourceUrl;

    try {
      const { url } = await transferAsset(sourceUrl, "ai-script/videos");
      onUpdateShot(shot.id, "videoUrl", url);
      return url;
    } catch (e) {
      console.error("视频转存存储失败：", (e as Error).message);
      return sourceUrl;
    }
  }

  /** 将 API 返回的尾帧图像转存到存储并保存为截屏资产 */
  async function saveReturnedLastFrame(shot: Shot, sourceUrl: string) {
    const shotIndex = episode.shots.indexOf(shot) + 1;
    try {
      let imageUrl = sourceUrl;
      if (await isCosConfigured()) {
        const { url } = await transferAsset(sourceUrl, "ai-script/screenshots");
        imageUrl = url;
      }

      const name = `${episode.title || "未命名剧集"}-镜头${shotIndex}-尾帧`;
      const asset: Asset = {
        ...emptyAsset(name, "screenshot"),
        imageUrl,
        status: "ready",
        description: `视频尾帧截图：${shot.visualDescription || ""}`.trim(),
      };

      onAddScreenshot(asset);
      void recordMediaAsset({
        mediaType: "image",
        url: imageUrl,
        entityType: "screenshot",
        entityName: name,
        prompt: asset.description,
        source: "screenshot",
        seriesId: episode.seriesId,
        seriesTitle: seriesTitle ?? "",
        episodeId: episode.id,
        episodeTitle: episode.title,
      });
      setSavedIds((prev) => new Set(prev).add(shot.id));
      setTimeout(() => {
        setSavedIds((prev) => {
          const next = new Set(prev);
          next.delete(shot.id);
          return next;
        });
      }, 2000);
    } catch (e) {
      console.error("尾帧转存失败：", (e as Error).message);
    }
  }

  /** 截取视频尾帧并保存为截屏资产 */
  async function captureLastFrame(shot: Shot, index: number) {
    if (!(await isCosConfigured())) {
      showError("请先配置存储方式，再截取尾帧");
      return;
    }
    setCapturingIds((prev) => new Set(prev).add(shot.id));

    try {
      const base64 = await extractVideoLastFrame(shot.videoUrl);
      const name = `${episode.title || "未命名剧集"}-镜头${index + 1}-尾帧`;
      const url = await uploadRefBase64(base64, `screenshot-${shot.id}`);

      const asset: Asset = {
        ...emptyAsset(name, "screenshot"),
        imageUrl: url,
        status: "ready",
        description: `视频尾帧截图：${shot.visualDescription || ""}`.trim(),
      };

      onAddScreenshot(asset);
      void recordMediaAsset({
        mediaType: "image",
        url,
        entityType: "screenshot",
        entityName: name,
        prompt: asset.description,
        source: "screenshot",
        seriesId: episode.seriesId,
        seriesTitle: seriesTitle ?? "",
        episodeId: episode.id,
        episodeTitle: episode.title,
      });
      setSavedIds((prev) => new Set(prev).add(shot.id));
      setTimeout(() => {
        setSavedIds((prev) => {
          const next = new Set(prev);
          next.delete(shot.id);
          return next;
        });
      }, 2000);
    } catch (e) {
      showError(`截取尾帧失败：${(e as Error).message}`);
    } finally {
      setCapturingIds((prev) => {
        const next = new Set(prev);
        next.delete(shot.id);
        return next;
      });
    }
  }

  /** 从视频 URL 提取最后一帧，返回 PNG data URL */
  function extractVideoLastFrame(videoUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      // 必须设置 crossOrigin 才能用 canvas 读取视频像素；
      // 若 COS 桶未返回 Access-Control-Allow-Origin，会触发 CORS 加载失败。
      video.crossOrigin = "anonymous";
      video.src = videoUrl;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";

      let settled = false;
      const cleanup = () => {
        settled = true;
        video.onloadedmetadata = null;
        video.onloadeddata = null;
        video.onseeked = null;
        video.onerror = null;
        video.onstalled = null;
        video.pause();
        video.src = "";
        video.load();
      };

      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(msg));
      };

      const timeout = setTimeout(() => {
        fail("视频加载超时，请检查网络或视频 URL 是否可访问");
      }, 30000);

      video.onloadedmetadata = () => {
        if (!video.duration || !isFinite(video.duration)) {
          clearTimeout(timeout);
          fail("无法获取视频时长");
          return;
        }
        // 先加载足够数据再 seek，避免部分浏览器 seek 失败
        const target = Math.max(0, video.duration - 0.1);
        if (video.readyState >= 2) {
          video.currentTime = target;
        }
      };

      video.onloadeddata = () => {
        if (!video.duration || !isFinite(video.duration)) return;
        video.currentTime = Math.max(0, video.duration - 0.1);
      };

      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 1920;
          canvas.height = video.videoHeight || 1080;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            clearTimeout(timeout);
            fail("创建 canvas 失败");
            return;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/png");
          clearTimeout(timeout);
          cleanup();
          resolve(dataUrl);
        } catch (err) {
          clearTimeout(timeout);
          const code = (video as HTMLVideoElement & { error?: MediaError }).error?.code;
          if (err instanceof DOMException && err.name === "SecurityError") {
            fail(
              "视频跨域策略阻止截图。请将 COS 存储桶的 CORS 配置为允许当前域名访问，或在同域名下使用。"
            );
          } else {
            fail(`截取画面失败${code ? `（视频错误码：${code}）` : ""}：${(err as Error).message}`);
          }
        }
      };

      video.onerror = () => {
        clearTimeout(timeout);
        const code = video.error?.code;
        const codeText: Record<number, string> = {
          1: "MEDIA_ERR_ABORTED",
          2: "MEDIA_ERR_NETWORK",
          3: "MEDIA_ERR_DECODE",
          4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
        };
        const corsHint =
          "截图需要 COS 存储桶开启跨域访问。请在 COS 控制台 > 存储桶详情 > 安全管理 > CORS 设置中添加规则：来源为当前域名（如 http://localhost:3000 或实际部署域名），允许的 Method 包含 GET，允许的 Header 包含 * 或 Origin，并勾选“允许跨域访问”。保存后刷新页面再试。";
        fail(
          code === 2 || code === 4
            ? `视频加载失败（${codeText[code]}），可能是 COS CORS 配置未允许当前域名。${corsHint}`
            : `视频加载失败${code ? `（${codeText[code] ?? code}）` : ""}，请确认视频 URL 可访问且格式正确。${corsHint}`
        );
      };

      video.onstalled = () => {
        // 仅作为日志，不直接失败，由 timeout 兜底
        console.warn("[extractVideoLastFrame] 视频加载停滞");
      };

      video.load();
    });
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

      {episode.shots.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/50 py-16 text-center">
          <div className="mb-2 text-4xl opacity-40">🎬</div>
          <p className="text-sm text-slate-500">
            暂无镜头{onAddRow ? "，可手动添加或返回第二步生成分镜" : "，请返回第二步生成分镜"}
          </p>
          {onAddRow && (
            <Button variant="secondary" size="sm" className="mt-4" onClick={onAddRow}>
              + 添加镜头
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {episode.shots.map((shot, i) => (
              <VideoCard
                key={shot.id}
                shot={shot}
                index={i}
                episode={episode}
                relatedAssets={getRelatedAssets(shot)}
                characterVoiceNames={characterVoiceNames}
                storyboardTemplate={storyboardTemplate}
                allAssets={episode.assets.filter((a) => a.type === "character" || a.type === "scene" || a.type === "object")}
                atMentionOptions={atMentionOptions}
                videoOptions={videoOptions}
                imageConfigured={imageConfigured}
                imageOptions={imageOptions}
                defaultVideoConfig={defaultVideoConfig}
                defaultImageConfig={defaultImageConfig}
                isGeneratingPrompt={generatingIds.has(shot.id)}
                isGeneratingVideo={videoGeneratingIds.has(shot.id)}
                isGeneratingStoryboard={generatingStoryboardIds.has(shot.id)}
                onSetGeneratingStoryboard={(value) =>
                  setGeneratingStoryboardIds((prev) => {
                    const next = new Set(prev);
                    if (value) next.add(shot.id);
                    else next.delete(shot.id);
                    return next;
                  })
                }
                videoConfigured={videoConfigured}
                onGeneratePrompt={() => generateOne(shot)}
                onGenerateVideo={() => generateVideo(shot)}
                onCancelVideo={() => cancelVideo(shot)}
                onUpdatePrompt={(v) => onUpdateShot(shot.id, "finalPrompt", v)}
                onUpdateVisualDescription={(v) => onUpdateShot(shot.id, "visualDescription", v)}
                onUpdateVideoConfig={(patch) => onUpdateVideoConfig(shot.id, patch)}
                onUpdateShotField={(field, value) => onUpdateShot(shot.id, field, value)}
                onUnlinkAsset={(assetId) => onUnlinkAsset(shot.id, assetId)}
                onLinkAsset={(assetId) => onLinkAsset(shot.id, assetId)}
                onCaptureScreenshot={() => captureLastFrame(shot, i + 1)}
                isCapturing={capturingIds.has(shot.id)}
                isSaved={savedIds.has(shot.id)}
                onAddAsset={onAddScreenshot}
                abortSignal={abortRef.current?.signal}
                onPersistNow={onPersistNow}
                seriesTitle={seriesTitle}
                onDeleteShot={onDeleteRow ? () => onDeleteRow(shot.id) : undefined}
                isFirst={i === 0}
                isLast={i === episode.shots.length - 1}
                onMoveShot={
                  onMoveRow
                    ? (dir) => onMoveRow(shot.id, dir)
                    : undefined
                }
              />
            ))}
          </div>
          {onAddRow && (
            <div className="mt-4">
              <Button variant="secondary" size="sm" onClick={onAddRow}>
                + 添加镜头
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 首帧/尾帧图片上传组件（带缩略图预览，hover 更换时可选本地/资产库） */
function FrameImageUpload({
  label,
  url,
  uploading,
  onUpload,
  onPickAsset,
  onRemove,
}: {
  label: string;
  url?: string;
  uploading: boolean;
  onUpload: () => void;
  onPickAsset: () => void;
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
          <div className="absolute bottom-1 right-1 opacity-0 transition-opacity group-hover:opacity-100">
            <AddMediaDropdown
              label={label}
              buttonLabel="更换"
              hideIcon
              uploading={uploading}
              className="h-6 rounded bg-black/60 px-2 text-[10px] text-white hover:bg-black/70 hover:text-white border-0"
              onUpload={() => {
                onRemove();
                onUpload();
              }}
              onPickAsset={() => {
                onRemove();
                onPickAsset();
              }}
            />
          </div>
        </div>
      ) : (
        <AddMediaDropdown
          label={label}
          uploading={uploading}
          className="h-24 w-full"
          onUpload={onUpload}
          onPickAsset={onPickAsset}
        />
      )}
    </div>
  );
}

/** 带 hover 下拉菜单的添加/更换按钮：一个入口，hover 后显示本地上传 / 资产库 / 使用故事板生成 */
function AddMediaDropdown({
  label,
  buttonLabel,
  hideIcon,
  uploading,
  disabled,
  className,
  onUpload,
  onPickAsset,
  onPickPreset,
  onGenerateFromStoryboard,
}: {
  label: string;
  buttonLabel?: string;
  hideIcon?: boolean;
  uploading: boolean;
  disabled?: boolean;
  className?: string;
  onUpload: () => void;
  onPickAsset: () => void;
  /** 从预设库获取 */
  onPickPreset?: () => void;
  /** 参考图区域可选：使用故事板生成图片资产 */
  onGenerateFromStoryboard?: () => void;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        disabled={uploading || disabled}
        className={`flex flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-slate-300 text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-500 disabled:opacity-50 ${className ?? "h-16 w-16"}`}
        title={buttonLabel ? buttonLabel : `添加${label}`}
      >
        {uploading ? <Spinner size={16} /> : !hideIcon && <span className="text-xl leading-none">+</span>}
        <span className="text-[10px]">{buttonLabel ?? `添加${label}`}</span>
      </button>
      <div className="absolute left-full top-0 z-20 hidden flex-col pl-1 group-hover:flex">
        <div className="w-max min-w-[7rem] rounded-md border border-slate-100 bg-white py-1 shadow-lg">
          <button
            type="button"
            onClick={onUpload}
            className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50"
          >
            从本地上传
          </button>
          <button
            type="button"
            onClick={onPickAsset}
            className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50"
          >
            从资产库获取
          </button>
          {onPickPreset && (
            <button
              type="button"
              onClick={onPickPreset}
              className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50"
            >
              从预设库获取
            </button>
          )}
          {onGenerateFromStoryboard && (
            <button
              type="button"
              onClick={onGenerateFromStoryboard}
              className="block w-full px-3 py-1.5 text-left text-xs text-brand-600 hover:bg-brand-50"
            >
              使用故事板生成
            </button>
          )}
        </div>
      </div>
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
  onPickAsset,
  onPickPreset,
  onRemove,
  beforeItems,
  labelSuffix,
  itemBaseName,
  // onAddAsset, // 添加素材ID功能暂时隐藏
}: {
  label: string;
  icon: string;
  mediaType: "video" | "audio";
  items: string[];
  uploading: boolean;
  max: number;
  onUpload: () => void;
  onPickAsset: () => void;
  onPickPreset?: () => void;
  onRemove: (index: number) => void;
  /** 在虚线上传按钮之前渲染的自定义节点（如关联人物音色缩略图） */
  beforeItems?: React.ReactNode;
  /** 覆盖标题右侧显示的数量后缀（用于叠加只读关联项） */
  labelSuffix?: string;
  /** 缩略图底部标签的基础名（默认取 label.replace("参考", "")） */
  itemBaseName?: string;
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
          {label}（{items.length}/{max}{labelSuffix ?? ""}）
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
              {u.startsWith("asset://") ? `素材${i + 1}` : `${itemBaseName ?? label.replace("参考", "")}${i + 1}`}
            </span>
          </div>
        ))}
        {beforeItems}
        {items.length < max && (
          <AddMediaDropdown
            label={label.replace("参考", "")}
            uploading={uploading}
            onUpload={onUpload}
            onPickAsset={onPickAsset}
            onPickPreset={onPickPreset}
          />
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
  episode,
  relatedAssets,
  characterVoiceNames,
  storyboardTemplate,
  allAssets,
  atMentionOptions,
  videoOptions,
  imageConfigured,
  imageOptions,
  defaultVideoConfig,
  defaultImageConfig,
  isGeneratingPrompt,
  isGeneratingVideo,
  isGeneratingStoryboard,
  videoConfigured,
  onGeneratePrompt,
  onGenerateVideo,
  onCancelVideo,
  onUpdatePrompt,
  onUpdateVisualDescription,
  onUpdateVideoConfig,
  onUpdateShotField,
  onUnlinkAsset,
  onLinkAsset,
  onSetGeneratingStoryboard,
  onCaptureScreenshot,
  isCapturing,
  isSaved,
  onAddAsset,
  abortSignal,
  onPersistNow,
  seriesTitle,
  onDeleteShot,
  isFirst,
  isLast,
  onMoveShot,
}: {
  shot: Shot;
  index: number;
  episode: Episode;
  relatedAssets: Asset[];
  characterVoiceNames: Set<string>;
  /** 当前选中风格的故事板提示词模板（含 {镜头信息} 占位符） */
  storyboardTemplate: string;
  allAssets: Asset[];
  atMentionOptions: { label: string; value: string }[];
  /** 所有已配置供应商的视频模型聚合列表（模型选择弹框 + 能力查询使用） */
  videoOptions: ModelOption[];
  imageConfigured: boolean;
  /** 所有已配置供应商的图片模型聚合列表（故事板弹框模型选择 + 能力查询使用） */
  imageOptions: ModelOption[];
  /** 用户自定义的默认视频生成参数（设置页维护；卡片缺省 videoConfig 时回退） */
  defaultVideoConfig: ShotVideoConfig;
  /** 用户自定义的默认图片生成参数（故事板弹框每次打开时作为基础） */
  defaultImageConfig: AssetImageConfig;
  isGeneratingPrompt: boolean;
  isGeneratingVideo: boolean;
  videoConfigured: boolean;
  isCapturing: boolean;
  isSaved: boolean;
  onGeneratePrompt: () => void;
  onGenerateVideo: () => void;
  onCancelVideo: () => void;
  onUpdatePrompt: (v: string) => void;
  onUpdateVisualDescription: (v: string) => void;
  onUpdateVideoConfig: (patch: Partial<ShotVideoConfig>) => void;
  /** 更新镜头任意字段（用于 storyboardUrl / imageTaskId 持久化） */
  onUpdateShotField: (field: keyof Shot, value: string) => void;
  onUnlinkAsset: (assetId: string) => void;
  onLinkAsset: (assetId: string) => void;
  isGeneratingStoryboard: boolean;
  onSetGeneratingStoryboard: (value: boolean) => void;
  onCaptureScreenshot: () => void;
  onAddAsset: (asset: Asset) => void;
  /** 组件级 AbortSignal，切页/卸载时取消故事板图片生成轮询（保留 jobId 供恢复） */
  abortSignal?: AbortSignal;
  /** 立即落盘当前 episode（绕过防抖），用于 imageTaskId 关键字段持久化 */
  onPersistNow?: () => void;
  /** 所属企划标题（用于媒体资产账本记录） */
  seriesTitle?: string;
  /** 删除当前镜头（已由父组件做二次确认或由本卡片确认后调用） */
  onDeleteShot?: () => void;
  /** 是否为第一个镜头（用于禁用上移） */
  isFirst?: boolean;
  /** 是否为最后一个镜头（用于禁用下移） */
  isLast?: boolean;
  /** 上移/下移当前镜头 */
  onMoveShot?: (direction: "up" | "down") => void;
}) {
  const hasPrompt = !!shot.finalPrompt;
  const videoStatus = shot.videoStatus;
  const isVideoReady = videoStatus === "succeeded" && !!shot.videoUrl;
  const isVideoBusy = videoStatus === "queued" || videoStatus === "running" || isGeneratingVideo;

  // 卡片级视频配置（缺省时使用用户自定义默认参数构建并收敛到能力范围内）
  const defaultVidOption = findModelOption(videoOptions, defaultVideoConfig.provider, defaultVideoConfig.model);
  const defaultVidCap = getVideoModelCapability(
    defaultVideoConfig.model,
    defaultVidOption ? [defaultVidOption.entry] : undefined
  );
  const config = shot.videoConfig
    ? shot.videoConfig
    : sanitizeConfig({ ...defaultVideoConfig }, defaultVidCap);
  // 能力查询使用所选模型所属供应商的模型条目（同一模型名在不同供应商下能力可能不同）
  const selectedVidOption = findModelOption(videoOptions, config.provider, config.model);
  const cap = getVideoModelCapability(config.model, selectedVidOption ? [selectedVidOption.entry] : undefined);
  const [showVideoConfig, setShowVideoConfig] = useState(false);
  const [showInputMaterials, setShowInputMaterials] = useState(true);
  const [showShotInfo, setShowShotInfo] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<"video" | "audio" | "firstFrame" | "lastFrame" | "refImage" | null>(null);
  const showError = useErrorDialog();
  const confirm = useConfirm();
  const [pickerTarget, setPickerTarget] = useState<"firstFrame" | "lastFrame" | "refImage" | "refVideo" | "refAudio" | null>(null);
  const [presetPickerTarget, setPresetPickerTarget] = useState<"refImage" | "refVideo" | "refAudio" | "promptText" | null>(null);

  // 故事板生成状态
  const [storyboardOpen, setStoryboardOpen] = useState(false);
  const [storyboardPrompt, setStoryboardPrompt] = useState("");
  const [useStoryboardTemplate, setUseStoryboardTemplate] = useState(true);
  const [storyboardConfig, setStoryboardConfig] = useState<AssetImageConfig>({
    ...defaultImageConfig,
  });
  const [storyboardRefImages, setStoryboardRefImages] = useState<string[]>([]);
  const [storyboardRefImageLabels, setStoryboardRefImageLabels] = useState<string[]>([]);

  /** 删除当前镜头（二次确认） */
  async function handleDeleteShot() {
    const ok = await confirm({
      message: `确定删除镜头 ${index + 1} 吗？\n该镜头的画面描述、视频提示词及已生成的视频将一并移除，且无法撤销。`,
      confirmText: "删除",
    });
    if (ok) onDeleteShot?.();
  }

  /** 将当前镜头信息追加到视频提示词输入框 */
  function addShotInfoToPrompt() {
    const shotInfo = buildShotInfoBlock(shot);
    if (!shotInfo) return;
    const current = shot.finalPrompt ?? "";
    const next = current.trim() ? `${current.trim()}\n\n${shotInfo}` : shotInfo;
    onUpdatePrompt(next);
  }

  /** 将关联人物音色参考句式追加到视频提示词输入框 */
  function addRelatedVoiceClauses() {
    const voiced = relatedAssets.filter(
      (a) => a.type === "character" && characterVoiceNames.has(a.name.toLowerCase())
    );
    if (!voiced.length) return;
    const clauses = voiced
      .map((a) => `@${a.name} 的音色参考@${a.name}音频`)
      .join(" ，");
    const current = shot.finalPrompt ?? "";
    const next = current.trim()
      ? appendVoiceClauses(current.trim(), relatedAssets, characterVoiceNames)
      : `【音色参考】${clauses}。`;
    onUpdatePrompt(next);
  }

  /** 追加故事板引用：从参考图中匹配第一个名字包含“故事板”的，@ 其名 */
  function addStoryboardToPrompt() {
    const names = config.referenceImageAssetNames ?? [];
    const urls = config.referenceImageAssetUrls ?? [];
    const targetName = (() => {
      for (let i = 0; i < urls.length; i++) {
        const n = getRefImgName(names, i);
        if (n.includes("故事板")) return n;
      }
      return null;
    })();
    if (!targetName) {
      showError("参考图中，未包含故事板");
      return;
    }
    const block = `【故事板】\n请参考故事板@${targetName}  生成视频。`;
    const current = shot.finalPrompt ?? "";
    const next = current.trim() ? `${current.trim()}\n\n${block}` : block;
    onUpdatePrompt(next);
  }

  // 添加素材ID功能暂时隐藏
  // const [assetInputKind, setAssetInputKind] = useState<"image" | "video" | "audio" | null>(null);
  // const [assetInputValue, setAssetInputValue] = useState("");

  // @ 补全选项：资产准备 + 卡片级参考图/视频/音频（仅在 multimodal-ref 模式下有视频/音频）
  const cardMentionOptions = useMemo(() => {
    const opts = [...atMentionOptions];
    if (config.mode === "multimodal-ref") {
      // 手动上传的参考图：编号接在关联资产之后
      const refImgCount = relatedAssets.filter((a) => a.imageUrl).length;
      (config.referenceImageAssetUrls ?? []).forEach((_, i) => {
        const name = getRefImgName(config.referenceImageAssetNames, i);
        opts.push({ label: name, value: name });
      });
      void refImgCount;
      (config.referenceVideoUrls ?? []).forEach((_, i) => {
        opts.push({ label: `视频${i + 1}`, value: `视频${i + 1}` });
      });
      (config.referenceAudioUrls ?? []).forEach((_, i) => {
        opts.push({ label: `音频${i + 1}`, value: `音频${i + 1}` });
      });
      // 关联人物音色：@林坤音频
      relatedAssets.forEach((a) => {
        if (a.type === "character" && characterVoiceNames.has(a.name.toLowerCase())) {
          opts.push({ label: `${a.name}音频`, value: `${a.name}音频` });
        }
      });
    }
    return opts;
  }, [atMentionOptions, config.mode, config.referenceImageAssetUrls, config.referenceImageAssetNames, config.referenceVideoUrls, config.referenceAudioUrls, relatedAssets, characterVoiceNames]);

  /** 切换模型时收敛配置到新模型能力范围内（同时记录所选模型所属供应商，生成时按此路由凭证）。
   *  旧模型不支持而被强制关闭的能力，在切回支持该能力的新模型时恢复为用户默认参数，
   *  避免模型间往返切换后自动时长/有声视频等选项卡在关闭状态。 */
  function changeModel(newProvider: string, newModel: string) {
    const newOption = findModelOption(videoOptions, newProvider, newModel);
    const newCap = getVideoModelCapability(newModel, newOption ? [newOption.entry] : undefined);
    const oldOption = findModelOption(videoOptions, config.provider, config.model);
    const oldCap = getVideoModelCapability(config.model, oldOption ? [oldOption.entry] : undefined);
    const merged: ShotVideoConfig = {
      ...config,
      model: newModel,
      provider: newProvider as ShotVideoConfig["provider"],
    };
    if (!oldCap.durationAuto && newCap.durationAuto) {
      merged.duration = defaultVideoConfig.duration;
    }
    if (!oldCap.audio && newCap.audio) {
      merged.generateAudio = defaultVideoConfig.generateAudio;
    }
    if (!oldCap.seed && newCap.seed) {
      merged.seed = defaultVideoConfig.seed;
    }
    if (!oldCap.cameraFixed && newCap.cameraFixed) {
      merged.cameraFixed = defaultVideoConfig.cameraFixed;
    }
    if (!oldCap.webSearch && newCap.webSearch) {
      merged.webSearch = defaultVideoConfig.webSearch;
    }
    if (!oldCap.priority && newCap.priority) {
      merged.priority = defaultVideoConfig.priority;
    }
    if (!oldCap.draft && newCap.draft) {
      merged.draft = defaultVideoConfig.draft;
    }
    if (oldCap.watermark === false && newCap.watermark !== false) {
      merged.watermark = defaultVideoConfig.watermark;
    }
    const sanitized = sanitizeConfig(merged, newCap);
    onUpdateVideoConfig(sanitized);
  }

  /** 上传参考素材（视频/音频/首帧图/尾帧图/参考图）到 COS，回填 URL 到配置 */
  function handleUploadRef(kind: "video" | "audio" | "firstFrame" | "lastFrame" | "refImage") {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = kind === "video" ? "video/*" : kind === "audio" ? "audio/*" : "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploadingKind(kind);
      try {
        const url = await uploadRefFile(file, `${kind}-${shot.id}`);
        const refMediaType = kind === "video" ? "video" : kind === "audio" ? "audio" : "image";
        const refKindLabel = kind === "firstFrame" ? "首帧图" : kind === "lastFrame" ? "尾帧图" : kind === "refImage" ? "参考图" : kind === "video" ? "参考视频" : "参考音频";
        void recordMediaAsset({
          mediaType: refMediaType,
          url,
          entityType: "other",
          entityName: refKindLabel,
          source: "manual",
          seriesId: episode.seriesId,
          seriesTitle: seriesTitle ?? "",
          episodeId: episode.id,
          episodeTitle: episode.title,
        });
        if (kind === "video") {
          const arr = config.referenceVideoUrls ?? [];
          if (arr.length >= 3) { showError("参考视频最多 3 个"); return; }
          onUpdateVideoConfig({ referenceVideoUrls: [...arr, url] });
        } else if (kind === "audio") {
          const arr = config.referenceAudioUrls ?? [];
          if (arr.length >= 3) { showError("参考音频最多 3 个"); return; }
          onUpdateVideoConfig({ referenceAudioUrls: [...arr, url] });
        } else if (kind === "refImage") {
          const names = config.referenceImageAssetNames ?? [];
          const newName = `参考图${nextRefImgNumber(names)}`;
          onUpdateVideoConfig({
            referenceImageAssetUrls: [...(config.referenceImageAssetUrls ?? []), url],
            referenceImageAssetNames: [...names, newName],
          });
        } else if (kind === "firstFrame") {
          onUpdateVideoConfig({ firstFrameImageUrl: url });
        } else {
          onUpdateVideoConfig({ lastFrameImageUrl: url });
        }
      } catch (e) {
        showError((e as Error).message);
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

  /** 根据当前镜头信息与模板开关构建故事板提示词（不依赖 LLM，直接拼接镜头信息） */
  function buildStoryboardPromptText(useTemplate: boolean): string {
    const shotInfo = buildShotInfoBlock(shot);
    return useTemplate ? wrapStoryboardTemplate(shotInfo, storyboardTemplate) : shotInfo;
  }

  /** 打开故事板生成弹框，直接将镜头信息 + 故事板模板填入输入框 */
  function openStoryboardDialog() {
    // 每次打开都以用户自定义默认图片参数为基础（已含默认模型 + 所属供应商）
    setStoryboardConfig({
      ...defaultImageConfig,
    });
    const assetsWithImages = relatedAssets.filter((a) => a.imageUrl);
    setStoryboardRefImages(assetsWithImages.map((a) => a.imageUrl));
    setStoryboardRefImageLabels(assetsWithImages.map((a) => a.name));
    setStoryboardPrompt(buildStoryboardPromptText(useStoryboardTemplate));
    setStoryboardOpen(true);
  }

  /** 切换故事板模板开关时基于镜头信息重新构建提示词 */
  function toggleStoryboardTemplate(useTemplate: boolean) {
    setUseStoryboardTemplate(useTemplate);
    setStoryboardPrompt(buildStoryboardPromptText(useTemplate));
  }

  /** 生成故事板图片 + 转存 COS + 保存为故事板资产 */
  async function handleGenerateStoryboard(params: ImageGenerationParams) {
    setStoryboardOpen(false);
    setStoryboardConfig(params.config);
    onSetGeneratingStoryboard(true);
    try {
      // 发送给图片模型前确定性替换 @资产名称 -> 图片N（兜底，不依赖 LLM 自觉）
      // 编号与 params.images 数组顺序一致；标签缺省时回退 图片N（此时 @图片N -> 图片N 无实质变化）
      const assetImageNo = new Map<string, number | null>();
      const labels = params.imageLabels ?? [];
      params.images.forEach((_, i) => {
        const name = labels[i] || `图片${i + 1}`;
        assetImageNo.set(name, i + 1);
      });
      const finalStoryboardPrompt = replaceAssetTagsWithImageNos(params.prompt, assetImageNo);

      const result = await generateImage(
        finalStoryboardPrompt,
        params.config,
        params.images.length > 0 ? params.images : undefined,
        (jobId) => {
          // 异步任务创建后立即持久化 imageTaskId + imageTaskProvider，切页/刷新后可恢复轮询（按 provider 路由凭证）
          onUpdateShotField("imageTaskId", jobId);
          if (params.config.provider) onUpdateShotField("imageTaskProvider", params.config.provider);
          // 立即落盘：jobId 写入即保存，避免 1.5s 防抖未触发就切路由/刷新导致恢复信息丢失
          onPersistNow?.();
        },
        abortSignal
      );
      let finalUrl = result.imageUrl;
      onUpdateShotField("storyboardUrl", finalUrl);
      onUpdateShotField("imageTaskId", "");
      // 转存到存储（Seedream 图片 URL 只有 24h 有效期）；失败时回退使用临时 URL，不阻断后续入库
      try {
        if (await isCosConfigured()) {
          const { url } = await transferAsset(result.imageUrl, "ai-script/storyboards");
          finalUrl = url;
          onUpdateShotField("storyboardUrl", finalUrl);
        }
      } catch (e) {
        console.error("故事板转存存储失败：", (e as Error).message);
      }

      // 保存为故事板资产：自动命名为“剧集名-镜头名-故事版n”
      const existingStoryboards = episode.assets.filter(
        (a) => a.type === "storyboard" && a.shotId === shot.id
      );
      const nextIndex = existingStoryboards.length + 1;
      const name = `${episode.title || "未命名剧集"}-镜头${index + 1}-故事板${nextIndex}`;

      // 生成成功后直接放入参考图（保留故事板名称，便于 @ 引用）
      onUpdateVideoConfig({
        referenceImageAssetUrls: [...(config.referenceImageAssetUrls ?? []), finalUrl],
        referenceImageAssetNames: [...(config.referenceImageAssetNames ?? []), name],
      });

      const asset: Asset = {
        ...emptyAsset(name, "storyboard"),
        imageUrl: finalUrl,
        status: "ready",
        description: params.prompt,
        shotId: shot.id,
      };
      onAddAsset(asset);
    } catch (e) {
      // 切页/卸载导致轮询被取消时，保留 imageTaskId 以便重新挂载后恢复轮询；
      // 仅在真实失败（API 错误/超时）时清除 imageTaskId 并提示错误。
      // 不依赖共享 abortSignal.aborted：组件卸载后所有并发轮询共享的 signal 会被 abort，
      // 真实失败也会被误判为"已取消"而静默，导致既不报错也不回写图片。
      const isAborted = (e as Error)?.name === "AbortError" || (e as Error)?.message === "已取消";
      if (!isAborted) {
        onUpdateShotField("imageTaskId", "");
        showError(`故事板生成失败：${(e as Error).message}`);
      }
    } finally {
      onSetGeneratingStoryboard(false);
    }
  }

  return (
    <div className="relative z-0 flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:z-30 hover:shadow-md">
      {/* 卡片头 */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
            {index + 1}
          </span>
          <span className="text-sm font-medium text-slate-700">镜头 {index + 1}</span>
          {hasPrompt && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">✅ 提示词已就绪</span>
          )}
          {videoStatus !== "idle" && (
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE_CLASS[videoStatus]}`}
              title={(videoStatus === "failed" || videoStatus === "expired") && shot.videoError ? shot.videoError : undefined}
            >
              {isVideoBusy && <Spinner size={10} />}
              {STATUS_LABEL[videoStatus]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {onMoveShot && (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => onMoveShot("up")}
                disabled={isFirst}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                title="上移"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M12 5l7 7H5l7-7z" fill="currentColor" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => onMoveShot("down")}
                disabled={isLast}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                title="下移"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M12 19l7-7H5l7 7z" fill="currentColor" />
                </svg>
              </button>
            </div>
          )}
          {onDeleteShot && (
            <button
              type="button"
              onClick={handleDeleteShot}
              disabled={isVideoBusy}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              title={isVideoBusy ? "视频生成中，暂无法删除" : "删除镜头"}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
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
            <div className="flex flex-wrap items-center gap-2">
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
              <button
                type="button"
                onClick={onCaptureScreenshot}
                disabled={isCapturing || isSaved}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCapturing ? (
                  <>
                    <Spinner size={12} />
                    <span>截取中…</span>
                  </>
                ) : isSaved ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>已保存到资产库</span>
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                      <path d="M3 8h18" stroke="currentColor" strokeWidth="2" />
                    </svg>
                    <span>截取尾帧</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : isVideoBusy ? (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-900 text-white">
            <div className="flex flex-col items-center gap-2">
              <Spinner size={28} />
              <span className="text-xs">{STATUS_LABEL[videoStatus] || "处理中…"}（约 1-5 分钟）</span>
            </div>
          </div>
        ) : null}

        {/* 分镜信息（含画面描述等全部字段，可编辑并同步回分镜表） */}
        <div className="rounded-md border border-slate-200 bg-slate-50/40">
          <button
            type="button"
            onClick={() => setShowShotInfo(!showShotInfo)}
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-black"
          >
            <span className="flex items-center gap-1.5">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className={`transition-transform ${showShotInfo ? "rotate-90" : ""}`}>
                <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              📋 分镜信息
            </span>
            <span className="text-[11px] text-slate-400">
              {[shot.visualDescription, shot.duration, shot.shotType, shot.lightingMood, shot.dialogueVoiceover, shot.soundEffects, shot.cameraMovement].filter(Boolean).length} / 7 项已填
            </span>
          </button>
          {showShotInfo && (
            <div className="space-y-2.5 border-t border-slate-200 px-3 py-3">
              {/* 画面描述 */}
              <div>
                <label className="mb-1 block text-[11px] text-slate-500">🖼️ 画面描述</label>
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
              <div className="grid grid-cols-3 gap-2.5">
                {/* 时长 */}
                <div>
                  <label className="mb-1 block text-[11px] text-slate-500">⏱️ 时长</label>
                  <EditableCell
                    value={shot.duration}
                    onChange={(v) => onUpdateShotField("duration", v)}
                    placeholder="10-15秒"
                    minWidth="100%"
                  />
                </div>
                {/* 景别 */}
                <div>
                  <label className="mb-1 block text-[11px] text-slate-500">🎥 景别</label>
                  <select
                    value={shot.shotType}
                    onChange={(e) => onUpdateShotField("shotType", e.target.value)}
                    className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 hover:border-brand-300 focus:border-brand-400 focus:outline-none"
                  >
                    <option value="">选择…</option>
                    {SHOT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                {/* 运镜 */}
                <div>
                  <label className="mb-1 block text-[11px] text-slate-500">🎬 运镜</label>
                  <select
                    value={shot.cameraMovement}
                    onChange={(e) => onUpdateShotField("cameraMovement", e.target.value)}
                    className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 hover:border-brand-300 focus:border-brand-400 focus:outline-none"
                  >
                    <option value="">选择…</option>
                    {CAMERA_MOVES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {/* 光影氛围 */}
              <div>
                <label className="mb-1 block text-[11px] text-slate-500">💡 光影氛围</label>
                <EditableCell
                  value={shot.lightingMood}
                  onChange={(v) => onUpdateShotField("lightingMood", v)}
                  placeholder="暖色调 / 逆光…"
                  multiline
                  minWidth="100%"
                />
              </div>
              {/* 对白旁白 */}
              <div>
                <label className="mb-1 block text-[11px] text-slate-500">💬 对白旁白</label>
                <EditableCell
                  value={shot.dialogueVoiceover}
                  onChange={(v) => onUpdateShotField("dialogueVoiceover", v)}
                  placeholder="对白或旁白…"
                  multiline
                  minWidth="100%"
                />
              </div>
              {/* 音效 */}
              <div>
                <label className="mb-1 block text-[11px] text-slate-500">🔊 音效</label>
                <EditableCell
                  value={shot.soundEffects}
                  onChange={(v) => onUpdateShotField("soundEffects", v)}
                  placeholder="雨声 / 钢琴…"
                  multiline
                  minWidth="100%"
                />
              </div>
            </div>
          )}
        </div>

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
                  `${relatedAssets.filter((a) => a.imageUrl).length + (config.referenceImageAssetUrls?.length ?? 0)}图 · ${config.referenceVideoUrls?.length ?? 0}视频 · ${(config.referenceAudioUrls?.length ?? 0) + relatedAssets.filter((a) => a.type === "character" && characterVoiceNames.has(a.name.toLowerCase())).length}音频`
                )}
              </span>
            </button>
            {showInputMaterials && (
              <div className="space-y-2.5 border-t border-slate-200 px-3 py-3">
                {config.mode === "first-frame" && (
                  <div className="space-y-2">
                    <FrameImageUpload
                      label="首帧图片"
                      url={config.firstFrameImageUrl}
                      uploading={uploadingKind === "firstFrame"}
                      onUpload={() => handleUploadRef("firstFrame")}
                      onPickAsset={() => setPickerTarget("firstFrame")}
                      onRemove={() => onUpdateVideoConfig({ firstFrameImageUrl: undefined })}
                    />
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
                        onPickAsset={() => setPickerTarget("firstFrame")}
                        onRemove={() => onUpdateVideoConfig({ firstFrameImageUrl: undefined })}
                      />
                      <FrameImageUpload
                        label="尾帧图片"
                        url={config.lastFrameImageUrl}
                        uploading={uploadingKind === "lastFrame"}
                        onUpload={() => handleUploadRef("lastFrame")}
                        onPickAsset={() => setPickerTarget("lastFrame")}
                        onRemove={() => onUpdateVideoConfig({ lastFrameImageUrl: undefined })}
                      />
                    </div>
                  </div>
                )}
                {config.mode === "multimodal-ref" && (
                  <div className="space-y-2">
                    {/* 参考图：关联资产缩略图 + 手动添加的资产库素材 */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">
                          参考图（{relatedAssets.filter((a) => a.imageUrl).length + (config.referenceImageAssetUrls?.length ?? 0)}）· 关联资产自动作为参考图
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {relatedAssets.length === 0 && (
                          <span className="text-[11px] text-slate-400">
                            画面描述中无 @标签，未关联任何资产
                          </span>
                        )}
                        {relatedAssets.map((a) => {
                          const hasVoice = a.type === "character" && characterVoiceNames.has(a.name.toLowerCase());
                          return (
                            <div
                              key={a.id}
                              className="relative flex w-20 flex-col items-center gap-1 rounded-md border border-slate-200 bg-white p-1"
                              title={hasVoice ? `${a.description ?? ""}\n🎙️ 已关联音色，将作为参考音频` : a.description}
                            >
                              <button
                                onClick={() => onUnlinkAsset(a.id)}
                                className="absolute -right-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-slate-300 text-[10px] leading-none text-white hover:bg-red-400 transition-colors"
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
                              {hasVoice && (
                                <span
                                  className="absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-500/90 text-white shadow"
                                  title="已关联音色"
                                >
                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                                    <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </span>
                              )}
                              <span className="w-full truncate text-center text-[11px] font-medium text-slate-700">
                                {a.name}
                              </span>
                            </div>
                          );
                        })}
                        {(config.referenceImageAssetUrls ?? []).map((u, i) => {
                          const displayName = getRefImgName(config.referenceImageAssetNames, i);
                          return (
                            <div
                              key={u}
                              className="relative flex w-20 flex-col items-center gap-1 rounded-md border border-amber-200 bg-amber-50 p-1"
                              title={displayName}
                            >
                              <button
                                onClick={() => onUpdateVideoConfig({ referenceImageAssetUrls: config.referenceImageAssetUrls!.filter((_, j) => j !== i), referenceImageAssetNames: config.referenceImageAssetNames?.filter((_, j) => j !== i) })}
                                className="absolute -right-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-slate-300 text-[10px] leading-none text-white hover:bg-red-400 transition-colors"
                                title="移除"
                              >
                                ×
                              </button>
                              <div className="flex h-16 w-full items-center justify-center overflow-hidden rounded bg-white">
                                <ImageLightbox src={u} alt={displayName} className="h-full w-full">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={u} alt={displayName} className="h-full w-full object-cover" />
                                </ImageLightbox>
                              </div>
                              <span className="w-full truncate text-center text-[11px] font-medium text-amber-700">
                                {displayName}
                              </span>
                            </div>
                          );
                        })}
                        {isGeneratingStoryboard && (
                          <div
                            className="relative flex w-20 flex-col items-center gap-1 rounded-md border border-dashed border-brand-300 bg-brand-50/50 p-1"
                            title="故事板生成中…"
                          >
                            <div className="flex h-16 w-full items-center justify-center rounded bg-white/60">
                              <Spinner size={16} />
                            </div>
                            <span className="w-full truncate text-center text-[11px] font-medium text-brand-600">
                              生成中…
                            </span>
                          </div>
                        )}
                        <AddMediaDropdown
                          label="图片"
                          uploading={uploadingKind === "refImage"}
                          onUpload={() => handleUploadRef("refImage")}
                          onPickAsset={() => setPickerTarget("refImage")}
                          onPickPreset={() => setPresetPickerTarget("refImage")}
                          onGenerateFromStoryboard={openStoryboardDialog}
                        />
                      </div>
                      {relatedAssets.length > 0 && relatedAssets.every((a) => !a.description) && (
                        <p className="text-xs text-amber-600">
                          ⚠ 关联资产尚未生成描述（请返回第三步生成资产信息），提示词可能无法准确引用资产特征
                        </p>
                      )}
                    </div>

                    {/* 参考视频：一个添加入口 hover 展开本地上传/资产库 */}
                    <MediaUploadArea
                      label="参考视频"
                      icon="📹"
                      mediaType="video"
                      items={config.referenceVideoUrls ?? []}
                      uploading={uploadingKind === "video"}
                      max={3}
                      onUpload={() => handleUploadRef("video")}
                      onPickAsset={() => setPickerTarget("refVideo")}
                      onPickPreset={() => setPresetPickerTarget("refVideo")}
                      onRemove={(i) => onUpdateVideoConfig({ referenceVideoUrls: (config.referenceVideoUrls ?? []).filter((_, j) => j !== i) })}
                      // onAddAsset={() => { setAssetInputKind("video"); setAssetInputValue(""); }} // 添加素材ID功能暂时隐藏
                    />

                    {/* 参考音频：手动上传 + 资产库 + 关联人物音色（只读，同一行展示） */}
                    {(() => {
                      const linkedCharacterVoices = relatedAssets
                        .filter((a) => a.type === "character" && characterVoiceNames.has(a.name.toLowerCase()))
                        .map((a) => ({ name: a.name, imageUrl: a.imageUrl }));
                      const suffix = linkedCharacterVoices.length
                        ? ` · 人物音色 ${linkedCharacterVoices.length}`
                        : "";
                      return (
                        <MediaUploadArea
                          label="参考音频"
                          icon="🎵"
                          mediaType="audio"
                          items={config.referenceAudioUrls ?? []}
                          uploading={uploadingKind === "audio"}
                          max={Math.max(0, 3 - linkedCharacterVoices.length)}
                          onUpload={() => handleUploadRef("audio")}
                          onPickAsset={() => setPickerTarget("refAudio")}
                          onPickPreset={() => setPresetPickerTarget("refAudio")}
                          onRemove={(i) => onUpdateVideoConfig({ referenceAudioUrls: (config.referenceAudioUrls ?? []).filter((_, j) => j !== i) })}
                          labelSuffix={suffix}
                          beforeItems={linkedCharacterVoices.map((c) => (
                            <div
                              key={c.name}
                              className="relative flex w-20 flex-col items-center gap-1 rounded-md border border-brand-200 bg-brand-50/60 p-1"
                              title={`来自关联人物「${c.name}」的音色，将作为参考音频（若需移除，请在第三步取消关联该人物）`}
                            >
                              <div className="flex h-16 w-full items-center justify-center overflow-hidden rounded bg-white">
                                {c.imageUrl ? (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img src={c.imageUrl} alt={c.name} className="h-full w-full object-cover" />
                                ) : (
                                  <span className="text-2xl">🎙️</span>
                                )}
                              </div>
                              <span
                                className="absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-500/90 text-white shadow"
                                title="人物音色"
                              >
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                                  <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </span>
                              <span className="w-full truncate text-center text-[11px] font-medium text-brand-700">
                                {c.name}音频
                              </span>
                            </div>
                          ))}
                        />
                      );
                    })()}

                    {/* 故事板生成已集成到上方“添加图片”子菜单中 */}

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
              <span className="truncate max-w-[140px]">{selectedVidOption?.entry.label ?? config.model}</span>
              <span className="rounded bg-slate-200 px-1 py-0.5">{MODE_LABELS[config.mode]}</span>
              <span>{config.resolution} · {config.duration === -1 ? "自动" : `${config.duration}s`}</span>
            </span>
          </button>
          {showVideoConfig && (
            <div className="space-y-2.5 border-t border-slate-200 px-3 py-3">
              <div className="grid grid-cols-2 gap-2.5">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">模型</span>
                  <ModelPicker
                    options={videoOptions}
                    provider={config.provider}
                    model={config.model}
                    onSelect={(p, m) => changeModel(p, m)}
                  />
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
                {cap.watermark !== false && (
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <input type="checkbox" checked={config.watermark} onChange={(e) => onUpdateVideoConfig({ watermark: e.target.checked })} className="h-3.5 w-3.5" />
                    水印
                  </label>
                )}
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
              <div className="group relative">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-brand-600 hover:bg-brand-50 hover:text-brand-700"
                  title="向视频提示词追加镜头信息或关联音色参考"
                >
                  <svg className="mr-1 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M12 8v8M8 12h8" />
                  </svg>
                  添加提示词
                  <svg className="ml-1 h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </Button>
                <div className="absolute right-0 top-full z-50 hidden flex-col pt-1 group-hover:flex">
                  <div className="w-max min-w-[8rem] rounded-md border border-slate-100 bg-white py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={addShotInfoToPrompt}
                      className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-brand-50 hover:text-brand-700"
                    >
                      添加镜头组信息
                    </button>
                    <button
                      type="button"
                      onClick={addRelatedVoiceClauses}
                      className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-brand-50 hover:text-brand-700"
                    >
                      添加关联音效
                    </button>
                    <button
                      type="button"
                      onClick={addStoryboardToPrompt}
                      className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-brand-50 hover:text-brand-700"
                    >
                      添加故事板
                    </button>
                    <button
                      type="button"
                      onClick={() => setPresetPickerTarget("promptText")}
                      className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-brand-50 hover:text-brand-700"
                    >
                      从预设库获取
                    </button>
                  </div>
                </div>
              </div>
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
          mediaType={pickerTarget === "refVideo" ? "video" : pickerTarget === "refAudio" ? "audio" : "image"}
          multiple={pickerTarget === "refImage" || pickerTarget === "refVideo" || pickerTarget === "refAudio"}
          max={
            pickerTarget === "refVideo" ? 3
              : pickerTarget === "refImage" ? 10
                : pickerTarget === "refAudio" ? 3
                  : 1
          }
          selectedUrls={
            pickerTarget === "firstFrame"
              ? config.firstFrameImageUrl ? [config.firstFrameImageUrl] : []
              : pickerTarget === "lastFrame"
                ? config.lastFrameImageUrl ? [config.lastFrameImageUrl] : []
                : pickerTarget === "refImage"
                  ? config.referenceImageAssetUrls ?? []
                  : pickerTarget === "refAudio"
                    ? config.referenceAudioUrls ?? []
                    : config.referenceVideoUrls ?? []
          }
          onConfirm={(items) => {
            const urls = items.map((i) => i.url);
            if (urls.length === 0) {
              setPickerTarget(null);
              return;
            }
            if (pickerTarget === "firstFrame") {
              onUpdateVideoConfig({ firstFrameImageUrl: urls[0] });
            } else if (pickerTarget === "lastFrame") {
              onUpdateVideoConfig({ lastFrameImageUrl: urls[0] });
            } else if (pickerTarget === "refImage") {
              const existingNames = config.referenceImageAssetNames ?? [];
              const appendedNames: string[] = [];
              for (const it of items) {
                const trimmed = it.name?.trim();
                if (trimmed) {
                  appendedNames.push(trimmed);
                } else {
                  appendedNames.push(`参考图${nextRefImgNumber([...existingNames, ...appendedNames])}`);
                }
              }
              onUpdateVideoConfig({
                referenceImageAssetUrls: [
                  ...(config.referenceImageAssetUrls ?? []),
                  ...urls,
                ],
                referenceImageAssetNames: [...existingNames, ...appendedNames],
              });
            } else if (pickerTarget === "refVideo") {
              const existing = config.referenceVideoUrls ?? [];
              onUpdateVideoConfig({
                referenceVideoUrls: [...existing, ...urls].slice(0, 3),
              });
            } else if (pickerTarget === "refAudio") {
              const existing = config.referenceAudioUrls ?? [];
              onUpdateVideoConfig({
                referenceAudioUrls: [...existing, ...urls].slice(0, 3),
              });
            }
            setPickerTarget(null);
          }}
        />
      )}

      {presetPickerTarget && (
        <PresetPicker
          open={!!presetPickerTarget}
          onClose={() => setPresetPickerTarget(null)}
          type={
            presetPickerTarget === "refImage"
              ? "image"
              : presetPickerTarget === "refVideo"
                ? "video"
                : presetPickerTarget === "refAudio"
                  ? "audio"
                  : "text"
          }
          multiple={true}
          max={
            presetPickerTarget === "refImage"
              ? 10
              : presetPickerTarget === "refVideo" || presetPickerTarget === "refAudio"
                ? 3
                : undefined
          }
          selectedUrls={
            presetPickerTarget === "refImage"
              ? config.referenceImageAssetUrls ?? []
              : presetPickerTarget === "refVideo"
                ? config.referenceVideoUrls ?? []
                : presetPickerTarget === "refAudio"
                  ? config.referenceAudioUrls ?? []
                  : []
          }
          onConfirm={(items: PickedPresetItem[]) => {
            if (presetPickerTarget === "refImage") {
              const urls = items
                .map((i) => i.url)
                .filter((u): u is string => !!u);
              if (urls.length === 0) {
                setPresetPickerTarget(null);
                return;
              }
              const existingNames = config.referenceImageAssetNames ?? [];
              const appendedNames: string[] = [];
              for (const it of items) {
                const trimmed = it.name?.trim();
                if (trimmed) {
                  appendedNames.push(trimmed);
                } else {
                  appendedNames.push(`参考图${nextRefImgNumber([...existingNames, ...appendedNames])}`);
                }
              }
              onUpdateVideoConfig({
                referenceImageAssetUrls: [
                  ...(config.referenceImageAssetUrls ?? []),
                  ...urls,
                ],
                referenceImageAssetNames: [...existingNames, ...appendedNames],
              });
            } else if (presetPickerTarget === "refVideo") {
              const urls = items
                .map((i) => i.url)
                .filter((u): u is string => !!u);
              const existing = config.referenceVideoUrls ?? [];
              onUpdateVideoConfig({
                referenceVideoUrls: [...existing, ...urls].slice(0, 3),
              });
            } else if (presetPickerTarget === "refAudio") {
              const urls = items
                .map((i) => i.url)
                .filter((u): u is string => !!u);
              const existing = config.referenceAudioUrls ?? [];
              onUpdateVideoConfig({
                referenceAudioUrls: [...existing, ...urls].slice(0, 3),
              });
            } else if (presetPickerTarget === "promptText") {
              const texts = items
                .map((i) => i.content ?? "")
                .filter((t) => t.trim());
              if (texts.length > 0) {
                const block = texts.join("\n");
                const current = shot.finalPrompt ?? "";
                const next = current.trim() ? `${current.trim()}\n${block}` : block;
                onUpdatePrompt(next);
              }
            }
            setPresetPickerTarget(null);
          }}
        />
      )}

      <ImageGenerationDialog
        open={storyboardOpen}
        onClose={() => setStoryboardOpen(false)}
        initialPrompt={storyboardPrompt}
        initialConfig={storyboardConfig}
        images={storyboardRefImages}
        onImagesChange={setStoryboardRefImages}
        imageLabels={storyboardRefImageLabels}
        onImageLabelsChange={setStoryboardRefImageLabels}
        imageOptions={imageOptions}
        title="生成故事板"
        confirmText="生成故事板"
        loading={isGeneratingStoryboard}
        onConfirm={handleGenerateStoryboard}
        keepMentionPrefix
        promptFooterExtra={
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={useStoryboardTemplate}
              onChange={(e) => toggleStoryboardTemplate(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-xs text-slate-500">使用默认故事板模板</span>
          </label>
        }
      />
    </div>
  );
}
