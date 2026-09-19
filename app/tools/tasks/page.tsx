"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import { apiClient } from "@/lib/api-client";
import type { ToolTaskRecord } from "@/lib/types";

const STATUS_LABELS: Record<ToolTaskRecord["status"], string> = {
  running: "处理中",
  done: "成功",
  failed: "失败",
  cancelled: "已取消",
  expired: "已超时",
};

const STATUS_STYLES: Record<ToolTaskRecord["status"], string> = {
  running: "bg-sky-50 text-sky-700",
  done: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-slate-500",
  expired: "bg-amber-light text-amber-dark",
};

const SOURCE_LABELS: Record<ToolTaskRecord["source"], string> = {
  runninghub: "RunningHub 云端",
  comfyui: "本地 ComfyUI",
};

type Filter = "all" | "active" | "done";

const FILTER_OPTIONS: { value: Filter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "active", label: "进行中" },
  { value: "done", label: "已完成" },
];

function BackArrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M15 18l-6-6 6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  return `${Math.floor(m / 60)} 时 ${m % 60} 分`;
}

/** 从结果 URL 提取扩展名，兜底按媒体类型给默认值 */
function downloadName(task: ToolTaskRecord): string {
  const m = task.resultUrl?.match(/\.(mp4|webm|mov|mkv|png|jpe?g|webp)(\?|$)/i);
  const ext = m ? m[1].toLowerCase() : task.mediaType === "video" ? "mp4" : "png";
  return `${task.toolId}-${task.id.slice(0, 8)}.${ext}`;
}

function downloadResult(task: ToolTaskRecord) {
  if (!task.resultUrl) return;
  const a = document.createElement("a");
  a.href = `/api/runninghub/download?url=${encodeURIComponent(task.resultUrl)}&name=${encodeURIComponent(downloadName(task))}`;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function TaskCard({
  task,
  onCancel,
  onDelete,
}: {
  task: ToolTaskRecord;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const running = task.status === "running";
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const withBusy = (fn: () => void | Promise<void>) => async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="rounded-card border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-serif text-base font-semibold text-slate-800">{task.toolName}</p>
        <span
          className={`rounded px-1.5 py-0.5 text-xs ${
            task.source === "comfyui" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"
          }`}
        >
          {SOURCE_LABELS[task.source]}
        </span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
          {task.mediaType === "video" ? "视频" : "图片"}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[task.status]}`}>
          {STATUS_LABELS[task.status]}
          {running && <Spinner size={10} />}
        </span>
        <span className="ml-auto text-xs text-slate-400">{fmtTime(task.createdAt)}</span>
      </div>

      {task.title && <p className="mt-2 text-sm text-slate-600">{task.title}</p>}
      {task.prompt && (
        <p className="mt-1 text-xs text-slate-400 line-clamp-2" title={task.prompt}>
          {task.prompt}
        </p>
      )}
      <p className="mt-1 text-xs text-slate-400">
        {running
          ? `已进行 ${fmtDuration(Date.now() - task.createdAt)}（服务端轮询中，可关闭页面）`
          : task.completedAt
          ? `耗时 ${fmtDuration(task.completedAt - task.createdAt)}`
          : null}
      </p>

      {task.error && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{task.error}</div>
      )}

      {task.status === "done" && task.resultUrl && (
        <div className="mt-3 space-y-2">
          {task.mediaType === "video" ? (
            <video src={task.resultUrl} controls className="max-h-[420px] w-full rounded-lg bg-black" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={task.resultUrl}
              alt={task.title || task.toolName}
              className="max-h-[420px] w-auto rounded-lg border border-slate-200"
            />
          )}
        </div>
      )}
      {task.status === "done" && !task.resultUrl && (
        <div className="mt-2 rounded-lg bg-amber-light px-3 py-2 text-sm text-amber-dark">
          任务已完成，但未解析到结果地址，可前往「任务日志」查看返回详情。
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {task.status === "done" && task.resultUrl && (
          <Button size="sm" onClick={() => downloadResult(task)}>
            下载到本地
          </Button>
        )}
        {running && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={withBusy(() => onCancel(task.id))}>
            {busy ? "取消中…" : "取消"}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={withBusy(() => onDelete(task.id))}>
          删除
        </Button>
      </div>
    </div>
  );
}

export default function ToolTasksPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [tasks, setTasks] = useState<ToolTaskRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const load = useCallback(async () => {
    try {
      const res = await apiClient.listToolTasks({ status: filterRef.current });
      setTasks(res.items);
      setTotal(res.total);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [filter, load]);

  const hasRunning = tasks.some((t) => t.status === "running");
  // 存在进行中任务时 3s 自动刷新（GET 内部会惰性恢复服务端轮询），否则 15s 慢刷
  useEffect(() => {
    const id = setInterval(() => void load(), hasRunning ? 3000 : 15000);
    return () => clearInterval(id);
  }, [hasRunning, load]);

  async function handleCancel(id: string) {
    await apiClient.cancelToolTask(id);
    await load();
  }

  async function handleDelete(id: string) {
    await apiClient.deleteToolTasks([id]);
    await load();
  }

  async function handleClearDone() {
    const doneIds = tasks.filter((t) => t.status !== "running").map((t) => t.id);
    if (doneIds.length === 0) return;
    await apiClient.deleteToolTasks(doneIds);
    await load();
  }

  const doneCount = tasks.filter((t) => t.status !== "running").length;

  return (
    <main className="mx-auto min-h-screen max-w-[1400px] px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="md" onClick={() => router.push("/tools")}>
            <BackArrow />
            返回
          </Button>
          <h1 className="font-serif text-xl font-semibold text-slate-800">任务中心</h1>
          <span className="text-sm text-slate-400">
            共 {total} 个任务{hasRunning ? ` · ${tasks.filter((t) => t.status === "running").length} 个进行中` : ""}
          </span>
        </div>
        <Button variant="ghost" size="sm" disabled={doneCount === 0} onClick={() => void handleClearDone()}>
          清空已结束
        </Button>
      </header>

      {/* 状态筛选 */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {FILTER_OPTIONS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f.value
                ? "bg-brand-600 text-warm-50"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="py-20 text-center text-slate-400">加载中…</div>
      ) : tasks.length === 0 ? (
        <div className="py-20 text-center text-slate-400">
          暂无任务，去
          <button
            type="button"
            className="mx-1 text-brand-600 underline underline-offset-2 hover:text-brand-700"
            onClick={() => router.push("/tools")}
          >
            AI 小工具
          </button>
          发起一个吧
        </div>
      ) : (
        <div className="space-y-4">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} onCancel={handleCancel} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </main>
  );
}
