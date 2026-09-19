"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import RunningHubApiConfig from "@/components/tools/runninghub/RunningHubApiConfig";
import { usePreviewUrl } from "@/components/tools/runninghub/usePreviewUrl";
import { useTaskSubmit } from "@/components/tools/useTaskSubmit";
import { apiClient } from "@/lib/api-client";
import {
  OUTFIT_CHANGE_APP_ID,
  uploadMediaFile,
  submitOutfitChange,
} from "@/lib/runninghub-client";

const DEFAULT_PROMPT = "让图一的人物穿上图二的衣服";

export default function OutfitChangeTool() {
  const router = useRouter();
  const [configured, setConfigured] = useState<boolean | null>(null);

  const [modelImage, setModelImage] = useState<File | null>(null);
  const [clothingImage, setClothingImage] = useState<File | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [statusText, setStatusText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const guard = useTaskSubmit();

  // 本地预览 URL（objectURL，file 变化时重建并回收旧的）
  const modelPreview = usePreviewUrl(modelImage);
  const clothingPreview = usePreviewUrl(clothingImage);

  async function doSubmit() {
    if (!modelImage || !clothingImage || !configured) return;
    setError("");
    setSubmitted(false);
    setStatusText("正在上传图片…");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const [modelUp, clothingUp] = await Promise.all([
        uploadMediaFile(modelImage),
        uploadMediaFile(clothingImage),
      ]);
      setStatusText("正在提交换装任务…");
      const run = await submitOutfitChange({
        modelImageFieldValue: modelUp.downloadUrl,
        clothingImageFieldValue: clothingUp.downloadUrl,
        prompt: prompt.trim() || DEFAULT_PROMPT,
        signal: ctrl.signal,
      });
      // 注册进任务中心：服务端接管轮询，本页可关闭/继续发起新任务
      await apiClient.registerToolTask({
        toolId: "outfit-change",
        toolName: "AI 换装",
        source: "runninghub",
        mediaType: "image",
        title: `换装 · ${(prompt.trim() || DEFAULT_PROMPT).slice(0, 30)}`,
        prompt: prompt.trim() || DEFAULT_PROMPT,
        upstreamTaskId: run.taskId,
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

  const canStart = !!modelImage && !!clothingImage && !!configured && !guard.disabled;

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
                  disabled={guard.submitting}
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
                  disabled={guard.submitting}
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
              disabled={guard.submitting}
              rows={2}
              placeholder={DEFAULT_PROMPT}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>

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
                开始换装
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

          {/* 提交成功：引导去任务中心查看进度与结果 */}
          {submitted && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <span>任务已提交，进度与结果请在任务中心查看（页面可关闭）</span>
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
