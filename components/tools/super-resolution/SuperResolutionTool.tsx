"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import RunningHubApiConfig from "@/components/tools/runninghub/RunningHubApiConfig";
import { useTaskSubmit } from "@/components/tools/useTaskSubmit";
import { apiClient } from "@/lib/api-client";
import {
  SUPER_RESOLUTION_APP_ID,
  uploadMediaFile,
  submitSuperResolution,
} from "@/lib/runninghub-client";
import type { SuperResolutionScale } from "@/lib/types";

const SCALE_OPTIONS: { value: SuperResolutionScale; label: string }[] = [
  { value: "2", label: "2x（推荐）" },
  { value: "3", label: "3x" },
  { value: "4", label: "4x" },
];

export default function SuperResolutionTool() {
  const router = useRouter();
  const [configured, setConfigured] = useState<boolean | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState<SuperResolutionScale>("2");
  const [statusText, setStatusText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const guard = useTaskSubmit();

  async function doSubmit() {
    if (!file || !configured) return;
    setError("");
    setSubmitted(false);
    setStatusText("正在上传视频文件…");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const up = await uploadMediaFile(file);
      setStatusText("正在提交超分任务…");
      const run = await submitSuperResolution({
        // nodeId=6 file 节点的 fieldValue：优先用 download_url（可直接访问的完整地址）。
        // 若实际工作流要求 fileName 逻辑路径，可改为 up.fileName。
        fileFieldValue: up.downloadUrl,
        scale,
        signal: ctrl.signal,
      });
      // 注册进任务中心：服务端接管轮询，本页可关闭/继续发起新任务
      await apiClient.registerToolTask({
        toolId: "super-resolution",
        toolName: "视频超分",
        source: "runninghub",
        mediaType: "video",
        title: `${scale}x 超分 · ${file.name}`,
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

  const canStart = !!file && configured && !guard.disabled;

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
                  disabled={guard.submitting}
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
                    disabled={guard.submitting}
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
                开始超分
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
