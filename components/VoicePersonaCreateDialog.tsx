"use client";

import { useState } from "react";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import { isAudioConfigured, MAX_VOICE_SAMPLE_LENGTH } from "@/lib/audio-client";
import { isMusicConfigured } from "@/lib/music-client";
import { isCosConfigured } from "@/lib/cos-client";
import {
  createVoiceFromAudio,
  generateTtsAndCreateVoice,
  uploadAndCreateVoice,
  createPendingVoicePersona,
  persistVoicePersona,
} from "@/lib/voice-persona-client";
import { saveVoicePersona } from "@/lib/storage";
import type { VoicePersona } from "@/lib/types";

type CreateMode = "upload" | "tts" | "url";

const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60";

const MODE_OPTIONS: { value: CreateMode; label: string }[] = [
  { value: "upload", label: "上传音频" },
  { value: "tts", label: "TTS 生成" },
  { value: "url", label: "粘贴链接" },
];

const ACCEPTED_TYPES = [".mp3", ".wav", "audio/mpeg", "audio/wav", "audio/x-wav"];

export interface VoicePersonaCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (vp: VoicePersona) => void;
}

export default function VoicePersonaCreateDialog({
  open,
  onClose,
  onCreated,
}: VoicePersonaCreateDialogProps) {
  const [mode, setMode] = useState<CreateMode>("upload");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [voicePrompt, setVoicePrompt] = useState("");
  const [sampleText, setSampleText] = useState("你好，这是我的声音。");
  const [audioUrl, setAudioUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");

  function reset() {
    setMode("upload");
    setName("");
    setFile(null);
    setVoicePrompt("");
    setSampleText("你好，这是我的声音。");
    setAudioUrl("");
    setBusy(false);
    setProgress(0);
    setStatusMsg("");
    setError("");
  }

  function handleClose() {
    if (busy) return;
    reset();
    onClose();
  }

  function validateFile(f: File): string | null {
    const ext = "." + (f.name.split(".").pop() ?? "").toLowerCase();
    const typeOk = ACCEPTED_TYPES.includes(f.type) || ACCEPTED_TYPES.includes(ext);
    if (!typeOk) return "仅支持 MP3 / WAV 格式";
    if (f.size > 50 * 1024 * 1024) return "文件大小不能超过 50MB";
    return null;
  }

  async function handleSubmit() {
    setError("");

    if (!name.trim()) {
      setError("请填写音色名称");
      return;
    }
    if (!(await isMusicConfigured())) {
      setError("请先在设置中配置音乐生成 API（APIMart）");
      return;
    }

    let sourceType: VoicePersona["sourceType"];
    let sourceAudioUrl = "";
    let description: string | undefined;

    if (mode === "upload") {
      if (!file) {
        setError("请选择音频文件");
        return;
      }
      const fileErr = validateFile(file);
      if (fileErr) {
        setError(fileErr);
        return;
      }
      if (!(await isCosConfigured())) {
        setError("请先在设置中配置对象存储（COS）");
        return;
      }
      sourceType = "upload";
    } else if (mode === "tts") {
      if (!voicePrompt.trim()) {
        setError("请填写音色描述");
        return;
      }
      if (!(await isAudioConfigured())) {
        setError("请先在设置中配置音频生成 API（MiMo）");
        return;
      }
      sourceType = "tts";
      description = voicePrompt.trim();
    } else {
      if (!audioUrl.trim()) {
        setError("请填写音频 URL");
        return;
      }
      sourceType = "url";
      sourceAudioUrl = audioUrl.trim();
    }

    setBusy(true);
    setProgress(5);
    setStatusMsg("正在准备…");

    const vp = createPendingVoicePersona(name.trim(), sourceType, sourceAudioUrl, description);
    await persistVoicePersona(vp);

    try {
      let personaId = "";

      if (mode === "upload" && file) {
        const result = await uploadAndCreateVoice(file, {
          onProgress: (p) => setProgress(p),
          onStatus: (msg) => setStatusMsg(msg),
        });
        personaId = result.personaId;
        vp.sourceAudioUrl = result.sourceAudioUrl;
      } else if (mode === "tts") {
        const result = await generateTtsAndCreateVoice(
          { voicePrompt: voicePrompt.trim(), sampleText: sampleText.trim() },
          {
            onProgress: (p) => setProgress(p),
            onStatus: (msg) => setStatusMsg(msg),
          }
        );
        personaId = result.personaId;
        vp.sourceAudioUrl = result.sourceAudioUrl;
      } else {
        setStatusMsg("正在从音频创建音色…");
        personaId = await createVoiceFromAudio(sourceAudioUrl, {
          onProgress: (p) => setProgress(p),
          onStatus: (msg) => setStatusMsg(msg),
        });
      }

      vp.personaId = personaId;
      vp.status = "completed";
      vp.sunoTaskId = undefined;
      vp.updatedAt = Date.now();
      await persistVoicePersona(vp);

      setProgress(100);
      setStatusMsg("创建成功！");
      onCreated?.(vp);
      setTimeout(() => handleClose(), 800);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      vp.status = "failed";
      vp.error = msg;
      vp.updatedAt = Date.now();
      await saveVoicePersona(vp);
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="创建歌手音色"
      width="max-w-xl"
      footer={
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {busy ? statusMsg : "从音频提取可复用人声音色，用于音乐生成"}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleClose} disabled={busy}>
              取消
            </Button>
            <Button onClick={handleSubmit} loading={busy} disabled={busy}>
              创建
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {busy && progress > 0 && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-brand-500 transition-all duration-300"
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            音色名称 <span className="text-red-500">*</span>
          </label>
          <input
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder="给这个音色起个名字"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">创建方式</label>
          <div className="flex gap-1.5">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={busy}
                onClick={() => setMode(opt.value)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  mode === opt.value
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {mode === "upload" && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              音频文件 <span className="text-red-500">*</span>
            </label>
            <input
              type="file"
              accept=".mp3,.wav,audio/mpeg,audio/wav"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
            />
            {file && (
              <p className="mt-1 text-xs text-slate-500">
                已选择：{file.name}（{(file.size / 1024 / 1024).toFixed(1)} MB）
              </p>
            )}
            <p className="mt-1 text-xs text-slate-400">支持 MP3 / WAV，建议包含清晰人声</p>
          </div>
        )}

        {mode === "tts" && (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                音色描述 <span className="text-red-500">*</span>
              </label>
              <input
                value={voicePrompt}
                disabled={busy}
                onChange={(e) => setVoicePrompt(e.target.value)}
                placeholder="如：温柔成熟的女声，略带磁性"
                className={INPUT_CLASS}
              />
              <p className="mt-1 text-xs text-slate-400">
                使用 MiMo voicedesign 生成人声音频，再提取为音色
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">样例文本</label>
              <input
                value={sampleText}
                disabled={busy}
                maxLength={MAX_VOICE_SAMPLE_LENGTH}
                onChange={(e) => setSampleText(e.target.value)}
                placeholder="要合成语音的文本"
                className={INPUT_CLASS}
              />
              <p className="mt-1 text-xs text-slate-400">
                最多 {MAX_VOICE_SAMPLE_LENGTH} 字（{sampleText.length}/{MAX_VOICE_SAMPLE_LENGTH}）
              </p>
            </div>
          </>
        )}

        {mode === "url" && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              音频 URL <span className="text-red-500">*</span>
            </label>
            <input
              value={audioUrl}
              disabled={busy}
              onChange={(e) => setAudioUrl(e.target.value)}
              placeholder="https://example.com/voice.mp3"
              className={INPUT_CLASS}
            />
            <p className="mt-1 text-xs text-slate-400">公开可访问的 MP3 / WAV 链接</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
