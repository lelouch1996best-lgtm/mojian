"use client";

import { useEffect, useState } from "react";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import Spinner from "./ui/Spinner";
import ImageLightbox from "./ImageLightbox";
import {
  getSettings,
  saveSettings,
  testConnection,
  PROVIDER_PRESETS,
} from "@/lib/llm-client";
import {
  getImageSettings,
  saveImageSettings,
  testImageConnection,
  SIZE_PRESETS,
  DEFAULT_IMAGE_SETTINGS,
} from "@/lib/image-client";
import {
  getVideoSettings,
  saveVideoSettings,
  DEFAULT_VIDEO_SETTINGS,
} from "@/lib/video-client";
import {
  getLLMModels,
  saveLLMModels,
  resetLLMModels,
  getImageModels,
  saveImageModels,
  resetImageModels,
  getVideoModels,
  saveVideoModels,
  resetVideoModels,
  initAllModels,
  type ModelEntry,
} from "@/lib/model-presets";
import {
  getCosSettings,
  saveCosSettings,
} from "@/lib/cos-client";
import type { CosSettings, ImageGenSettings, LLMSettings, VideoGenSettings } from "@/lib/types";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  // ---- LLM 状态 ----
  const [provider, setProvider] = useState<LLMSettings["provider"]>("deepseek");
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);

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
  const [imgSaved, setImgSaved] = useState(false);

  // ---- 图片模型管理 ----
  const [imageModels, setImageModels] = useState<ModelEntry[]>([]);
  const [showImageManager, setShowImageManager] = useState(false);
  const [newImageValue, setNewImageValue] = useState("");
  const [newImageLabel, setNewImageLabel] = useState("");

  // ---- 视频 API 状态 ----
  const [vidSettings, setVidSettings] = useState<VideoGenSettings>(DEFAULT_VIDEO_SETTINGS);
  const [videoPanelOpen, setVideoPanelOpen] = useState(false);
  const [vidSaved, setVidSaved] = useState(false);

  // ---- 视频模型管理 ----
  const [videoModels, setVideoModels] = useState<ModelEntry[]>([]);
  const [showVideoManager, setShowVideoManager] = useState(false);
  const [newVideoValue, setNewVideoValue] = useState("");
  const [newVideoLabel, setNewVideoLabel] = useState("");

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
  const [cosSaved, setCosSaved] = useState(false);
  const [cosTesting, setCosTesting] = useState(false);
  const [cosTestResult, setCosTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // ---- 初始化模型 ----
  const [initializing, setInitializing] = useState(false);

  // 打开时载入已存设置
  useEffect(() => {
    if (!open) return;
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
    setSaved(false);

    // LLM 模型列表
    const currentProvider = s?.provider ?? "deepseek";
    setLLMModels(await getLLMModels(currentProvider));
    setShowLLMManager(false);
    setNewLLMValue("");
    setNewLLMLabel("");

    // 图片
    const is = await getImageSettings();
    setImgSettings(is ?? { ...DEFAULT_IMAGE_SETTINGS });
    setImagePanelOpen(!!is?.apiKey);
    setImgTestResult(null);
    setImgSaved(false);

    // 图片模型列表
    setImageModels(await getImageModels());
    setShowImageManager(false);
    setNewImageValue("");
    setNewImageLabel("");

    // 视频
    const vs = await getVideoSettings();
    setVidSettings(vs ?? { ...DEFAULT_VIDEO_SETTINGS });
    setVideoPanelOpen(!!vs?.apiKey);
    setVidSaved(false);

    // 视频模型列表
    setVideoModels(await getVideoModels());
    setShowVideoManager(false);
    setNewVideoValue("");
    setNewVideoLabel("");

    // COS
    const cos = await getCosSettings();
    const cosCfg = !!(cos?.secretId && cos?.secretKey && cos?.bucket && cos?.region);
    setCosSettings(cos ?? { secretId: "", secretKey: "", bucket: "", region: "ap-guangzhou", customDomain: "" });
    setCosPanelOpen(cosCfg);
    setCosConfigured(cosCfg);
    setCosSaved(false);
    setCosTestResult(null);
    })();
  }, [open]);

  // ---- LLM handlers ----
  async function handleProviderChange(p: LLMSettings["provider"]) {
    setProvider(p);
    const preset = PROVIDER_PRESETS[p];
    if (p !== "custom") {
      setBaseURL(preset.baseURL);
      setModel(preset.model);
    }
    setTestResult(null);
    // 切换 provider 时重新加载模型列表
    setLLMModels(await getLLMModels(p));
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

  function handleSave() {
    if (!baseURL || !apiKey || !model) {
      setTestResult({ ok: false, message: "请先填写全部字段" });
      return;
    }
    saveSettings({ provider, baseURL, apiKey, model });
    saveLLMModels(provider, llmModels);
    setSaved(true);
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

  async function handleResetLLMModels() {
    const defaults = await resetLLMModels(provider);
    setLLMModels(defaults);
    if (!defaults.some((m) => m.value === model) && defaults.length > 0) {
      setModel(defaults[0].value);
    }
  }

  // ---- 图片 API handlers ----
  function updateImg<K extends keyof ImageGenSettings>(key: K, value: ImageGenSettings[K]) {
    setImgSettings((prev) => ({ ...prev, [key]: value }));
    setImgTestResult(null);
    setImgSaved(false);
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

  function handleImgSave() {
    if (!imgSettings.apiKey) {
      setImgTestResult({ ok: false, message: "请先填写 API Key" });
      return;
    }
    saveImageSettings(imgSettings);
    saveImageModels(imageModels);
    setImgSaved(true);
  }

  // ---- 图片模型管理 ----
  async function handleAddImageModel() {
    const v = newImageValue.trim();
    if (!v) return;
    if (imageModels.some((m) => m.value === v)) return;
    const label = newImageLabel.trim() || undefined;
    const updated = [...imageModels, { value: v, label }];
    setImageModels(updated);
    await saveImageModels(updated);
    setNewImageValue("");
    setNewImageLabel("");
  }

  async function handleDeleteImageModel(value: string) {
    const updated = imageModels.filter((m) => m.value !== value);
    setImageModels(updated);
    await saveImageModels(updated);
    if (imgSettings.model === value && updated.length > 0) {
      updateImg("model", updated[0].value);
    }
  }

  async function handleResetImageModels() {
    const defaults = await resetImageModels();
    setImageModels(defaults);
    if (!defaults.some((m) => m.value === imgSettings.model) && defaults.length > 0) {
      updateImg("model", defaults[0].value);
    }
  }

  // ---- 视频 API handlers ----
  function updateVid<K extends keyof VideoGenSettings>(key: K, value: VideoGenSettings[K]) {
    setVidSettings((prev) => ({ ...prev, [key]: value }));
    setVidSaved(false);
  }

  function handleVidSave() {
    if (!vidSettings.apiKey) {
      setVidSaved(false);
      alert("请先填写 API Key（或先在上方图片 API 区域配置，会自动复用）");
      return;
    }
    saveVideoSettings(vidSettings);
    saveVideoModels(videoModels);
    setVidSaved(true);
  }

  // ---- 视频模型管理 ----
  async function handleAddVideoModel() {
    const v = newVideoValue.trim();
    if (!v) return;
    if (videoModels.some((m) => m.value === v)) return;
    const label = newVideoLabel.trim() || undefined;
    const updated = [...videoModels, { value: v, label }];
    setVideoModels(updated);
    await saveVideoModels(updated);
    setNewVideoValue("");
    setNewVideoLabel("");
  }

  async function handleDeleteVideoModel(value: string) {
    const updated = videoModels.filter((m) => m.value !== value);
    setVideoModels(updated);
    await saveVideoModels(updated);
  }

  async function handleResetVideoModels() {
    const defaults = await resetVideoModels();
    setVideoModels(defaults);
  }

  // ---- COS handlers ----
  function updateCos<K extends keyof CosSettings>(key: K, value: CosSettings[K]) {
    setCosSettings((prev) => ({ ...prev, [key]: value }));
    setCosSaved(false);
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

  function handleCosSave() {
    if (!cosSettings.secretId || !cosSettings.secretKey || !cosSettings.bucket || !cosSettings.region) {
      setCosTestResult({ ok: false, message: "请先填写所有必填字段" });
      return;
    }
    saveCosSettings(cosSettings);
    setCosSaved(true);
  }

  /** 统一保存所有配置 */
  async function handleSaveAll() {
    // LLM
    if (baseURL && apiKey && model) {
      await saveSettings({ provider, baseURL, apiKey, model });
      await saveLLMModels(provider, llmModels);
    }
    // 图片
    if (imgSettings.apiKey) {
      await saveImageSettings(imgSettings);
      await saveImageModels(imageModels);
    }
    // 视频
    if (vidSettings.apiKey || vidSettings.baseURL) {
      await saveVideoSettings(vidSettings);
      await saveVideoModels(videoModels);
    }
    // COS
    if (cosSettings.secretId && cosSettings.secretKey && cosSettings.bucket) {
      await saveCosSettings(cosSettings);
    }

    setSaved(true);
    setImgSaved(true);
    setVidSaved(true);
    setCosSaved(true);
  }

  /** 初始化：用代码中的默认模型覆盖数据库 */
  async function handleInitModels() {
    if (!window.confirm(
      "确定要用代码中的默认模型配置覆盖数据库中的所有模型列表吗？\n\n" +
      "将覆盖：\n" +
      "• 所有 LLM 服务商的模型列表\n" +
      "• 图片生成模型列表\n" +
      "• 视频生成模型列表\n\n" +
      "自定义添加的模型将被清除。"
    )) {
      return;
    }
    setInitializing(true);
    try {
      await initAllModels();
      // 刷新 UI 中的模型列表
      const llmDefaults = await getLLMModels(provider);
      const imgDefaults = await getImageModels();
      const vidDefaults = await getVideoModels();
      setLLMModels(llmDefaults);
      setImageModels(imgDefaults);
      setVideoModels(vidDefaults);
      // 如果当前选中的模型不在默认列表中，切换到第一个
      if (!llmDefaults.some((m) => m.value === model) && llmDefaults.length > 0) {
        setModel(llmDefaults[0].value);
      }
      if (!imgDefaults.some((m) => m.value === imgSettings.model) && imgDefaults.length > 0) {
        updateImg("model", imgDefaults[0].value);
      }
    } finally {
      setInitializing(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="API 设置"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleInitModels}
              loading={initializing}
            >
              初始化模型列表
            </Button>
          </div>
          <Button size="sm" onClick={handleSaveAll}>
            保存全部设置
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* ========= LLM 区域 ========= */}
        <fieldset className="rounded-xl border border-slate-200 p-4">
          <legend className="px-2 text-sm font-semibold text-slate-700">
            对话 API
          </legend>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                服务商
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(Object.keys(PROVIDER_PRESETS) as LLMSettings["provider"][]).map((p) => (
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
                  </button>
                ))}
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

            {/* --- LLM 模型选择器 + 管理 --- */}
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label className="text-sm font-medium text-slate-700">模型名称</label>
                {provider !== "custom" && (
                  <button
                    type="button"
                    onClick={() => setShowLLMManager(!showLLMManager)}
                    className="text-xs text-brand-600 hover:text-brand-800 transition-colors"
                  >
                    {showLLMManager ? "收起管理" : "管理模型"}
                  </button>
                )}
              </div>
              {provider !== "custom" ? (
                <select value={model} onChange={(e) => setModel(e.target.value)} className="input">
                  {llmModels.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label ? `${m.label}（${m.value}）` : m.value}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" className="input" />
              )}

              {/* LLM 模型管理面板 */}
              {showLLMManager && provider !== "custom" && (
                <ModelManagerPanel
                  models={llmModels}
                  newValue={newLLMValue}
                  newLabel={newLLMLabel}
                  onNewValueChange={setNewLLMValue}
                  onNewLabelChange={setNewLLMLabel}
                  onAdd={handleAddLLMModel}
                  onDelete={handleDeleteLLMModel}
                  onReset={handleResetLLMModels}
                  currentModel={model}
                />
              )}
            </div>

            {PROVIDER_PRESETS[provider]?.hint && (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                {PROVIDER_PRESETS[provider].hint}
              </div>
            )}
            {testResult && (
              <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${testResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                {testing && <Spinner size={14} />}
                <span>{testResult.message}</span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={handleTest} loading={testing}>测试连接</Button>
            </div>
          </div>
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
              图片生成 API（火山引擎 Seedream）
              {!imgSettings.apiKey && imagePanelOpen && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700">未配置</span>
              )}
              {imgSettings.apiKey && !imagePanelOpen && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-normal text-emerald-700">已配置</span>
              )}
            </button>
          </legend>

          {imagePanelOpen && (
            <div className="space-y-3 p-4 pt-0">
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                用于第三步「资产准备」中的图片生成。请在火山方舟控制台获取 API Key 并开通对应模型。
              </div>

              <Field label="Base URL">
                <input type="text" value={imgSettings.baseURL} onChange={(e) => updateImg("baseURL", e.target.value)} placeholder="https://ark.cn-beijing.volces.com/api/v3" className="input" />
              </Field>

              <Field label="API Key">
                <input type="password" value={imgSettings.apiKey} onChange={(e) => updateImg("apiKey", e.target.value)} placeholder="ark-..." className="input" autoComplete="off" />
              </Field>

              {/* --- 图片模型选择器 + 管理 --- */}
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label className="text-sm font-medium text-slate-700">模型</label>
                  <button
                    type="button"
                    onClick={() => setShowImageManager(!showImageManager)}
                    className="text-xs text-brand-600 hover:text-brand-800 transition-colors"
                  >
                    {showImageManager ? "收起管理" : "管理模型"}
                  </button>
                </div>
                <select value={imgSettings.model} onChange={(e) => updateImg("model", e.target.value)} className="input">
                  {imageModels.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label ? `${m.label}（${m.value}）` : m.value}
                    </option>
                  ))}
                </select>

                {showImageManager && (
                  <ModelManagerPanel
                    models={imageModels}
                    newValue={newImageValue}
                    newLabel={newImageLabel}
                    onNewValueChange={setNewImageValue}
                    onNewLabelChange={setNewImageLabel}
                    onAdd={handleAddImageModel}
                    onDelete={handleDeleteImageModel}
                    onReset={handleResetImageModels}
                    currentModel={imgSettings.model}
                  />
                )}
              </div>

              <Field label="生成尺寸">
                <select value={imgSettings.size} onChange={(e) => updateImg("size", e.target.value)} className="input">
                  {SIZE_PRESETS.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </Field>

              <Field label="输出格式">
                <div className="flex gap-2">
                  {(["png", "jpeg"] as const).map((f) => (
                    <button key={f} onClick={() => updateImg("outputFormat", f)}
                      className={`rounded-md border px-4 py-2 text-sm transition-colors ${imgSettings.outputFormat === f ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="返回格式">
                <div className="flex gap-2">
                  {(["url", "b64_json"] as const).map((f) => (
                    <button key={f} onClick={() => updateImg("responseFormat", f)}
                      className={`rounded-md border px-4 py-2 text-sm transition-colors ${imgSettings.responseFormat === f ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
                      {f === "url" ? "URL 链接" : "Base64"}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="水印">
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={imgSettings.watermark} onChange={(e) => updateImg("watermark", e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                  <span className="text-sm text-slate-700">{imgSettings.watermark ? "添加水印" : "不添加水印"}</span>
                </label>
              </Field>

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
              视频生成 API（火山引擎 Seedance）
              {!vidSettings.apiKey && videoPanelOpen && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700">未配置</span>
              )}
              {vidSettings.apiKey && !videoPanelOpen && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-normal text-emerald-700">已配置</span>
              )}
            </button>
          </legend>

          {videoPanelOpen && (
            <div className="space-y-3 p-4 pt-0">
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                用于第四步「视频生成」。与图片 API 共用同一火山方舟 API Key，若上方已配置图片 API，此处 API Key 留空会自动复用。视频生成为异步任务，提交后需轮询状态。
              </div>

              <Field label="Base URL">
                <input type="text" value={vidSettings.baseURL} onChange={(e) => updateVid("baseURL", e.target.value)} placeholder="https://ark.cn-beijing.volces.com/api/v3" className="input" />
              </Field>

              <Field label="API Key" hint="留空则自动复用图片 API 的 Key">
                <input type="password" value={vidSettings.apiKey} onChange={(e) => updateVid("apiKey", e.target.value)} placeholder="ark-...（留空复用图片 API）" className="input" autoComplete="off" />
              </Field>

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
                    newValue={newVideoValue}
                    newLabel={newVideoLabel}
                    onNewValueChange={setNewVideoValue}
                    onNewLabelChange={setNewVideoLabel}
                    onAdd={handleAddVideoModel}
                    onDelete={handleDeleteVideoModel}
                    onReset={handleResetVideoModels}
                  />
                )}
              </div>

            </div>
          )}
        </fieldset>

        {/* ========= COS 存储折叠区域 ========= */}
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
              腾讯云 COS 存储
              {!cosConfigured && cosPanelOpen && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700">未配置</span>
              )}
              {cosConfigured && !cosPanelOpen && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-normal text-emerald-700">已配置</span>
              )}
            </button>
          </legend>

          {cosPanelOpen && (
            <div className="space-y-3 p-4 pt-0">
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
    </Modal>
  );
}

// ==================== 模型管理面板（内联组件） ====================

function ModelManagerPanel({
  models,
  newValue,
  newLabel,
  onNewValueChange,
  onNewLabelChange,
  onAdd,
  onDelete,
  onReset,
  currentModel,
}: {
  models: ModelEntry[];
  newValue: string;
  newLabel: string;
  onNewValueChange: (v: string) => void;
  onNewLabelChange: (v: string) => void;
  onAdd: () => void;
  onDelete: (value: string) => void;
  onReset: () => void;
  currentModel?: string;
}) {
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
      {/* 当前模型列表 */}
      <div className="text-xs font-medium text-slate-500">当前模型列表</div>
      {models.length === 0 ? (
        <p className="text-xs text-slate-400">暂无模型</p>
      ) : (
        <div className="max-h-40 overflow-y-auto space-y-1">
          {models.map((m) => (
            <div
              key={m.value}
              className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm ${
                m.value === currentModel
                  ? "bg-brand-50 text-brand-800"
                  : "bg-white text-slate-700"
              }`}
            >
              <div className="min-w-0 flex-1">
                <span className="truncate">
                  {m.label ? `${m.label} ` : ""}
                  <span className="text-xs text-slate-400">{m.value}</span>
                </span>
                {m.hint && (
                  <span className="ml-1.5 text-xs text-slate-400">— {m.hint}</span>
                )}
                {m.value === currentModel && (
                  <span className="ml-1.5 rounded bg-brand-200 px-1 py-0.5 text-[10px] text-brand-700">
                    当前
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDelete(m.value)}
                className="ml-2 shrink-0 rounded p-0.5 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="删除此模型"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
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
      </div>

      {/* 恢复默认 */}
      <div className="border-t border-slate-200 pt-2">
        <button
          type="button"
          onClick={() => {
            if (window.confirm("确定要恢复为默认模型列表吗？自定义的模型将被清除。")) {
              onReset();
            }
          }}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
        >
          初始化模型列表
        </button>
      </div>
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

/** 生成 1x1 像素 PNG 测试图（用于 COS 上传测试） */
function createTestImageBase64(): string {
  // 1x1 透明 PNG 的 base64
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
}
