import type {
  AudioGenSettings,
  AudioProxyRequest,
  AudioProxyResponse,
  ProviderCache,
  ProviderCacheEntry,
  VoiceGenResult,
} from "./types";
import { apiClient } from "./api-client";
import { uploadBase64 } from "./cos-client";
import { getAudioModelCapability, type ModelEntry } from "./model-presets";

/** 音频供应商预设 */
export interface AudioProviderPreset {
  baseURL: string;
  label: string;
  keyPrefix?: string;
  hint?: string;
}

export const AUDIO_PROVIDER_PRESETS: Record<AudioGenSettings["provider"], AudioProviderPreset> = {
  mimo: {
    baseURL: "https://api.xiaomimimo.com/v1",
    label: "小米 MiMo",
    keyPrefix: "sk-",
    hint: "小米 MiMo 大模型平台，提供 mimo-v2.5-tts 系列语音合成模型。前往平台获取 API Key。",
  },
  custom: {
    baseURL: "",
    label: "自定义",
    hint: "自定义兼容 MiMo TTS 格式的 API 端点。",
  },
};

export const DEFAULT_AUDIO_SETTINGS: AudioGenSettings = {
  provider: "mimo",
  apiKey: "",
  baseURL: "https://api.xiaomimimo.com/v1",
};

export async function getAudioSettings(): Promise<AudioGenSettings | null> {
  try {
    const s = await apiClient.getSetting<AudioGenSettings>("audio");
    return s;
  } catch { return null; }
}

export async function saveAudioSettings(s: AudioGenSettings): Promise<void> {
  const normalized: AudioGenSettings = {
    ...s,
    baseURL: s.baseURL.replace(/\/+$/, ""),
  };
  await apiClient.saveSetting("audio", normalized);
}

export async function isAudioConfigured(): Promise<boolean> {
  return !!(await getAudioSettings())?.apiKey;
}

/** 获取各音频 provider 缓存的配置（切换供应商时自动恢复，含 baseURL） */
export async function getAudioProviderKeys(): Promise<ProviderCache> {
  try {
    const raw = await apiClient.getSetting<ProviderCache>("audio_provider_keys");
    return raw ?? {};
  } catch {
    return {};
  }
}

/** 缓存某个音频 provider 的配置（合并写入，不覆盖未传入字段） */
export async function saveAudioProviderKey(provider: string, entry: ProviderCacheEntry): Promise<void> {
  const all = await getAudioProviderKeys();
  all[provider] = { ...all[provider], ...entry };
  await apiClient.saveSetting("audio_provider_keys", all);
}

/** 清除某个音频 provider 的缓存配置（用于「初始化默认配置」时清空旧的缓存） */
export async function clearAudioProviderKey(provider: string): Promise<void> {
  const all = await getAudioProviderKeys();
  if (provider in all) {
    delete all[provider];
    await apiClient.saveSetting("audio_provider_keys", all);
  }
}

/** generateVoice 入参 */
export interface VoiceGenParams {
  /** 模型 ID */
  model: string;
  /** 模型列表（用于能力查询） */
  models?: ModelEntry[];
  /** 音色设计描述（voicedesign 必填）或风格指令（预置/复刻可选） */
  voicePrompt: string;
  /** 样例文本（assistant 消息内容，即要合成语音的目标文本） */
  sampleText: string;
  /** 预置音色 ID（预置 tts，如 Chloe） */
  voiceId?: string;
  /** 音频样本 data URI（voiceclone）：data:audio/wav;base64,... */
  sampleAudioDataUri?: string;
}

/** 样例文本最大字符数（中文约 3-4 字/秒，20 字可确保生成音频 ≤6 秒） */
export const MAX_VOICE_SAMPLE_LENGTH = 20;

/** 将样例文本截断到安全长度，优先在标点处断句，避免生成超过 6 秒的音频 */
function limitSampleText(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_VOICE_SAMPLE_LENGTH) return t;
  const slice = t.slice(0, MAX_VOICE_SAMPLE_LENGTH);
  const m = slice.match(/.*[。！？.!?,，、；;：:]/);
  return m ? m[0] : slice;
}

/**
 * 生成人物音色：调用 mimo TTS 生成音频 -> 转存 COS -> 返回持久 URL 与元信息。
 */
export async function generateVoice(params: VoiceGenParams): Promise<VoiceGenResult> {
  const { model, voicePrompt, sampleText } = params;
  const s = await getAudioSettings();
  if (!s || !s.apiKey) {
    throw new Error("未配置音频生成 API，请先在「设置」中填写");
  }

  const cap = getAudioModelCapability(model, params.models);
  const messages: Array<{ role: string; content: string }> = [];

  // user 消息：voicedesign 必填（音色描述）；预置/复刻可选（风格指令，可为空）
  if (cap.supportsVoiceDesign) {
    messages.push({ role: "user", content: voicePrompt || "Give me a natural human voice." });
  } else {
    messages.push({ role: "user", content: voicePrompt || "" });
  }
  // assistant 消息：要合成语音的目标文本（voicedesign 且 optimize_text_preview 时可省略，这里始终传入）
  // 限制长度以确保生成音频不超过 6 秒
  messages.push({ role: "assistant", content: limitSampleText(sampleText) || "你好，这是我的声音。" });

  const audio: Record<string, unknown> = { format: "wav" };
  let voiceId = "";
  if (cap.supportsPresetVoice) {
    voiceId = params.voiceId || "mimo_default";
    audio.voice = voiceId;
  } else if (cap.supportsVoiceClone) {
    if (!params.sampleAudioDataUri) {
      throw new Error("音色复刻需要提供音频样本，请上传或从资产库选取音频");
    }
    voiceId = "voiceclone";
    audio.voice = params.sampleAudioDataUri;
  } else if (cap.supportsVoiceDesign) {
    audio.optimize_text_preview = false;
    voiceId = "voicedesign";
  }

  const payload: Record<string, unknown> = { model, messages, audio };

  const body: AudioProxyRequest = {
    apiKey: s.apiKey,
    baseURL: s.baseURL,
    payload,
  };
  console.log("[VoiceGeneration] 上游请求 payload：", { model, audio });

  const res = await fetch("/api/audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const data = (await res.json()) as AudioProxyResponse;
  const { audioBase64, format } = data;

  // 转存到 COS
  const voiceUrl = await uploadAudio(audioBase64, format);

  return {
    voiceUrl,
    voicePrompt,
    voiceModel: model,
    voiceId,
  };
}

/** 将 base64 音频上传到存储，返回公网 URL */
async function uploadAudio(audioBase64: string, format: string): Promise<string> {
  const ext = format === "wav" ? "wav" : format === "mp3" ? "mp3" : "wav";
  const dataUri = audioBase64.startsWith("data:")
    ? audioBase64
    : `data:audio/${ext};base64,${audioBase64}`;
  const fileName = `audio-${Date.now()}.${ext}`;
  const { url } = await uploadBase64(dataUri, fileName);
  return url;
}
