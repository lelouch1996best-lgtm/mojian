"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "./ui/Button";
import AiOptimizeButton from "./ui/AiOptimizeButton";
import Spinner from "./ui/Spinner";
import Modal from "./ui/Modal";
import { useConfirm, useErrorDialog } from "./ui/ConfirmDialog";
import EditableCell from "./EditableCell";
import OptionCombobox from "./OptionCombobox";
import { SHOT_TYPES, CAMERA_MOVES } from "@/lib/shot-options";
import ImageLightbox from "./ImageLightbox";
import AssetPicker from "./AssetPicker";
import PresetPicker from "./PresetPicker";
import CameraPlaceholderDialog from "./CameraPlaceholderDialog";
import { callLLM } from "@/lib/llm-client";
import { useAbortableTask } from "@/lib/use-abortable-task";
import {
  createVideoTask,
  cancelVideoTask,
  pollVideoTask,
  isGrokVideoModel,
  getAllConfiguredVideoModels,
} from "@/lib/video-client";
import { estimateVideoCostWith, getUserVideoPriceTable, type VideoPriceEntry } from "@/lib/video-pricing";
import {
  videoPromptMessages,
  optimizeVideoPromptMessages,
  wrapStoryboardTemplate,
  buildShotInfoBlock,
  buildShotInfoBlockForImage,
} from "@/lib/prompts";
import { isCosConfigured, transferAsset, uploadRefFile, uploadRefBase64 } from "@/lib/cos-client";
import { recordMediaAsset } from "@/lib/storage";
import { generateImage, DEFAULT_ASSET_IMAGE_CONFIG, getDefaultAssetImageConfig, getAllConfiguredImageModels } from "@/lib/image-client";
import { recoverImageTasks } from "@/lib/image-task-recovery";
import { ASSET_TYPE_LABELS, emptyAsset, extractTags, extractAllTags, replaceAssetTagsWithImageNos, isMentionedInText, MENTION_BOUNDARY } from "@/lib/utils";
import { useSettingsMentionOptions } from "@/lib/use-settings-mention-options";
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
import Select from "./ui/Select";
import { SmartAddShotDialog } from "./SmartAddShotDialog";
import TagList from "./TagList";
import type {
  Asset,
  AssetImageConfig,
  CharacterProfile,
  Episode,
  ObjectProfile,
  PickedPresetItem,
  SceneProfile,
  Shot,
  ShotVideoConfig,
  StyleSettings,
  VideoGenSettings,
  VideoGenerationMode,
  VideoRatio,
  VideoResolution,
  VideoStatus,
  WorldSettings,
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
  /** 智能添加镜头：根据输入内容 AI 生成完整镜头后追加 */
  onAddSmartShot?: (shot: Shot) => void;
  /** 删除指定镜头 */
  onDeleteRow?: (shotId: string) => void;
  /** 上移/下移镜头（交换相邻顺序） */
  onMoveRow?: (shotId: string, direction: "up" | "down") => void;
  /** 从所有分镜画面描述中移除某个标签的 @ 前缀（删除标注） */
  onRemoveTag?: (tagName: string) => void;
  /** 将资产关联到某个镜头（@ 补全选中时触发） */
  onLinkAsset: (shotId: string, assetId: string) => void;
  /** 解除镜头与资产的关联（× 按钮触发） */
  onUnlinkAsset: (shotId: string, assetId: string) => void;
  /** 将截屏资产保存到当前剧集 */
  onAddScreenshot: (asset: Asset) => void;
  /** @ 选中设定时确保对应资产已存在（不存在则按设定创建），返回资产 id 供关联 */
  onEnsureAssetForSetting?: (name: string) => string | undefined;
  /** 立即落盘当前 episode（绕过 1500ms 防抖）。用于 imageTaskId 等关键恢复字段，
   *  确保故事板任务创建后即使立刻切路由/刷新，回来仍能恢复轮询。
   *  可传 mutate 基于快照构造补丁直写（组件卸载后仍有效）。 */
  onPersistNow?: (mutate?: (ep: Episode) => Episode) => void;
  /** 系列级风格设定设定（优先使用，不传则用全局） */
  seriesStyleSettings?: StyleSettings | null;
  /** 系列级人物设定（用于在视频提示词末尾注入角色音色） */
  characterSettings?: CharacterProfile[] | null;
  /** 系列级世界设定（用于智能添加镜头弹框 @ 选择设定） */
  worldSettings?: WorldSettings | null;
  /** 系列级物品设定（用于智能添加镜头弹框 @ 选择设定） */
  objectSettings?: ObjectProfile[] | null;
  /** 系列级场景设定（用于智能添加镜头弹框 @ 选择设定） */
  sceneSettings?: SceneProfile[] | null;
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

/** 计算下一个"生成图N"的编号（避免与已有"生成图N"重名） */
function nextGenImgNumber(names: string[] | undefined): number {
  let max = 0;
  for (const n of names ?? []) {
    const m = /^生成图(\d+)$/.exec(n);
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
  generated: "bg-violet-50 text-violet-700",
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
  onAddSmartShot,
  onDeleteRow,
  onMoveRow,
  onRemoveTag,
  onLinkAsset,
  onUnlinkAsset,
  onAddScreenshot,
  onEnsureAssetForSetting,
  onPersistNow,
  seriesStyleSettings,
  characterSettings,
  worldSettings,
  objectSettings,
  sceneSettings,
}: VideoGenerationProps) {
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [videoGeneratingIds, setVideoGeneratingIds] = useState<Set<string>>(new Set());
  const [generatingStoryboardIds, setGeneratingStoryboardIds] = useState<Set<string>>(new Set());
  const [capturingIds, setCapturingIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [generatingAll, setGeneratingAll] = useState(false);
  // 提示词生成（generateOne/generateAll）的可中止任务管理，参考 AiOptimizeButton 的停止机制
  const promptAbort = useAbortableTask();
  const [bulkCollapsed, setBulkCollapsed] = useState(false);
  const [bulkCollapseToken, setBulkCollapseToken] = useState(0);
  const [smartAddOpen, setSmartAddOpen] = useState(false);
  const [newlyAddedShotId, setNewlyAddedShotId] = useState<string | null>(null);
  const showError = useErrorDialog();
  const confirm = useConfirm();

  // 所有「已配置 API Key」视频供应商的全部模型（聚合，供卡片模型选择弹框使用）
  const [videoOptions, setVideoOptions] = useState<ModelOption[]>([]);
  // 用户自定义的默认生成参数（设置页维护；初始值为代码兜底，加载完成后覆盖）
  const [defaultVideoConfig, setDefaultVideoConfig] = useState<ShotVideoConfig>(DEFAULT_SHOT_VIDEO_CONFIG);
  const [defaultImageConfig, setDefaultImageConfig] = useState<AssetImageConfig>(DEFAULT_ASSET_IMAGE_CONFIG);

  const [videoConfigured, setVideoConfigured] = useState(false);
  // 视频未配置时弹框提示前往设置
  const [showVideoNotConfiguredModal, setShowVideoNotConfiguredModal] = useState(false);
  useEffect(() => {
    (async () => {
      // 任意供应商有 apiKey 即视为已配置（聚合所有已配置供应商的模型）
      const options = await getAllConfiguredVideoModels();
      setVideoOptions(options);
      setVideoConfigured(options.length > 0);
    })();
    getDefaultShotVideoConfig().then(setDefaultVideoConfig);
  }, [seriesStyleSettings]);

  // 图片生成 API 状态（供镜头故事板生成使用）
  const [imageConfigured, setImageConfigured] = useState(false);
  // 所有「已配置 API Key」图片供应商的全部模型（聚合，供故事板模型选择弹框使用）
  const [imageOptions, setImageOptions] = useState<ModelOption[]>([]);
  useEffect(() => {
    (async () => {
      // 任意供应商有 apiKey 即视为已配置
      const options = await getAllConfiguredImageModels();
      setImageOptions(options);
      setImageConfigured(options.length > 0);
    })();
    getDefaultAssetImageConfig().then(setDefaultImageConfig);
  }, []);

  // 组件级 AbortController：卸载（切步骤/路由离开/刷新）时取消所有进行中的轮询，
  // 避免孤儿轮询与重新挂载后的恢复轮询产生重复。
  // 在 useEffect 中创建（而非渲染期同步初始化），避免 StrictMode 双挂载时
  // 首次挂载创建的 controller 被 abort 后仍被二次挂载复用。
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    return () => { ac.abort(); abortRef.current = null; };
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

  // 最新版本人物的音色映射（按名字小写），作为资产未携带 voiceUrl 时的回退来源
  const latestCharacterVoiceByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of getLatestVersions(characterSettings ?? [])) {
      if (c.voiceUrl && c.name) m.set(c.name.toLowerCase(), c.voiceUrl);
    }
    return m;
  }, [characterSettings]);

  // 已关联音色的人物名称集合（小写），用于卡片角标与 LLM 提示词。
  // 优先取资产所选版本的 voiceUrl（资产准备页切换版本时写入），
  // 未携带时回退该人物最新版本的音色（兼容未经过资产准备页的资产）。
  const characterVoiceNames = useMemo(() => {
    const s = new Set<string>();
    for (const a of episode.assets) {
      if (a.type !== "character" || !a.name) continue;
      const voiceUrl = a.voiceUrl || latestCharacterVoiceByName.get(a.name.toLowerCase());
      if (voiceUrl) s.add(a.name.toLowerCase());
    }
    return s;
  }, [episode.assets, latestCharacterVoiceByName]);

  // 当前选中风格的故事板提示词模板（来自风格设定，可在企划风格设定页编辑）
  const storyboardTemplate = useMemo(
    () => getStoryboardTemplateSync(seriesStyleSettings),
    [seriesStyleSettings],
  );

  // 根据画面描述中的 @标签自动关联资产（进入 Step4 时自动执行，也可通过一键关联手动触发）
  // 对尚不存在的资产，若 @标签匹配系列设定（人物/物品/场景），自动创建并关联
  const linkMentionedAssets = useCallback(
    (shot: Shot) => {
      const tagNames = extractTags(shot.visualDescription);
      for (const tagName of tagNames) {
        if (tagName.startsWith("视频") || tagName.startsWith("音频")) continue;
        const existingId = assetIdByName.get(tagName.toLowerCase());
        const assetId = existingId ?? onEnsureAssetForSetting?.(tagName);
        if (assetId && !shot.relatedAssetIds?.includes(assetId)) {
          onLinkAsset(shot.id, assetId);
        }
      }
    },
    [assetIdByName, onLinkAsset, onEnsureAssetForSetting],
  );

  // 进入 Step4 时，根据画面描述中的 @标签自动关联资产（仅执行一次）
  const didAutoLink = useRef(false);
  useEffect(() => {
    if (didAutoLink.current) return;
    if (episode.assets.length === 0 || episode.shots.length === 0) return;
    didAutoLink.current = true;
    for (const shot of episode.shots) {
      linkMentionedAssets(shot);
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

  // 进入 Step4 时，恢复未完成的故事板/生成图图片任务订阅（刷新/切页后任务不丢失）。
  // 数据加载完成信号：父页面在 episode 为 null 时不渲染本组件（且 key=episode.id 按剧集重挂载），
  // 故挂载时 shots 必已加载完毕，仅需等待 imageConfigured/imageOptions 就绪，避免空数据时恢复空转。
  // 占位恢复也在此统一完成：entries 非空时先批量加入占位，onDone/onFailed 中移除对应占位。
  useEffect(() => {
    if (!imageConfigured || imageOptions.length === 0) return;
    const ac = new AbortController();

    // key 编码 shotId + 任务类型，onDone 按 kind 写回不同字段（storyboard -> storyboardUrl；genImage -> 参考图列表）
    const entries = episode.shots
      .filter((s) => s.imageTaskId)
      .map((s) => ({
        key: `${s.id}:${s.imageTaskKind ?? "storyboard"}`,
        jobId: s.imageTaskId!,
        provider: s.imageTaskProvider,
      }));
    if (entries.length === 0) return;

    const shotIdOf = (key: string) => key.slice(0, key.lastIndexOf(":"));

    // 进入恢复时立即显示占位（重新生成场景下旧 storyboardUrl 仍在，但 imageTaskId 表明有进行中任务）
    setGeneratingStoryboardIds((prev) => {
      const next = new Set(prev);
      entries.forEach((e) => next.add(shotIdOf(e.key)));
      return next;
    });

    recoverImageTasks(entries, {
      onDone: async (key, imageUrl) => {
        // imageUrl 已经服务端 COS 转存，无需再转存
        const shotId = shotIdOf(key);
        const kind = key.slice(key.lastIndexOf(":") + 1);
        try {
          // 读取最新 episode 状态做去重判断（避免闭包捕获过期数据；切页期间原任务可能已完成并写回）
          const entry = entries.find((e) => e.key === key);
          const latest = episodeRef.current;
          const latestShot = latest.shots.find((s) => s.id === shotId);
          if (!latestShot) return;
          if (entry && latestShot.imageTaskId && latestShot.imageTaskId !== entry.jobId) {
            // taskId 已变化（被新的生成覆盖），不处理这次结果
            return;
          }

          // 生成图片任务：按 imageTaskTarget 写入对应字段并存入资产库（类型：生成）
          if (kind === "genImage") {
            onUpdateShot(shotId, "imageTaskId", "");
            onUpdateShot(shotId, "imageTaskProvider", "");
            onUpdateShot(shotId, "imageTaskKind", "");
            onUpdateShot(shotId, "imageTaskTarget", "");
            const target = latestShot.imageTaskTarget ?? "refImage";
            const isFrame = target === "firstFrame" || target === "lastFrame";
            const refNames = latestShot.videoConfig?.referenceImageAssetNames ?? [];
            const genName = isFrame
              ? (target === "firstFrame" ? "首帧图" : "尾帧图")
              : `生成图${nextGenImgNumber(refNames)}`;

            // 写入对应字段：首帧/尾帧模式直接设置帧图；参考图模式追加到参考图列表
            if (target === "firstFrame") {
              onUpdateVideoConfig(shotId, { firstFrameImageUrl: imageUrl });
            } else if (target === "lastFrame") {
              onUpdateVideoConfig(shotId, { lastFrameImageUrl: imageUrl });
            } else {
              const refImgs = latestShot.videoConfig?.referenceImageAssetUrls ?? [];
              if (!refImgs.includes(imageUrl)) {
                onUpdateVideoConfig(shotId, {
                  referenceImageAssetUrls: [...refImgs, imageUrl],
                  referenceImageAssetNames: [...refNames, genName],
                });
              }
            }

            // 存入资产库（类型：生成，避免重复入库）
            const refImgExists = latest.assets.some(
              (a) => a.type === "generated" && a.imageUrl === imageUrl
            );
            if (!refImgExists) {
              const shotIdx = latest.shots.findIndex((s) => s.id === shotId) + 1;
              const assetName = `${latest.title || "未命名剧集"}-镜头${shotIdx}-${genName}`;
              const asset: Asset = {
                ...emptyAsset(assetName, "generated"),
                imageUrl,
                status: "ready",
                shotId,
              };
              onAddScreenshot(asset);
              void recordMediaAsset({
                mediaType: "image",
                url: imageUrl,
                entityType: "generated",
                entityName: assetName,
                prompt: latestShot.finalPrompt ?? "",
                source: "generated",
                seriesId: latest.seriesId,
                seriesTitle: seriesTitle ?? "",
                episodeId: latest.id,
                episodeTitle: latest.title,
              });
            }
            // DB 直写补丁：onUpdateVideoConfig 走 setState，恢复完成后若立即切页，
            // 防抖未触发且 useUnloadPersist 可能读到未渲染的旧 episode，参考图丢失。
            // 此处基于快照直写，保证图片 URL/参考图/资产/清 taskId 落库。
            onPersistNow?.((ep) => {
              const sIdx = ep.shots.findIndex((x) => x.id === shotId);
              if (sIdx < 0) return ep;
              const cur = ep.shots[sIdx];
              const vc = cur.videoConfig;
              let nextVc = vc;
              if (vc) {
                if (target === "firstFrame") {
                  nextVc = { ...vc, firstFrameImageUrl: imageUrl };
                } else if (target === "lastFrame") {
                  nextVc = { ...vc, lastFrameImageUrl: imageUrl };
                } else {
                  const urls = vc.referenceImageAssetUrls ?? [];
                  const vcNames = vc.referenceImageAssetNames ?? [];
                  nextVc = {
                    ...vc,
                    referenceImageAssetUrls: urls.includes(imageUrl) ? urls : [...urls, imageUrl],
                    referenceImageAssetNames: urls.includes(imageUrl) ? vcNames : [...vcNames, genName],
                  };
                }
              }
              const assetExists = ep.assets.some((a) => a.type === "generated" && a.imageUrl === imageUrl);
              const assetName = `${ep.title || "未命名剧集"}-镜头${sIdx + 1}-${genName}`;
              const newAsset: Asset = {
                ...emptyAsset(assetName, "generated"),
                imageUrl,
                status: "ready",
                shotId,
              };
              return {
                ...ep,
                shots: ep.shots.map((x) =>
                  x.id === shotId
                    ? {
                        ...x,
                        imageTaskId: "",
                        imageTaskProvider: undefined,
                        imageTaskKind: undefined,
                        imageTaskTarget: undefined,
                        ...(nextVc ? { videoConfig: nextVc } : {}),
                      }
                    : x
                ),
                assets: assetExists ? ep.assets : [...ep.assets, newAsset],
              };
            });
            return;
          }

          // 故事板任务：设置 storyboardUrl，按 imageTaskTarget 写入帧图或参考图
          onUpdateShot(shotId, "storyboardUrl", imageUrl);
          onUpdateShot(shotId, "imageTaskId", "");
          onUpdateShot(shotId, "imageTaskProvider", "");
          onUpdateShot(shotId, "imageTaskKind", "");
          onUpdateShot(shotId, "imageTaskTarget", "");

          // 计算故事板名称（用于参考图显示名 + 资产名，与 handleGenerateStoryboard 保持一致）
          const shotIdx = latest.shots.findIndex((s) => s.id === shotId) + 1;
          const existingStoryboards = latest.assets.filter(
            (a) => a.type === "storyboard" && a.shotId === shotId
          );
          const nextIdx = existingStoryboards.length + 1;
          const storyboardName = `${latest.title || "未命名剧集"}-镜头${shotIdx}-故事板${nextIdx}`;

          // 写入对应字段：首帧/尾帧模式直接设置帧图；参考图模式追加到参考图列表（保留故事板名称，便于 @ 引用）
          const sbTarget = latestShot.imageTaskTarget ?? "refImage";
          if (sbTarget === "firstFrame") {
            onUpdateVideoConfig(shotId, { firstFrameImageUrl: imageUrl });
          } else if (sbTarget === "lastFrame") {
            onUpdateVideoConfig(shotId, { lastFrameImageUrl: imageUrl });
          } else {
            const existingRefImgs = latestShot.videoConfig?.referenceImageAssetUrls ?? [];
            const existingRefNames = latestShot.videoConfig?.referenceImageAssetNames ?? [];
            if (!existingRefImgs.includes(imageUrl)) {
              onUpdateVideoConfig(shotId, {
                referenceImageAssetUrls: [...existingRefImgs, imageUrl],
                referenceImageAssetNames: [...existingRefNames, storyboardName],
              });
            }
          }

          // 保存为故事板资产（避免重复入库）
          const storyboardExists = latest.assets.some(
            (a) => a.type === "storyboard" && a.imageUrl === imageUrl
          );
          if (!storyboardExists) {
            const asset: Asset = {
              ...emptyAsset(storyboardName, "storyboard"),
              imageUrl,
              status: "ready",
              shotId,
            };
            onAddScreenshot(asset);
          }
          // DB 直写补丁：同 genImage，确保切页前故事板图片/参考图/资产/清 taskId 落库
          onPersistNow?.((ep) => {
            const sIdx = ep.shots.findIndex((x) => x.id === shotId);
            if (sIdx < 0) return ep;
            const cur = ep.shots[sIdx];
            const vc = cur.videoConfig;
            let nextVc = vc;
            if (vc) {
              if (sbTarget === "firstFrame") {
                nextVc = { ...vc, firstFrameImageUrl: imageUrl };
              } else if (sbTarget === "lastFrame") {
                nextVc = { ...vc, lastFrameImageUrl: imageUrl };
              } else {
                const urls = vc.referenceImageAssetUrls ?? [];
                const vcNames = vc.referenceImageAssetNames ?? [];
                nextVc = {
                  ...vc,
                  referenceImageAssetUrls: urls.includes(imageUrl) ? urls : [...urls, imageUrl],
                  referenceImageAssetNames: urls.includes(imageUrl) ? vcNames : [...vcNames, storyboardName],
                };
              }
            }
            const assetExists = ep.assets.some((a) => a.type === "storyboard" && a.imageUrl === imageUrl);
            const newAsset: Asset = {
              ...emptyAsset(storyboardName, "storyboard"),
              imageUrl,
              status: "ready",
              shotId,
            };
            return {
              ...ep,
              shots: ep.shots.map((x) =>
                x.id === shotId
                  ? {
                      ...x,
                      storyboardUrl: imageUrl,
                      imageTaskId: "",
                      imageTaskProvider: undefined,
                      imageTaskKind: undefined,
                      imageTaskTarget: undefined,
                      ...(nextVc ? { videoConfig: nextVc } : {}),
                    }
                  : x
              ),
              assets: assetExists ? ep.assets : [...ep.assets, newAsset],
            };
          });
        } finally {
          setGeneratingStoryboardIds((prev) => {
            const next = new Set(prev);
            next.delete(shotId);
            return next;
          });
        }
      },
      onFailed: (key, error) => {
        // 仅真实失败才回调（取消/切页由 recoverImageTasks 静默，imageTaskId 保留待下次恢复）
        const shotId = shotIdOf(key);
        const shotIdx = episodeRef.current.shots.findIndex((s) => s.id === shotId) + 1;
        onUpdateShot(shotId, "imageTaskId", "");
        onUpdateShot(shotId, "imageTaskProvider", "");
        onUpdateShot(shotId, "imageTaskKind", "");
        onUpdateShot(shotId, "imageTaskTarget", "");
        showError(`镜头 ${shotIdx} 图片生成失败：${error}`);
        setGeneratingStoryboardIds((prev) => {
          const next = new Set(prev);
          next.delete(shotId);
          return next;
        });
      },
    }, ac.signal);

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageConfigured, imageOptions]);

  // 当前所有镜头里的 @ 标签（去重，按首次出现顺序）
  const tags = useMemo(() => extractAllTags(episode.shots), [episode.shots]);

  // 系列设定（人物/物品/场景/世界）@ 补全选项，与第一步一致
  const { options: settingsOptions } = useSettingsMentionOptions({ worldSettings, characterSettings, objectSettings, sceneSettings });
  // @ 补全选项（供所有 VideoCard 共享）：系列设定优先，再补齐第三步资产准备中的人物/场景/物品
  const atMentionOptions = useMemo(() => {
    const seen = new Set<string>();
    const merged: { label: string; value: string }[] = [];
    for (const o of settingsOptions) {
      if (!seen.has(o.value)) {
        seen.add(o.value);
        merged.push(o);
      }
    }
    for (const a of episode.assets) {
      if (a.type === "character" || a.type === "scene" || a.type === "object") {
        if (!seen.has(a.name)) {
          seen.add(a.name);
          merged.push({ label: a.name, value: a.name });
        }
      }
    }
    return merged;
  }, [settingsOptions, episode.assets]);

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
    const signal = promptAbort.start(shot.id);
    try {
      const related = getRelatedAssets(shot);
      const messages = videoPromptMessages(shot, related);
      console.log("[VideoPrompt] 镜头提示词生成 messages：", messages);
      const prompt = await callLLM(messages, { temperature: 0.6, signal });
      console.log("[VideoPrompt] 镜头提示词生成结果：", prompt);
      if (promptAbort.mountedRef.current && !signal.aborted) {
        onUpdateShot(shot.id, "finalPrompt", prompt.trim());
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      showError(`镜头 ${episode.shots.indexOf(shot) + 1} 提示词生成失败：${(e as Error).message}`);
    } finally {
      if (promptAbort.mountedRef.current) {
        promptAbort.clear(shot.id);
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(shot.id);
          return next;
        });
      }
    }
  }

  /** 停止指定镜头的提示词生成 */
  function cancelGeneratePrompt(shot: Shot) {
    promptAbort.stop(shot.id);
    setGeneratingIds((prev) => {
      const next = new Set(prev);
      next.delete(shot.id);
      return next;
    });
  }

  async function generateAll() {
    setGeneratingAll(true);
    for (const shot of episode.shots) {
      setGeneratingIds((prev) => new Set(prev).add(shot.id));
      const signal = promptAbort.start(shot.id);
      try {
        const related = getRelatedAssets(shot);
        const messages = videoPromptMessages(shot, related);
        console.log("[VideoPrompt] 镜头提示词生成 messages：", messages);
        const prompt = await callLLM(messages, { temperature: 0.6, signal });
        console.log("[VideoPrompt] 镜头提示词生成结果：", prompt);
        if (promptAbort.mountedRef.current && !signal.aborted) {
          onUpdateShot(shot.id, "finalPrompt", prompt.trim());
        }
        if (signal.aborted) break;
      } catch (e) {
        if ((e as Error).name === "AbortError") break;
        showError(`镜头 ${episode.shots.indexOf(shot) + 1} 提示词生成失败：${(e as Error).message}`);
        break;
      } finally {
        if (promptAbort.mountedRef.current) {
          promptAbort.clear(shot.id);
          setGeneratingIds((prev) => {
            const next = new Set(prev);
            next.delete(shot.id);
            return next;
          });
        }
      }
    }
    setGeneratingAll(false);
  }

  /** 停止批量生成提示词 */
  function cancelGenerateAll() {
    promptAbort.stopAll();
    setGeneratingIds(new Set());
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
  async function generateVideo(shot: Shot, opts?: { skipUnusedRefCheck?: boolean; validateOnly?: boolean }): Promise<boolean> {
    if (!shot.finalPrompt) {
      showError(`镜头 ${episode.shots.indexOf(shot) + 1} 还没有视频提示词，请先生成`);
      return false;
    }
    if (!videoConfigured) {
      setShowVideoNotConfiguredModal(true);
      return false;
    }

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
    // 「的」作为额外尾部边界，使「@林坤的音色参考」中的 @林坤 被识别为已提及
    function mentionedInPrompt(name: string): boolean {
      return isMentionedInText(prompt, name, "的");
    }

    // 校验：multimodal-ref 模式下若存在未 @ 引用的素材（参考图 / 参考视频 / 参考音频 / 人物音色），弹框确认
    // 点否：关闭弹框，用户继续编辑；点是：继续生成（后续过滤逻辑会自动丢弃未使用的素材）
    if (!opts?.skipUnusedRefCheck && config.mode === "multimodal-ref") {
      const relatedForCheck = getRelatedAssets(shot);

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
          const voiceUrl = a.voiceUrl || latestCharacterVoiceByName.get(a.name.toLowerCase());
          if (voiceUrl && !mentionedInPrompt(`${a.name}音频`)) {
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
          return false;
        }
      }
    }

    // 关联资产（提前收集，供下方 Grok 校验与参考图收集共用）
    const related = getRelatedAssets(shot);

    // 校验：Grok 模型不支持参考视频/音频，multimodal-ref 模式下若提示词里 @ 了视频/音频则提示会被忽略
    if (!opts?.skipUnusedRefCheck && isGrokVideoModel(config.model) && config.mode === "multimodal-ref") {
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
          return false;
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
        return false;
      }
    } else if (config.mode === "first-last-frame") {
      firstFrameUrl = config.firstFrameImageUrl;
      lastFrameUrl = config.lastFrameImageUrl;
      if (!firstFrameUrl || !lastFrameUrl) {
        showError(`镜头 ${shotIndex} 首尾帧模式需要上传首帧与尾帧图片，请在卡片参数中上传`);
        return false;
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
        return false;
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

      // 人物音色：只保留被 @人物名音频 引用的关联人物。
      // 优先取资产所选版本的 voiceUrl，回退该人物最新版本的音色。
      const characterVoiceUrls: string[] = [];
      related
        .filter((a) => a.type === "character")
        .forEach((a) => {
          if (!mentionedInPrompt(`${a.name}音频`)) return;
          const voiceUrl = a.voiceUrl || latestCharacterVoiceByName.get(a.name.toLowerCase());
          if (voiceUrl) {
            characterVoiceUrls.push(voiceUrl);
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

    // 校验：所选模型是否属于已配置 apiKey 的供应商（不在 videoOptions 中说明供应商未配置）
    const selectedOption = findModelOption(videoOptions, config.provider, config.model);
    if (!selectedOption) {
      showError(`镜头 ${shotIndex} 未选择有效的视频模型，请先在卡片中选择一个已配置 API Key 的供应商模型`);
      return false;
    }

    if (opts?.validateOnly) return true;
    setVideoGeneratingIds((prev) => new Set(prev).add(shot.id));
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
      for (const [name, no] of audioEntries) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`@${escaped}(?=${MENTION_BOUNDARY}|$)`, "g");
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
    return true;
  }

  /** 批量生成所有镜头视频 */
  async function generateAllVideos() {
    if (!videoConfigured) {
      setShowVideoNotConfiguredModal(true);
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

  /** 截取视频首帧并保存为截屏资产 */
  async function captureFirstFrame(shot: Shot, index: number) {
    if (!(await isCosConfigured())) {
      showError("请先配置存储方式，再截取首帧");
      return;
    }
    const key = `${shot.id}#first`;
    setCapturingIds((prev) => new Set(prev).add(key));

    try {
      const base64 = await extractVideoFrameAt(shot.videoUrl, 0);
      const name = `${episode.title || "未命名剧集"}-镜头${index + 1}-首帧`;
      const url = await uploadRefBase64(base64, `screenshot-${shot.id}-first`);

      const asset: Asset = {
        ...emptyAsset(name, "screenshot"),
        imageUrl: url,
        status: "ready",
        description: `视频首帧截图：${shot.visualDescription || ""}`.trim(),
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
      setSavedIds((prev) => new Set(prev).add(key));
      setTimeout(() => {
        setSavedIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 2000);
    } catch (e) {
      showError(`截取首帧失败：${(e as Error).message}`);
    } finally {
      setCapturingIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  /** 截取视频当前播放帧并保存为截屏资产 */
  async function captureCurrentFrame(shot: Shot, index: number, currentTime: number) {
    if (!(await isCosConfigured())) {
      showError("请先配置存储方式，再截取当前帧");
      return;
    }
    const key = `${shot.id}#current`;
    setCapturingIds((prev) => new Set(prev).add(key));

    try {
      const base64 = await extractVideoFrameAt(shot.videoUrl, Math.max(0, currentTime));
      const name = `${episode.title || "未命名剧集"}-镜头${index + 1}-当前帧`;
      const url = await uploadRefBase64(base64, `screenshot-${shot.id}-current`);

      const asset: Asset = {
        ...emptyAsset(name, "screenshot"),
        imageUrl: url,
        status: "ready",
        description: `视频当前帧截图：${shot.visualDescription || ""}`.trim(),
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
      setSavedIds((prev) => new Set(prev).add(key));
      setTimeout(() => {
        setSavedIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 2000);
    } catch (e) {
      showError(`截取当前帧失败：${(e as Error).message}`);
    } finally {
      setCapturingIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
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

  /** 从视频 URL 提取指定时刻的帧，返回 PNG data URL（timeSec=0 取首帧） */
  function extractVideoFrameAt(videoUrl: string, timeSec: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
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

      const drawAndResolve = () => {
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

      const seekTarget = () => {
        const duration = video.duration;
        const max = isFinite(duration) && duration > 0 ? duration - 0.001 : timeSec;
        return Math.max(0, Math.min(timeSec, max));
      };

      video.onloadedmetadata = () => {
        const target = seekTarget();
        if (target > 0 && video.readyState >= 2) {
          video.currentTime = target;
        }
      };

      video.onloadeddata = () => {
        const target = seekTarget();
        if (target <= 0) {
          // 首帧：loadeddata 触发时第一帧已就绪，直接绘制
          drawAndResolve();
        } else if (video.readyState >= 2) {
          video.currentTime = target;
        }
      };

      video.onseeked = drawAndResolve;

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
        console.warn("[extractVideoFrameAt] 视频加载停滞");
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
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!videoConfigured ? (
            <span className="inline-flex cursor-pointer items-center rounded-md border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-200" onClick={() => { window.location.href = "/settings"; }}>
              ⚠️ 视频 API 未配置，请前往「设置」页面
            </span>
          ) : (
            <span className="inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">✅ 视频 API 已配置</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = !bulkCollapsed;
              setBulkCollapsed(next);
              setBulkCollapseToken((t) => t + 1);
            }}
            disabled={episode.shots.length === 0}
          >
            {bulkCollapsed ? "一键展开" : "一键折叠"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50/40 px-4 py-3 text-xs leading-relaxed text-slate-600">
        <p className="mb-1 font-medium text-slate-700">第四步 · 视频生成</p>
        <p>
          每张卡片对应分镜表中的一个镜头。系统根据画面描述中的 @标签 自动关联第三步的资产，
          可以调用 LLM 生成视频提示词，也可以使用故事板或者生成分镜头制作视频提示词。
          视频生成为异步任务，提交后需轮询状态（约 1-5 分钟）。
        </p>
      </div>

      <TagList tags={tags} onRemoveTag={onRemoveTag} title="已标注标签：" />

      {episode.shots.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/50 py-16 text-center">
          <div className="mb-2 text-4xl opacity-40">🎬</div>
          <p className="text-sm text-slate-500">
            暂无镜头{onAddRow ? "，可手动添加或返回第二步生成分镜" : "，请返回第二步生成分镜"}
          </p>
          <div className="mt-4 flex items-center gap-2">
            {onAddRow && (
              <Button variant="secondary" size="sm" onClick={onAddRow}>
                + 添加镜头
              </Button>
            )}
            {onAddSmartShot && (
              <Button variant="secondary" size="sm" onClick={() => setSmartAddOpen(true)}>
                ✨ 智能添加镜头
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap">
            {episode.shots.map((shot, i) => (
              <div key={shot.id} className="w-full lg:w-[calc(50%-0.5rem)]">
              <VideoCard
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
                onCancelGeneratePrompt={() => cancelGeneratePrompt(shot)}
                isGeneratingVideo={videoGeneratingIds.has(shot.id)}
                isGeneratingStoryboard={generatingStoryboardIds.has(shot.id)}
                initiallyExpanded={shot.id === newlyAddedShotId}
                bulkCollapse={{ value: bulkCollapsed, token: bulkCollapseToken }}
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
                onGenerateVideo={() => generateVideo(shot, { skipUnusedRefCheck: true })}
                onPrecheckVideo={() => generateVideo(shot, { validateOnly: true })}
                onCancelVideo={() => cancelVideo(shot)}
                onUpdatePrompt={(v) => onUpdateShot(shot.id, "finalPrompt", v)}
                onUpdateVisualDescription={(v) => onUpdateShot(shot.id, "visualDescription", v)}
                onUpdateVideoConfig={(patch) => onUpdateVideoConfig(shot.id, patch)}
                onUpdateShotField={(field, value) => onUpdateShot(shot.id, field, value)}
                onUnlinkAsset={(assetId) => onUnlinkAsset(shot.id, assetId)}
                onLinkAsset={(assetId) => onLinkAsset(shot.id, assetId)}
                onEnsureAssetForSetting={onEnsureAssetForSetting}
                onLinkMentionedAssets={() => linkMentionedAssets(shot)}
                onCaptureScreenshot={() => captureLastFrame(shot, i + 1)}
                isCapturing={capturingIds.has(shot.id)}
                isSaved={savedIds.has(shot.id)}
                onCaptureFirstFrame={() => captureFirstFrame(shot, i + 1)}
                isCapturingFirst={capturingIds.has(`${shot.id}#first`)}
                isSavedFirst={savedIds.has(`${shot.id}#first`)}
                onCaptureCurrentFrame={(t: number) => captureCurrentFrame(shot, i + 1, t)}
                isCapturingCurrent={capturingIds.has(`${shot.id}#current`)}
                isSavedCurrent={savedIds.has(`${shot.id}#current`)}
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
              </div>
            ))}
          </div>
          {(onAddRow || onAddSmartShot) && (
            <div className="mt-4 flex items-center gap-2">
              {onAddRow && (
                <Button variant="secondary" size="sm" onClick={onAddRow}>
                  + 添加镜头
                </Button>
              )}
              {onAddSmartShot && (
                <Button variant="secondary" size="sm" onClick={() => setSmartAddOpen(true)}>
                  ✨ 智能添加镜头
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <SmartAddShotDialog
        open={smartAddOpen}
        onClose={() => setSmartAddOpen(false)}
        onApply={(shot) => {
          setNewlyAddedShotId(shot.id);
          onAddSmartShot?.(shot);
          linkMentionedAssets(shot);
        }}
        title="智能添加镜头"
        worldSettings={worldSettings}
        characterSettings={characterSettings}
        objectSettings={objectSettings}
        sceneSettings={sceneSettings}
        onAtMentionSelect={(name) => { onEnsureAssetForSetting?.(name); }}
      />
      <ShotToc shots={episode.shots} />

      <Modal
        open={showVideoNotConfiguredModal}
        onClose={() => setShowVideoNotConfiguredModal(false)}
        title="未配置视频生成 API"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowVideoNotConfiguredModal(false)}>
              稍后配置
            </Button>
            <Button variant="primary" onClick={() => {
              setShowVideoNotConfiguredModal(false);
              window.location.href = "/settings";
            }}>
              前往设置
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          视频生成 API 尚未配置。请前往「设置」页面，在「视频生成 API」区域填写至少一个供应商的 API Key。
        </p>
      </Modal>
    </div>
  );
}

/** 镜头目录（右侧浮动导航：内容超视口 200% 时显示，半透明，hover 变实，点击跳转） */
function ShotToc({ shots }: { shots: Shot[] }) {
  const [visible, setVisible] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const visibleMapRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    const check = () => {
      setVisible(document.documentElement.scrollHeight > window.innerHeight * 2);
    };
    check();
    window.addEventListener("resize", check);
    const ro = new ResizeObserver(check);
    if (document.body) ro.observe(document.body);
    return () => {
      window.removeEventListener("resize", check);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const els = shots
      .map((s) => document.getElementById(`shot-card-${s.id}`))
      .filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    visibleMapRef.current.clear();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          const id = e.target.id.replace("shot-card-", "");
          if (e.isIntersecting) visibleMapRef.current.set(id, true);
          else visibleMapRef.current.delete(id);
        });
        const first = shots.find((s) => visibleMapRef.current.has(s.id));
        if (first) setActiveId(first.id);
      },
      { rootMargin: "-25% 0px -65% 0px", threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [visible, shots]);

  const handleClick = (id: string) => {
    document
      .getElementById(`shot-card-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!visible || shots.length === 0) return null;

  return (
    <nav
      aria-label="镜头目录"
      className="fixed right-3 top-1/2 z-40 hidden -translate-y-1/2 opacity-60 transition-opacity duration-200 hover:opacity-100 lg:block"
    >
      <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-white/70 p-1.5 shadow-sm backdrop-blur-sm transition-colors hover:bg-white/95 hover:shadow-md">
        <ul className="flex flex-col gap-0.5">
          {shots.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => handleClick(s.id)}
                className={`block w-full whitespace-nowrap rounded px-2.5 py-1 text-left text-xs transition-colors ${
                  activeId === s.id
                    ? "bg-brand-100 font-medium text-brand-700"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                }`}
              >
                镜头 {i + 1}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/** 首帧/尾帧图片上传组件（带缩略图预览，hover 更换时可选本地/资产库/URL/生成图片） */
function FrameImageUpload({
  label,
  url,
  uploading,
  generating,
  onUpload,
  onPickAsset,
  onAddFromUrl,
  onGenerateFromStoryboard,
  onGenerateImage,
  onRemove,
}: {
  label: string;
  url?: string;
  uploading: boolean;
  /** 图片生成中（显示 loading 占位） */
  generating?: boolean;
  onUpload: () => void;
  onPickAsset: () => void;
  onAddFromUrl?: () => void;
  /** 使用故事板生成图片 */
  onGenerateFromStoryboard?: () => void;
  /** 生成图片 */
  onGenerateImage?: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] text-slate-500">{label}</span>
      {generating ? (
        <div
          className="flex h-24 w-full items-center justify-center rounded-md border border-dashed border-brand-300 bg-brand-50/50"
          title="生成中…"
        >
          <div className="flex flex-col items-center gap-1.5">
            <Spinner size={20} />
            <span className="text-[11px] text-brand-600">生成中…</span>
          </div>
        </div>
      ) : url ? (
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
              onAddFromUrl={
                onAddFromUrl
                  ? () => {
                      onRemove();
                      onAddFromUrl();
                    }
                  : undefined
              }
              onGenerateFromStoryboard={
                onGenerateFromStoryboard
                  ? () => {
                      onRemove();
                      onGenerateFromStoryboard();
                    }
                  : undefined
              }
              onGenerateImage={
                onGenerateImage
                  ? () => {
                      onRemove();
                      onGenerateImage();
                    }
                  : undefined
              }
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
          onAddFromUrl={onAddFromUrl}
          onGenerateFromStoryboard={onGenerateFromStoryboard}
          onGenerateImage={onGenerateImage}
        />
      )}
    </div>
  );
}

/** 带 hover 下拉菜单的添加/更换按钮：一个入口，hover 后显示本地上传 / 资产库 / 从 URL 添加 / 使用故事板生成 */
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
  onAddFromUrl,
  onGenerateFromStoryboard,
  onGenerateImage,
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
  /** 从 URL 添加（仅图片，直接回填公网 URL，不经 COS） */
  onAddFromUrl?: () => void;
  /** 参考图区域可选：使用故事板生成图片资产 */
  onGenerateFromStoryboard?: () => void;
  /** 参考图区域可选：带上卡片参考图直接生成图片（不附加提示词模板） */
  onGenerateImage?: () => void;
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
          {onAddFromUrl && (
            <button
              type="button"
              onClick={onAddFromUrl}
              className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50"
            >
              从 URL 添加
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
          {onGenerateImage && (
            <button
              type="button"
              onClick={onGenerateImage}
              className="block w-full px-3 py-1.5 text-left text-xs text-brand-600 hover:bg-brand-50"
            >
              生成图片
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
  onCancelGeneratePrompt,
  onGenerateVideo,
  onPrecheckVideo,
  onCancelVideo,
  onUpdatePrompt,
  onUpdateVisualDescription,
  onUpdateVideoConfig,
  onUpdateShotField,
  onUnlinkAsset,
  onLinkAsset,
  onEnsureAssetForSetting,
  onLinkMentionedAssets,
  onSetGeneratingStoryboard,
  onCaptureScreenshot,
  isCapturing,
  isSaved,
  onCaptureFirstFrame,
  isCapturingFirst,
  isSavedFirst,
  onCaptureCurrentFrame,
  isCapturingCurrent,
  isSavedCurrent,
  initiallyExpanded,
  bulkCollapse,
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
  isCapturingFirst: boolean;
  isSavedFirst: boolean;
  isCapturingCurrent: boolean;
  isSavedCurrent: boolean;
  /** 新添加的镜头初始展开「分镜信息」区域 */
  initiallyExpanded?: boolean;
  /** 父级「一键折叠/展开」指令：每次触发 token 递增，卡片据 value 设置折叠状态 */
  bulkCollapse?: { value: boolean; token: number };
  onGeneratePrompt: () => void;
  /** 停止当前镜头的提示词生成 */
  onCancelGeneratePrompt: () => void;
  onGenerateVideo: () => void;
  onPrecheckVideo: () => Promise<boolean>;
  onCancelVideo: () => void;
  onUpdatePrompt: (v: string) => void;
  onUpdateVisualDescription: (v: string) => void;
  onUpdateVideoConfig: (patch: Partial<ShotVideoConfig>) => void;
  /** 更新镜头任意字段（用于 storyboardUrl / imageTaskId 持久化） */
  onUpdateShotField: (field: keyof Shot, value: string) => void;
  onUnlinkAsset: (assetId: string) => void;
  onLinkAsset: (assetId: string) => void;
  /** @ 选中设定时确保对应资产已存在（不存在则按设定创建），返回资产 id 供关联 */
  onEnsureAssetForSetting?: (name: string) => string | undefined;
  /** 一键关联画面描述中 @到的资产 */
  onLinkMentionedAssets: () => void;
  isGeneratingStoryboard: boolean;
  onSetGeneratingStoryboard: (value: boolean) => void;
  onCaptureScreenshot: () => void;
  onCaptureFirstFrame: () => void;
  onCaptureCurrentFrame: (currentTime: number) => void;
  onAddAsset: (asset: Asset) => void;
  /** 组件级 AbortSignal，切页/卸载时取消故事板图片生成轮询（保留 jobId 供恢复） */
  abortSignal?: AbortSignal;
  /** 立即落盘当前 episode（绕过防抖），用于 imageTaskId 关键字段持久化；
   *  可传 mutate 基于快照构造补丁直写（组件卸载后仍有效） */
  onPersistNow?: (mutate?: (ep: Episode) => Episode) => void;
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
  const effectiveDuration = config.duration === -1 && !cap.durationAuto ? cap.durationRange[0] : config.duration;
  // 模型所属供应商未配置 apiKey（不在 videoOptions 中）时，ModelPicker 显示空让用户自选
  const displayModel = (config.model && selectedVidOption) ? config.model : "";
  const [videoConfigOpen, setVideoConfigOpen] = useState(false);
  const [userPriceTable, setUserPriceTable] = useState<Record<string, VideoPriceEntry> | undefined>(undefined);
  const [showInputMaterials, setShowInputMaterials] = useState(true);
  const [showShotInfo, setShowShotInfo] = useState(true);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(`video:shot:collapsed:${shot.id}`) === "1";
  });
  useEffect(() => {
    window.localStorage.setItem(`video:shot:collapsed:${shot.id}`, collapsed ? "1" : "0");
  }, [collapsed, shot.id]);
  // 加载用户自定义价格表（用于费用估算）
  useEffect(() => {
    if (!videoConfigOpen || !config.provider) return;
    getUserVideoPriceTable(config.provider).then(setUserPriceTable);
  }, [videoConfigOpen, config.provider]);
  const lastBulkTokenRef = useRef(0);
  // 视频元素引用，用于「截取当前帧」读取当前播放位置
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (bulkCollapse && bulkCollapse.token !== lastBulkTokenRef.current) {
      lastBulkTokenRef.current = bulkCollapse.token;
      setCollapsed(bulkCollapse.value);
    }
  }, [bulkCollapse]);
  const [uploadingKind, setUploadingKind] = useState<"video" | "audio" | "firstFrame" | "lastFrame" | "refImage" | null>(null);
  const showError = useErrorDialog();
  const confirm = useConfirm();
  const [pickerTarget, setPickerTarget] = useState<"firstFrame" | "lastFrame" | "refImage" | "refVideo" | "refAudio" | null>(null);
  const [presetPickerTarget, setPresetPickerTarget] = useState<"refImage" | "refVideo" | "refAudio" | "promptText" | "camera" | null>(null);
  const [cameraPresetContent, setCameraPresetContent] = useState<string | null>(null);
  // 从 URL 添加图片（首帧/尾帧/参考图）：直接回填公网 URL，不经过 COS
  const [urlInputTarget, setUrlInputTarget] = useState<"firstFrame" | "lastFrame" | "refImage" | null>(null);
  const [urlInputValue, setUrlInputValue] = useState("");
  const [urlPreviewError, setUrlPreviewError] = useState(false);

  // 图片生成目标（refImage 加入参考图列表；firstFrame/lastFrame 写入对应帧图）
  const [imageGenTarget, setImageGenTarget] = useState<"refImage" | "firstFrame" | "lastFrame">("refImage");
  const [optimizingPrompt, setOptimizingPrompt] = useState(false);

  // 故事板生成状态
  const [storyboardOpen, setStoryboardOpen] = useState(false);
  const [storyboardPrompt, setStoryboardPrompt] = useState("");
  const [useStoryboardTemplate, setUseStoryboardTemplate] = useState(true);
  const [storyboardConfig, setStoryboardConfig] = useState<AssetImageConfig>({
    ...defaultImageConfig,
  });
  const [storyboardRefImages, setStoryboardRefImages] = useState<string[]>([]);
  const [storyboardRefImageLabels, setStoryboardRefImageLabels] = useState<string[]>([]);

  // 生成图片状态（带上卡片参考图，不附加提示词模板）
  const [genImageOpen, setGenImageOpen] = useState(false);
  const [genImagePrompt, setGenImagePrompt] = useState("");
  const [genImageConfig, setGenImageConfig] = useState<AssetImageConfig>({
    ...defaultImageConfig,
  });
  const [genImageRefImages, setGenImageRefImages] = useState<string[]>([]);
  const [genImageRefImageLabels, setGenImageRefImageLabels] = useState<string[]>([]);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

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

  // 运镜占位符填充用的参考图名列表：关联资产图 + 手动参考图（仅 multimodal-ref 有意义）
  const refImageNameOptions = useMemo(() => {
    if (config.mode !== "multimodal-ref") return [];
    const names: string[] = [];
    relatedAssets.forEach((a) => {
      if (a.imageUrl) names.push(a.name);
    });
    (config.referenceImageAssetUrls ?? []).forEach((_, i) => {
      names.push(getRefImgName(config.referenceImageAssetNames, i));
    });
    return names;
  }, [config.mode, relatedAssets, config.referenceImageAssetUrls, config.referenceImageAssetNames]);

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
  async function handleUploadRef(kind: "video" | "audio" | "firstFrame" | "lastFrame" | "refImage") {
    if (!(await isCosConfigured())) {
      showError("未配置 COS 存储，无法上传文件，请先在「设置」中配置腾讯云 COS");
      return;
    }
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

  /** 从 URL 添加图片（首帧/尾帧/参考图）：校验后直接回填公网 URL，不经过 COS */
  function handleConfirmAddFromUrl() {
    const target = urlInputTarget;
    const raw = urlInputValue.trim();
    if (!target) return;
    if (!raw) {
      showError("请输入图片 URL");
      return;
    }
    if (!/^https?:\/\//i.test(raw)) {
      showError("请输入以 http:// 或 https:// 开头的有效图片 URL");
      return;
    }
    if (target === "firstFrame") {
      onUpdateVideoConfig({ firstFrameImageUrl: raw });
    } else if (target === "lastFrame") {
      onUpdateVideoConfig({ lastFrameImageUrl: raw });
    } else {
      const existingNames = config.referenceImageAssetNames ?? [];
      const newName = `参考图${nextRefImgNumber(existingNames)}`;
      onUpdateVideoConfig({
        referenceImageAssetUrls: [...(config.referenceImageAssetUrls ?? []), raw],
        referenceImageAssetNames: [...existingNames, newName],
      });
    }
    closeUrlInputDialog();
  }

  /** 关闭从 URL 添加弹框并清空输入 */
  function closeUrlInputDialog() {
    setUrlInputTarget(null);
    setUrlInputValue("");
    setUrlPreviewError(false);
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

  /** 当用户在画面描述/提示词中通过 @ 补全选中设定或资产时，自动关联到该镜头。
   *  若选中的是设定但尚未作为资产准备，则先按设定创建资产再关联；视频/音频无需关联。 */
  function handleMentionSelect(assetName: string) {
    if (assetName.startsWith("视频") || assetName.startsWith("音频")) return;
    const asset = allAssets.find(
      (a) => a.name === assetName || a.name.toLowerCase() === assetName.toLowerCase()
    );
    const assetId = asset?.id ?? onEnsureAssetForSetting?.(assetName);
    if (assetId && !shot.relatedAssetIds?.includes(assetId)) {
      onLinkAsset(assetId);
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
  function openStoryboardDialog(target: "refImage" | "firstFrame" | "lastFrame" = "refImage") {
    setImageGenTarget(target);
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

  /** 生成故事板图片（服务端转存 COS）并保存为故事板资产 */
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
          // 异步任务创建后立即持久化 imageTaskId + imageTaskProvider + imageTaskTarget，切页/刷新后可恢复轮询（按 provider 路由凭证）
          onUpdateShotField("imageTaskId", jobId);
          if (params.config.provider) onUpdateShotField("imageTaskProvider", params.config.provider);
          onUpdateShotField("imageTaskKind", "storyboard");
          onUpdateShotField("imageTaskTarget", imageGenTarget);
          // 立即落盘（mutation 直写）：提交在飞时切页，组件卸载后 setState 无效，
          // mutation 基于卸载前快照直写是 taskId 不丢的唯一保障
          onPersistNow?.((ep) => ({
            ...ep,
            shots: ep.shots.map((s) =>
              s.id === shot.id
                ? {
                    ...s,
                    imageTaskId: jobId,
                    ...(params.config.provider ? { imageTaskProvider: params.config.provider } : {}),
                    imageTaskKind: "storyboard" as const,
                    imageTaskTarget: imageGenTarget,
                  }
                : s
            ),
          }));
        },
        abortSignal,
        { cosPrefix: "ai-script/storyboards" }
      );
      // imageUrl 已经服务端 COS 转存，无需再转存
      const finalUrl = result.imageUrl;
      onUpdateShotField("storyboardUrl", finalUrl);
      onUpdateShotField("imageTaskId", "");
      onUpdateShotField("imageTaskTarget", "");

      // 保存为故事板资产：自动命名为“剧集名-镜头名-故事版n”
      const existingStoryboards = episode.assets.filter(
        (a) => a.type === "storyboard" && a.shotId === shot.id
      );
      const nextIndex = existingStoryboards.length + 1;
      const name = `${episode.title || "未命名剧集"}-镜头${index + 1}-故事板${nextIndex}`;

      const asset: Asset = {
        ...emptyAsset(name, "storyboard"),
        imageUrl: finalUrl,
        status: "ready",
        description: params.prompt,
        shotId: shot.id,
      };
      onAddAsset(asset);

      // 写入对应字段：首帧/尾帧模式直接设置帧图；参考图模式追加到参考图列表（保留故事板名称，便于 @ 引用）
      if (imageGenTarget === "firstFrame") {
        onUpdateVideoConfig({ firstFrameImageUrl: finalUrl });
      } else if (imageGenTarget === "lastFrame") {
        onUpdateVideoConfig({ lastFrameImageUrl: finalUrl });
      } else {
        onUpdateVideoConfig({
          referenceImageAssetUrls: [...(config.referenceImageAssetUrls ?? []), finalUrl],
          referenceImageAssetNames: [...(config.referenceImageAssetNames ?? []), name],
        });
      }

      // DB 直写补丁：页面离开后组件已卸载，上面的 setState 链全部静默丢弃，
      // 此处基于卸载前快照把故事板/帧图/参考图/资产/清 taskId 直写落库，保证图片不丢
      onPersistNow?.((ep) => ({
        ...ep,
        shots: ep.shots.map((s) => {
          if (s.id !== shot.id) return s;
          const vc = s.videoConfig ?? defaultVideoConfig;
          let videoConfig: ShotVideoConfig;
          if (imageGenTarget === "firstFrame") {
            videoConfig = { ...vc, firstFrameImageUrl: finalUrl };
          } else if (imageGenTarget === "lastFrame") {
            videoConfig = { ...vc, lastFrameImageUrl: finalUrl };
          } else {
            const urls = vc.referenceImageAssetUrls ?? [];
            const vcNames = vc.referenceImageAssetNames ?? [];
            videoConfig = {
              ...vc,
              referenceImageAssetUrls: urls.includes(finalUrl) ? urls : [...urls, finalUrl],
              referenceImageAssetNames: urls.includes(finalUrl) ? vcNames : [...vcNames, name],
            };
          }
          return { ...s, storyboardUrl: finalUrl, imageTaskId: "", imageTaskTarget: undefined, videoConfig };
        }),
        assets: ep.assets.some((a) => a.type === "storyboard" && a.imageUrl === finalUrl)
          ? ep.assets
          : [...ep.assets, asset],
      }));
    } catch (e) {
      // 切页/卸载导致轮询被取消时，保留 imageTaskId 以便重新挂载后恢复轮询；
      // 仅在真实失败（API 错误/超时）时清除 imageTaskId 并提示错误。
      // 不依赖共享 abortSignal.aborted：组件卸载后所有并发轮询共享的 signal 会被 abort，
      // 真实失败也会被误判为"已取消"而静默，导致既不报错也不回写图片。
      const isAborted = (e as Error)?.name === "AbortError" || (e as Error)?.message === "已取消";
      if (!isAborted) {
        onUpdateShotField("imageTaskId", "");
        onUpdateShotField("imageTaskTarget", "");
        showError(`故事板生成失败：${(e as Error).message}`);
      }
    } finally {
      onSetGeneratingStoryboard(false);
    }
  }

  /** 打开生成图片弹框：带上卡片所有参考图（关联资产 + 手动/故事板参考图），不附加任何提示词模板 */
  function openGenerateImageDialog(target: "refImage" | "firstFrame" | "lastFrame" = "refImage") {
    setImageGenTarget(target);
    setGenImageConfig({ ...defaultImageConfig });
    // 卡片参考图区域 = 关联资产（@ 引用，自动作为参考图）+ 手动/故事板添加的参考图
    const linkedAssets = relatedAssets.filter((a) => a.imageUrl);
    if (target === "refImage") {
      const manualUrls = config.referenceImageAssetUrls ?? [];
      const manualNames = config.referenceImageAssetNames ?? [];
      setGenImageRefImages([
        ...linkedAssets.map((a) => a.imageUrl),
        ...manualUrls,
      ]);
      setGenImageRefImageLabels([
        ...linkedAssets.map((a) => a.name),
        ...manualUrls.map((_, i) => getRefImgName(manualNames, i)),
      ]);
    } else {
      // firstFrame/lastFrame：仅用关联资产作为参考图
      setGenImageRefImages(linkedAssets.map((a) => a.imageUrl));
      setGenImageRefImageLabels(linkedAssets.map((a) => a.name));
    }
    // 预填分镜中对静态画面有视觉参考价值的信息（画面描述、景别、光影氛围），
    // 不带运镜（动态）、音效/对白旁白（声音）、时长（时间）等与静态图片无关的字段
    setGenImagePrompt(buildShotInfoBlockForImage(shot));
    setGenImageOpen(true);
  }

  /** 基于卡片参考图单纯生图（服务端转存 COS）后加入参考图列表 */
  async function handleGenerateImage(params: ImageGenerationParams) {
    setGenImageOpen(false);
    setGenImageConfig(params.config);
    setIsGeneratingImage(true);
    try {
      // 发送给图片模型前确定性替换 @资产名称/@参考图N -> 图片N（与故事板一致，编号与 images 数组顺序对齐）
      const assetImageNo = new Map<string, number | null>();
      const genLabels = params.imageLabels ?? [];
      params.images.forEach((_, i) => {
        const name = genLabels[i] || `图片${i + 1}`;
        assetImageNo.set(name, i + 1);
      });
      const finalGenPrompt = replaceAssetTagsWithImageNos(params.prompt, assetImageNo);
      const result = await generateImage(
        finalGenPrompt,
        params.config,
        params.images.length > 0 ? params.images : undefined,
        (jobId) => {
          // 异步任务创建后立即持久化 imageTaskId + imageTaskProvider + imageTaskKind + imageTaskTarget，切页/刷新后可恢复轮询
          onUpdateShotField("imageTaskId", jobId);
          if (params.config.provider) onUpdateShotField("imageTaskProvider", params.config.provider);
          onUpdateShotField("imageTaskKind", "genImage");
          onUpdateShotField("imageTaskTarget", imageGenTarget);
          // 立即落盘（mutation 直写，组件卸载后仍有效）
          onPersistNow?.((ep) => ({
            ...ep,
            shots: ep.shots.map((s) =>
              s.id === shot.id
                ? {
                    ...s,
                    imageTaskId: jobId,
                    ...(params.config.provider ? { imageTaskProvider: params.config.provider } : {}),
                    imageTaskKind: "genImage" as const,
                    imageTaskTarget: imageGenTarget,
                  }
                : s
            ),
          }));
        },
        abortSignal,
        { cosPrefix: "ai-script/generated" }
      );
      onUpdateShotField("imageTaskId", "");
      onUpdateShotField("imageTaskTarget", "");
      // imageUrl 已经服务端 COS 转存，无需再转存
      const finalUrl = result.imageUrl;
      const isFrame = imageGenTarget === "firstFrame" || imageGenTarget === "lastFrame";
      const newName = isFrame
        ? (imageGenTarget === "firstFrame" ? "首帧图" : "尾帧图")
        : `生成图${nextGenImgNumber(config.referenceImageAssetNames ?? [])}`;

      // 存入资产库（类型：生成，避免重复入库）
      const refImgExists = episode.assets.some(
        (a) => a.type === "generated" && a.imageUrl === finalUrl
      );
      let createdAsset: Asset | null = null;
      if (!refImgExists) {
        const assetName = `${episode.title || "未命名剧集"}-镜头${index + 1}-${newName}`;
        const asset: Asset = {
          ...emptyAsset(assetName, "generated"),
          imageUrl: finalUrl,
          status: "ready",
          description: finalGenPrompt,
          shotId: shot.id,
        };
        createdAsset = asset;
        onAddAsset(asset);
        void recordMediaAsset({
          mediaType: "image",
          url: finalUrl,
          entityType: "generated",
          entityName: assetName,
          prompt: finalGenPrompt,
          source: "generated",
          seriesId: episode.seriesId,
          seriesTitle: seriesTitle ?? "",
          episodeId: episode.id,
          episodeTitle: episode.title,
        });
      }

      // 写入对应字段：首帧/尾帧模式直接设置帧图；参考图模式追加到参考图列表
      if (imageGenTarget === "firstFrame") {
        onUpdateVideoConfig({ firstFrameImageUrl: finalUrl });
      } else if (imageGenTarget === "lastFrame") {
        onUpdateVideoConfig({ lastFrameImageUrl: finalUrl });
      } else {
        const names = config.referenceImageAssetNames ?? [];
        onUpdateVideoConfig({
          referenceImageAssetUrls: [...(config.referenceImageAssetUrls ?? []), finalUrl],
          referenceImageAssetNames: [...names, newName],
        });
      }

      // DB 直写补丁：页面离开后组件已卸载，上面的 setState 链全部静默丢弃，
      // 此处基于卸载前快照把帧图/参考图/资产/清 taskId 直写落库，保证图片不丢
      const assetToAdd = createdAsset;
      onPersistNow?.((ep) => ({
        ...ep,
        shots: ep.shots.map((s) => {
          if (s.id !== shot.id) return s;
          const vc = s.videoConfig ?? defaultVideoConfig;
          let videoConfig: ShotVideoConfig;
          if (imageGenTarget === "firstFrame") {
            videoConfig = { ...vc, firstFrameImageUrl: finalUrl };
          } else if (imageGenTarget === "lastFrame") {
            videoConfig = { ...vc, lastFrameImageUrl: finalUrl };
          } else {
            const urls = vc.referenceImageAssetUrls ?? [];
            const vcNames = vc.referenceImageAssetNames ?? [];
            videoConfig = {
              ...vc,
              referenceImageAssetUrls: urls.includes(finalUrl) ? urls : [...urls, finalUrl],
              referenceImageAssetNames: urls.includes(finalUrl) ? vcNames : [...vcNames, newName],
            };
          }
          return { ...s, imageTaskId: "", imageTaskTarget: undefined, videoConfig };
        }),
        assets:
          assetToAdd && !ep.assets.some((a) => a.type === "generated" && a.imageUrl === finalUrl)
            ? [...ep.assets, assetToAdd]
            : ep.assets,
      }));
    } catch (e) {
      const isAborted = (e as Error)?.name === "AbortError" || (e as Error)?.message === "已取消";
      if (!isAborted) {
        onUpdateShotField("imageTaskId", "");
        onUpdateShotField("imageTaskTarget", "");
        showError(`图片生成失败：${(e as Error).message}`);
      }
    } finally {
      setIsGeneratingImage(false);
    }
  }

  return (
    <div id={`shot-card-${shot.id}`} className="relative z-0 flex scroll-mt-20 flex-col rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:z-30 hover:shadow-md">
      {/* 卡片头 */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title={collapsed ? "展开卡片" : "折叠卡片"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={`transition-transform ${collapsed ? "" : "rotate-90"}`}>
              <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
            {index + 1}
          </span>
          <span className="text-sm font-medium text-slate-700">镜头 {index + 1}</span>
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
                ref={videoRef}
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
                onClick={onCaptureFirstFrame}
                disabled={isCapturingFirst || isSavedFirst}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCapturingFirst ? (
                  <>
                    <Spinner size={12} />
                    <span>截取中…</span>
                  </>
                ) : isSavedFirst ? (
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
                      <path d="M9 8v8M14 12l-5 4V8z" fill="currentColor" stroke="none" />
                    </svg>
                    <span>截取首帧</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => onCaptureCurrentFrame(videoRef.current?.currentTime ?? 0)}
                disabled={isCapturingCurrent || isSavedCurrent}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCapturingCurrent ? (
                  <>
                    <Spinner size={12} />
                    <span>截取中…</span>
                  </>
                ) : isSavedCurrent ? (
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
                    <span>截取当前帧</span>
                  </>
                )}
              </button>
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
        ) : collapsed ? (
          <div className="flex h-[294px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400">
            <div className="flex flex-col items-center gap-1.5">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
              </svg>
              <span className="text-xs">视频未生成</span>
            </div>
          </div>
        ) : null}

        {!collapsed && (
        <div className="flex flex-col gap-3">
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
                  allowCreateTag
                />
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {/* 时长 */}
                <div>
                  <label className="mb-1 block text-[11px] text-slate-500">⏱️ 时长</label>
                  <EditableCell
                    value={shot.duration}
                    onChange={(v) => onUpdateShotField("duration", v)}
                    placeholder="如 8秒"
                    minWidth="100%"
                  />
                </div>
                {/* 景别 */}
                <div>
                  <label className="mb-1 block text-[11px] text-slate-500">🎥 景别</label>
                  <OptionCombobox
                    value={shot.shotType}
                    onChange={(v) => onUpdateShotField("shotType", v)}
                    options={SHOT_TYPES}
                    placeholder="选择或输入…"
                    className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 hover:border-brand-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                </div>
                {/* 运镜 */}
                <div>
                  <label className="mb-1 block text-[11px] text-slate-500">🎬 运镜</label>
                  <OptionCombobox
                    value={shot.cameraMovement}
                    onChange={(v) => onUpdateShotField("cameraMovement", v)}
                    options={CAMERA_MOVES}
                    placeholder="选择或输入…"
                    className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 hover:border-brand-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
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

        {/* 模型与生成模式（决定输入素材类型，置于卡片内便于切换首尾帧/多模态） */}
        <div className="grid grid-cols-2 gap-2.5">
          <label className="block">
            <span className="mb-1 block text-[11px] text-slate-500">模型</span>
            <ModelPicker
              options={videoOptions}
              provider={config.provider}
              model={displayModel}
              onSelect={(p, m) => changeModel(p, m)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-slate-500">生成模式</span>
            <Select
              value={config.mode}
              onChange={(v) => onUpdateVideoConfig({ mode: v as VideoGenerationMode })}
              options={cap.modes.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
              disabled={isGeneratingImage || isGeneratingStoryboard}
            />
          </label>
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
                      generating={(isGeneratingImage || isGeneratingStoryboard) && imageGenTarget === "firstFrame"}
                      onUpload={() => handleUploadRef("firstFrame")}
                      onPickAsset={() => setPickerTarget("firstFrame")}
                      onAddFromUrl={() => setUrlInputTarget("firstFrame")}
                      onGenerateImage={() => openGenerateImageDialog("firstFrame")}
                      onGenerateFromStoryboard={() => openStoryboardDialog("firstFrame")}
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
                        generating={(isGeneratingImage || isGeneratingStoryboard) && imageGenTarget === "firstFrame"}
                        onUpload={() => handleUploadRef("firstFrame")}
                        onPickAsset={() => setPickerTarget("firstFrame")}
                        onAddFromUrl={() => setUrlInputTarget("firstFrame")}
                        onGenerateImage={() => openGenerateImageDialog("firstFrame")}
                        onGenerateFromStoryboard={() => openStoryboardDialog("firstFrame")}
                        onRemove={() => onUpdateVideoConfig({ firstFrameImageUrl: undefined })}
                      />
                      <FrameImageUpload
                        label="尾帧图片"
                        url={config.lastFrameImageUrl}
                        uploading={uploadingKind === "lastFrame"}
                        generating={(isGeneratingImage || isGeneratingStoryboard) && imageGenTarget === "lastFrame"}
                        onUpload={() => handleUploadRef("lastFrame")}
                        onPickAsset={() => setPickerTarget("lastFrame")}
                        onAddFromUrl={() => setUrlInputTarget("lastFrame")}
                        onGenerateImage={() => openGenerateImageDialog("lastFrame")}
                        onGenerateFromStoryboard={() => openStoryboardDialog("lastFrame")}
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
                        <button
                          type="button"
                          onClick={onLinkMentionedAssets}
                          className="rounded px-1.5 py-1 text-[11px] text-brand-600 transition-colors hover:bg-brand-50"
                          title="关联画面描述中 @标签 对应的资产（不存在的自动从设定创建）"
                        >
                          一键关联
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
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
                        {(isGeneratingStoryboard || isGeneratingImage) && (
                          <div
                            className="relative flex w-20 flex-col items-center gap-1 rounded-md border border-dashed border-brand-300 bg-brand-50/50 p-1"
                            title="生成中…"
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
                          onAddFromUrl={() => setUrlInputTarget("refImage")}
                          onGenerateFromStoryboard={openStoryboardDialog}
                          onGenerateImage={openGenerateImageDialog}
                        />
                      </div>
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
                    {config.mode === "multimodal-ref" && (
                      <button
                        type="button"
                        onClick={() => setPresetPickerTarget("camera")}
                        className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-brand-50 hover:text-brand-700"
                      >
                        添加镜头
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {isGeneratingPrompt ? (
                <Button size="sm" variant="ghost" onClick={onCancelGeneratePrompt} title="点击停止">
                  <Spinner size={11} /> 停止生成
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={hasPrompt ? "ghost" : "secondary"}
                  onClick={onGeneratePrompt}
                >
                  {hasPrompt ? "重新生成" : "生成提示词"}
                </Button>
              )}
              <AiOptimizeButton
                text={shot.finalPrompt}
                onOptimized={onUpdatePrompt}
                onRunningChange={setOptimizingPrompt}
                buildMessages={optimizeVideoPromptMessages}
              />
            </div>
          </div>
          <EditableCell
            value={shot.finalPrompt}
            onChange={onUpdatePrompt}
            disabled={optimizingPrompt}
            placeholder="输入视频提示词，或点击上方按钮生成…"
            multiline
            minWidth="100%"
            minHeight="80px"
            maxHeight="500px"
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
            onClick={async () => {
              const ok = await onPrecheckVideo();
              if (ok) setVideoConfigOpen(true);
            }}
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
        </div>
        </div>
        )}
      </div>

      <Modal
        open={videoConfigOpen}
        onClose={() => setVideoConfigOpen(false)}
        title={`镜头 ${index + 1} · 视频生成参数`}
        width="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setVideoConfigOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={isGeneratingVideo}
              onClick={() => {
                setVideoConfigOpen(false);
                onGenerateVideo();
              }}
            >
              确认生成
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="mb-1 block text-[11px] text-slate-500">分辨率</span>
              <Select
                value={config.resolution}
                onChange={(v) => onUpdateVideoConfig({ resolution: v as VideoResolution })}
                options={cap.resolutions.map((r) => ({ value: r, label: r }))}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-slate-500">宽高比</span>
              <Select
                value={config.ratio}
                onChange={(v) => onUpdateVideoConfig({ ratio: v as VideoRatio })}
                options={cap.ratios.map((r) => ({ value: r, label: RATIO_LABELS[r] }))}
              />
            </label>
            <label className="col-span-2 block">
              <span className="mb-1 block text-[11px] text-slate-500">时长（秒）{cap.durationAuto && " · 支持自动"}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={cap.durationRange[0]}
                  max={cap.durationRange[1]}
                  value={effectiveDuration === -1 ? "" : effectiveDuration}
                  disabled={effectiveDuration === -1}
                  onChange={(e) => onUpdateVideoConfig({ duration: Number(e.target.value) })}
                  className="input"
                />
                {cap.durationAuto && (
                  <label className="flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-500">
                    <input
                      type="checkbox"
                      checked={effectiveDuration === -1}
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

          {/* 预估费用 */}
          {(() => {
            const cost = estimateVideoCostWith(config.provider, config.model, config.resolution, effectiveDuration, userPriceTable);
            return (
              <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-[11px] text-slate-500">预估费用</span>
                <div className="text-right">
                  <span className={cost.amount !== null ? "text-sm font-medium text-slate-700" : "text-[11px] text-slate-400"}>
                    {cost.label}
                  </span>
                  {cost.breakdown && (
                    <span className="ml-1.5 text-[11px] text-slate-400">{cost.breakdown}</span>
                  )}
                  {cost.note && (
                    <span className="ml-1.5 text-[10px] font-bold text-red-500">· {cost.note}</span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </Modal>

      {pickerTarget && (
        <AssetPicker
          open={!!pickerTarget}
          onClose={() => setPickerTarget(null)}
          mediaType={pickerTarget === "refVideo" ? "video" : pickerTarget === "refAudio" ? "audio" : "image"}
          defaultSeriesId={episode.seriesId}
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
                  : presetPickerTarget === "camera"
                    ? "camera"
                    : "text"
          }
          multiple={presetPickerTarget !== "camera"}
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
            } else if (presetPickerTarget === "camera") {
              const text = items[0]?.content ?? "";
              if (text.trim()) {
                if (/\{\{.+?\}\}/.test(text)) {
                  setCameraPresetContent(text);
                } else {
                  const current = shot.finalPrompt ?? "";
                  const next = current.trim() ? `${current.trim()}\n\n${text}` : text;
                  onUpdatePrompt(next);
                }
              }
            }
            setPresetPickerTarget(null);
          }}
        />
      )}

      <CameraPlaceholderDialog
        open={cameraPresetContent !== null}
        content={cameraPresetContent ?? ""}
        refImageOptions={refImageNameOptions}
        onClose={() => setCameraPresetContent(null)}
        onConfirm={(generated) => {
          const current = shot.finalPrompt ?? "";
          const next = current.trim() ? `${current.trim()}\n\n${generated}` : generated;
          onUpdatePrompt(next);
          setCameraPresetContent(null);
        }}
      />

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
        defaultSeriesId={episode.seriesId}
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

      <ImageGenerationDialog
        open={genImageOpen}
        onClose={() => setGenImageOpen(false)}
        initialPrompt={genImagePrompt}
        initialConfig={genImageConfig}
        images={genImageRefImages}
        onImagesChange={setGenImageRefImages}
        imageLabels={genImageRefImageLabels}
        onImageLabelsChange={setGenImageRefImageLabels}
        imageOptions={imageOptions}
        title="生成图片"
        confirmText="生成图片"
        loading={isGeneratingImage}
        onConfirm={handleGenerateImage}
        keepMentionPrefix
        enablePresetPrompt
        defaultSeriesId={episode.seriesId}
      />

      <Modal
        open={!!urlInputTarget}
        onClose={closeUrlInputDialog}
        title="从 URL 添加图片"
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={closeUrlInputDialog}>
              取消
            </Button>
            <Button onClick={handleConfirmAddFromUrl} disabled={!urlInputValue.trim()}>
              添加
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">
              图片 URL
              {urlInputTarget === "firstFrame" && "（首帧图片）"}
              {urlInputTarget === "lastFrame" && "（尾帧图片）"}
              {urlInputTarget === "refImage" && "（参考图）"}
            </span>
            <input
              type="url"
              autoFocus
              value={urlInputValue}
              onChange={(e) => {
                setUrlInputValue(e.target.value);
                setUrlPreviewError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleConfirmAddFromUrl();
                }
              }}
              placeholder="https://example.com/image.png"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
          </label>
          {/^https?:\/\//i.test(urlInputValue.trim()) && (
            <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
              {urlPreviewError ? (
                <div className="flex h-32 items-center justify-center text-xs text-slate-400">
                  无法加载图片预览，请检查 URL 是否可公开访问
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={urlInputValue.trim()}
                  alt="预览"
                  className="max-h-48 w-full object-contain"
                  onError={() => setUrlPreviewError(true)}
                />
              )}
            </div>
          )}
          <p className="text-[11px] text-slate-400">
            公网图片 URL 将直接作为素材添加，不会上传到 COS。请确保链接可公开访问且为图片格式。
          </p>
        </div>
      </Modal>
    </div>
  );
}
