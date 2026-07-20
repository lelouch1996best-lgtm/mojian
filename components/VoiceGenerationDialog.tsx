"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import AssetPicker, { type PickedAssetItem } from "./AssetPicker";
import { type VoiceGenParams, MAX_VOICE_SAMPLE_LENGTH } from "@/lib/audio-client";
import {
  getAudioModelCapability,
  getDefaultModelValue,
  type ModelEntry,
} from "@/lib/model-presets";
import type { CharacterProfile } from "@/lib/types";

/** 预置音色 ID 列表（mimo-v2.5-tts） */
const PRESET_VOICES = [
  "mimo_default",
  "冰糖",
  "茉莉",
  "苏打",
  "白桦",
  "Mia",
  "Chloe",
  "Milo",
  "Dean",
];

const DEFAULT_SAMPLE_TEXT = "你好，这是我的声音。";

export interface VoiceGenerationDialogProps {
  open: boolean;
  onClose: () => void;
  /** 提交生成参数：弹框会立即关闭，由父组件在卡片音色模块显示 loading 并后台执行生成 */
  onGenerate: (params: VoiceGenParams) => void;
  /** 用于预填音色描述（性别/年龄/性格） */
  character?: CharacterProfile;
  /** 模型列表 */
  audioModels?: ModelEntry[];
  /** 存储是否已配置 */
  storageConfigured?: boolean;
}

/** 根据人物性别/年龄/性格预填一段音色描述 */
function buildDefaultVoicePrompt(char?: CharacterProfile): string {
  if (!char) return "";
  const parts: string[] = [];
  if (char.genderAge.trim()) parts.push(char.genderAge.trim());
  if (char.personality.trim()) parts.push(`性格${char.personality.trim()}`);
  if (parts.length === 0) return "";
  return `${parts.join("，")}的角色声音`;
}

/** 读取本地文件为 base64 data URI */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

/** 将资产库 URL 音频转为 data URI（voiceclone 需要音频数据） */
async function urlToDataUri(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("获取音频失败");
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("读取音频失败"));
    reader.readAsDataURL(blob);
  });
}

/**
 * 音色生成弹框（人物设定用）。
 * 根据所选模型能力渲染不同参数区：预置音色 / 音色设计 / 音色复刻。
 * 点击生成后立即关闭弹框，由父组件后台执行生成并在卡片显示 loading。
 */
export function VoiceGenerationDialog({
  open,
  onClose,
  onGenerate,
  character,
  audioModels = [],
  storageConfigured,
}: VoiceGenerationDialogProps) {
  const defaultModel = getDefaultModelValue(audioModels);
  const [model, setModel] = useState(defaultModel ?? "");
  const [voicePrompt, setVoicePrompt] = useState("");
  const [sampleText, setSampleText] = useState(DEFAULT_SAMPLE_TEXT);
  const [voiceId, setVoiceId] = useState(PRESET_VOICES[0]);
  const [sampleAudioDataUri, setSampleAudioDataUri] = useState("");
  const [sampleAudioName, setSampleAudioName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cap = getAudioModelCapability(model, audioModels);

  useEffect(() => {
    if (open) {
      setModel(defaultModel ?? "");
      setVoicePrompt(buildDefaultVoicePrompt(character));
      setSampleText(DEFAULT_SAMPLE_TEXT);
      setVoiceId(PRESET_VOICES[0]);
      setSampleAudioDataUri("");
      setSampleAudioName("");
      setError(null);
    }
  }, [open, defaultModel, character]);

  const canConfirm = (() => {
    if (!sampleText.trim()) return false;
    if (cap.supportsVoiceDesign && !voicePrompt.trim()) return false;
    if (cap.supportsVoiceClone && !sampleAudioDataUri) return false;
    return true;
  })();

  function handleGenerate() {
    if (!canConfirm) return;
    const params: VoiceGenParams = {
      model,
      models: audioModels,
      voicePrompt: voicePrompt.trim(),
      sampleText: sampleText.trim(),
    };
    if (cap.supportsPresetVoice) params.voiceId = voiceId;
    if (cap.supportsVoiceClone) params.sampleAudioDataUri = sampleAudioDataUri;
    onGenerate(params);
  }

  async function handleAddFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setError(`不支持的音频格式：${file.type || "未知"}，建议上传 wav/mp3`);
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setError(`音频「${file.name}」超过 30MB 限制`);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const dataUri = await readFileAsDataURL(file);
      setSampleAudioDataUri(dataUri);
      setSampleAudioName(file.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handlePickAsset(items: PickedAssetItem[]) {
    setPickerOpen(false);
    if (items.length === 0) return;
    const item = items[0];
    setError(null);
    setUploading(true);
    try {
      const dataUri = await urlToDataUri(item.url);
      setSampleAudioDataUri(dataUri);
      setSampleAudioName(item.name);
    } catch (e) {
      setError(`从资产库加载音频失败：${(e as Error).message}，建议直接上传本地文件`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="音色生成"
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleGenerate} disabled={!canConfirm}>
            生成音色
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* 模型选择 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">音色模型</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            {audioModels.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label ?? m.value}
              </option>
            ))}
          </select>
          {cap.supportsPresetVoice && (
            <p className="mt-1 text-xs text-slate-400">预置音色模式：选择内置音色 ID 合成语音。</p>
          )}
          {cap.supportsVoiceDesign && (
            <p className="mt-1 text-xs text-slate-400">音色设计模式：用文字描述生成专属音色。</p>
          )}
          {cap.supportsVoiceClone && (
            <p className="mt-1 text-xs text-slate-400">音色复刻模式：上传音频样本复刻音色。</p>
          )}
        </div>

        {/* 预置音色 */}
        {cap.supportsPresetVoice && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">预置音色</label>
            <select
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              {PRESET_VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 音色描述（voicedesign） */}
        {cap.supportsVoiceDesign && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">音色描述</label>
            <textarea
              value={voicePrompt}
              onChange={(e) => setVoicePrompt(e.target.value)}
              rows={3}
              placeholder="描述想要的音色，如：成熟低沉的男性声音，语速平稳…"
              className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        )}

        {/* 音频样本（voiceclone） */}
        {cap.supportsVoiceClone && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">音频样本</label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? "读取中…" : "上传本地文件"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPickerOpen(true)}
                disabled={uploading}
              >
                从资产库选择
              </Button>
              {sampleAudioName && (
                <span className="text-xs text-slate-500" title={sampleAudioName}>
                  已选：{sampleAudioName}
                </span>
              )}
            </div>
            {sampleAudioDataUri && (
              <audio controls src={sampleAudioDataUri} className="mt-2 w-full" />
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleAddFile(file);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {/* 样例文本 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            样例文本
            <span className="ml-1 font-normal text-slate-400">（不超过 {MAX_VOICE_SAMPLE_LENGTH} 字，确保音频 ≤6 秒）</span>
          </label>
          <textarea
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value.slice(0, MAX_VOICE_SAMPLE_LENGTH))}
            rows={2}
            maxLength={MAX_VOICE_SAMPLE_LENGTH}
            placeholder="输入要合成语音的文本…"
            className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        {storageConfigured === false && (
          <p className="text-xs text-amber-600">未配置存储方式，生成的音色将无法持久保存，请先在「设置」中配置。</p>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      <AssetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        mediaType="audio"
        multiple={false}
        selectedUrls={[]}
        onConfirm={handlePickAsset}
      />
    </Modal>
  );
}
