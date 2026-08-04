"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import Modal from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import ImageLightbox from "@/components/ImageLightbox";
import { debounce } from "@/lib/utils";
import {
  getSettings,
  saveSettings,
  testConnection,
  PROVIDER_PRESETS,
  getProviderKeys,
  saveProviderKey,
  clearProviderKey,
} from "@/lib/llm-client";
import {
  getImageSettings,
  saveImageSettings,
  testImageConnection,
  IMAGE_PROVIDER_PRESETS,
  IMAGE_ASPECT_RATIOS,
  DEFAULT_IMAGE_SETTINGS,
  DEFAULT_ASSET_IMAGE_CONFIG,
  getDefaultAssetImageConfig,
  saveDefaultAssetImageConfig,
  getImageProviderKeys,
  saveImageProviderKey,
  clearImageProviderKey,
} from "@/lib/image-client";
import {
  getVideoSettings,
  saveVideoSettings,
  DEFAULT_VIDEO_SETTINGS,
  VIDEO_PROVIDER_PRESETS,
  getVideoProviderKeys,
  saveVideoProviderKey,
  clearVideoProviderKey,
} from "@/lib/video-client";
import {
  getAudioSettings,
  saveAudioSettings,
  DEFAULT_AUDIO_SETTINGS,
  AUDIO_PROVIDER_PRESETS,
  getAudioProviderKeys,
  saveAudioProviderKey,
  clearAudioProviderKey,
} from "@/lib/audio-client";
import {
  getMusicSettings,
  saveMusicSettings,
  DEFAULT_MUSIC_SETTINGS,
  MUSIC_PROVIDER_PRESETS,
  getMusicProviderKey,
  saveMusicProviderKey,
  clearMusicProviderKey,
} from "@/lib/music-client";
import {
  getLLMModels,
  saveLLMModels,
  refreshBuiltInLLMModels,
  getImageModels,
  saveImageModels,
  refreshBuiltInImageModels,
  getVideoModels,
  saveVideoModels,
  refreshBuiltInVideoModels,
  getAudioModels,
  saveAudioModels,
  refreshBuiltInAudioModels,
  getMusicModels,
  saveMusicModels,
  refreshBuiltInMusicModels,
  getCodeDefaultImageCapability,
  getCodeDefaultVideoCapability,
  getDefaultShotVideoConfig,
  saveDefaultShotVideoConfig,
  DEFAULT_LLM_MODELS,
  DEFAULT_IMAGE_MODELS,
  DEFAULT_VIDEO_MODELS,
  DEFAULT_AUDIO_MODELS,
  DEFAULT_MUSIC_MODELS,
  DEFAULT_SHOT_VIDEO_CONFIG,
  getDefaultModelValue,
  type ModelEntry,
  type ImageModelCapability,
  type VideoModelCapability,
} from "@/lib/model-presets";
import {
  getCosSettings,
  saveCosSettings,
} from "@/lib/cos-client";
import type { CosSettings, ImageGenSettings, LLMSettings, ProviderCache, VideoGenSettings, AudioGenSettings, MusicGenSettings, AssetImageConfig, ShotVideoConfig } from "@/lib/types";
import { apiClient } from "@/lib/api-client";

/** 设置页自动保存防抖间隔（ms）—— 比全局 1500ms 更短，配置类操作更跟手 */
const SETTINGS_AUTOSAVE_DEBOUNCE_MS = 500;

// 批量管理：所有分类供应商品牌的并集（排除 custom）
const BULK_BRANDS: string[] = Array.from(
  new Set([
    ...Object.keys(PROVIDER_PRESETS),
    ...Object.keys(IMAGE_PROVIDER_PRESETS),
    ...Object.keys(VIDEO_PROVIDER_PRESETS),
    ...Object.keys(AUDIO_PROVIDER_PRESETS),
    ...Object.keys(MUSIC_PROVIDER_PRESETS),
  ])
).filter((b) => b !== "custom");

/** 取某品牌在任意分类预设中的 label / keyPrefix */
function getBrandMeta(brand: string): { label: string; keyPrefix?: string } {
  const src =
    (PROVIDER_PRESETS as Record<string, any>)[brand] ||
    (IMAGE_PROVIDER_PRESETS as Record<string, any>)[brand] ||
    (VIDEO_PROVIDER_PRESETS as Record<string, any>)[brand] ||
    (AUDIO_PROVIDER_PRESETS as Record<string, any>)[brand] ||
    (MUSIC_PROVIDER_PRESETS as Record<string, any>)[brand];
  return { label: src?.label ?? brand, keyPrefix: src?.keyPrefix };
}

