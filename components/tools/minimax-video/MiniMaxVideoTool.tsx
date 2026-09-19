"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import ComfyUiConfig from "@/components/tools/comfyui/ComfyUiConfig";
import { usePreviewUrl } from "@/components/tools/runninghub/usePreviewUrl";
import { useTaskSubmit } from "@/components/tools/useTaskSubmit";
import { apiClient } from "@/lib/api-client";
import {
  buildMinimaxVideoWorkflow,
  minimaxCanvas,
  minimaxSecondsToLength,
  type MinimaxMode,
} from "@/components/tools/minimax-video/workflow";
import {
  uploadComfyUiFile,
  comfyUiImagePath,
  submitComfyUiPrompt,
  fetchComfyUiModels,
  freeComfyUiMemory,
} from "@/lib/comfyui-client";
import type { ComfyUiModelsResponse } from "@/lib/types";

const MODE_OPTIONS: { value: MinimaxMode; label: string; hint: string }[] = [
  { value: "t2v", label: "文生视频 T2V", hint: "纯提示词生成，视频自带原生立体声音轨" },
  { value: "i2v", label: "首尾帧 I2V", hint: "首帧必填、尾帧可选，从静图生成动态视频" },
  { value: "ref2va", label: "全能参考 R2V", hint: "参考图 ≤9、参考视频 ≤3、参考音频 ≤3，锁定人物 / 风格 / 运镜 / 声音" },
];

const RATIO_OPTIONS = ["16:9", "9:16", "1:1", "4:3", "21:9"] as const;

const RESOLUTION_OPTIONS: { value: number; label: string }[] = [
  { value: 384, label: "384p（极限省内存）" },
  { value: 448, label: "448p（省内存推荐）" },
  { value: 512, label: "512p" },
  { value: 576, label: "576p" },
  { value: 640, label: "640p" },
  { value: 704, label: "704p（≈720p）" },
  { value: 768, label: "768p（标准 · H3 上限）" },
];

const MODE_LABEL_SHORT: Record<MinimaxMode, string> = {
  t2v: "T2V",
  i2v: "I2V",
  ref2va: "R2V",
};

const LOG_MODEL_BY_MODE: Record<MinimaxMode, string> = {
  t2v: "文生视频（MiniMax H3）",
  i2v: "首尾帧生视频（MiniMax H3）",
  ref2va: "参考生视频（MiniMax H3）",
};

const PROMPT_PLACEHOLDER = `A lone traveler walks along a windswept cliff at golden hour, cinematic tracking shot, ambient wind, soft orchestral score

（R2V 模式可在提示词里用 <Picture 1>、<Video 1>、<Audio 1> 按上传顺序引用参考素材）`;

/** 单文件预览小卡片（图 / 视频 / 音频） */
function FilePreview({ file, video }: { file: File; video?: boolean }) {
  const url = usePreviewUrl(file);
  if (!url) return null;
  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      {video ? (
        <video src={url} muted controls className="h-24 w-auto" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className="h-24 w-auto object-contain" />
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const a = document.createElement("a");
          a.href = url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }}
        className="absolute right-1 top-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white"
        title="查看原文件"
      >
        查看
      </button>
    </div>
  );
}

