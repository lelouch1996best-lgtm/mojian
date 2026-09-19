/**
 * MiniMax H3 视频（本地 ComfyUI 动态拼图）。
 *
 * 标准链路（官方标准节点，不依赖任何已保存的工作流）：
 *   UNETLoader → MiniMaxH3SigmaShift → BasicGuider ┐
 *   MiniMaxH3ImageToVideo / MiniMaxH3ReferenceToVideo ┤→ SamplerCustomAdvanced
 *   RandomNoise + KSamplerSelect + BasicScheduler ┘
 *   → MiniMaxH3AVDecodeT8 → VHS_VideoCombine（H.264 + 原生音轨）
 *
 * 加速链路（accelerated=true，对应原 "Dual-clock 8-step Generator" 工作流）：
 *   UNETLoader → MiniMaxH3MemoryEfficientSageAttentionPatch（kjnodes，SageAttention 省显存）
 *   → LoraLoaderBypassModelOnly（turbo 蒸馏 LoRA，步数压到 4-8 步）
 *   → MiniMaxH3DualClockSamplerT8（dual_clock_euler + native_flow，视频/音频双时钟，
 *     输出 [MODEL, SAMPLER, SIGMAS] 直接喂 SamplerCustomAdvanced，替代 SigmaShift 组合）
 *
 * 三种模式：
 * - t2v    文生视频（MiniMaxH3ImageToVideo，无图）
 * - i2v    首尾帧图生视频（MiniMaxH3ImageToVideo + first_frame/last_frame）
 * - ref2va 全能参考（MiniMaxH3ReferenceToVideo：图 ≤9 / 视频 ≤3 / 音频 ≤3，
 *          prompt 用 <Picture i> <Video k> <Audio j> 按连接顺序引用）
 */

export type MinimaxMode = "t2v" | "i2v" | "ref2va";

export interface MinimaxRefVideo {
  /** VHS_LoadVideo video 字段（上传返回 subfolder/name） */
  videoPath: string;
  /** 是否把该视频的原声一起作为音频参考（<Audio j> 标签） */
  withAudio: boolean;
}

export interface BuildMinimaxVideoParams {
  mode: MinimaxMode;
  prompt: string;
  /** 画布宽（32 的倍数，面积 ≤ 768×1344） */
  width: number;
  /** 画布高 */
  height: number;
  /** 帧数（24fps，17n+5 对齐） */
  length: number;
  /** 噪波种子 */
  seed: number;
  /** 采样步数 */
  steps: number;
  /** 加速模式：SageAttention patch + turbo LoRA + 双时钟采样器（原 Dual-clock 8-step 工作流） */
  accelerated?: boolean;
  /** 加速模式 turbo LoRA（LoraLoaderBypassModelOnly.lora_name），如 minimax_h3_turbo_4STEPS_comfyui.safetensors */
  loraName?: string;
  /** UNETLoader.unet_name */
  unetName: string;
  /** CLIPLoader.clip_name */
  clipName: string;
  /** 视频 VAE（VAELoader.vae_name） */
  vaeVideoName: string;
  /** 音频 VAE（VAELoader.vae_name） */
  vaeAudioName: string;
  /** i2v：首帧图（LoadImage image 字段） */
  firstFramePath?: string;
  /** i2v：尾帧图（可选） */
  lastFramePath?: string;
  /** ref2va：参考图（≤9，顺序即 <Picture i> 序号） */
  refImagePaths: string[];
  /** ref2va：参考视频（≤3，顺序即 <Video k> 序号） */
  refVideos: MinimaxRefVideo[];
  /** ref2va：独立参考音频（≤3，顺序即 <Audio j> 序号） */
  refAudioPaths: string[];
}

/** 画布：短边分辨率 + 宽高比 → 32 倍数宽高（面积上限 768×1344） */
export function minimaxCanvas(ratioW: number, ratioH: number, shortSide: number): {
  width: number;
  height: number;
} {
  const ratio = ratioW / ratioH;
  let w: number;
  let h: number;
  if (ratio >= 1) {
    w = shortSide * ratio;
    h = shortSide;
  } else {
    w = shortSide;
    h = shortSide / ratio;
  }
  const maxArea = 768 * 1344;
  if (w * h > maxArea) {
    const k = Math.sqrt(maxArea / (w * h));
    w *= k;
    h *= k;
  }
  const m = 32;
  return {
    width: Math.max(m, Math.round(w / m) * m),
    height: Math.max(m, Math.round(h / m) * m),
  };
}

/** 秒 → 帧数（24fps，向上对齐到 17n+5 网格，最短 5 帧） */
export function minimaxSecondsToLength(seconds: number): number {
  let n = Math.max(5, Math.round(seconds * 24));
  while ((n - 5) % 17 !== 0) n++;
  return n;
}

type WorkflowNode = {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title: string };
};

