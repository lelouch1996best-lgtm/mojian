"use client";

import { useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import RunningHubApiConfig from "@/components/tools/runninghub/RunningHubApiConfig";
import {
  SUPER_RESOLUTION_APP_ID,
  uploadMediaFile,
  submitSuperResolution,
  pollRunningHubTask,
} from "@/lib/runninghub-client";
import type { SuperResolutionScale, RunningHubQueryProxyResponse } from "@/lib/types";

type Stage = "idle" | "uploading" | "running" | "success" | "failed";

const SCALE_OPTIONS: { value: SuperResolutionScale; label: string }[] = [
  { value: "2", label: "2x（推荐）" },
  { value: "3", label: "3x" },
  { value: "4", label: "4x" },
];

const STATUS_LABELS: Record<string, string> = {
  QUEUED: "排队中",
  RUNNING: "处理中",
  SUCCESS: "成功",
  FAILED: "失败",
};

export default function SuperResolutionTool() {
  const [configured, setConfigured] = useState<boolean | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState<SuperResolutionScale>("2");
  const [stage, setStage] = useState<Stage>("idle");
  const [statusText, setStatusText] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  async function handleStart() {
    if (!file || !configured) return;
    setError("");
    setResultUrl("");
    setStage("uploading");
    setStatusText("正在上传视频文件…");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const up = await uploadMediaFile(file);
      setStage("running");
      setStatusText("已提交，等待 RunningHub 处理…");
      const run = await submitSuperResolution({
        // nodeId=6 file 节点的 fieldValue：优先用 download_url（可直接访问的完整地址）。
        // 若实际工作流要求 fileName 逻辑路径，可改为 up.fileName。
        fileFieldValue: up.downloadUrl,
        scale,
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
    setResultUrl("");
    setError("");
    setStage("idle");
    setStatusText("");
  }

  const busy = stage === "uploading" || stage === "running";
  const fileInputDisabled = busy || stage === "success";
  const canStart = !!file && configured && !busy;

  return (
    <div className="space-y-5">
      {/* API 配置：页面内直接查看与修改 */}
      <RunningHubApiConfig
        appId={SUPER_RESOLUTION_APP_ID}
        onConfiguredChange={setConfigured}
      />

      {configured && (
        <>
          {/* 文件选择 + 倍率 */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-600">输入视频</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="file"
                  accept="video/*"
                  disabled={fileInputDisabled}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-warm-50 file:disabled:opacity-50"
                />
              </div>
              {file && (
                <p className="mt-1 text-xs text-slate-400">
                  {file.name} · {((file.size / 1024 / 1024) || 0).toFixed(2)} MB
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600">超分倍率</label>
              <div className="mt-1 flex gap-2">
                {SCALE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    disabled={busy}
                    onClick={() => setScale(o.value)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      scale === o.value
                        ? "bg-brand-600 text-warm-50"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-wrap items-center gap-2">
            {!busy && stage !== "success" ? (
              <Button onClick={handleStart} disabled={!canStart}>
                {stage === "failed" ? "重试" : "开始超分"}
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

          {/* 结果视频 + 下载 */}
          {stage === "success" && resultUrl && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-emerald-700">超分完成（结果链接 24h 内有效，请尽快下载保存）</p>
              <video src={resultUrl} controls className="w-full max-h-[420px] rounded-lg bg-black" />
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
