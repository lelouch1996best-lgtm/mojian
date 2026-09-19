"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import RunningHubApiConfig from "@/components/tools/runninghub/RunningHubApiConfig";
import { usePreviewUrl } from "@/components/tools/runninghub/usePreviewUrl";
import {
  INPAINT_APP_ID,
  uploadMediaFile,
  submitInpaint,
  pollRunningHubTask,
} from "@/lib/runninghub-client";
import type { RunningHubQueryProxyResponse } from "@/lib/types";

type Stage = "idle" | "uploading" | "running" | "success" | "failed";

const STATUS_LABELS: Record<string, string> = {
  QUEUED: "排队中",
  RUNNING: "处理中",
  SUCCESS: "成功",
  FAILED: "失败",
};

/** 涂抹颜色（显示用半透明红） */
const MASK_COLOR = "rgba(239, 68, 68, 0.55)";

/**
 * 把原图与涂抹蒙版合成为带 alpha 通道的 PNG：
 * 涂抹区域 alpha=0（透明），其余保持不透明。对应 ComfyUI MaskEditor 的
 * clipspace 蒙版语义（LoadImage 从 alpha 通道提取 MASK，涂抹区 mask=1 即编辑区）。
 */
function composeMaskedPng(img: HTMLImageElement, mask: HTMLCanvasElement): Promise<Blob> {
  const out = document.createElement("canvas");
  out.width = img.naturalWidth;
  out.height = img.naturalHeight;
  const octx = out.getContext("2d");
  const mctx = mask.getContext("2d");
  if (!octx || !mctx) throw new Error("无法创建画布");
  octx.drawImage(img, 0, 0);
  // 画布尺寸一致时才逐像素合并（mask canvas 初始化即按原始尺寸）
  if (mask.width === out.width && mask.height === out.height) {
    const md = mctx.getImageData(0, 0, mask.width, mask.height);
    const od = octx.getImageData(0, 0, out.width, out.height);
    for (let i = 3; i < md.data.length; i += 4) {
      if (md.data[i] > 0) od.data[i] = 0;
    }
    octx.putImageData(od, 0, 0);
  } else {
    // 兜底：mask 尺寸不符时用 destination-out 按比例擦除
    octx.globalCompositeOperation = "destination-out";
    octx.drawImage(mask, 0, 0, out.width, out.height);
  }
  return new Promise((resolve, reject) => {
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG 导出失败"))),
      "image/png"
    );
  });
}

