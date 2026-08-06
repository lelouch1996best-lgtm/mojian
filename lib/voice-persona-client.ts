import type { VoicePersona } from "@/lib/types";
import { createVoiceTask, pollMusicTask } from "@/lib/music-client";
import { generateVoice, MAX_VOICE_SAMPLE_LENGTH } from "@/lib/audio-client";
import { uploadRefFile } from "@/lib/cos-client";
import { saveVoicePersona, emptyVoicePersona } from "@/lib/storage";

const VOICEDESIGN_MODEL = "mimo-v2.5-tts-voicedesign";

export interface CreateVoiceOpts {
  onProgress?: (p: number) => void;
  onStatus?: (msg: string) => void;
  signal?: AbortSignal;
}

/**
 * 从音频 URL 创建音色：提交 createVoice -> 轮询 -> 返回 personaId。
 */
export async function createVoiceFromAudio(
  audioUrl: string,
  opts: CreateVoiceOpts = {}
): Promise<string> {
  opts.onStatus?.("正在提交创建音色任务…");
  const taskId = await createVoiceTask(audioUrl);

  const result = await pollMusicTask(
    taskId,
    {
      onProgress: (r) => {
        opts.onProgress?.(r.progress ?? 50);
      },
      onFailed: (err) => {
        opts.onStatus?.(`创建失败：${err}`);
      },
    },
    4000,
    5 * 60 * 1000,
    opts.signal
  );

  if (result.status === "failed") {
    throw new Error(result.error || "音色创建失败");
  }

  const personaId = result.personaId;
  if (!personaId) {
    console.error("[VoicePersona] createVoice 结果未包含 persona_id", result.rawResult);
    throw new Error("创建音色成功但未返回 persona_id，请稍后重试或联系开发者");
  }

  return personaId;
}

/**
 * TTS 生成再提取：MiMo voicedesign 生成人声音频 -> createVoice -> 轮询 -> 返回 personaId + 源音频 URL。
 */
export async function generateTtsAndCreateVoice(
  params: { voicePrompt: string; sampleText: string },
  opts: CreateVoiceOpts = {}
): Promise<{ personaId: string; sourceAudioUrl: string }> {
  opts.onStatus?.("正在生成 TTS 人声音频…");
  opts.onProgress?.(10);

  const voiceResult = await generateVoice({
    model: VOICEDESIGN_MODEL,
    voicePrompt: params.voicePrompt,
    sampleText: params.sampleText.slice(0, MAX_VOICE_SAMPLE_LENGTH),
  });

  opts.onProgress?.(40);
  opts.onStatus?.("正在从音频提取音色…");

  const personaId = await createVoiceFromAudio(voiceResult.voiceUrl, {
    onProgress: (p) => opts.onProgress?.(40 + Math.round(p * 0.6)),
    onStatus: opts.onStatus,
    signal: opts.signal,
  });

  return { personaId, sourceAudioUrl: voiceResult.voiceUrl };
}

/**
 * 上传音频文件到 COS 并创建音色。
 */
export async function uploadAndCreateVoice(
  file: File,
  opts: CreateVoiceOpts = {}
): Promise<{ personaId: string; sourceAudioUrl: string }> {
  opts.onStatus?.("正在上传音频文件…");
  opts.onProgress?.(10);

  const sourceAudioUrl = await uploadRefFile(file, `voice-source-${Date.now()}`);

  opts.onProgress?.(30);
  const personaId = await createVoiceFromAudio(sourceAudioUrl, {
    onProgress: (p) => opts.onProgress?.(30 + Math.round(p * 0.7)),
    onStatus: opts.onStatus,
    signal: opts.signal,
  });

  return { personaId, sourceAudioUrl };
}

/**
 * 持久化音色记录到数据库（创建成功后调用）。
 */
export async function persistVoicePersona(
  vp: VoicePersona
): Promise<VoicePersona> {
  await saveVoicePersona(vp);
  return vp;
}

/**
 * 构建一个新的音色记录（pending 状态）。
 */
export function createPendingVoicePersona(
  name: string,
  sourceType: VoicePersona["sourceType"],
  sourceAudioUrl: string,
  description?: string,
  seriesId?: string,
  seriesTitle?: string
): VoicePersona {
  const vp = emptyVoicePersona(name, sourceType, sourceAudioUrl);
  vp.status = "pending";
  vp.description = description;
  vp.seriesId = seriesId;
  vp.seriesTitle = seriesTitle;
  return vp;
}