export default function SettingsPage() {
  const router = useRouter();
  const confirm = useConfirm();

  // ---- LLM 状态 ----
  const [provider, setProvider] = useState<LLMSettings["provider"]>("deepseek");
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [llmPanelOpen, setLlmPanelOpen] = useState(true);

  // 各 provider 缓存的配置（切换供应商时自动恢复，含 baseURL/model）
  const [providerKeys, setProviderKeys] = useState<ProviderCache>({});

  // ---- LLM 模型管理 ----
  const [llmModels, setLLMModels] = useState<ModelEntry[]>([]);
  const [showLLMManager, setShowLLMManager] = useState(false);
  const [newLLMValue, setNewLLMValue] = useState("");
  const [newLLMLabel, setNewLLMLabel] = useState("");

  // ---- 图片 API 状态 ----
  const [imgSettings, setImgSettings] = useState<ImageGenSettings>(DEFAULT_IMAGE_SETTINGS);
  const [imagePanelOpen, setImagePanelOpen] = useState(false);
  const [imgTesting, setImgTesting] = useState(false);
  const [imgTestResult, setImgTestResult] = useState<{
    ok: boolean;
    message: string;
    imageUrl?: string;
  } | null>(null);

  // 各图片 provider 缓存的配置（切换供应商时自动恢复，含 baseURL/model）
  const [imageProviderKeys, setImageProviderKeys] = useState<ProviderCache>({});

  // ---- 图片模型管理 ----
  const [imageModels, setImageModels] = useState<ModelEntry[]>([]);
  const [showImageManager, setShowImageManager] = useState(false);
  const [newImageValue, setNewImageValue] = useState("");
  const [newImageLabel, setNewImageLabel] = useState("");

  // ---- 视频 API 状态 ----
  const [vidSettings, setVidSettings] = useState<VideoGenSettings>(DEFAULT_VIDEO_SETTINGS);
  const [videoPanelOpen, setVideoPanelOpen] = useState(false);

  // 各视频 provider 缓存的配置（切换供应商时自动恢复，含 baseURL）
  const [videoProviderKeys, setVideoProviderKeys] = useState<ProviderCache>({});

  // ---- 视频模型管理 ----
  const [videoModels, setVideoModels] = useState<ModelEntry[]>([]);
  const [showVideoManager, setShowVideoManager] = useState(false);
  const [newVideoValue, setNewVideoValue] = useState("");
  const [newVideoLabel, setNewVideoLabel] = useState("");

  // ---- 音频 API 状态 ----
  const [audSettings, setAudSettings] = useState<AudioGenSettings>(DEFAULT_AUDIO_SETTINGS);
  const [audioPanelOpen, setAudioPanelOpen] = useState(false);
  const [audioProviderKeys, setAudioProviderKeys] = useState<ProviderCache>({});

  // ---- 音频模型管理 ----
  const [audioModels, setAudioModels] = useState<ModelEntry[]>([]);
  const [showAudioManager, setShowAudioManager] = useState(false);
  const [newAudioValue, setNewAudioValue] = useState("");
  const [newAudioLabel, setNewAudioLabel] = useState("");

  // ---- 音乐 API 状态 ----
  const [musSettings, setMusSettings] = useState<MusicGenSettings>(DEFAULT_MUSIC_SETTINGS);
  const [musicPanelOpen, setMusicPanelOpen] = useState(false);
  const [musicProviderKeys, setMusicProviderKeys] = useState<ProviderCache>({});

  // ---- 音乐模型管理 ----
  const [musicModels, setMusicModels] = useState<ModelEntry[]>([]);
  const [showMusicManager, setShowMusicManager] = useState(false);
  const [newMusicValue, setNewMusicValue] = useState("");
  const [newMusicLabel, setNewMusicLabel] = useState("");

  // ---- API Key 批量管理 ----
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  // key 为品牌名（如 apimart/ark/deepseek），值为该品牌的 apiKey
  const [bulkKeyMap, setBulkKeyMap] = useState<Record<string, string>>({});
  // 当前下拉选中的品牌
  const [bulkSelectedBrand, setBulkSelectedBrand] = useState<string>("");
  // 勾选项：同时将该品牌设为各分类的默认供应商
  const [bulkSetAsDefault, setBulkSetAsDefault] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // ---- COS 存储状态 ----
  const [cosSettings, setCosSettings] = useState<CosSettings>({
    secretId: "",
    secretKey: "",
    bucket: "",
    region: "ap-guangzhou",
    customDomain: "",
  });
  const [cosPanelOpen, setCosPanelOpen] = useState(false);
  const [cosConfigured, setCosConfigured] = useState(false);
  const [cosTesting, setCosTesting] = useState(false);
  const [cosTestResult, setCosTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // ---- 默认生成参数（用户自定义） ----
  const [defaultImageConfig, setDefaultImageConfig] = useState<AssetImageConfig>(DEFAULT_ASSET_IMAGE_CONFIG);
  const [defaultVideoConfig, setDefaultVideoConfig] = useState<ShotVideoConfig>(DEFAULT_SHOT_VIDEO_CONFIG);
  const [showDefaultImageConfig, setShowDefaultImageConfig] = useState(false);
  const [showDefaultVideoConfig, setShowDefaultVideoConfig] = useState(false);

  // ---- 保存提示 ----
  const [savedHint, setSavedHint] = useState(false);
  const savedHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showSavedHint() {
    setSavedHint(true);
    if (savedHintTimerRef.current) clearTimeout(savedHintTimerRef.current);
    savedHintTimerRef.current = setTimeout(() => setSavedHint(false), 1500);
  }

  // 页面载入时读取已存设置
  useEffect(() => {
    (async () => {

    // LLM
    const s = await getSettings();
    if (s) {
      setProvider(s.provider);
      setBaseURL(s.baseURL);
      setApiKey(s.apiKey);
      setModel(s.model);
    } else {
      setProvider("deepseek");
      setBaseURL(PROVIDER_PRESETS.deepseek.baseURL);
      setModel(PROVIDER_PRESETS.deepseek.model);
      setApiKey("");
    }
    setTestResult(null);

    // 加载各 provider 缓存的 API Key
    setProviderKeys(await getProviderKeys());

    // LLM 模型列表
    const currentProvider = s?.provider ?? "deepseek";
    setLLMModels(await getLLMModels(currentProvider));
    setShowLLMManager(false);
    setNewLLMValue("");
    setNewLLMLabel("");

    // 图片
    const is = await getImageSettings();
    const imgProvider = is?.provider ?? "ark";
    setImgSettings(is ?? { ...DEFAULT_IMAGE_SETTINGS });
    setImgTestResult(null);

    // 加载各图片 provider 缓存的 API Key
    const imgKeys = await getImageProviderKeys();
    setImageProviderKeys(imgKeys);
    // 任意供应商有 apiKey 即视为已配置，自动展开面板
    setImagePanelOpen(!!is?.apiKey || Object.values(imgKeys).some((e) => !!e?.apiKey));

    // 图片模型列表（标记 isDefault：优先用已加载的 imgSettings.model，否则取 getDefaultModelValue）
    const imgModels = await getImageModels(imgProvider);
    const imgDefaultModel = is?.model || getDefaultModelValue(imgModels) || "";
    setImageModels(imgModels.map((m) => ({ ...m, isDefault: m.value === imgDefaultModel })));
    setShowImageManager(false);
    setNewImageValue("");
    setNewImageLabel("");

    // 图片默认生成参数
    setDefaultImageConfig(await getDefaultAssetImageConfig());

    // 视频
    const vs = await getVideoSettings();
    const vidProvider = vs?.provider ?? "ark";
    setVidSettings(vs ?? { ...DEFAULT_VIDEO_SETTINGS });

    // 加载各视频 provider 缓存的 API Key
    const vidKeys = await getVideoProviderKeys();
    setVideoProviderKeys(vidKeys);
    // 任意供应商有 apiKey 即视为已配置，自动展开面板
    setVideoPanelOpen(!!vs?.apiKey || Object.values(vidKeys).some((e) => !!e?.apiKey));

    // 视频模型列表 + 默认生成参数（标记 isDefault：优先用 defaultVideoConfig.model，否则取 getDefaultModelValue）
    const vidModels = await getVideoModels(vidProvider);
    const vidCfg = await getDefaultShotVideoConfig();
    setDefaultVideoConfig(vidCfg);
    const vidDefaultModel = (vidCfg.provider === vidProvider ? vidCfg.model : undefined) || getDefaultModelValue(vidModels) || "";
    setVideoModels(vidModels.map((m) => ({ ...m, isDefault: m.value === vidDefaultModel })));
    setShowVideoManager(false);
    setNewVideoValue("");
    setNewVideoLabel("");

    // 音频
    const aus = await getAudioSettings();
    const audProvider = aus?.provider ?? "mimo";
    setAudSettings(aus ?? { ...DEFAULT_AUDIO_SETTINGS });
    setAudioPanelOpen(!!aus?.apiKey);

    // 加载各音频 provider 缓存的 API Key
    setAudioProviderKeys(await getAudioProviderKeys());

    // 音频模型列表
    setAudioModels(await getAudioModels(audProvider));
    setShowAudioManager(false);
    setNewAudioValue("");
    setNewAudioLabel("");

    // 音乐
    const mus = await getMusicSettings();
    const musProvider = mus?.provider ?? "apimart";
    setMusSettings(mus ?? { ...DEFAULT_MUSIC_SETTINGS });
    setMusicPanelOpen(!!mus?.apiKey);

    // 加载各音乐 provider 缓存的 API Key
    setMusicProviderKeys(await getMusicProviderKey());

    // 音乐模型列表
    setMusicModels(await getMusicModels(musProvider));
    setShowMusicManager(false);
    setNewMusicValue("");
    setNewMusicLabel("");

    // COS
    const cos = await getCosSettings();
    const cosCfg = !!(cos?.secretId && cos?.secretKey && cos?.bucket && cos?.region);
    setCosSettings(cos ?? { secretId: "", secretKey: "", bucket: "", region: "ap-guangzhou", customDomain: "" });
    setCosPanelOpen(cosCfg);
    setCosConfigured(cosCfg);
    setCosTestResult(null);
    })();
    // 初始化完成后启用自动保存
    setTimeout(() => { skipAutoSave.current = false; }, 0);
  }, []);

  // ---- LLM handlers ----
  async function handleProviderChange(p: LLMSettings["provider"]) {
    if (p === provider) return;
    // 同步计算更新后的缓存，避免闭包陈旧值导致 Key 闪烁
    const updatedKeys: ProviderCache = {
      ...providerKeys,
      [provider]: { apiKey, baseURL, model },
    };
    setProviderKeys(updatedKeys);
    // 落盘当前 provider 的完整配置，刷新后仍可恢复
    await saveProviderKey(provider, { apiKey, baseURL, model });

    setProvider(p);
    const preset = PROVIDER_PRESETS[p];
    const cached = updatedKeys[p];
    const fallbackBaseURL = p !== "custom" ? preset.baseURL : "";
    const fallbackModel = p !== "custom" ? preset.model : "";
    // 切换 provider 时重新加载模型列表，并确保当前使用的 model 标记为默认（星号显示）
    const loadedModels = await getLLMModels(p);
    const resolvedModel =
      (cached?.model && loadedModels.some((m) => m.value === cached.model))
        ? cached.model
        : (getDefaultModelValue(loadedModels) ?? fallbackModel);
    const modelsWithDefault = loadedModels.map((m) => ({ ...m, isDefault: m.value === resolvedModel }));
    // 优先恢复缓存（保留用户编辑过的 baseURL/model），无缓存时回退到预设/空
    setBaseURL(cached?.baseURL ?? fallbackBaseURL);
    setModel(resolvedModel);
    setApiKey(cached?.apiKey ?? "");
    setTestResult(null);
    setLLMModels(modelsWithDefault);
    setShowLLMManager(false);
    setNewLLMValue("");
    setNewLLMLabel("");
  }

  async function handleTest() {
    if (!baseURL || !apiKey || !model) {
      setTestResult({ ok: false, message: "请先填写全部字段" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    const result = await testConnection({ provider, baseURL, apiKey, model });
    setTestResult(result);
    setTesting(false);
  }

  // ---- LLM 模型管理 ----
  async function handleAddLLMModel() {
    const v = newLLMValue.trim();
    if (!v) return;
    if (llmModels.some((m) => m.value === v)) return;
    const label = newLLMLabel.trim() || undefined;
    const updated = [...llmModels, { value: v, label }];
    setLLMModels(updated);
    await saveLLMModels(provider, updated);
    setNewLLMValue("");
    setNewLLMLabel("");
  }

  async function handleDeleteLLMModel(value: string) {
    const updated = llmModels.filter((m) => m.value !== value);
    setLLMModels(updated);
    await saveLLMModels(provider, updated);
    if (model === value && updated.length > 0) {
      setModel(updated[0].value);
    }
  }

  async function handleRefreshLLMModels() {
    const merged = await refreshBuiltInLLMModels(provider);
    setLLMModels(merged);
    if (!merged.some((m) => m.value === model) && merged.length > 0) {
      setModel(merged[0].value);
    }
  }

  async function handleSetDefaultLLMModel(value: string) {
    const updated = llmModels.map((m) => ({ ...m, isDefault: m.value === value }));
    setLLMModels(updated);
    await saveLLMModels(provider, updated);
    setModel(value);
  }

  /** 初始化当前 LLM 供应商的默认配置：重置 baseURL/model 到预设默认值、清空 apiKey、清缓存、刷新内置模型列表 */
  async function handleInitLLMProvider() {
    const p = provider;
    if (!await confirm({
      message: "确定要初始化当前供应商为默认配置吗？baseURL / 模型将恢复为预设值，API Key 将被清空，内置模型列表将刷新为代码最新（自定义模型保留）。",
      confirmText: "初始化",
    })) return;
    const preset = PROVIDER_PRESETS[p];
    const fbBase = p !== "custom" ? preset.baseURL : "";
    const fbModel = p !== "custom" ? preset.model : "";
    // 更新缓存状态（清除当前 provider 缓存条目）
    const updatedKeys = { ...providerKeys };
    delete updatedKeys[p];
    setProviderKeys(updatedKeys);
    await clearProviderKey(p);
    // 重置供应商配置到预设默认
    setBaseURL(fbBase);
    setModel(fbModel);
    setApiKey("");
    setTestResult(null);
    // 主动保存清空后的主配置（persistLlm 在 apiKey 为空时会跳过，需手动落盘避免刷新后旧 key 回来）
    await saveSettings({ provider: p, baseURL: fbBase, apiKey: "", model: fbModel });
    // 联动刷新内置模型列表
    const merged = await refreshBuiltInLLMModels(p);
    setLLMModels(merged);
    setShowLLMManager(false);
  }

  // ---- 图片 API handlers ----
  async function handleImageProviderChange(p: ImageGenSettings["provider"]) {
    if (p === imgSettings.provider) return;
    // 同步计算更新后的缓存，避免闭包陈旧值导致 Key 闪烁
    const updatedKeys: ProviderCache = {
      ...imageProviderKeys,
      [imgSettings.provider]: { apiKey: imgSettings.apiKey, baseURL: imgSettings.baseURL, model: imgSettings.model },
    };
    setImageProviderKeys(updatedKeys);
    // 落盘当前 provider 的完整配置，刷新后仍可恢复
    await saveImageProviderKey(imgSettings.provider, { apiKey: imgSettings.apiKey, baseURL: imgSettings.baseURL, model: imgSettings.model });

    const preset = IMAGE_PROVIDER_PRESETS[p];
    const cached = updatedKeys[p];
    const fbBase = p !== "custom" ? preset.baseURL : "";
    const fbModel = p !== "custom" ? preset.model : "";
    // 切换 provider 时重新加载模型列表，并确保默认模型标记正确（星号显示）
    const loadedModels = await getImageModels(p);
    const cachedModel = cached?.model;
    const resolvedModel =
      (cachedModel && loadedModels.some((m) => m.value === cachedModel))
        ? cachedModel
        : (getDefaultModelValue(loadedModels) ?? fbModel);
    const modelsWithDefault = loadedModels.map((m) => ({ ...m, isDefault: m.value === resolvedModel }));
    const newSettings = { ...imgSettings, provider: p, baseURL: cached?.baseURL ?? fbBase, model: resolvedModel, apiKey: cached?.apiKey ?? "" };
    setImgSettings(newSettings);
    setImgTestResult(null);
    setImageModels(modelsWithDefault);
    // 同步默认生成参数的模型与供应商
    await updateDefaultImageConfig({ model: resolvedModel, provider: p });
    setShowImageManager(false);
    setNewImageValue("");
    setNewImageLabel("");
  }

  function updateImg<K extends keyof ImageGenSettings>(key: K, value: ImageGenSettings[K]) {
    setImgSettings((prev) => ({ ...prev, [key]: value }));
    setImgTestResult(null);
  }

  async function handleImgTest() {
    if (!imgSettings.apiKey) {
      setImgTestResult({ ok: false, message: "请先填写 API Key" });
      return;
    }
    setImgTesting(true);
    setImgTestResult(null);
    const result = await testImageConnection(imgSettings);
    setImgTestResult(result);
    setImgTesting(false);
  }

  // ---- 图片模型管理 ----
  async function handleAddImageModel() {
    const v = newImageValue.trim();
    if (!v) return;
    if (imageModels.some((m) => m.value === v)) return;
    const label = newImageLabel.trim() || undefined;
    const updated = [...imageModels, { value: v, label }];
    setImageModels(updated);
    await saveImageModels(imgSettings.provider, updated);
    setNewImageValue("");
    setNewImageLabel("");
  }

  async function handleDeleteImageModel(value: string) {
    const updated = imageModels.filter((m) => m.value !== value);
    setImageModels(updated);
    await saveImageModels(imgSettings.provider, updated);
    if (imgSettings.model === value && updated.length > 0) {
      const nextModel = getDefaultModelValue(updated) ?? updated[0].value;
      updateImg("model", nextModel);
      await updateDefaultImageConfig({ model: nextModel, provider: imgSettings.provider });
    }
  }

  async function handleUpdateImageCapability(value: string, capability: Partial<ImageModelCapability>) {
    const updated = imageModels.map((m) =>
      m.value === value ? { ...m, capability: { ...m.capability, ...capability } } : m
    );
    setImageModels(updated);
    await saveImageModels(imgSettings.provider, updated);
  }

  /** 将某个图片模型的能力参数恢复为代码默认值（仅当前模型） */
  async function handleInitImageModelCapability(value: string) {
    const cap = getCodeDefaultImageCapability(imgSettings.provider, value);
    if (!cap) return;
    const updated = imageModels.map((m) =>
      m.value === value ? { ...m, capability: cap } : m
    );
    setImageModels(updated);
    await saveImageModels(imgSettings.provider, updated);
  }

  async function handleRefreshImageModels() {
    const merged = await refreshBuiltInImageModels(imgSettings.provider);
    setImageModels(merged);
    if (!merged.some((m) => m.value === imgSettings.model) && merged.length > 0) {
      const nextModel = getDefaultModelValue(merged) ?? merged[0].value;
      updateImg("model", nextModel);
      await updateDefaultImageConfig({ model: nextModel, provider: imgSettings.provider });
    }
  }

  async function handleSetDefaultImageModel(value: string) {
    const updated = imageModels.map((m) => ({ ...m, isDefault: m.value === value }));
    setImageModels(updated);
    await saveImageModels(imgSettings.provider, updated);
    updateImg("model", value);
    await updateDefaultImageConfig({ model: value, provider: imgSettings.provider });
  }

  /** 初始化当前供应商的默认配置：重置 baseURL/model 到预设默认值、清空 apiKey、清缓存、刷新内置模型列表 */
  async function handleInitImageProvider() {
    const p = imgSettings.provider;
    if (!await confirm({
      message: "确定要初始化当前供应商为默认配置吗？baseURL / 模型将恢复为预设值，API Key 将被清空，内置模型列表将刷新为代码最新（自定义模型保留）。",
      confirmText: "初始化",
    })) return;
    const preset = IMAGE_PROVIDER_PRESETS[p];
    const fbBase = p !== "custom" ? preset.baseURL : "";
    const fbModel = p !== "custom" ? preset.model : "";
    // 更新缓存状态（清除当前 provider 缓存条目）
    const updatedKeys = { ...imageProviderKeys };
    delete updatedKeys[p];
    setImageProviderKeys(updatedKeys);
    await clearImageProviderKey(p);
    // 重置供应商配置到预设默认
    const resetImg = { ...imgSettings, provider: p, baseURL: fbBase, model: fbModel, apiKey: "" };
    setImgSettings(resetImg);
    setImgTestResult(null);
    // 主动保存清空后的主配置（persistImg 在 apiKey 为空时会跳过，需手动落盘）
    await saveImageSettings(resetImg);
    // 联动刷新内置模型列表
    const merged = await refreshBuiltInImageModels(p);
    setImageModels(merged);
    setShowImageManager(false);
  }

  // ---- 视频 API handlers ----
  async function handleVideoProviderChange(p: VideoGenSettings["provider"]) {
    if (p === vidSettings.provider) return;
    // 同步计算更新后的缓存，避免闭包陈旧值导致 Key 闪烁
    const updatedKeys: ProviderCache = {
      ...videoProviderKeys,
      [vidSettings.provider]: { apiKey: vidSettings.apiKey, baseURL: vidSettings.baseURL },
    };
    setVideoProviderKeys(updatedKeys);
    // 落盘当前 provider 的完整配置，刷新后仍可恢复
    await saveVideoProviderKey(vidSettings.provider, { apiKey: vidSettings.apiKey, baseURL: vidSettings.baseURL });

    const preset = VIDEO_PROVIDER_PRESETS[p];
    const cached = updatedKeys[p];
    const fbBase = p !== "custom" ? preset.baseURL : "";
    // 切换 provider 时重新加载模型列表，并确保默认模型标记正确（星号显示）
    const loadedModels = await getVideoModels(p);
    const cachedModel = defaultVideoConfig.provider === p ? defaultVideoConfig.model : undefined;
    const resolvedModel =
      (cachedModel && loadedModels.some((m) => m.value === cachedModel))
        ? cachedModel
        : (getDefaultModelValue(loadedModels) ?? "");
    const modelsWithDefault = loadedModels.map((m) => ({ ...m, isDefault: m.value === resolvedModel }));
    const newSettings = { ...vidSettings, provider: p, baseURL: cached?.baseURL ?? fbBase, apiKey: cached?.apiKey ?? "" };
    setVidSettings(newSettings);
    setVideoModels(modelsWithDefault);
    // 同步默认生成参数的模型与供应商
    await updateDefaultVideoConfig({ model: resolvedModel, provider: p });
    setShowVideoManager(false);
    setNewVideoValue("");
    setNewVideoLabel("");
  }

  function updateVid<K extends keyof VideoGenSettings>(key: K, value: VideoGenSettings[K]) {
    setVidSettings((prev) => ({ ...prev, [key]: value }));
  }

  // ---- 视频模型管理 ----
  async function handleAddVideoModel() {
    const v = newVideoValue.trim();
    if (!v) return;
    if (videoModels.some((m) => m.value === v)) return;
    const label = newVideoLabel.trim() || undefined;
    const updated = [...videoModels, { value: v, label }];
    setVideoModels(updated);
    await saveVideoModels(vidSettings.provider, updated);
    setNewVideoValue("");
    setNewVideoLabel("");
  }

  async function handleDeleteVideoModel(value: string) {
    const updated = videoModels.filter((m) => m.value !== value);
    setVideoModels(updated);
    await saveVideoModels(vidSettings.provider, updated);
    if (defaultVideoConfig.model === value && updated.length > 0) {
      const nextModel = getDefaultModelValue(updated) ?? updated[0].value;
      await updateDefaultVideoConfig({ model: nextModel, provider: vidSettings.provider });
    }
  }

  async function handleUpdateVideoCapability(value: string, videoCapability: Partial<VideoModelCapability>) {
    const updated = videoModels.map((m) =>
      m.value === value ? { ...m, videoCapability: { ...m.videoCapability, ...videoCapability } } : m
    );
    setVideoModels(updated);
    await saveVideoModels(vidSettings.provider, updated);
  }

  /** 将某个视频模型的能力参数恢复为代码默认值（仅当前模型） */
  async function handleInitVideoModelCapability(value: string) {
    const cap = getCodeDefaultVideoCapability(vidSettings.provider, value);
    if (!cap) return;
    const updated = videoModels.map((m) =>
      m.value === value ? { ...m, videoCapability: cap } : m
    );
    setVideoModels(updated);
    await saveVideoModels(vidSettings.provider, updated);
  }

  async function handleRefreshVideoModels() {
    const merged = await refreshBuiltInVideoModels(vidSettings.provider);
    setVideoModels(merged);
    if (!merged.some((m) => m.value === defaultVideoConfig.model) && merged.length > 0) {
      const nextModel = getDefaultModelValue(merged) ?? merged[0].value;
      await updateDefaultVideoConfig({ model: nextModel, provider: vidSettings.provider });
    }
  }

  async function handleSetDefaultVideoModel(value: string) {
    const updated = videoModels.map((m) => ({ ...m, isDefault: m.value === value }));
    setVideoModels(updated);
    await saveVideoModels(vidSettings.provider, updated);
    await updateDefaultVideoConfig({ model: value, provider: vidSettings.provider });
  }

  /** 初始化当前视频供应商的默认配置：重置 baseURL 到预设默认值、清空 apiKey、清缓存、刷新内置模型列表 */
  async function handleInitVideoProvider() {
    const p = vidSettings.provider;
    if (!await confirm({
      message: "确定要初始化当前供应商为默认配置吗？baseURL 将恢复为预设值，API Key 将被清空，内置模型列表将刷新为代码最新（自定义模型保留）。",
      confirmText: "初始化",
    })) return;
    const preset = VIDEO_PROVIDER_PRESETS[p];
    const fbBase = p !== "custom" ? preset.baseURL : "";
    // 更新缓存状态（清除当前 provider 缓存条目）
    const updatedKeys = { ...videoProviderKeys };
    delete updatedKeys[p];
    setVideoProviderKeys(updatedKeys);
    await clearVideoProviderKey(p);
    // 重置供应商配置到预设默认
    const resetVid = { ...vidSettings, provider: p, baseURL: fbBase, apiKey: "" };
    setVidSettings(resetVid);
    // 主动保存清空后的主配置（persistVid 在 apiKey 为空时会跳过，需手动落盘）
    await saveVideoSettings(resetVid);
    // 联动刷新内置模型列表
    const merged = await refreshBuiltInVideoModels(p);
    setVideoModels(merged);
    setShowVideoManager(false);
  }

  // ---- 音频 API ----
  async function handleAudioProviderChange(p: AudioGenSettings["provider"]) {
    if (p === audSettings.provider) return;
    const updatedKeys: ProviderCache = {
      ...audioProviderKeys,
      [audSettings.provider]: { apiKey: audSettings.apiKey, baseURL: audSettings.baseURL },
    };
    setAudioProviderKeys(updatedKeys);
    await saveAudioProviderKey(audSettings.provider, { apiKey: audSettings.apiKey, baseURL: audSettings.baseURL });

    const preset = AUDIO_PROVIDER_PRESETS[p];
    const cached = updatedKeys[p];
    const fbBase = p !== "custom" ? preset.baseURL : "";
    const newSettings = { ...audSettings, provider: p, baseURL: cached?.baseURL ?? fbBase, apiKey: cached?.apiKey ?? "" };
    setAudSettings(newSettings);
    // 切换 provider 时重新加载模型列表，并确保默认模型标记正确（星号显示）
    const loadedAudModels = await getAudioModels(p);
    const audDefault = getDefaultModelValue(loadedAudModels);
    setAudioModels(loadedAudModels.map((m) => ({ ...m, isDefault: m.value === audDefault })));
    setShowAudioManager(false);
    setNewAudioValue("");
    setNewAudioLabel("");
  }

  function updateAud<K extends keyof AudioGenSettings>(key: K, value: AudioGenSettings[K]) {
    setAudSettings((prev) => ({ ...prev, [key]: value }));
  }

  // ---- 音频模型管理 ----
  async function handleAddAudioModel() {
    const v = newAudioValue.trim();
    if (!v) return;
    if (audioModels.some((m) => m.value === v)) return;
    const label = newAudioLabel.trim() || undefined;
    const updated = [...audioModels, { value: v, label }];
    setAudioModels(updated);
    await saveAudioModels(audSettings.provider, updated);
    setNewAudioValue("");
    setNewAudioLabel("");
  }

  async function handleDeleteAudioModel(value: string) {
    const updated = audioModels.filter((m) => m.value !== value);
    setAudioModels(updated);
    await saveAudioModels(audSettings.provider, updated);
  }

  async function handleRefreshAudioModels() {
    const merged = await refreshBuiltInAudioModels(audSettings.provider);
    setAudioModels(merged);
  }

  /** 初始化当前音频供应商的默认配置：重置 baseURL 到预设默认值、清空 apiKey、清缓存、刷新内置模型列表 */
  async function handleInitAudioProvider() {
    const p = audSettings.provider;
    if (!await confirm({
      message: "确定要初始化当前供应商为默认配置吗？baseURL 将恢复为预设值，API Key 将被清空，内置模型列表将刷新为代码最新（自定义模型保留）。",
      confirmText: "初始化",
    })) return;
    const preset = AUDIO_PROVIDER_PRESETS[p];
    const fbBase = p !== "custom" ? preset.baseURL : "";
    // 更新缓存状态（清除当前 provider 缓存条目）
    const updatedKeys = { ...audioProviderKeys };
    delete updatedKeys[p];
    setAudioProviderKeys(updatedKeys);
    await clearAudioProviderKey(p);
    // 重置供应商配置到预设默认
    const resetAud = { ...audSettings, provider: p, baseURL: fbBase, apiKey: "" };
    setAudSettings(resetAud);
    // 主动保存清空后的主配置（persistAud 在 apiKey 为空时会跳过，需手动落盘）
    await saveAudioSettings(resetAud);
    // 联动刷新内置模型列表
    const merged = await refreshBuiltInAudioModels(p);
    setAudioModels(merged);
    setShowAudioManager(false);
  }

  async function handleSetDefaultAudioModel(value: string) {
    const updated = audioModels.map((m) => ({ ...m, isDefault: m.value === value }));
    setAudioModels(updated);
    await saveAudioModels(audSettings.provider, updated);
  }

  // ---- 音乐 API ----
  async function handleMusicProviderChange(p: MusicGenSettings["provider"]) {
    if (p === musSettings.provider) return;
    const updatedKeys: ProviderCache = {
      ...musicProviderKeys,
      [musSettings.provider]: { apiKey: musSettings.apiKey, baseURL: musSettings.baseURL },
    };
    setMusicProviderKeys(updatedKeys);
    await saveMusicProviderKey(musSettings.provider, { apiKey: musSettings.apiKey, baseURL: musSettings.baseURL });

    const preset = MUSIC_PROVIDER_PRESETS[p];
    const cached = updatedKeys[p];
    const fbBase = p !== "custom" ? preset.baseURL : "";
    const models = await getMusicModels(p);
    const resolvedMusModel = getDefaultModelValue(models) ?? "";
    const newSettings = { ...musSettings, provider: p, baseURL: cached?.baseURL ?? fbBase, apiKey: cached?.apiKey ?? "", model: resolvedMusModel };
    setMusSettings(newSettings);
    // 确保默认模型标记正确（星号显示）
    setMusicModels(models.map((m) => ({ ...m, isDefault: m.value === resolvedMusModel })));
    setShowMusicManager(false);
    setNewMusicValue("");
    setNewMusicLabel("");
  }

  function updateMus<K extends keyof MusicGenSettings>(key: K, value: MusicGenSettings[K]) {
    setMusSettings((prev) => ({ ...prev, [key]: value }));
  }

  // ---- 音乐模型管理 ----
  async function handleAddMusicModel() {
    const v = newMusicValue.trim();
    if (!v) return;
    if (musicModels.some((m) => m.value === v)) return;
    const label = newMusicLabel.trim() || undefined;
    const updated = [...musicModels, { value: v, label }];
    setMusicModels(updated);
    await saveMusicModels(musSettings.provider, updated);
    setNewMusicValue("");
    setNewMusicLabel("");
  }

  async function handleDeleteMusicModel(value: string) {
    const updated = musicModels.filter((m) => m.value !== value);
    setMusicModels(updated);
    await saveMusicModels(musSettings.provider, updated);
  }

  async function handleRefreshMusicModels() {
    const merged = await refreshBuiltInMusicModels(musSettings.provider);
    setMusicModels(merged);
    if (!merged.some((m) => m.value === musSettings.model)) {
      updateMus("model", getDefaultModelValue(merged) ?? "");
    }
  }

  /** 初始化当前音乐供应商的默认配置：重置 baseURL 到预设默认值、清空 apiKey、清缓存、刷新内置模型列表 */
  async function handleInitMusicProvider() {
    const p = musSettings.provider;
    if (!await confirm({
      message: "确定要初始化当前供应商为默认配置吗？baseURL 将恢复为预设值，API Key 将被清空，内置模型列表将刷新为代码最新（自定义模型保留）。",
      confirmText: "初始化",
    })) return;
    const preset = MUSIC_PROVIDER_PRESETS[p];
    const fbBase = p !== "custom" ? preset.baseURL : "";
    // 更新缓存状态（清除当前 provider 缓存条目）
    const updatedKeys = { ...musicProviderKeys };
    delete updatedKeys[p];
    setMusicProviderKeys(updatedKeys);
    await clearMusicProviderKey(p);
    // 联动刷新内置模型列表
    const merged = await refreshBuiltInMusicModels(p);
    // 重置供应商配置到预设默认
    const resetMus = { ...musSettings, provider: p, baseURL: fbBase, apiKey: "", model: getDefaultModelValue(merged) ?? "" };
    setMusSettings(resetMus);
    // 主动保存清空后的主配置（persistMus 在 apiKey 为空时会跳过，需手动落盘）
    await saveMusicSettings(resetMus);
    setMusicModels(merged);
    setShowMusicManager(false);
  }

  async function handleSetDefaultMusicModel(value: string) {
    const updated = musicModels.map((m) => ({ ...m, isDefault: m.value === value }));
    setMusicModels(updated);
    await saveMusicModels(musSettings.provider, updated);
    updateMus("model", value);
  }

  // ---- 默认生成参数（用户自定义，即改即存） ----
  async function updateDefaultImageConfig(patch: Partial<AssetImageConfig>) {
    const next = { ...defaultImageConfig, ...patch };
    setDefaultImageConfig(next);
    await saveDefaultAssetImageConfig(next);
    showSavedHint();
  }

  async function updateDefaultVideoConfig(patch: Partial<ShotVideoConfig>) {
    const next = { ...defaultVideoConfig, ...patch };
    setDefaultVideoConfig(next);
    await saveDefaultShotVideoConfig(next);
    showSavedHint();
  }

  // ---- API Key 批量管理 ----
  /** 打开弹框：从独立的 bulk_api_keys 存储读取批量管理的 key（与各 API 设置解耦） */
  async function openBulkModal() {
    try {
      const stored = await apiClient.getSetting<Record<string, string>>("bulk_api_keys");
      setBulkKeyMap(stored ?? {});
    } catch {
      setBulkKeyMap({});
    }
    // 默认选中当前对话供应商（若不在 BULK_BRANDS 中则取第一个）
    setBulkSelectedBrand(
      BULK_BRANDS.includes(provider) ? provider : (BULK_BRANDS[0] ?? "")
    );
    setBulkSetAsDefault(false);
    setBulkModalOpen(true);
  }

  /** 应用：把选中品牌的 Key 同步覆盖到所有分类中该品牌的供应商；若勾选「同时设为默认供应商」则切换各分类激活供应商 */
  async function handleBulkApplyApiKeys() {
    const brand = bulkSelectedBrand;
    if (!brand) return;
    const k = (bulkKeyMap[brand] ?? "").trim();
    if (!k) return;
    const setAsDefault = bulkSetAsDefault;
    if (!await confirm({
      message: setAsDefault
        ? `确定将「${getBrandMeta(brand).label}」的 API Key 应用到所有分类中该品牌的供应商，并切换为默认供应商吗？`
        : `确定将「${getBrandMeta(brand).label}」的 API Key 应用到所有分类中该品牌的供应商吗？`,
      confirmText: "应用",
    })) return;
    setBulkBusy(true);
    try {
      // 1. 持久化批量管理的 key 到独立存储（与 API 设置解耦）
      await apiClient.saveSetting("bulk_api_keys", bulkKeyMap);

      const newLlmKeys: ProviderCache = { ...providerKeys };
      const newImgKeys: ProviderCache = { ...imageProviderKeys };
      const newVidKeys: ProviderCache = { ...videoProviderKeys };
      const newAudKeys: ProviderCache = { ...audioProviderKeys };
      const newMusKeys: ProviderCache = { ...musicProviderKeys };

      // LLM
      if ((PROVIDER_PRESETS as Record<string, any>)[brand]) {
        const p = brand as LLMSettings["provider"];
        const cached = providerKeys[p];
        const preset = PROVIDER_PRESETS[p];
        const baseURL = cached?.baseURL ?? preset.baseURL;
        const model = cached?.model ?? preset.model;
        const entry = { apiKey: k, baseURL, model };
        newLlmKeys[p] = entry;
        await saveProviderKey(p, entry);
        if (setAsDefault) {
          setProvider(p);
          setBaseURL(baseURL);
          setApiKey(k);
          const loadedModels = await getLLMModels(p);
          const resolvedModel =
            (model && loadedModels.some((m) => m.value === model)) ? model : (getDefaultModelValue(loadedModels) ?? preset.model);
          setModel(resolvedModel);
          setLLMModels(loadedModels.map((m) => ({ ...m, isDefault: m.value === resolvedModel })));
          setShowLLMManager(false);
          setNewLLMValue("");
          setNewLLMLabel("");
        } else if (p === provider) {
          setApiKey(k);
        }
      }
      // 图片
      if ((IMAGE_PROVIDER_PRESETS as Record<string, any>)[brand]) {
        const p = brand as ImageGenSettings["provider"];
        const cached = imageProviderKeys[p];
        const preset = IMAGE_PROVIDER_PRESETS[p];
        const baseURL = cached?.baseURL ?? preset.baseURL;
        const model = cached?.model ?? preset.model;
        const entry = { apiKey: k, baseURL, model };
        newImgKeys[p] = entry;
        await saveImageProviderKey(p, entry);
        if (setAsDefault) {
          const loadedModels = await getImageModels(p);
          const resolvedModel =
            (model && loadedModels.some((m) => m.value === model)) ? model : (getDefaultModelValue(loadedModels) ?? preset.model);
          setImgSettings({ ...imgSettings, provider: p, baseURL, model: resolvedModel, apiKey: k });
          setImageModels(loadedModels.map((m) => ({ ...m, isDefault: m.value === resolvedModel })));
          await updateDefaultImageConfig({ model: resolvedModel, provider: p });
          setShowImageManager(false);
          setNewImageValue("");
          setNewImageLabel("");
        } else if (p === imgSettings.provider) {
          setImgSettings((prev) => ({ ...prev, apiKey: k }));
        }
      }
      // 视频
      if ((VIDEO_PROVIDER_PRESETS as Record<string, any>)[brand]) {
        const p = brand as VideoGenSettings["provider"];
        const cached = videoProviderKeys[p];
        const preset = VIDEO_PROVIDER_PRESETS[p];
        const baseURL = cached?.baseURL ?? preset.baseURL;
        const entry = { apiKey: k, baseURL };
        newVidKeys[p] = entry;
        await saveVideoProviderKey(p, entry);
        if (setAsDefault) {
          const loadedModels = await getVideoModels(p);
          const cachedModel = defaultVideoConfig.provider === p ? defaultVideoConfig.model : undefined;
          const resolvedModel =
            (cachedModel && loadedModels.some((m) => m.value === cachedModel)) ? cachedModel : (getDefaultModelValue(loadedModels) ?? "");
          setVidSettings({ ...vidSettings, provider: p, baseURL, apiKey: k });
          setVideoModels(loadedModels.map((m) => ({ ...m, isDefault: m.value === resolvedModel })));
          await updateDefaultVideoConfig({ model: resolvedModel, provider: p });
          setShowVideoManager(false);
          setNewVideoValue("");
          setNewVideoLabel("");
        } else if (p === vidSettings.provider) {
          setVidSettings((prev) => ({ ...prev, apiKey: k }));
        }
      }
      // 音频
      if ((AUDIO_PROVIDER_PRESETS as Record<string, any>)[brand]) {
        const p = brand as AudioGenSettings["provider"];
        const cached = audioProviderKeys[p];
        const preset = AUDIO_PROVIDER_PRESETS[p];
        const baseURL = cached?.baseURL ?? preset.baseURL;
        const entry = { apiKey: k, baseURL };
        newAudKeys[p] = entry;
        await saveAudioProviderKey(p, entry);
        if (setAsDefault) {
          const loadedModels = await getAudioModels(p);
          const resolvedModel = getDefaultModelValue(loadedModels) ?? "";
          setAudSettings({ ...audSettings, provider: p, baseURL, apiKey: k });
          setAudioModels(loadedModels.map((m) => ({ ...m, isDefault: m.value === resolvedModel })));
          setShowAudioManager(false);
          setNewAudioValue("");
          setNewAudioLabel("");
        } else if (p === audSettings.provider) {
          setAudSettings((prev) => ({ ...prev, apiKey: k }));
        }
      }
      // 音乐
      if ((MUSIC_PROVIDER_PRESETS as Record<string, any>)[brand]) {
        const p = brand as MusicGenSettings["provider"];
        const cached = musicProviderKeys[p];
        const preset = MUSIC_PROVIDER_PRESETS[p];
        const baseURL = cached?.baseURL ?? preset.baseURL;
        const entry = { apiKey: k, baseURL };
        newMusKeys[p] = entry;
        await saveMusicProviderKey(p, entry);
        if (setAsDefault) {
          const loadedModels = await getMusicModels(p);
          const resolvedModel = getDefaultModelValue(loadedModels) ?? "";
          setMusSettings({ ...musSettings, provider: p, baseURL, apiKey: k, model: resolvedModel });
          setMusicModels(loadedModels.map((m) => ({ ...m, isDefault: m.value === resolvedModel })));
          setShowMusicManager(false);
          setNewMusicValue("");
          setNewMusicLabel("");
        } else if (p === musSettings.provider) {
          setMusSettings((prev) => ({ ...prev, apiKey: k }));
        }
      }

      setProviderKeys(newLlmKeys);
      setImageProviderKeys(newImgKeys);
      setVideoProviderKeys(newVidKeys);
      setAudioProviderKeys(newAudKeys);
      setMusicProviderKeys(newMusKeys);

      showSavedHint();
      setBulkModalOpen(false);
    } finally {
      setBulkBusy(false);
    }
  }

  // ---- COS handlers ----
  function updateCos<K extends keyof CosSettings>(key: K, value: CosSettings[K]) {
    setCosSettings((prev) => ({ ...prev, [key]: value }));
    setCosTestResult(null);
  }

  async function handleCosTest() {
    if (!cosSettings.secretId || !cosSettings.secretKey || !cosSettings.bucket || !cosSettings.region) {
      setCosTestResult({ ok: false, message: "请先填写所有必填字段" });
      return;
    }
    setCosTesting(true);
    setCosTestResult(null);
    try {
      const res = await fetch("/api/cos/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64: createTestImageBase64(),
          fileName: "test-upload.png",
          settings: cosSettings,
        }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        setCosTestResult({ ok: true, message: `上传成功！URL: ${data.url}` });
      } else {
        setCosTestResult({ ok: false, message: data.error ?? "上传失败" });
      }
    } catch (e) {
      setCosTestResult({ ok: false, message: `请求失败：${(e as Error).message}` });
    } finally {
      setCosTesting(false);
    }
  }

  // ---- 自动保存（防抖） ----
  const skipAutoSave = useRef(true);

  const persistLlm = useCallback(
    debounce(async (p: typeof provider, b: string, k: string, m: string, models: ModelEntry[]) => {
      await saveSettings({ provider: p, baseURL: b, apiKey: k, model: m });
      await saveLLMModels(p, models);
      await saveProviderKey(p, { apiKey: k, baseURL: b, model: m });
      setProviderKeys((prev) => ({ ...prev, [p]: { apiKey: k, baseURL: b, model: m } }));
      showSavedHint();
    }, SETTINGS_AUTOSAVE_DEBOUNCE_MS),
    []
  );

  const persistImg = useCallback(
    debounce(async (s: ImageGenSettings, models: ModelEntry[]) => {
      await saveImageSettings(s);
      await saveImageModels(s.provider, models);
      await saveImageProviderKey(s.provider, { apiKey: s.apiKey, baseURL: s.baseURL, model: s.model });
      setImageProviderKeys((prev) => ({ ...prev, [s.provider]: { apiKey: s.apiKey, baseURL: s.baseURL, model: s.model } }));
      showSavedHint();
    }, SETTINGS_AUTOSAVE_DEBOUNCE_MS),
    []
  );

  const persistVid = useCallback(
    debounce(async (s: VideoGenSettings, models: ModelEntry[]) => {
      await saveVideoSettings(s);
      await saveVideoModels(s.provider, models);
      await saveVideoProviderKey(s.provider, { apiKey: s.apiKey, baseURL: s.baseURL });
      setVideoProviderKeys((prev) => ({ ...prev, [s.provider]: { apiKey: s.apiKey, baseURL: s.baseURL } }));
      showSavedHint();
    }, SETTINGS_AUTOSAVE_DEBOUNCE_MS),
    []
  );

  const persistAud = useCallback(
    debounce(async (s: AudioGenSettings, models: ModelEntry[]) => {
      await saveAudioSettings(s);
      await saveAudioModels(s.provider, models);
      await saveAudioProviderKey(s.provider, { apiKey: s.apiKey, baseURL: s.baseURL });
      setAudioProviderKeys((prev) => ({ ...prev, [s.provider]: { apiKey: s.apiKey, baseURL: s.baseURL } }));
      showSavedHint();
    }, SETTINGS_AUTOSAVE_DEBOUNCE_MS),
    []
  );

  const persistMus = useCallback(
    debounce(async (s: MusicGenSettings, models: ModelEntry[]) => {
      await saveMusicSettings(s);
      await saveMusicModels(s.provider, models);
      await saveMusicProviderKey(s.provider, { apiKey: s.apiKey, baseURL: s.baseURL });
      setMusicProviderKeys((prev) => ({ ...prev, [s.provider]: { apiKey: s.apiKey, baseURL: s.baseURL } }));
      showSavedHint();
    }, SETTINGS_AUTOSAVE_DEBOUNCE_MS),
    []
  );

  const persistCos = useCallback(
    debounce(async (s: CosSettings) => {
      await saveCosSettings(s);
      setCosConfigured(!!(s.secretId && s.secretKey && s.bucket));
      showSavedHint();
    }, SETTINGS_AUTOSAVE_DEBOUNCE_MS),
    []
  );

  // LLM 配置变化时自动保存
  useEffect(() => {
    if (skipAutoSave.current) return;
    persistLlm(provider, baseURL, apiKey, model, llmModels);
  }, [provider, baseURL, apiKey, model, llmModels, persistLlm]);

  // 图片配置变化时自动保存
  useEffect(() => {
    if (skipAutoSave.current) return;
    persistImg(imgSettings, imageModels);
  }, [imgSettings, imageModels, persistImg]);

  // 视频配置变化时自动保存
  useEffect(() => {
    if (skipAutoSave.current) return;
    persistVid(vidSettings, videoModels);
  }, [vidSettings, videoModels, persistVid]);

  // 音频配置变化时自动保存
  useEffect(() => {
    if (skipAutoSave.current) return;
    persistAud(audSettings, audioModels);
  }, [audSettings, audioModels, persistAud]);

  // 音乐配置变化时自动保存
  useEffect(() => {
    if (skipAutoSave.current) return;
    persistMus(musSettings, musicModels);
  }, [musSettings, musicModels, persistMus]);

  // COS 配置变化时自动保存
  useEffect(() => {
    if (skipAutoSave.current) return;
    persistCos(cosSettings);
  }, [cosSettings, persistCos]);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6">
      {/* 页头 */}
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-slate-400 hover:text-slate-600"
            title="返回"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-slate-800">API 设置</h1>
        </div>
        <div className="flex items-center gap-2">
          {savedHint && <span className="text-xs text-emerald-600">已保存 ✓</span>}
          <button
            onClick={openBulkModal}
            className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            title="API Key 批量管理"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M14 7a4 4 0 1 1-5.66 5.66L4 17v3h3l4.34-4.34A4 4 0 0 1 14 7z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Key 批量管理
          </button>
        </div>
      </header>

      <div className="space-y-4">
        {/* ========= LLM 区域 ========= */}
        <fieldset className={`rounded-xl border transition-colors ${llmPanelOpen ? "border-brand-200" : "border-slate-200"}`}>
          <legend className="px-2">
            <button
              onClick={() => setLlmPanelOpen(!llmPanelOpen)}
              className="flex items-center gap-1.5 text-sm font-semibold transition-colors"
              style={{ color: llmPanelOpen ? "#D97706" : "#57534E" }}
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                className={`transition-transform ${llmPanelOpen ? "rotate-90" : ""}`}
              >
                <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              对话 API
              {apiKey ? (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-normal text-emerald-700">已配置</span>
              ) : (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700">未配置</span>
              )}
            </button>
          </legend>

          {llmPanelOpen && (
          <div className="space-y-3 p-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                服务商
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(Object.keys(PROVIDER_PRESETS) as LLMSettings["provider"][]).map((p) => {
                  const isDefault = p === provider;
                  return (
                  <button
                    key={p}
                    onClick={() => handleProviderChange(p)}
                    className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                      provider === p
                        ? "border-brand-500 bg-brand-50 text-brand-700"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {PROVIDER_PRESETS[p].label}
                    {isDefault && <DefaultProviderStar />}
                  </button>
                  );
                })}
              </div>
            </div>
            <Field label="Base URL">
              <input
                type="text"
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="input"
              />
            </Field>
            <Field label="API Key">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={PROVIDER_PRESETS[provider]?.keyPrefix ? `${PROVIDER_PRESETS[provider].keyPrefix}...` : "API Key..."}
                className="input"
                autoComplete="off"
              />
            </Field>

            {/* --- LLM 模型列表管理 --- */}
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label className="text-sm font-medium text-slate-700">模型列表</label>
                <button
                  type="button"
                  onClick={() => setShowLLMManager(!showLLMManager)}
                  className="text-xs text-brand-600 hover:text-brand-800 transition-colors"
                >
                  {showLLMManager ? "收起管理" : "管理模型"}
                </button>
              </div>
              <p className="mb-1.5 text-xs text-slate-400">此处维护的模型将出现在对话页的「模型」下拉中。</p>

              {showLLMManager && (
                <ModelManagerPanel
                  models={llmModels}
                  modelType="llm"
                  provider={provider}
                  builtInValues={new Set((DEFAULT_LLM_MODELS[provider] ?? []).map((m) => m.value))}
                  newValue={newLLMValue}
                  newLabel={newLLMLabel}
                  onNewValueChange={setNewLLMValue}
                  onNewLabelChange={setNewLLMLabel}
                  onAdd={handleAddLLMModel}
                  onDelete={handleDeleteLLMModel}
                  onRefresh={handleRefreshLLMModels}
                  onSetDefault={handleSetDefaultLLMModel}
                />
              )}
            </div>

            {PROVIDER_PRESETS[provider]?.hint && (
              <div className="flex items-start gap-2 rounded-md border-l-4 border-amber-500 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900 shadow-sm">
                <span className="mt-0.5 flex-shrink-0" aria-hidden>💡</span>
                <span>{PROVIDER_PRESETS[provider].hint}</span>
              </div>
            )}
            {testResult && (
              <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${testResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                {testing && <Spinner size={14} />}
                <span>{testResult.message}</span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={handleInitLLMProvider}>初始化默认配置</Button>
              <Button variant="secondary" size="sm" onClick={handleTest} loading={testing}>测试连接</Button>
            </div>
          </div>
          )}
        </fieldset>

        {/* ========= 图片 API 折叠区域 ========= */}
        <fieldset className={`rounded-xl border transition-colors ${imagePanelOpen ? "border-brand-200" : "border-slate-200"}`}>
          <legend className="px-2">
            <button
              onClick={() => setImagePanelOpen(!imagePanelOpen)}
              className="flex items-center gap-1.5 text-sm font-semibold transition-colors"
              style={{ color: imagePanelOpen ? "#D97706" : "#57534E" }}
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                className={`transition-transform ${imagePanelOpen ? "rotate-90" : ""}`}
              >
                <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              图片生成 API
              {(imgSettings.apiKey || Object.values(imageProviderKeys).some((e) => !!e?.apiKey)) ? (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-normal text-emerald-700">已配置</span>
              ) : (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700">未配置</span>
              )}
            </button>
          </legend>

          {imagePanelOpen && (
            <div className="space-y-3 p-4 pt-0">
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                用于第三步「资产准备」中的图片生成。请在对应平台获取 API Key 并开通模型。图片生成参数（尺寸/格式/水印）在资产卡片上单独配置。
              </div>

              {/* --- 供应商选择 --- */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">服务商</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(Object.keys(IMAGE_PROVIDER_PRESETS) as ImageGenSettings["provider"][]).map((p) => {
                    const isDefault = p === imgSettings.provider;
                    return (
                    <button
                      key={p}
                      onClick={() => handleImageProviderChange(p)}
                      className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                        imgSettings.provider === p
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {IMAGE_PROVIDER_PRESETS[p].label}
                      {isDefault && <DefaultProviderStar />}
                    </button>
                    );
                  })}
                </div>
              </div>

              <Field label="Base URL">
                <input type="text" value={imgSettings.baseURL} onChange={(e) => updateImg("baseURL", e.target.value)} placeholder="https://ark.cn-beijing.volces.com/api/v3" className="input" />
              </Field>

              <Field label="API Key">
                <input type="password" value={imgSettings.apiKey} onChange={(e) => updateImg("apiKey", e.target.value)} placeholder={IMAGE_PROVIDER_PRESETS[imgSettings.provider]?.keyPrefix ? `${IMAGE_PROVIDER_PRESETS[imgSettings.provider].keyPrefix}...` : "API Key..."} className="input" autoComplete="off" />
              </Field>

              {/* --- 图片模型列表管理（供第三步卡片下拉使用） --- */}
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label className="text-sm font-medium text-slate-700">模型列表</label>
                  <button
                    type="button"
                    onClick={() => setShowImageManager(!showImageManager)}
                    className="text-xs text-brand-600 hover:text-brand-800 transition-colors"
                  >
                    {showImageManager ? "收起管理" : "管理模型"}
                  </button>
                </div>
                <p className="mb-1.5 text-xs text-slate-400">此处维护的模型将出现在第三步每个资产卡片的「模型」下拉中。模型、尺寸、格式等生成参数在第三步每个资产卡片单独配置。</p>

                {showImageManager && (
                  <ModelManagerPanel
                    models={imageModels}
                    modelType="image"
                    provider={imgSettings.provider}
                    currentModel={imgSettings.model}
                    builtInValues={new Set((DEFAULT_IMAGE_MODELS[imgSettings.provider] ?? []).map((m) => m.value))}
                    newValue={newImageValue}
                    newLabel={newImageLabel}
                    onNewValueChange={setNewImageValue}
                    onNewLabelChange={setNewImageLabel}
                    onAdd={handleAddImageModel}
                    onDelete={handleDeleteImageModel}
                    onRefresh={handleRefreshImageModels}
                    onUpdateCapability={handleUpdateImageCapability}
                    onInitCapability={handleInitImageModelCapability}
                    onSetDefault={handleSetDefaultImageModel}
                  />
                )}
              </div>

              {/* --- 默认生成参数（用户自定义，每次打开图片生成弹框时使用） --- */}
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label className="text-sm font-medium text-slate-700">默认生成参数</label>
                  <button
                    type="button"
                    onClick={() => setShowDefaultImageConfig(!showDefaultImageConfig)}
                    className="text-xs text-brand-600 hover:text-brand-800 transition-colors"
                  >
                    {showDefaultImageConfig ? "收起" : "展开"}
                  </button>
                </div>
                <p className="mb-1.5 text-xs text-slate-400">每次打开图片生成弹框时使用的默认参数（资产卡片已单独调整的参数不受影响）。默认模型在上方「管理模型」中通过星标设置，与当前供应商绑定。</p>
                {showDefaultImageConfig && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50">
                    <DefaultImageConfigEditor config={defaultImageConfig} onChange={updateDefaultImageConfig} />
                  </div>
                )}
              </div>

              {IMAGE_PROVIDER_PRESETS[imgSettings.provider]?.hint && (
                <div className="flex items-start gap-2 rounded-md border-l-4 border-amber-500 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900 shadow-sm">
                  <span className="mt-0.5 flex-shrink-0" aria-hidden>💡</span>
                  <span>{IMAGE_PROVIDER_PRESETS[imgSettings.provider].hint}</span>
                </div>
              )}

              {imgTestResult && (
                <div className={`rounded-md px-3 py-2 text-sm ${imgTestResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                  <div className="flex items-center gap-2">
                    {imgTesting && <Spinner size={14} />}
                    <span>{imgTestResult.message}</span>
                  </div>
                  {imgTestResult.imageUrl && (
                    <ImageLightbox src={imgTestResult.imageUrl} alt="图片API测试结果" className="mt-2 inline-block">
                      <img src={imgTestResult.imageUrl} alt="测试" className="max-h-40 rounded border border-slate-200 cursor-pointer" />
                    </ImageLightbox>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={handleInitImageProvider}>初始化默认配置</Button>
                <Button variant="secondary" size="sm" onClick={handleImgTest} loading={imgTesting}>测试连接</Button>
              </div>
            </div>
          )}
        </fieldset>

        {/* ========= 视频 API 折叠区域 ========= */}
        <fieldset className={`rounded-xl border transition-colors ${videoPanelOpen ? "border-brand-200" : "border-slate-200"}`}>
          <legend className="px-2">
            <button
              onClick={() => setVideoPanelOpen(!videoPanelOpen)}
              className="flex items-center gap-1.5 text-sm font-semibold transition-colors"
              style={{ color: videoPanelOpen ? "#D97706" : "#57534E" }}
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                className={`transition-transform ${videoPanelOpen ? "rotate-90" : ""}`}
              >
                <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              视频生成 API
              {(vidSettings.apiKey || Object.values(videoProviderKeys).some((e) => !!e?.apiKey)) ? (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-normal text-emerald-700">已配置</span>
              ) : (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700">未配置</span>
              )}
            </button>
          </legend>

          {videoPanelOpen && (
            <div className="space-y-3 p-4 pt-0">
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                用于第四步「视频生成」。与图片 API 共用同一火山方舟 API Key，若上方已配置图片 API，此处 API Key 留空会自动复用。视频生成为异步任务，提交后需轮询状态。
              </div>

              {/* --- 供应商选择 --- */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">服务商</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(Object.keys(VIDEO_PROVIDER_PRESETS) as VideoGenSettings["provider"][]).map((p) => {
                    const isDefault = p === vidSettings.provider;
                    return (
                    <button
                      key={p}
                      onClick={() => handleVideoProviderChange(p)}
                      className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                        vidSettings.provider === p
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {VIDEO_PROVIDER_PRESETS[p].label}
                      {isDefault && <DefaultProviderStar />}
                    </button>
                    );
                  })}
                </div>
              </div>

              <Field label="Base URL">
                <input type="text" value={vidSettings.baseURL} onChange={(e) => updateVid("baseURL", e.target.value)} placeholder="https://ark.cn-beijing.volces.com/api/v3" className="input" />
              </Field>

              <Field label="API Key">
                <input type="password" value={vidSettings.apiKey} onChange={(e) => updateVid("apiKey", e.target.value)} placeholder={VIDEO_PROVIDER_PRESETS[vidSettings.provider]?.keyPrefix ? `${VIDEO_PROVIDER_PRESETS[vidSettings.provider].keyPrefix}...` : "API Key..."} className="input" autoComplete="off" />
              </Field>

              {VIDEO_PROVIDER_PRESETS[vidSettings.provider]?.hint && (
                <div className="flex items-start gap-2 rounded-md border-l-4 border-amber-500 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900 shadow-sm">
                  <span className="mt-0.5 flex-shrink-0" aria-hidden>💡</span>
                  <span>{VIDEO_PROVIDER_PRESETS[vidSettings.provider].hint}</span>
                </div>
              )}

              {/* --- 视频模型列表管理（供第四步卡片下拉使用） --- */}
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label className="text-sm font-medium text-slate-700">模型列表</label>
                  <button
                    type="button"
                    onClick={() => setShowVideoManager(!showVideoManager)}
                    className="text-xs text-brand-600 hover:text-brand-800 transition-colors"
                  >
                    {showVideoManager ? "收起管理" : "管理模型"}
                  </button>
                </div>
                <p className="mb-1.5 text-xs text-slate-400">此处维护的模型将出现在每个镜头卡片的「模型」下拉中。模型、分辨率、时长等生成参数在第四步每个镜头卡片单独配置。</p>

                {showVideoManager && (
                  <ModelManagerPanel
                    models={videoModels}
                    modelType="video"
                    provider={vidSettings.provider}
                    currentModel={defaultVideoConfig.model}
                    builtInValues={new Set((DEFAULT_VIDEO_MODELS[vidSettings.provider] ?? []).map((m) => m.value))}
                    newValue={newVideoValue}
                    newLabel={newVideoLabel}
                    onNewValueChange={setNewVideoValue}
                    onNewLabelChange={setNewVideoLabel}
                    onAdd={handleAddVideoModel}
                    onDelete={handleDeleteVideoModel}
                    onRefresh={handleRefreshVideoModels}
                    onUpdateVideoCapability={handleUpdateVideoCapability}
                    onInitCapability={handleInitVideoModelCapability}
                    onSetDefault={handleSetDefaultVideoModel}
                  />
                )}
              </div>

              {/* --- 默认生成参数（用户自定义，新增镜头卡片时使用） --- */}
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label className="text-sm font-medium text-slate-700">默认生成参数</label>
                  <button
                    type="button"
                    onClick={() => setShowDefaultVideoConfig(!showDefaultVideoConfig)}
                    className="text-xs text-brand-600 hover:text-brand-800 transition-colors"
                  >
                    {showDefaultVideoConfig ? "收起" : "展开"}
                  </button>
                </div>
                <p className="mb-1.5 text-xs text-slate-400">每个新增镜头卡片使用的默认视频参数（已调整过参数的镜头卡片不受影响）。默认模型在上方「管理模型」中通过星标设置，与当前供应商绑定。</p>
                {showDefaultVideoConfig && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50">
                    <DefaultVideoConfigEditor config={defaultVideoConfig} onChange={updateDefaultVideoConfig} />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={handleInitVideoProvider}>初始化默认配置</Button>
              </div>
            </div>
          )}
        </fieldset>

        {/* ========= 音频 API 折叠区域 ========= */}
        <fieldset className={`rounded-xl border transition-colors ${audioPanelOpen ? "border-brand-200" : "border-slate-200"}`}>
          <legend className="px-2">
            <button
              onClick={() => setAudioPanelOpen(!audioPanelOpen)}
              className="flex items-center gap-1.5 text-sm font-semibold transition-colors"
              style={{ color: audioPanelOpen ? "#D97706" : "#57534E" }}
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                className={`transition-transform ${audioPanelOpen ? "rotate-90" : ""}`}
              >
                <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              音频生成 API
              {audSettings.apiKey ? (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-normal text-emerald-700">已配置</span>
              ) : (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700">未配置</span>
              )}
            </button>
          </legend>

          {audioPanelOpen && (
            <div className="space-y-3 p-4 pt-0">
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                用于人物设定「生成音色」。接入小米 MiMo 的 mimo-v2.5-tts 系列语音合成模型，生成的音色会转存到 COS 并可在资产库「音色」分类中查看。
              </div>

              {/* --- 供应商选择 --- */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">服务商</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(Object.keys(AUDIO_PROVIDER_PRESETS) as AudioGenSettings["provider"][]).map((p) => {
                    const isDefault = p === audSettings.provider;
                    return (
                    <button
                      key={p}
                      onClick={() => handleAudioProviderChange(p)}
                      className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                        audSettings.provider === p
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {AUDIO_PROVIDER_PRESETS[p].label}
                      {isDefault && <DefaultProviderStar />}
                    </button>
                    );
                  })}
                </div>
              </div>

              <Field label="Base URL">
                <input type="text" value={audSettings.baseURL} onChange={(e) => updateAud("baseURL", e.target.value)} placeholder="https://api.xiaomimimo.com/v1" className="input" />
              </Field>

              <Field label="API Key">
                <input type="password" value={audSettings.apiKey} onChange={(e) => updateAud("apiKey", e.target.value)} placeholder={AUDIO_PROVIDER_PRESETS[audSettings.provider]?.keyPrefix ? `${AUDIO_PROVIDER_PRESETS[audSettings.provider].keyPrefix}...` : "API Key..."} className="input" autoComplete="off" />
              </Field>

              {AUDIO_PROVIDER_PRESETS[audSettings.provider]?.hint && (
                <div className="flex items-start gap-2 rounded-md border-l-4 border-amber-500 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900 shadow-sm">
                  <span className="mt-0.5 flex-shrink-0" aria-hidden>💡</span>
                  <span>{AUDIO_PROVIDER_PRESETS[audSettings.provider].hint}</span>
                </div>
              )}

              {/* --- 音频模型列表管理 --- */}
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label className="text-sm font-medium text-slate-700">模型列表</label>
                  <button
                    type="button"
                    onClick={() => setShowAudioManager(!showAudioManager)}
                    className="text-xs text-brand-600 hover:text-brand-800 transition-colors"
                  >
                    {showAudioManager ? "收起管理" : "管理模型"}
                  </button>
                </div>
                <p className="mb-1.5 text-xs text-slate-400">此处维护的模型将出现在人物设定「生成音色」弹框的「模型」下拉中。</p>

                {showAudioManager && (
                  <ModelManagerPanel
                    models={audioModels}
                    modelType="audio"
                    provider={audSettings.provider}
                    builtInValues={new Set((DEFAULT_AUDIO_MODELS[audSettings.provider] ?? []).map((m) => m.value))}
                    newValue={newAudioValue}
                    newLabel={newAudioLabel}
                    onNewValueChange={setNewAudioValue}
                    onNewLabelChange={setNewAudioLabel}
                    onAdd={handleAddAudioModel}
                    onDelete={handleDeleteAudioModel}
                    onRefresh={handleRefreshAudioModels}
                    onSetDefault={handleSetDefaultAudioModel}
                  />
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={handleInitAudioProvider}>初始化默认配置</Button>
              </div>
            </div>
          )}
        </fieldset>

        {/* ========= 音乐 API 折叠区域 ========= */}
        <fieldset className={`rounded-xl border transition-colors ${musicPanelOpen ? "border-brand-200" : "border-slate-200"}`}>
          <legend className="px-2">
            <button
              onClick={() => setMusicPanelOpen(!musicPanelOpen)}
              className="flex items-center gap-1.5 text-sm font-semibold transition-colors"
              style={{ color: musicPanelOpen ? "#D97706" : "#57534E" }}
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                className={`transition-transform ${musicPanelOpen ? "rotate-90" : ""}`}
              >
                <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              音乐生成 API
              {musSettings.apiKey ? (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-normal text-emerald-700">已配置</span>
              ) : (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700">未配置</span>
              )}
            </button>
          </legend>

          {musicPanelOpen && (
            <div className="space-y-3 p-4 pt-0">
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                用于系列页「音乐」面板的音乐生成。接入 APIMart 的 suno 音乐生成模型，生成的音乐会转存到 COS 并可在资产库中查看。
              </div>

              {/* --- 供应商选择 --- */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">服务商</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(Object.keys(MUSIC_PROVIDER_PRESETS) as MusicGenSettings["provider"][]).map((p) => {
                    const isDefault = p === musSettings.provider;
                    return (
                    <button
                      key={p}
                      onClick={() => handleMusicProviderChange(p)}
                      className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                        musSettings.provider === p
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {MUSIC_PROVIDER_PRESETS[p].label}
                      {isDefault && <DefaultProviderStar />}
                    </button>
                    );
                  })}
                </div>
              </div>

              <Field label="Base URL">
                <input type="text" value={musSettings.baseURL} onChange={(e) => updateMus("baseURL", e.target.value)} placeholder="https://api.apib.ai/v1" className="input" />
              </Field>

              <Field label="API Key">
                <input type="password" value={musSettings.apiKey} onChange={(e) => updateMus("apiKey", e.target.value)} placeholder={MUSIC_PROVIDER_PRESETS[musSettings.provider]?.keyPrefix ? `${MUSIC_PROVIDER_PRESETS[musSettings.provider].keyPrefix}...` : "API Key..."} className="input" autoComplete="off" />
              </Field>

              {MUSIC_PROVIDER_PRESETS[musSettings.provider]?.hint && (
                <div className="flex items-start gap-2 rounded-md border-l-4 border-amber-500 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900 shadow-sm">
                  <span className="mt-0.5 flex-shrink-0" aria-hidden>💡</span>
                  <span>{MUSIC_PROVIDER_PRESETS[musSettings.provider].hint}</span>
                </div>
              )}

              {/* --- 音乐模型列表管理 --- */}
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label className="text-sm font-medium text-slate-700">模型列表</label>
                  <button
                    type="button"
                    onClick={() => setShowMusicManager(!showMusicManager)}
                    className="text-xs text-brand-600 hover:text-brand-800 transition-colors"
                  >
                    {showMusicManager ? "收起管理" : "管理模型"}
                  </button>
                </div>
                <p className="mb-1.5 text-xs text-slate-400">此处维护的模型将出现在音乐编辑页的「模型」下拉中。</p>

                {showMusicManager && (
                  <ModelManagerPanel
                    models={musicModels}
                    modelType="music"
                    provider={musSettings.provider}
                    builtInValues={new Set((DEFAULT_MUSIC_MODELS[musSettings.provider] ?? []).map((m) => m.value))}
                    newValue={newMusicValue}
                    newLabel={newMusicLabel}
                    onNewValueChange={setNewMusicValue}
                    onNewLabelChange={setNewMusicLabel}
                    onAdd={handleAddMusicModel}
                    onDelete={handleDeleteMusicModel}
                    onRefresh={handleRefreshMusicModels}
                    onSetDefault={handleSetDefaultMusicModel}
                  />
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={handleInitMusicProvider}>初始化默认配置</Button>
              </div>
            </div>
          )}
        </fieldset>

        {/* ========= 存储折叠区域 ========= */}
        <fieldset className={`rounded-xl border transition-colors ${cosPanelOpen ? "border-brand-200" : "border-slate-200"}`}>
          <legend className="px-2">
            <button
              onClick={() => setCosPanelOpen(!cosPanelOpen)}
              className="flex items-center gap-1.5 text-sm font-semibold transition-colors"
              style={{ color: cosPanelOpen ? "#D97706" : "#57534E" }}
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                className={`transition-transform ${cosPanelOpen ? "rotate-90" : ""}`}
              >
                <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              存储
              {cosConfigured ? (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-normal text-emerald-700">已配置</span>
              ) : (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700">未配置</span>
              )}
            </button>
          </legend>

          {cosPanelOpen && (
            <div className="space-y-3 p-4 pt-0">
              <div className="space-y-3 pt-2">
                  <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                    用于第三步「资产准备」中上传本地图片到云端存储。配置后，资产图片将存为 COS 公网 URL，视频生成 API 可直接引用图片作为参考帧。请在腾讯云控制台获取密钥并创建存储桶。
                  </div>

                  <Field label="SecretId">
                    <input type="text" value={cosSettings.secretId} onChange={(e) => updateCos("secretId", e.target.value)} placeholder="AKID..." className="input" autoComplete="off" />
                  </Field>

                  <Field label="SecretKey">
                    <input type="password" value={cosSettings.secretKey} onChange={(e) => updateCos("secretKey", e.target.value)} placeholder="密钥..." className="input" autoComplete="off" />
                  </Field>

                  <Field label="Bucket" hint="格式：BucketName-APPID，如 my-bucket-1250000000">
                    <input type="text" value={cosSettings.bucket} onChange={(e) => updateCos("bucket", e.target.value)} placeholder="BucketName-APPID" className="input" />
                  </Field>

                  <Field label="Region" hint="如 ap-guangzhou、ap-beijing、ap-shanghai">
                    <select value={cosSettings.region} onChange={(e) => updateCos("region", e.target.value)} className="input">
                      <option value="ap-guangzhou">广州（ap-guangzhou）</option>
                      <option value="ap-beijing">北京（ap-beijing）</option>
                      <option value="ap-shanghai">上海（ap-shanghai）</option>
                      <option value="ap-nanjing">南京（ap-nanjing）</option>
                      <option value="ap-chengdu">成都（ap-chengdu）</option>
                      <option value="ap-chongqing">重庆（ap-chongqing）</option>
                      <option value="ap-shenzhen-fsi">深圳金融（ap-shenzhen-fsi）</option>
                      <option value="ap-hongkong">中国香港（ap-hongkong）</option>
                      <option value="ap-singapore">新加坡（ap-singapore）</option>
                      <option value="ap-tokyo">东京（ap-tokyo）</option>
                      <option value="na-siliconvalley">硅谷（na-siliconvalley）</option>
                      <option value="eu-frankfurt">法兰克福（eu-frankfurt）</option>
                    </select>
                  </Field>

                  <Field label="自定义域名（可选）" hint="CDN 加速域名，如 https://cdn.example.com">
                    <input type="text" value={cosSettings.customDomain ?? ""} onChange={(e) => updateCos("customDomain", e.target.value || undefined)} placeholder="https://cdn.example.com（留空使用默认域名）" className="input" />
                  </Field>

                  {cosTestResult && (
                    <div className={`rounded-md px-3 py-2 text-sm ${cosTestResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                      <div className="flex items-center gap-2">
                        {cosTesting && <Spinner size={14} />}
                        <span className="break-all">{cosTestResult.message}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={handleCosTest} loading={cosTesting}>测试上传</Button>
                  </div>
              </div>
            </div>
          )}
        </fieldset>

        <p className="text-xs text-slate-400">
          说明：API Key 保存在服务端数据库中，通过本地服务转发请求，不会上传到任何第三方。
        </p>
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          border-radius: 8px;
          border: 1px solid #D9D3C8;
          background: #fff;
          padding: 8px 12px;
          font-size: 14px;
          color: #44403C;
        }
        :global(.input:focus) {
          outline: none;
          border-color: #D97706;
          box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.25);
        }
      `}</style>

      {/* ========= API Key 批量管理弹框 ========= */}
      <Modal
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        title="API Key 批量管理"
        width="max-w-lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkModalOpen(false)} disabled={bulkBusy}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={handleBulkApplyApiKeys}
              loading={bulkBusy}
              disabled={!bulkSelectedBrand || !(bulkKeyMap[bulkSelectedBrand] ?? "").trim()}
            >
              应用
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            选择一个供应商品牌并填写 API Key，点击「应用」后会同步覆盖到所有分类（对话/图片/视频/音频/音乐）中该品牌的供应商。勾选「同时设置为默认供应商」可一并切换各分类的激活供应商。
          </p>
          {/* 供应商下拉选择 */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">供应商</label>
            <select
              value={bulkSelectedBrand}
              onChange={(e) => setBulkSelectedBrand(e.target.value)}
              className="input"
            >
              {BULK_BRANDS.map((brand) => {
                const { label } = getBrandMeta(brand);
                const cats: string[] = [];
                if ((PROVIDER_PRESETS as Record<string, any>)[brand]) cats.push("对话");
                if ((IMAGE_PROVIDER_PRESETS as Record<string, any>)[brand]) cats.push("图片");
                if ((VIDEO_PROVIDER_PRESETS as Record<string, any>)[brand]) cats.push("视频");
                if ((AUDIO_PROVIDER_PRESETS as Record<string, any>)[brand]) cats.push("音频");
                if ((MUSIC_PROVIDER_PRESETS as Record<string, any>)[brand]) cats.push("音乐");
                return (
                  <option key={brand} value={brand}>
                    {label}（{cats.join(" / ")}）
                  </option>
                );
              })}
            </select>
          </div>
          {/* 选中品牌的 API Key 输入 */}
          {bulkSelectedBrand && (() => {
            const { keyPrefix } = getBrandMeta(bulkSelectedBrand);
            return (
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">API Key</label>
                <input
                  type="password"
                  value={bulkKeyMap[bulkSelectedBrand] ?? ""}
                  onChange={(e) => setBulkKeyMap((prev) => ({ ...prev, [bulkSelectedBrand]: e.target.value }))}
                  placeholder={keyPrefix ? `${keyPrefix}...` : "API Key..."}
                  className="input"
                  autoComplete="off"
                />
              </div>
            );
          })()}
          {/* 同时设置为默认供应商 */}
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={bulkSetAsDefault}
              onChange={(e) => setBulkSetAsDefault(e.target.checked)}
              className="rounded border-slate-300"
            />
            同时设置为默认供应商
          </label>
        </div>
      </Modal>
    </main>
  );
}

// ==================== 模型管理面板（内联组件） ====================

const ALL_RESOLUTIONS = ["1K", "2K", "3K", "4K", "auto", "1024x1024", "1024x1536", "1536x1024", "3840x2160"];

function ModelManagerPanel({
  models,
  modelType,
  provider,
  builtInValues,
  newValue,
  newLabel,
  onNewValueChange,
  onNewLabelChange,
  onAdd,
  onDelete,
  onRefresh,
  onUpdateCapability,
  onUpdateVideoCapability,
  onInitCapability,
  onSetDefault,
  currentModel,
}: {
  models: ModelEntry[];
  modelType?: "llm" | "image" | "video" | "audio" | "music";
  provider?: string;
  builtInValues?: Set<string>;
  newValue: string;
  newLabel: string;
  onNewValueChange: (v: string) => void;
  onNewLabelChange: (v: string) => void;
  onAdd: () => void;
  onDelete: (value: string) => void;
  onRefresh: () => void;
  onUpdateCapability?: (value: string, capability: Partial<ImageModelCapability>) => void;
  onUpdateVideoCapability?: (value: string, capability: Partial<VideoModelCapability>) => void;
  /** 将某个模型的能力参数恢复为代码默认值（仅图片/视频区域传入） */
  onInitCapability?: (value: string) => void;
  onSetDefault?: (value: string) => void;
  currentModel?: string;
}) {
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const confirm = useConfirm();

  const isImage = modelType === "image";
  const isVideo = modelType === "video";
  const hasCapability = isImage || isVideo;
  // 默认模型改为通过模型管理面板的星标设置（沿用当前供应商的默认星标机制，与对话 API 一致）
  const canSetDefault = (modelType === "llm" || modelType === "audio" || modelType === "music" || modelType === "image" || modelType === "video") && !!onSetDefault;

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
      {/* 当前模型列表 */}
      <div className="text-xs font-medium text-slate-500">当前模型列表</div>
      {models.length === 0 ? (
        <p className="text-xs text-slate-400">暂无模型</p>
      ) : (
        <div className="max-h-60 overflow-y-auto space-y-1">
          {models.map((m) => {
            const expanded = expandedModel === m.value;
            const cap = m.capability;
            const vcap = m.videoCapability;
            const isBuiltIn = builtInValues?.has(m.value) ?? false;
            return (
              <div key={m.value} className="rounded-md bg-white">
                <div
                  className={`flex items-center justify-between px-2.5 py-1.5 text-sm rounded-md ${
                    m.value === currentModel ? "bg-brand-50 text-brand-800" : "text-slate-700"
                  }`}
                >
                  <div className="min-w-0 flex-1 flex items-center gap-1.5">
                    {hasCapability && (
                      <button
                        type="button"
                        onClick={() => setExpandedModel(expanded ? null : m.value)}
                        className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
                        title={expanded ? "收起能力配置" : "展开能力配置"}
                      >
                        <svg
                          width="10" height="10" viewBox="0 0 24 24" fill="none"
                          className={`transition-transform ${expanded ? "rotate-90" : ""}`}
                        >
                          <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                    <span className="truncate">
                      {m.label ? `${m.label} ` : ""}
                      <span className="text-xs text-slate-400">{m.value}</span>
                    </span>
                    {m.hint && (
                      <span className="ml-1.5 text-xs text-slate-400">- {m.hint}</span>
                    )}
                    {m.value === currentModel && (
                      <span className="ml-1.5 rounded bg-brand-200 px-1 py-0.5 text-[10px] text-brand-700">
                        当前
                      </span>
                    )}
                    {m.isDefault && (modelType === "audio" || modelType === "music" || modelType === "image" || modelType === "video") && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700">
                        默认
                      </span>
                    )}
                    {isImage && cap && (
                      <span className="ml-1.5 text-[10px] text-slate-400">
                        {cap.resolutions ? cap.resolutions.join("/") : ""}
                        {cap.maxRefImages != null ? ` · 参考${cap.maxRefImages}` : ""}
                      </span>
                    )}
                    {isVideo && vcap && (
                      <span className="ml-1.5 text-[10px] text-slate-400">
                        {vcap.resolutions ? vcap.resolutions.join("/") : ""}
                        {vcap.durationRange ? ` · ${vcap.durationRange[0]}-${vcap.durationRange[1]}s` : ""}
                        {vcap.audio ? " · 有声" : ""}
                      </span>
                    )}
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-0.5">
                    {canSetDefault && (
                      <button
                        type="button"
                        onClick={() => onSetDefault!(m.value)}
                        className={`rounded p-0.5 transition-colors ${
                          m.isDefault
                            ? "text-amber-500 hover:bg-amber-50"
                            : "text-slate-300 hover:text-amber-400 hover:bg-amber-50"
                        }`}
                        title={m.isDefault ? "已设为默认模型" : "设为默认模型"}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill={m.isDefault ? "currentColor" : "none"}>
                          <path
                            d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2-6.3-4.6-6.3 4.6L7.9 13.8 2 9.4h7.6z"
                            stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => !isBuiltIn && onDelete(m.value)}
                      disabled={isBuiltIn}
                      className={`rounded p-0.5 transition-colors ${
                        isBuiltIn
                          ? "text-slate-200 cursor-not-allowed"
                          : "text-slate-400 hover:text-red-500 hover:bg-red-50"
                      }`}
                      title={isBuiltIn ? "内置模型不可删除" : "删除此模型"}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                </div>
                {/* 图片模型能力配置（内置模型同样可编辑，编辑结果随列表落库） */}
                {isImage && expanded && onUpdateCapability && (
                  <ImageCapabilityEditor
                    capability={cap}
                    onChange={(patch) => onUpdateCapability(m.value, patch)}
                  />
                )}
                {/* 视频模型能力配置（内置模型同样可编辑，编辑结果随列表落库） */}
                {isVideo && expanded && onUpdateVideoCapability && (
                  <VideoCapabilityEditor
                    capability={vcap}
                    onChange={(patch) => onUpdateVideoCapability(m.value, patch)}
                  />
                )}
                {/* 初始化模型参数：恢复该模型为代码默认能力（仅代码中存在该模型时可用） */}
                {expanded && onInitCapability && provider &&
                  (isImage
                    ? getCodeDefaultImageCapability(provider, m.value) !== undefined
                    : isVideo && getCodeDefaultVideoCapability(provider, m.value) !== undefined) && (
                  <div className="mx-2.5 mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={async () => {
                        if (await confirm({ message: "确定要将该模型的参数恢复为代码默认值吗？", confirmText: "初始化" })) {
                          onInitCapability(m.value);
                        }
                      }}
                      className="rounded-md px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    >
                      初始化模型参数
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 添加新模型 */}
      <div className="border-t border-slate-200 pt-2">
        <div className="text-xs font-medium text-slate-500 mb-1.5">添加新模型</div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newValue}
            onChange={(e) => onNewValueChange(e.target.value)}
            placeholder="模型 ID（必填）"
            className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
            onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }}
          />
          <input
            type="text"
            value={newLabel}
            onChange={(e) => onNewLabelChange(e.target.value)}
            placeholder="显示名（可选）"
            className="w-32 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
            onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }}
          />
          <button
            type="button"
            onClick={onAdd}
            disabled={!newValue.trim()}
            className="shrink-0 rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            添加
          </button>
        </div>
        {hasCapability && (
          <p className="mt-1.5 text-[11px] text-slate-400">
            添加后可点击模型左侧箭头展开，配置支持的分辨率、时长、功能开关等能力矩阵
          </p>
        )}
      </div>

      {/* 刷新内置模型列表 */}
      <div className="border-t border-slate-200 pt-2 flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            if (await confirm({
              message: "将用代码中最新的内置模型替换当前内置模型（内置模型上手动修改的参数会恢复默认），你添加的自定义模型会保留。确定刷新吗？",
              confirmText: "刷新",
            })) {
              onRefresh();
            }
          }}
        >
          刷新内置模型列表
        </Button>
      </div>
    </div>
  );
}

/** 图片模型能力配置编辑器 */
function ImageCapabilityEditor({
  capability,
  onChange,
  readOnly = false,
}: {
  capability?: Partial<ImageModelCapability>;
  onChange: (patch: Partial<ImageModelCapability>) => void;
  readOnly?: boolean;
}) {
  const cap = capability ?? {};
  const resolutions = cap.resolutions ?? [];

  function toggleResolution(r: string) {
    if (readOnly) return;
    const next = resolutions.includes(r)
      ? resolutions.filter((x) => x !== r)
      : [...resolutions, r];
    onChange({ resolutions: next });
  }

  const boolFields: { key: keyof ImageModelCapability; label: string }[] = [
    { key: "outputFormat", label: "输出格式" },
    { key: "webSearch", label: "联网搜索" },
    { key: "optimizePrompt", label: "提示词优化" },
    { key: "optimizePromptFast", label: "快速优化" },
    { key: "sequentialImageGen", label: "组图功能" },
    { key: "watermark", label: "水印" },
    { key: "responseFormat", label: "返回格式" },
    { key: "quality", label: "画质" },
    { key: "supportsPolling", label: "轮询查询" },
  ];

  return (
    <div className={`border-t border-slate-100 px-2.5 py-2 space-y-2 bg-slate-50/50 ${readOnly ? "pointer-events-none opacity-70" : ""}`}>
      {/* 分辨率 */}
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-xs text-slate-500">分辨率</span>
        <div className="flex flex-wrap gap-1">
          {ALL_RESOLUTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => toggleResolution(r)}
              disabled={readOnly}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${
                resolutions.includes(r)
                  ? "bg-brand-600 text-white"
                  : "bg-white text-slate-500 border border-slate-200 hover:border-brand-400"
              } ${readOnly ? "cursor-default" : ""}`}
            >
              {r}
            </button>
          ))}
          {resolutions.length === 0 && (
            <span className="text-[11px] text-slate-400">未设置则默认 2K</span>
          )}
        </div>
      </div>

      {/* 最大参考图数 */}
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-xs text-slate-500">参考图上限</span>
        <input
          type="number"
          min={0}
          max={20}
          value={cap.maxRefImages ?? ""}
          onChange={(e) => onChange({ maxRefImages: e.target.value === "" ? undefined : Number(e.target.value) })}
          placeholder="默认 14"
          readOnly={readOnly}
          className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
        />
        <span className="text-[11px] text-slate-400">张</span>
      </div>

      {/* 功能开关 */}
      <div className="flex items-start gap-2">
        <span className="w-20 shrink-0 pt-0.5 text-xs text-slate-500">功能支持</span>
        <div className="flex flex-wrap gap-1.5">
          {boolFields.map(({ key, label }) => {
            const val = cap[key] as boolean | undefined;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange({ [key]: !val } as Partial<ImageModelCapability>)}
                disabled={readOnly}
                className={`rounded px-2 py-0.5 text-xs transition-colors ${
                  val === true
                    ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
                    : val === false
                    ? "bg-slate-100 text-slate-400 border border-slate-200 line-through"
                    : "bg-white text-slate-500 border border-slate-200 hover:border-brand-400"
                } ${readOnly ? "cursor-default" : ""}`}
                title={val === undefined ? "未设置（默认开启）" : val ? "已开启" : "已关闭"}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        灰色删除线表示关闭，绿色表示开启，白色表示未设置（使用默认值）
      </p>
    </div>
  );
}

/** 视频模型能力配置编辑器 */
function VideoCapabilityEditor({
  capability,
  onChange,
  readOnly = false,
}: {
  capability?: Partial<VideoModelCapability>;
  onChange: (patch: Partial<VideoModelCapability>) => void;
  readOnly?: boolean;
}) {
  const cap = capability ?? {};

  const allResolutions = ["480p", "720p", "1080p", "4k", "2K", "720P", "1080P"];
  const allRatios = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"];
  const allModes = ["text2video", "first-frame", "first-last-frame", "multimodal-ref"];

  const boolFields: { key: keyof VideoModelCapability; label: string }[] = [
    { key: "durationAuto", label: "自动时长" },
    { key: "audio", label: "有声视频" },
    { key: "draft", label: "Draft样片" },
    { key: "seed", label: "随机种子" },
    { key: "cameraFixed", label: "固定摄像头" },
    { key: "webSearch", label: "联网搜索" },
    { key: "priority", label: "优先级" },
    { key: "returnLastFrame", label: "返回尾帧" },
  ];

  function toggleArrayItem<T>(arr: T[] | undefined, item: T): T[] {
    const current = arr ?? [];
    return current.includes(item) ? current.filter((x) => x !== item) : [...current, item];
  }

  return (
    <div className={`border-t border-slate-100 px-2.5 py-2 space-y-2 bg-slate-50/50 ${readOnly ? "pointer-events-none opacity-70" : ""}`}>
      {/* 分辨率 */}
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-xs text-slate-500">分辨率</span>
        <div className="flex flex-wrap gap-1">
          {allResolutions.map((r) => {
            const active = (cap.resolutions ?? []).includes(r as never);
            return (
              <button key={r} type="button"
                onClick={() => onChange({ resolutions: toggleArrayItem(cap.resolutions, r) as never })}
                disabled={readOnly}
                className={`rounded px-2 py-0.5 text-xs transition-colors ${
                  active ? "bg-brand-600 text-white" : "bg-white text-slate-500 border border-slate-200 hover:border-brand-400"
                } ${readOnly ? "cursor-default" : ""}`}
              >{r}</button>
            );
          })}
        </div>
      </div>

      {/* 宽高比 */}
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-xs text-slate-500">宽高比</span>
        <div className="flex flex-wrap gap-1">
          {allRatios.map((r) => {
            const active = (cap.ratios ?? []).includes(r as never);
            return (
              <button key={r} type="button"
                onClick={() => onChange({ ratios: toggleArrayItem(cap.ratios, r) as never })}
                disabled={readOnly}
                className={`rounded px-2 py-0.5 text-xs transition-colors ${
                  active ? "bg-brand-600 text-white" : "bg-white text-slate-500 border border-slate-200 hover:border-brand-400"
                } ${readOnly ? "cursor-default" : ""}`}
              >{r}</button>
            );
          })}
        </div>
      </div>

      {/* 生成模式 */}
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-xs text-slate-500">生成模式</span>
        <div className="flex flex-wrap gap-1">
          {allModes.map((m) => {
            const active = (cap.modes ?? []).includes(m as never);
            const label = m === "text2video" ? "文生视频" : m === "first-frame" ? "首帧" : m === "first-last-frame" ? "首尾帧" : "多模态参考";
            return (
              <button key={m} type="button"
                onClick={() => onChange({ modes: toggleArrayItem(cap.modes, m) as never })}
                disabled={readOnly}
                className={`rounded px-2 py-0.5 text-xs transition-colors ${
                  active ? "bg-brand-600 text-white" : "bg-white text-slate-500 border border-slate-200 hover:border-brand-400"
                } ${readOnly ? "cursor-default" : ""}`}
              >{label}</button>
            );
          })}
        </div>
      </div>

      {/* 时长范围 */}
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-xs text-slate-500">时长范围</span>
        <input type="number" min={0} max={30}
          value={cap.durationRange?.[0] ?? ""}
          onChange={(e) => {
            const min = e.target.value === "" ? 0 : Number(e.target.value);
            const max = cap.durationRange?.[1] ?? 15;
            onChange({ durationRange: [min, max] });
          }}
          placeholder="最小"
          readOnly={readOnly}
          className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:border-brand-500"
        />
        <span className="text-xs text-slate-400">~</span>
        <input type="number" min={0} max={30}
          value={cap.durationRange?.[1] ?? ""}
          onChange={(e) => {
            const min = cap.durationRange?.[0] ?? 4;
            const max = e.target.value === "" ? 0 : Number(e.target.value);
            onChange({ durationRange: [min, max] });
          }}
          placeholder="最大"
          readOnly={readOnly}
          className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:border-brand-500"
        />
        <span className="text-[11px] text-slate-400">秒</span>
      </div>

      {/* 功能开关 */}
      <div className="flex items-start gap-2">
        <span className="w-20 shrink-0 pt-0.5 text-xs text-slate-500">功能支持</span>
        <div className="flex flex-wrap gap-1.5">
          {boolFields.map(({ key, label }) => {
            const val = cap[key] as boolean | undefined;
            return (
              <button key={key} type="button"
                onClick={() => onChange({ [key]: !val } as Partial<VideoModelCapability>)}
                disabled={readOnly}
                className={`rounded px-2 py-0.5 text-xs transition-colors ${
                  val === true
                    ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
                    : val === false
                    ? "bg-slate-100 text-slate-400 border border-slate-200 line-through"
                    : "bg-white text-slate-500 border border-slate-200 hover:border-brand-400"
                } ${readOnly ? "cursor-default" : ""}`}
                title={val === undefined ? "未设置（使用默认值）" : val ? "已开启" : "已关闭"}
              >{label}</button>
            );
          })}
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        灰色删除线表示关闭，绿色表示开启，白色表示未设置（使用默认值）
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="text-sm font-medium text-slate-700">{label}</label>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** 供应商按钮上的「当前默认供应商」星标 */
function DefaultProviderStar() {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24" fill="currentColor"
      className="ml-1 inline-block shrink-0 align-middle text-amber-500"
      aria-label="当前默认供应商"
    >
      <path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2-6.3-4.6-6.3 4.6L7.9 13.8 2 9.4h7.6z" />
    </svg>
  );
}

/** 默认参数编辑器共用的胶囊按钮样式 */
function defaultCfgPill(active: boolean) {
  return `rounded-full px-2 py-0.5 text-xs transition-colors ${
    active
      ? "bg-violet-100 text-violet-700"
      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
  }`;
}

/** 图片默认生成参数编辑器（设置页；无能力门控的静态全集选项，应用时按所选模型能力收敛） */
function DefaultImageConfigEditor({
  config,
  onChange,
}: {
  config: AssetImageConfig;
  onChange: (patch: Partial<AssetImageConfig>) => void;
}) {
  const boolRow = (
    label: string,
    key: "watermark" | "webSearch",
    hintOn: string,
    hintOff: string
  ) => (
    <div className="flex items-center gap-2" key={key}>
      <span className="w-20 shrink-0 text-slate-500">{label}</span>
      <div className="flex gap-1">
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange({ [key]: v })}
            className={defaultCfgPill((config[key] ?? false) === v)}
          >
            {v ? hintOn : hintOff}
          </button>
        ))}
      </div>
    </div>
  );

  const enumRow = <K extends "outputFormat" | "optimizePromptMode" | "quality" | "responseFormat">(
    label: string,
    key: K,
    options: { value: NonNullable<AssetImageConfig[K]>; label: string }[]
  ) => (
    <div className="flex items-center gap-2" key={key}>
      <span className="w-20 shrink-0 text-slate-500">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange({ [key]: o.value })}
            className={defaultCfgPill(config[key] === o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-slate-500">分辨率</span>
        <div className="flex flex-wrap gap-1">
          {ALL_RESOLUTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onChange({ resolution: r })}
              className={defaultCfgPill(config.resolution === r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-slate-500">宽高比</span>
        <div className="flex flex-wrap gap-1">
          {IMAGE_ASPECT_RATIOS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onChange({ aspectRatio: r })}
              className={defaultCfgPill(config.aspectRatio === r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {enumRow("输出格式", "outputFormat", [
        { value: "png", label: "PNG" },
        { value: "jpeg", label: "JPEG" },
      ])}
      {enumRow("画质", "quality", [
        { value: "low", label: "低" },
        { value: "medium", label: "中" },
        { value: "high", label: "高" },
        { value: "auto", label: "自动" },
      ])}
      {enumRow("提示词优化", "optimizePromptMode", [
        { value: "standard", label: "标准" },
        { value: "fast", label: "快速" },
      ])}
      {enumRow("返回格式", "responseFormat", [
        { value: "url", label: "URL" },
        { value: "b64_json", label: "Base64" },
      ])}
      {boolRow("水印", "watermark", "开启", "关闭")}
      {boolRow("联网搜索", "webSearch", "开启", "关闭")}
    </div>
  );
}

/** 视频默认生成参数编辑器（设置页；无能力门控的静态全集选项，应用时按所选模型能力收敛） */
function DefaultVideoConfigEditor({
  config,
  onChange,
}: {
  config: ShotVideoConfig;
  onChange: (patch: Partial<ShotVideoConfig>) => void;
}) {
  const boolRow = (
    label: string,
    key: "watermark" | "generateAudio" | "cameraFixed" | "returnLastFrame" | "webSearch" | "draft",
    hintOn: string,
    hintOff: string
  ) => (
    <div className="flex items-center gap-2" key={key}>
      <span className="w-20 shrink-0 text-slate-500">{label}</span>
      <div className="flex gap-1">
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange({ [key]: v })}
            className={defaultCfgPill((config[key] ?? false) === v)}
          >
            {v ? hintOn : hintOff}
          </button>
        ))}
      </div>
    </div>
  );

  const numRow = (
    label: string,
    key: "duration" | "seed" | "priority",
    hint: string
  ) => (
    <div className="flex items-center gap-2" key={key}>
      <span className="w-20 shrink-0 text-slate-500">{label}</span>
      <input
        type="number"
        value={config[key]}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange({ [key]: v });
        }}
        className="w-24 rounded border border-slate-300 px-2 py-0.5 focus:outline-none focus:border-violet-400"
      />
      <span className="text-slate-400">{hint}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-slate-500">生成模式</span>
        <div className="flex flex-wrap gap-1">
          {([
            { value: "text2video", label: "文生视频" },
            { value: "first-frame", label: "首帧" },
            { value: "first-last-frame", label: "首尾帧" },
            { value: "multimodal-ref", label: "全能参考" },
          ] as const).map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange({ mode: o.value })}
              className={defaultCfgPill(config.mode === o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-slate-500">分辨率</span>
        <div className="flex flex-wrap gap-1">
          {(["480p", "720p", "1080p", "4k", "2K", "720P", "1080P"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onChange({ resolution: r })}
              className={defaultCfgPill(config.resolution === r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-slate-500">宽高比</span>
        <div className="flex flex-wrap gap-1">
          {(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onChange({ ratio: r })}
              className={defaultCfgPill(config.ratio === r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {numRow("时长", "duration", "秒，-1 = 自动")}
      {numRow("优先级", "priority", "0-9，数字越小优先级越高")}
      {numRow("Seed", "seed", "-1 = 随机")}
      {boolRow("有声生成", "generateAudio", "有声", "无声")}
      {boolRow("水印", "watermark", "开启", "关闭")}
      {boolRow("固定摄像头", "cameraFixed", "开启", "关闭")}
      {boolRow("返回尾帧", "returnLastFrame", "开启", "关闭")}
      {boolRow("联网搜索", "webSearch", "开启", "关闭")}
      {boolRow("样片模式", "draft", "样片", "正式")}
    </div>
  );
}

/** 生成 1x1 像素 PNG 测试图（用于 COS 上传测试） */
function createTestImageBase64(): string {
  // 1x1 透明 PNG 的 base64
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
}
