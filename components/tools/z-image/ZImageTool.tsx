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
  buildZImageWorkflow,
  zImageCanvas,
  type ZImageMode,
} from "@/components/tools/z-image/workflow";
import {
  uploadComfyUiFile,
  comfyUiImagePath,
  submitComfyUiPrompt,
  fetchComfyUiModels,
  freeComfyUiMemory,
} from "@/lib/comfyui-client";
import type { ComfyUiModelsResponse } from "@/lib/types";

const MODE_OPTIONS: { value: ZImageMode; label: string; hint: string }[] = [
  { value: "t2i", label: "文生图", hint: "纯提示词生成图片" },
  { value: "img2img", label: "图生图", hint: "参考图 ≤3 张，提示词描述如何基于参考图生成 / 修改" },
];

const RATIO_OPTIONS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;

const SIZE_OPTIONS: { value: number; label: string }[] = [
  { value: 512, label: "512（快速草稿）" },
  { value: 768, label: "768" },
  { value: 1024, label: "1024（推荐）" },
  { value: 1280, label: "1280" },
  { value: 1536, label: "1536（高清水墨风）" },
  { value: 2048, label: "2048（上限 · 耗时）" },
];

const PROMPT_PLACEHOLDER = `A serene ink-wash painting of misty mountains at dawn, a lone crane flying over a still lake, minimalist composition with generous negative space, subtle gradients of grey and indigo`;

const IMG2IMG_PLACEHOLDER = `Based on the reference image: change the season to winter, cover the mountains with snow, keep the composition and the crane unchanged`;

/** 参考图预览小卡片 */
function RefPreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = usePreviewUrl(file);
  if (!url) return null;
  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={file.name}
        className="h-24 w-24 rounded-lg border border-slate-200 object-cover"
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute right-1 top-1 rounded bg-black/50 px-1.5 text-[10px] text-white"
        title="移除"
      >
        ✕
      </button>
    </div>
  );
}

