/**
 * Z-Image Turbo 文生图 / 图生图（本地 ComfyUI 动态拼图，官方标准节点）。
 *
 * 文生图链路：
 *   UNETLoader(z_image_turbo) ┐
 *   CLIPLoader(qwen_3_4b, type="qwen_image") → CLIPTextEncode(正/负) ┤→ KSampler → VAEDecode → SaveImage
 *   EmptySD3LatentImage(w, h) ┘                        VAELoader(ae) ┘
 *
 * 图生图链路（TextEncodeZImageOmni，最多 3 张参考图）：
 *   LoadImage(×N) → TextEncodeZImageOmni(clip, prompt, vae, image1..3)
 *   （VAE 把参考图编码为 reference_latents 并自动缩放到 ~1024² 面积，
 *    prompt 用 Qwen vision 模板包裹，提示词可直接描述如何修改参考图）
 *
 * Turbo 蒸馏版推荐：steps=8、cfg=1（不启用 CFG，负面提示词无效）、euler + simple。
 * 分辨率支持 512–2048，最佳 1024；宽高按 16 像素对齐。
 */

interface WorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title: string };
}

export type ZImageMode = "t2i" | "img2img";

export interface BuildZImageParams {
  /** 模式：t2i 纯文生图 / img2img 参考图生图 */
  mode: ZImageMode;
  /** 正向提示词 */
  prompt: string;
  /** 负向提示词（cfg=1 时无效，仅 cfg>1 生效） */
  negativePrompt: string;
  width: number;
  height: number;
  /** 采样步数（turbo 推荐 8） */
  steps: number;
  /** CFG（turbo 蒸馏模型固定 1） */
  cfg: number;
  seed: number;
  /** UNETLoader.unet_name，如 z_image_turbo_bf16.safetensors */
  unetName: string;
  /** CLIPLoader.clip_name，如 qwen_3_4b.safetensors（type 固定 "qwen_image"，非 flux 时自动走 Z-Image 编码器） */
  clipName: string;
  /** VAELoader.vae_name，如 ae.safetensors */
  vaeName: string;
  /** 参考图（img2img 模式，≤3，ComfyUI input 目录路径 subfolder/name） */
  refImagePaths?: string[];
}

export function buildZImageWorkflow(p: BuildZImageParams): Record<string, WorkflowNode> {
  const g: Record<string, WorkflowNode> = {};

  // 模型加载
  g["1"] = {
    class_type: "UNETLoader",
    inputs: { unet_name: p.unetName, weight_dtype: "default" },
    _meta: { title: "Load Diffusion Model" },
  };
  g["2"] = {
    class_type: "CLIPLoader",
    inputs: { clip_name: p.clipName, type: "qwen_image" },
    _meta: { title: "Load Text Encoder" },
  };
  g["3"] = {
    class_type: "VAELoader",
    inputs: { vae_name: p.vaeName },
    _meta: { title: "Load VAE" },
  };

  if (p.mode === "img2img" && p.refImagePaths?.length) {
    // ---- 图生图：参考图经 VAE 编码为 reference_latents，prompt 描述如何基于参考图生成 ----
    const refs = p.refImagePaths.slice(0, 3);
    const imageInputs: Record<string, unknown> = {
      clip: ["2", 0],
      prompt: p.prompt,
      auto_resize_images: true,
      vae: ["3", 0],
    };
    refs.forEach((img, i) => {
      const loadId = `10${i + 1}`;
      g[loadId] = {
        class_type: "LoadImage",
        inputs: { image: img },
        _meta: { title: `参考图 ${i + 1}` },
      };
      imageInputs[`image${i + 1}`] = [loadId, 0];
    });
    g["4"] = {
      class_type: "TextEncodeZImageOmni",
      inputs: imageInputs,
      _meta: { title: "正向提示词（含参考图）" },
    };
  } else {
    // ---- 文生图 ----
    g["4"] = {
      class_type: "CLIPTextEncode",
      inputs: { text: p.prompt, clip: ["2", 0] },
      _meta: { title: "正向提示词" },
    };
  }
  g["5"] = {
    class_type: "CLIPTextEncode",
    inputs: { text: p.negativePrompt, clip: ["2", 0] },
    _meta: { title: "负向提示词" },
  };

  // 空潜空间
  g["6"] = {
    class_type: "EmptySD3LatentImage",
    inputs: { width: p.width, height: p.height, batch_size: 1 },
    _meta: { title: "Empty Latent Image" },
  };

  // 采样（Z-Image 模型内置 shift=3.0，KSampler 自动应用）
  g["7"] = {
    class_type: "KSampler",
    inputs: {
      seed: p.seed,
      steps: p.steps,
      cfg: p.cfg,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: 1.0,
      model: ["1", 0],
      positive: ["4", 0],
      negative: ["5", 0],
      latent_image: ["6", 0],
    },
    _meta: { title: "KSampler" },
  };

  // 解码 + 保存
  g["8"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["7", 0], vae: ["3", 0] },
    _meta: { title: "VAE Decode" },
  };
  g["9"] = {
    class_type: "SaveImage",
    inputs: { images: ["8", 0], filename_prefix: "z_image" },
    _meta: { title: "Save Image" },
  };

  return g;
}

/** 按比例与基准长边计算画布，16 像素对齐，范围 512–2048 */
export function zImageCanvas(
  ratioW: number,
  ratioH: number,
  base: number
): { width: number; height: number } {
  let w: number;
  let h: number;
  if (ratioW >= ratioH) {
    w = base;
    h = Math.round((base * ratioH) / ratioW);
  } else {
    h = base;
    w = Math.round((base * ratioW) / ratioH);
  }
  const align = (n: number) => Math.min(2048, Math.max(256, Math.round(n / 16) * 16));
  return { width: align(w), height: align(h) };
}