/** 按参数动态拼装可直接 POST /prompt 的 API JSON */
export function buildMinimaxVideoWorkflow(p: BuildMinimaxVideoParams): Record<string, WorkflowNode> {
  const g: Record<string, WorkflowNode> = {};

  // ---- 模型加载 ----
  g["1"] = { class_type: "UNETLoader", inputs: { unet_name: p.unetName, weight_dtype: "default" } };
  g["2"] = { class_type: "CLIPLoader", inputs: { clip_name: p.clipName, type: "minimax" } };
  g["3"] = { class_type: "VAELoader", inputs: { vae_name: p.vaeVideoName } };
  g["4"] = { class_type: "VAELoader", inputs: { vae_name: p.vaeAudioName } };

  // ---- 条件节点（模式相关） ----
  if (p.mode === "ref2va") {
    const inputs: Record<string, unknown> = {
      clip: ["2", 0],
      vae: ["3", 0],
      audio_vae: ["4", 0],
      prompt: p.prompt,
      width: p.width,
      height: p.height,
      length: p.length,
      ref_image_size: "match",
    };
    // 参考图：LoadImage → ref_images.ref_image_N
    p.refImagePaths.slice(0, 9).forEach((path, i) => {
      const id = `li${i}`;
      g[id] = { class_type: "LoadImage", inputs: { image: path } };
      inputs[`ref_images.ref_image_${i}`] = [id, 0];
    });
    // 参考视频：VHS_LoadVideo（输出 0=IMAGE 帧，2=AUDIO 原声）→ ref_videos.ref_video_N
    p.refVideos.slice(0, 3).forEach((v, i) => {
      const id = `lv${i}`;
      g[id] = {
        class_type: "VHS_LoadVideo",
        inputs: {
          video: v.videoPath,
          force_rate: 24, // 节点要求参考视频帧率为 24fps
          custom_width: 0,
          custom_height: 0,
          frame_load_cap: 0,
          skip_first_frames: 0,
          select_every_nth: 1,
        },
      };
      inputs[`ref_videos.ref_video_${i}`] = [id, 0];
      if (v.withAudio) {
        inputs[`ref_video_audios.ref_video_audio_${i}`] = [id, 2];
      }
    });
    // 独立参考音频：LoadAudio → ref_audios.ref_audio_N
    p.refAudioPaths.slice(0, 3).forEach((path, i) => {
      const id = `la${i}`;
      g[id] = { class_type: "LoadAudio", inputs: { audio: path } };
      inputs[`ref_audios.ref_audio_${i}`] = [id, 0];
    });
    g["6"] = { class_type: "MiniMaxH3ReferenceToVideo", inputs };
  } else {
    const inputs: Record<string, unknown> = {
      clip: ["2", 0],
      vae: ["3", 0],
      prompt: p.prompt,
      width: p.width,
      height: p.height,
      length: p.length,
    };
    if (p.mode === "i2v") {
      if (p.firstFramePath) {
        g["lf"] = { class_type: "LoadImage", inputs: { image: p.firstFramePath } };
        inputs.first_frame = ["lf", 0];
      }
      if (p.lastFramePath) {
        g["ll"] = { class_type: "LoadImage", inputs: { image: p.lastFramePath } };
        inputs.last_frame = ["ll", 0];
      }
    }
    g["6"] = { class_type: "MiniMaxH3ImageToVideo", inputs };
  }

  // ---- 采样（标准 / 加速两条链路） ----
  g["8"] = { class_type: "RandomNoise", inputs: { noise_seed: p.seed } };
  if (p.accelerated) {
    // 加速：SageAttention 省显存 patch → turbo LoRA → 双时钟采样器（输出 model/sampler/sigmas）
    g["14"] = {
      class_type: "MiniMaxH3MemoryEfficientSageAttentionPatch",
      inputs: { model: ["1", 0] },
    };
    g["15"] = {
      class_type: "LoraLoaderBypassModelOnly",
      inputs: { model: ["14", 0], lora_name: p.loraName ?? "", strength_model: 1 },
    };
    g["16"] = {
      class_type: "MiniMaxH3DualClockSamplerT8",
      inputs: {
        model: ["15", 0],
        av_latent: ["6", 1],
        steps: p.steps,
        shift_video: 12.0,
        shift_audio: 3.0,
        sampler_name: "dual_clock_euler",
        scheduler: "native_flow",
      },
    };
    g["7"] = { class_type: "BasicGuider", inputs: { model: ["16", 0], conditioning: ["6", 0] } };
    g["11"] = {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["8", 0],
        guider: ["7", 0],
        sampler: ["16", 1],
        sigmas: ["16", 2],
        latent_image: ["6", 1],
      },
    };
  } else {
    // 标准：视频/音频双流 shift（官方推荐 video 12 / audio 3）
    g["5"] = {
      class_type: "MiniMaxH3SigmaShift",
      inputs: { model: ["1", 0], shift_video: 12.0, shift_audio: 3.0 },
    };
    g["7"] = { class_type: "BasicGuider", inputs: { model: ["5", 0], conditioning: ["6", 0] } };
    g["9"] = { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } };
    g["10"] = {
      class_type: "BasicScheduler",
      inputs: { model: ["5", 0], scheduler: "simple", steps: p.steps, denoise: 1.0 },
    };
    g["11"] = {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["8", 0],
        guider: ["7", 0],
        sampler: ["9", 0],
        sigmas: ["10", 0],
        latent_image: ["6", 1],
      },
    };
  }

  // ---- 解码 + 合成（T8 节点输出 [IMAGE, AUDIO]） ----
  g["12"] = {
    class_type: "MiniMaxH3AVDecodeT8",
    inputs: { av_latent: ["11", 0], video_vae: ["3", 0], audio_vae: ["4", 0] },
  };
  g["13"] = {
    class_type: "VHS_VideoCombine",
    inputs: {
      frame_rate: 24,
      loop_count: 0,
      filename_prefix: "MiniMaxH3",
      format: "video/h264-mp4",
      pix_fmt: "yuv420p",
      crf: 19,
      save_metadata: true,
      trim_to_audio: false,
      pingpong: false,
      save_output: true,
      images: ["12", 0],
      audio: ["12", 1],
    },
  };

  return g;
}