export default function ZImageTool() {
  const router = useRouter();
  const [online, setOnline] = useState<boolean | null>(null);
  const [baseUrl, setBaseUrl] = useState("");

  // 模型列表与选择
  const [models, setModels] = useState<ComfyUiModelsResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [unetName, setUnetName] = useState("");
  const [clipName, setClipName] = useState("");
  const [vaeName, setVaeName] = useState("");

  // 生成参数
  const [mode, setMode] = useState<ZImageMode>("t2i");
  const [refImages, setRefImages] = useState<File[]>([]);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [ratio, setRatio] = useState<string>("1:1");
  const [baseSize, setBaseSize] = useState(1024);
  const [seed, setSeed] = useState(42);
  const [steps, setSteps] = useState(8);
  const [cfg, setCfg] = useState(1);

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
      const prefer = (list: string[], keys: string[]): string => {
        for (const k of keys) {
          const hit = list.find((n) => n.toLowerCase().includes(k));
          if (hit) return hit;
        }
        return list.length ? list[0] : "";
      };
      setUnetName((prev) => prev || prefer(m.unet, ["z_image"]));
      setClipName((prev) => prev || prefer(m.clip, ["qwen"]));
      setVaeName((prev) => prev || prefer(m.vae, ["ae"]));
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelsLoading(false);
    }
  }

  const canvas = zImageCanvas(...(ratio.split(":").map(Number) as [number, number]), baseSize);

  async function doSubmit() {
    if (!baseUrl) return;
    const p = prompt.trim();
    if (!p) {
      setError("请填写提示词");
      return;
    }
    if (!unetName || !clipName || !vaeName) {
      setError("请先加载并选择模型（Diffusion / 文本编码器 / VAE）");
      return;
    }
    if (mode === "img2img" && refImages.length === 0) {
      setError("图生图模式需要上传至少一张参考图");
      return;
    }
    if (online !== true) {
      setError(`未检测到本地 ComfyUI（${baseUrl}），请先启动后点「刷新」重试。`);
      return;
    }
    setError("");
    setSubmitted(false);
    setStatusText(
      mode === "img2img" ? "正在上传参考图到本地 ComfyUI…" : "正在提交生成任务…"
    );
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      // 图生图：先上传参考图（/upload/image 不校验扩展名）
      let refImagePaths: string[] = [];
      if (mode === "img2img") {
        for (const f of refImages.slice(0, 3)) {
          refImagePaths.push(comfyUiImagePath(await uploadComfyUiFile(f, baseUrl)));
        }
        setStatusText("正在提交生成任务…");
      }

      const workflow = buildZImageWorkflow({
        mode,
        prompt: p,
        negativePrompt: negativePrompt.trim(),
        width: canvas.width,
        height: canvas.height,
        steps,
        cfg,
        seed,
        unetName,
        clipName,
        vaeName,
        refImagePaths,
      });
      const run = await submitComfyUiPrompt({
        workflow,
        baseUrl,
        logModel: mode === "img2img" ? "图生图片（Z-Image Turbo）" : "文生图片（Z-Image Turbo）",
        logType: "image",
        signal: ctrl.signal,
      });

      // 注册进任务中心：服务端接管轮询，本页可关闭/继续发起新任务
      await apiClient.registerToolTask({
        toolId: "z-image",
        toolName: mode === "img2img" ? "图生图片（Z-Image Turbo）" : "文生图片（Z-Image Turbo）",
        source: "comfyui",
        mediaType: "image",
        title: `${mode === "img2img" ? "图生图" : "文生图"} · ${ratio} · ${canvas.width}×${canvas.height}`,
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

  const canStart =
    !!prompt.trim() &&
    !guard.disabled &&
    online === true &&
    !!unetName &&
    !!clipName &&
    !!vaeName &&
    (mode === "t2i" || refImages.length > 0);

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
          {/* 模型选择 */}
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
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-500">Diffusion 模型</label>
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
                <label className="block text-xs font-medium text-slate-500">文本编码器</label>
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
                <label className="block text-xs font-medium text-slate-500">VAE</label>
                <select
                  value={vaeName}
                  onChange={(e) => setVaeName(e.target.value)}
                  disabled={formDisabled || !models?.vae.length}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  {(models?.vae ?? []).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                  {!models?.vae.length && <option value="">{modelsLoading ? "加载中…" : "点「刷新模型列表」"}</option>}
                </select>
              </div>
            </div>
            {modelsError && <p className="mt-2 text-sm text-red-600">{modelsError}</p>}
            <p className="mt-2 text-xs text-slate-400">
              Z-Image Turbo 三件套：z_image_turbo_bf16（Diffusion）+ qwen_3_4b（文本编码器）+ ae（VAE）。
            </p>
          </div>

          {/* 模式切换 + 参考图上传 */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
                {MODE_OPTIONS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    disabled={guard.submitting}
                    onClick={() => setMode(m.value)}
                    className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                      mode === m.value
                        ? "bg-brand-600 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">{modeHint}</p>
            </div>

            {mode === "img2img" && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-slate-600">
                  参考图<span className="text-xs text-slate-400">（≤3 张，多张时提示词可描述如何组合）</span>
                </label>
                <label className="mt-1 flex w-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-2 py-3 text-center text-xs text-slate-500 hover:border-brand-400 hover:text-brand-600">
                  <span className="text-xl leading-none">＋</span>
                  <span>{refImages.length ? `已选 ${refImages.length}/3` : "选择图片"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={guard.submitting || refImages.length >= 3}
                    className="hidden"
                    onChange={(e) => {
                      const list = Array.from(e.target.files ?? []);
                      setRefImages((prev) => [...prev, ...list].slice(0, 3));
                      e.target.value = "";
                    }}
                  />
                </label>
                {refImages.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {refImages.map((f, i) => (
                      <RefPreview
                        key={`${f.name}-${i}`}
                        file={f}
                        onRemove={() => setRefImages((prev) => prev.filter((_, j) => j !== i))}
                      />
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-400">
                  参考图会自动缩放到约 1024×1024 面积后参与生成，输出分辨率仍由下方画布设置决定。
                </p>
              </div>
            )}
          </div>

          {/* 提示词 */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600">正向提示词</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={guard.submitting}
                rows={5}
                placeholder={mode === "img2img" ? IMG2IMG_PLACEHOLDER : PROMPT_PLACEHOLDER}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600">
                负向提示词<span className="text-xs text-slate-400">（仅 CFG &gt; 1 时生效）</span>
              </label>
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                disabled={guard.submitting}
                rows={2}
                placeholder="blurry, low quality, watermark"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              />
            </div>
          </div>

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
              <label className="block text-sm font-medium text-slate-600">基准分辨率（长边）</label>
              <select
                value={baseSize}
                disabled={formDisabled}
                onChange={(e) => setBaseSize(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
              >
                {SIZE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
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
                  步数<span className="text-xs text-slate-400">（推荐 8）</span>
                </label>
                <input
                  type="number"
                  value={steps}
                  min={1}
                  max={50}
                  disabled={formDisabled}
                  onChange={(e) => setSteps(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600">
                  CFG<span className="text-xs text-slate-400">（蒸馏版固定 1）</span>
                </label>
                <input
                  type="number"
                  value={cfg}
                  min={1}
                  max={20}
                  step={0.5}
                  disabled={formDisabled}
                  onChange={(e) => setCfg(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-400">
            实际画布：{canvas.width} × {canvas.height}（16 像素对齐）｜Turbo 蒸馏版 8 步极速出图，模型内置 shift 3.0
          </p>

          {/* 操作按钮：提交期间禁用，结束后 1s 冷却再恢复（可连续发起多个任务） */}
          <div className="flex flex-wrap items-center gap-2">
            {guard.submitting ? (
              <>
                <Button variant="secondary" disabled>
                  <Spinner size={14} /> 提交中…
                </Button>
                <Button variant="ghost" onClick={handleCancel}>
                  取消提交
                </Button>
              </>
            ) : (
              <Button onClick={() => void guard.run(doSubmit)} disabled={!canStart}>
                开始生成
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

          {/* 提交成功：引导去任务中心查看进度与结果 */}
          {submitted && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <span>任务已提交，本机 ComfyUI 生成中，进度与结果请在任务中心查看（页面可关闭）</span>
              <Button size="sm" onClick={() => router.push("/tools/tasks")}>
                前往任务中心
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
