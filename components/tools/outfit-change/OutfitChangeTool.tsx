"use client";

import { useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import RunningHubApiConfig from "@/components/tools/runninghub/RunningHubApiConfig";
import { usePreviewUrl } from "@/components/tools/runninghub/usePreviewUrl";
import {
  OUTFIT_CHANGE_APP_ID,
  uploadMediaFile,
  submitOutfitChange,
  pollRunningHubTask,
} from "@/lib/runninghub-client";
import type { RunningHubQueryProxyResponse } from "@/lib/types";

type Stage = "idle" | "uploading" | "running" | "success" | "failed";

const DEFAULT_PROMPT = "让图一的人物穿上图二的衣服";

const STATUS_LABELS: Record<string, string> = {
  QUEUED: "排队中",
  RUNNING: "处理中",
  SUCCESS: "成功",
  FAILED: "失败",
};

export default function OutfitChangeTool() {
  const [configured, setConfigured] = useState<boolean | null>(null);

  const [modelImage, setModelImage] = useState<File | null>(null);
  const [clothingImage, setClothingImage] = useState<File | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [stage, setStage] = useState<Stage>("idle");
  const [statusText, setStatusText] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // 本地预览 URL（objectURL，file 变化时重建并回收旧的）
  const modelPreview = usePreviewUrl(modelImage);
  const clothingPreview = usePreviewUrl(clothingImage);

  async function handleStart() {
    if (!modelImage || !clothingImage || !configured) return;
    setError("");
    setResultUrl("");
    setStage("uploading");
    setStatusText("正在上传图片…");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const [modelUp, clothingUp] = await Promise.all([
        uploadMediaFile(modelImage),
        uploadMediaFile(clothingImage),
      ]);
      setStage("running");
      setStatusText("已提交，等待 RunningHub 处理…");
      const run = await submitOutfitChange({
        modelImageFieldValue: modelUp.downloadUrl,
        clothingImageFieldValue: clothingUp.downloadUrl,
        prompt: prompt.trim() || DEFAULT_PROMPT,
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
    setModelImage(null);
    setClothingImage(null);
    setPrompt(DEFAULT_PROMPT);
    setResultUrl("");
    setError("");
    setStage("idle");
    setStatusText("");
  }

  const busy = stage === "uploading" || stage === "running";
  const fileInputDisabled = busy || stage === "success";
  const canStart = !!modelImage && !!clothingImage && !!configured && !busy;

  return (
    <div className="space-y-5">
      {/* API 配置：页面内直接查看与修改 */}
      <RunningHubApiConfig
        appId={OUTFIT_CHANGE_APP_ID}
        onConfiguredChange={setConfigured}
      />

      {configured && (
        <>
          {/* 图片选择 */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-600">人物图（保留脸部与姿态）</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  disabled={fileInputDisabled}
                  onChange={(e) => setModelImage(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-warm-50 file:disabled:opacity-50"
                />
              </div>
              {modelImage && (
                <p className="mt-1 text-xs text-slate-400">
                  {modelImage.name} · {((modelImage.size / 1024) || 0).toFixed(0)} KB
                </p>
              )}
              {modelPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={modelPreview}
                  alt="人物图预览"
                  className="mt-2 max-h-48 w-auto rounded-lg border border-slate-200"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600">服装图（想要换上的衣服）</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  disabled={fileInputDisabled}
                  onChange={(e) => setClothingImage(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-warm-50 file:disabled:opacity-50"
                />
              </div>
              {clothingImage && (
                <p className="mt-1 text-xs text-slate-400">
                  {clothingImage.name} · {((clothingImage.size / 1024) || 0).toFixed(0)} KB
                </p>
              )}
              {clothingPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={clothingPreview}
                  alt="服装图预览"
                  className="mt-2 max-h-48 w-auto rounded-lg border border-slate-200"
                />
              )}
            </div>
          </div>

          {/* 提示词 */}
          <div>
            <label className="block text-sm font-medium text-slate-600">提示词</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={busy}
              rows={2}
              placeholder={DEFAULT_PROMPT}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-wrap items-center gap-2">
            {!busy && stage !== "success" ? (
              <Button onClick={handleStart} disabled={!canStart}>
                {stage === "failed" ? "重试" : "开始换装"}
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
              <p className="text-sm font-medium text-emerald-700">换装完成（结果链接 24h 内有效，请尽快下载保存）</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resultUrl}
                alt="换装结果"
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