export default function ImageInpaintTool() {
  const [configured, setConfigured] = useState<boolean | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const previewUrl = usePreviewUrl(file);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [hasMask, setHasMask] = useState(false);
  const [brushSize, setBrushSize] = useState(36);
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [statusText, setStatusText] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);

  // 换图时重置蒙版与加载状态
  useEffect(() => {
    setHasMask(false);
    setImgLoaded(false);
  }, [file]);

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    imgRef.current = img;
    const c = maskCanvasRef.current;
    if (c) {
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx?.clearRect(0, 0, c.width, c.height);
    }
    setImgLoaded(true);
  }

  /** 指针事件坐标 → mask canvas 原始像素坐标 */
  function canvasPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = e.currentTarget;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
      scale: c.width / rect.width,
    };
  }

  function strokeTo(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    lineWidth: number
  ) {
    ctx.strokeStyle = MASK_COLOR;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (stage === "uploading" || stage === "running" || stage === "success") return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    paintingRef.current = true;
    const p = canvasPos(e);
    lastPtRef.current = p;
    // 单点也画出一个圆点
    ctx.fillStyle = MASK_COLOR;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (brushSize * p.scale) / 2, 0, Math.PI * 2);
    ctx.fill();
    setHasMask(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!paintingRef.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = canvasPos(e);
    const last = lastPtRef.current ?? p;
    strokeTo(ctx, last, p, brushSize * p.scale);
    lastPtRef.current = p;
  }

  function handlePointerUp() {
    paintingRef.current = false;
    lastPtRef.current = null;
  }

  function handleClearMask() {
    const c = maskCanvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setHasMask(false);
  }

  async function handleStart() {
    const img = imgRef.current;
    const mask = maskCanvasRef.current;
    if (!file || !img || !mask || !configured) return;
    const p = prompt.trim();
    if (!p) return;
    setError("");
    setResultUrl("");
    setStage("uploading");
    setStatusText("正在上传图片…");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      // 合成带蒙版的 PNG（涂抹区透明）后上传
      const blob = await composeMaskedPng(img, mask);
      const maskedFile = new File([blob], "masked.png", { type: "image/png" });
      const up = await uploadMediaFile(maskedFile);
      setStage("running");
      setStatusText("已提交，等待 RunningHub 处理…");
      const run = await submitInpaint({
        imageFieldValue: up.fileName,
        prompt: p,
        signal: ctrl.signal,
      });
      await pollRunningHubTask(
        run.taskId,
        (r: RunningHubQueryProxyResponse) => {
          setStatusText(
            `${STATUS_LABELS[r.status] ?? r.status}${
              r.errorMessage ? "：" + r.errorMessage : ""
            }`
          );
        },
        {
          signal: ctrl.signal,
          onSuccess: (r: RunningHubQueryProxyResponse) => {
            setResultUrl(r.results?.[0]?.url ?? "");
          },
        }
      );
      setStage("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("failed");
    } finally {
      abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    setStage("idle");
    setStatusText("");
  }

  function handleReset() {
    setFile(null);
    setPrompt("");
    setResultUrl("");
    setError("");
    setStage("idle");
    setStatusText("");
  }

  const busy = stage === "uploading" || stage === "running";
  const fileInputDisabled = busy || stage === "success";
  const canStart = !!file && imgLoaded && !!prompt.trim() && !!configured && !busy;

  return (
    <div className="space-y-5">
      {/* API 配置：页面内直接查看与修改 */}
      <RunningHubApiConfig appId={INPAINT_APP_ID} onConfiguredChange={setConfigured} />

      {configured && (
        <>
          {/* 图片选择 */}
          <div>
            <label className="block text-sm font-medium text-slate-600">原图</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="file"
                accept="image/*"
                disabled={fileInputDisabled}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-warm-50 file:disabled:opacity-50"
              />
            </div>
            {file && (
              <p className="mt-1 text-xs text-slate-400">
                {file.name} · {((file.size / 1024) || 0).toFixed(0)} KB
              </p>
            )}
          </div>

          {/* 蒙版画板 */}
          {file && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-slate-600">
                  画笔大小
                  <input
                    type="range"
                    min={4}
                    max={120}
                    value={brushSize}
                    disabled={fileInputDisabled}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="ml-2 w-40 align-middle"
                  />
                  <span className="ml-1 text-xs text-slate-400">{brushSize}px</span>
                </label>
                {hasMask && !fileInputDisabled && (
                  <Button variant="ghost" size="sm" onClick={handleClearMask}>
                    清除涂抹
                  </Button>
                )}
              </div>
              <div className="inline-block relative max-w-full rounded-lg border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="原图预览"
                  onLoad={handleImageLoad}
                  className="block max-h-[520px] w-auto max-w-full select-none"
                  draggable={false}
                />
                <canvas
                  ref={maskCanvasRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                />
              </div>
              <p className="text-xs text-slate-400">
                在图片上涂抹要编辑的区域（红色），AI 只修改涂抹部分。不涂抹则视为整图编辑。
              </p>
            </div>
          )}

          {/* 提示词 */}
          <div>
            <label className="block text-sm font-medium text-slate-600">编辑内容（提示词）</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={busy}
              rows={2}
              placeholder="例如：戴一顶帽子"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-wrap items-center gap-2">
            {!busy && stage !== "success" ? (
              <Button onClick={handleStart} disabled={!canStart}>
                {stage === "failed" ? "重试" : "开始编辑"}
              </Button>
            ) : busy ? (
              <>
                <Button variant="secondary" disabled>
                  <Spinner size={14} /> {stage === "uploading" ? "上传中…" : "处理中…"}
                </Button>
                <Button variant="ghost" onClick={handleCancel}>
                  取消
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={handleReset}>
                开始新任务
              </Button>
            )}
          </div>

          {/* 状态文案 */}
          {statusText && (
            <div className="rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-600">{statusText}</div>
          )}
          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
          )}

          {/* 结果图片 + 下载 */}
          {stage === "success" && resultUrl && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-emerald-700">编辑完成（结果链接 24h 内有效，请尽快下载保存）</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resultUrl}
                alt="编辑结果"
                className="max-h-[520px] w-auto rounded-lg border border-slate-200"
              />
              <Button
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = `/api/runninghub/download?url=${encodeURIComponent(resultUrl)}`;
                  a.download = "";
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                }}
              >
                下载到本地
              </Button>
            </div>
          )}
          {stage === "success" && !resultUrl && (
            <div className="rounded-lg bg-amber-light px-4 py-2 text-sm text-amber-dark">
              任务已完成，但未解析到结果地址，可前往「任务日志」查看返回详情。
            </div>
          )}
        </>
      )}
    </div>
  );
}