export default function MiniMaxVideoTool() {
  const router = useRouter();
  const [online, setOnline] = useState<boolean | null>(null);
  const [baseUrl, setBaseUrl] = useState("");

  // 模型列表与选择
  const [models, setModels] = useState<ComfyUiModelsResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [unetName, setUnetName] = useState("");
  const [clipName, setClipName] = useState("");
  const [vaeVideoName, setVaeVideoName] = useState("");
  const [vaeAudioName, setVaeAudioName] = useState("");
  const [loraName, setLoraName] = useState("");

  // 生成参数
  const [mode, setMode] = useState<MinimaxMode>("ref2va");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<string>("16:9");
  const [shortSide, setShortSide] = useState(768);
  const [duration, setDuration] = useState(5);
  const [seed, setSeed] = useState(42);
  const [steps, setSteps] = useState(8);
  const [accelerated, setAccelerated] = useState(true);

  // 模式相关输入
  const [firstFrame, setFirstFrame] = useState<File | null>(null);
  const [lastFrame, setLastFrame] = useState<File | null>(null);
  const [refImages, setRefImages] = useState<File[]>([]);
  const [refVideos, setRefVideos] = useState<{ file: File; withAudio: boolean }[]>([]);
  const [refAudios, setRefAudios] = useState<File[]>([]);

  const [statusText, setStatusText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const modelsLoadedRef = useRef(false);
  const guard = useTaskSubmit();

  const formDisabled = guard.submitting;

  // 在线后自动拉取模型列表（每次地址变更后仅拉一次）
  useEffect(() => {
    if (online !== true || !baseUrl || modelsLoadedRef.current) return;
    modelsLoadedRef.current = true;
    void loadModels(baseUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, baseUrl]);

  async function loadModels(url: string) {
    setModelsLoading(true);
    setModelsError("");
    try {
      const m = await fetchComfyUiModels(url);
      setModels(m);
      const prefer = (list: string[], keys: string[], fallback = true): string => {
        for (const k of keys) {
          const hit = list.find((n) => n.toLowerCase().includes(k));
          if (hit) return hit;
        }
        return fallback && list.length ? list[0] : "";
      };
      setUnetName((prev) => prev || prefer(m.unet, ["minimax"]));
      setClipName((prev) => prev || prefer(m.clip, ["minimax", "int8"]));
      setVaeVideoName((prev) => prev || prefer(m.vae, ["video"]));
      setVaeAudioName((prev) => prev || prefer(m.vae, ["audio"]));
      setLoraName((prev) => prev || prefer(m.lora, ["turbo"]));
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelsLoading(false);
    }
  }

  const canvas = minimaxCanvas(...(ratio.split(":").map(Number) as [number, number]), shortSide);
  const length = minimaxSecondsToLength(duration);
  const actualShort = Math.min(canvas.width, canvas.height);

  async function doSubmit() {
    if (!baseUrl) return;
    const p = prompt.trim();
    if (!p) {
      setError("请填写提示词");
      return;
    }
    if (!unetName || !clipName || !vaeVideoName || !vaeAudioName) {
      setError("请先加载并选择模型（Diffusion / 文本编码器 / 视频 VAE / 音频 VAE）");
      return;
    }
    if (accelerated && !loraName) {
      setError("加速模式需要选择 turbo LoRA（模型列表里没有 LoRA 时请点「刷新模型列表」或关闭加速模式）");
      return;
    }
    if (mode === "i2v" && !firstFrame) {
      setError("I2V 模式需要上传首帧图");
      return;
    }
    if (mode === "ref2va" && refImages.length === 0 && refVideos.length === 0) {
      setError("R2V 模式至少需要一张参考图或一个参考视频");
      return;
    }
    if (online !== true) {
      setError(`未检测到本地 ComfyUI（${baseUrl}），请先启动后点「刷新」重试。`);
      return;
    }
    setError("");
    setSubmitted(false);
    setStatusText("正在上传素材到本地 ComfyUI…");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      // 1) 上传素材（/upload/image 不校验扩展名，图片/视频/音频通用）
      let firstFramePath: string | undefined;
      let lastFramePath: string | undefined;
      const refImagePaths: string[] = [];
      const refVideoPaths: { videoPath: string; withAudio: boolean }[] = [];
      const refAudioPaths: string[] = [];
      if (mode === "i2v") {
        if (firstFrame) firstFramePath = comfyUiImagePath(await uploadComfyUiFile(firstFrame, baseUrl));
        if (lastFrame) lastFramePath = comfyUiImagePath(await uploadComfyUiFile(lastFrame, baseUrl));
      } else if (mode === "ref2va") {
        for (const f of refImages.slice(0, 9)) {
          refImagePaths.push(comfyUiImagePath(await uploadComfyUiFile(f, baseUrl)));
        }
        for (const v of refVideos.slice(0, 3)) {
          refVideoPaths.push({
            videoPath: comfyUiImagePath(await uploadComfyUiFile(v.file, baseUrl)),
            withAudio: v.withAudio,
          });
        }
        for (const f of refAudios.slice(0, 3)) {
          refAudioPaths.push(comfyUiImagePath(await uploadComfyUiFile(f, baseUrl)));
        }
      }

      // 2) 动态拼图并提交
      const workflow = buildMinimaxVideoWorkflow({
        mode,
        prompt: p,
        width: canvas.width,
        height: canvas.height,
        length,
        seed,
        steps,
        accelerated,
        loraName,
        unetName,
        clipName,
        vaeVideoName,
        vaeAudioName,
        firstFramePath,
        lastFramePath,
        refImagePaths,
        refVideos: refVideoPaths,
        refAudioPaths,
      });
      setStatusText("正在提交生成任务…");
      const run = await submitComfyUiPrompt({
        workflow,
        baseUrl,
        logModel: LOG_MODEL_BY_MODE[mode],
        logType: "video",
        signal: ctrl.signal,
      });

      // 3) 注册进任务中心：服务端接管轮询，本页可关闭/继续发起新任务
      await apiClient.registerToolTask({
        toolId: "minimax-video",
        toolName: LOG_MODEL_BY_MODE[mode],
        source: "comfyui",
        mediaType: "video",
        title: `${MODE_LABEL_SHORT[mode]} · ${duration}s · ${ratio} · ${canvas.width}×${canvas.height}${accelerated ? " · 加速" : ""}`,
        prompt: p,
        upstreamTaskId: run.promptId,
        baseUrl,
      });
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setStatusText("");
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    setStatusText("");
  }

  async function handleFreeMemory() {
    setError("");
    setStatusText("正在释放内存（卸载模型 + 清空执行缓存）…");
    try {
      await freeComfyUiMemory(baseUrl);
      setStatusText("内存已释放（PyTorch 进程自留底属正常）");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleToggleAccelerated(on: boolean) {
    setAccelerated(on);
    // 仅当步数处于另一档推荐值时才自动带到本档推荐值（加速 8 / 标准 20），用户自定义值不覆盖
    setSteps((s) => (on ? (s === 20 ? 8 : s) : s === 8 ? 20 : s));
  }

  const canStart =
    !!prompt.trim() &&
    !guard.disabled &&
    online === true &&
    !!unetName &&
    !!clipName &&
    !!vaeVideoName &&
    !!vaeAudioName &&
    (!accelerated || !!loraName);

  const modeHint = MODE_OPTIONS.find((m) => m.value === mode)?.hint ?? "";

  return (
    <div className="space-y-5">
      {/* 本地 ComfyUI 连接配置：页面内直接查看与修改 */}
      <ComfyUiConfig
        onStatusChange={(o, url) => {
          setOnline(o);
          if (url !== baseUrl) modelsLoadedRef.current = false;
          setBaseUrl(url);
        }}
      />

      {online === true && (
        <>
          {/* 模型选择（从 /object_info 拉取已安装模型） */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-serif text-base font-semibold text-slate-800">模型选择</p>
              <Button
                variant="ghost"
                size="sm"
                disabled={modelsLoading}
                onClick={() => void loadModels(baseUrl)}
              >
                {modelsLoading ? "加载中…" : "刷新模型列表"}
              </Button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-500">Diffusion 模型（UNETLoader）</label>
                <select
                  value={unetName}
                  onChange={(e) => setUnetName(e.target.value)}
                  disabled={formDisabled || !models?.unet.length}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  {(models?.unet ?? []).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                  {!models?.unet.length && <option value="">{modelsLoading ? "加载中…" : "点「刷新模型列表」"}</option>}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">文本编码器（CLIPLoader · minimax）</label>
                <select
                  value={clipName}
                  onChange={(e) => setClipName(e.target.value)}
                  disabled={formDisabled || !models?.clip.length}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  {(models?.clip ?? []).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                  {!models?.clip.length && <option value="">{modelsLoading ? "加载中…" : "点「刷新模型列表」"}</option>}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">视频 VAE</label>
                <select
                  value={vaeVideoName}
                  onChange={(e) => setVaeVideoName(e.target.value)}
                  disabled={formDisabled || !models?.vae.length}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  {(models?.vae ?? []).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                  {!models?.vae.length && <option value="">{modelsLoading ? "加载中…" : "点「刷新模型列表」"}</option>}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">音频 VAE</label>
                <select
                  value={vaeAudioName}
                  onChange={(e) => setVaeAudioName(e.target.value)}
                  disabled={formDisabled || !models?.vae.length}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  {(models?.vae ?? []).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                  {!models?.vae.length && <option value="">{modelsLoading ? "加载中…" : "点「刷新模型列表」"}</option>}
                </select>
              </div>
              {accelerated && (
                <div>
                  <label className="block text-xs font-medium text-slate-500">Turbo LoRA（加速蒸馏，配合 4-8 步）</label>
                  <select
                    value={loraName}
                    onChange={(e) => setLoraName(e.target.value)}
                    disabled={formDisabled || !models?.lora.length}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  >
                    {(models?.lora ?? []).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                    {!models?.lora.length && <option value="">{modelsLoading ? "加载中…" : "无可用 LoRA（或点「刷新模型列表」）"}</option>}
                  </select>
                </div>
              )}
            </div>
            {modelsError && <p className="mt-2 text-sm text-red-600">{modelsError}</p>}
            <p className="mt-2 text-xs text-slate-400">
              T2V / I2V 用 fl2va 权重，R2V 用 ref2va 权重（如 minimax_h3_fl2va_int8_convrot / minimax_h3_ref2va_pruned_int8_convrot）。
              加速模式需本机装有 SageAttention 与 turbo LoRA（如 minimax_h3_turbo_4STEPS_comfyui.safetensors）。
            </p>
          </div>

          {/* 模式切换 */}
          <div>
            <div className="flex flex-wrap gap-2">
              {MODE_OPTIONS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  disabled={formDisabled}
                  onClick={() => setMode(m.value)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    mode === m.value
                      ? "bg-brand-600 text-warm-50"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">{modeHint}</p>
          </div>

          {/* 提示词 */}
          <div>
            <label className="block text-sm font-medium text-slate-600">提示词（画面 + 原生立体声：对白 / 音效 / 音乐）</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={formDisabled}
              rows={6}
              placeholder={PROMPT_PLACEHOLDER}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>

          {/* 模式相关素材 */}
          {mode === "i2v" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-600">首帧图（必填）</label>
                <input
                  type="file"
                  accept="image/*"
                  disabled={formDisabled}
                  onChange={(e) => setFirstFrame(e.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-warm-50"
                />
                {firstFrame && <div className="mt-2"><FilePreview file={firstFrame} /></div>}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600">尾帧图（可选）</label>
                <input
                  type="file"
                  accept="image/*"
                  disabled={formDisabled}
                  onChange={(e) => setLastFrame(e.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-warm-50"
                />
                {lastFrame && <div className="mt-2"><FilePreview file={lastFrame} /></div>}
              </div>
            </div>
          )}

          {mode === "ref2va" && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600">
                  参考图（≤9 张，提示词用 &lt;Picture 1&gt;、&lt;Picture 2&gt;… 按上传顺序引用）
                </label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={formDisabled}
                  onChange={(e) => setRefImages(Array.from(e.target.files ?? []).slice(0, 9))}
                  className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-warm-50"
                />
                {refImages.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {refImages.map((f, i) => (
                      <FilePreview key={`${f.name}-${i}`} file={f} />
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600">
                  参考视频（≤3 个，提示词用 &lt;Video 1&gt;… 引用；可勾选把原声作为 &lt;Audio&gt; 参考）
                </label>
                <input
                  type="file"
                  accept="video/*"
                  multiple
                  disabled={formDisabled}
                  onChange={(e) =>
                    setRefVideos(
                      Array.from(e.target.files ?? []).slice(0, 3).map((file) => ({ file, withAudio: false }))
                    )
                  }
                  className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-warm-50"
                />
                {refVideos.map((v, i) => (
                  <div key={`${v.file.name}-${i}`} className="mt-2 flex flex-wrap items-center gap-3">
                    <FilePreview file={v.file} video />
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={v.withAudio}
                        disabled={formDisabled}
                        onChange={(e) =>
                          setRefVideos((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, withAudio: e.target.checked } : x))
                          )
                        }
                      />
                      原声作为音频参考（&lt;Audio {i + 1}&gt;）
                    </label>
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600">
                  参考音频（≤3 个，提示词用 &lt;Audio 1&gt;… 引用，可配参考图/视频一起用）
                </label>
                <input
                  type="file"
                  accept="audio/*"
                  multiple
                  disabled={formDisabled}
                  onChange={(e) => setRefAudios(Array.from(e.target.files ?? []).slice(0, 3))}
                  className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-warm-50"
                />
                {refAudios.length > 0 && (
                  <p className="mt-1 text-xs text-slate-400">
                    {refAudios.map((f) => f.name).join("、")}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 生成参数 */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-600">画面比例</label>
              <select
                value={ratio}
                disabled={formDisabled}
                onChange={(e) => setRatio(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
              >
                {RATIO_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600">分辨率档位（短边）</label>
              <select
                value={shortSide}
                disabled={formDisabled}
                onChange={(e) => setShortSide(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
              >
                {RESOLUTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600">
                时长：<span className="text-slate-800">{duration} 秒</span>
              </label>
              <input
                type="range"
                min={1}
                max={15}
                step={1}
                value={duration}
                disabled={formDisabled}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="mt-3 w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-600">Seed</label>
                <input
                  type="number"
                  value={seed}
                  min={0}
                  disabled={formDisabled}
                  onChange={(e) => setSeed(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600">
                  采样步数{accelerated ? "（加速推荐 8：4 视频 + 4 音频）" : "（标准推荐 20）"}
                </label>
                <input
                  type="number"
                  value={steps}
                  min={1}
                  max={100}
                  disabled={formDisabled}
                  onChange={(e) => setSteps(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={accelerated}
                  disabled={formDisabled}
                  onChange={(e) => handleToggleAccelerated(e.target.checked)}
                  className="h-4 w-4"
                />
                加速模式
              </label>
              <span className="text-xs text-slate-400">
                {accelerated
                  ? "SageAttention 省显存 + turbo LoRA 蒸馏 + 双时钟采样（dual_clock_euler），对应原 Dual-clock 8-step 工作流"
                  : "官方标准节点链路（SigmaShift + res_multistep + simple 调度器）"}
              </span>
            </div>
          </div>
          <p className="text-xs text-slate-400">
            实际画布：{canvas.width} × {canvas.height}
            {actualShort < shortSide ? `（面积达上限，短边缩至 ${actualShort}）` : ""}｜帧数：{length}（≈{" "}
            {(length / 24).toFixed(1)}s，按 17n+5 对齐）｜H3 无 1080p/2K（面积上限 768×1344）
          </p>

          {/* 操作按钮 */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => void guard.run(doSubmit)}
              disabled={!canStart}
              loading={guard.submitting}
            >
              {guard.submitting ? "提交中…" : "开始生成"}
            </Button>
            {guard.submitting && (
              <Button variant="ghost" onClick={handleCancel}>
                取消提交
              </Button>
            )}
            <Button variant="ghost" disabled={guard.submitting} onClick={() => void handleFreeMemory()}>
              释放内存
            </Button>
          </div>

          {/* 状态文案 */}
          {statusText && (
            <div className="rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-600">{statusText}</div>
          )}
          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
          )}

          {/* 提交成功：结果在任务中心查看（服务端轮询，页面可关闭） */}
          {submitted && (
            <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              任务已提交，服务端正在后台轮询，本页面可以关闭或继续发起新任务。
              <button
                type="button"
                className="ml-1 font-medium underline underline-offset-2 hover:text-emerald-800"
                onClick={() => router.push("/tools/tasks")}
              >
                前往任务中心查看进度 →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
