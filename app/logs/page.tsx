"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { apiClient } from "@/lib/api-client";
import type { ApiCallLog } from "@/lib/types";

const PAGE_SIZE = 50;

const PROVIDER_OPTIONS = [
  { value: "", label: "全部供应商" },
  { value: "ark", label: "火山方舟" },
  { value: "ark-plan", label: "火山引擎 Plan" },
  { value: "apimart", label: "APIMart" },
  { value: "custom", label: "自定义" },
];

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
];

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-brand-600 text-warm-50"
          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function prettyJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str || "(空)";
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

export default function LogsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const [items, setItems] = useState<ApiCallLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [filterType, setFilterType] = useState("");
  const [filterProvider, setFilterProvider] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.listApiLogs({
        type: filterType || undefined,
        provider: filterProvider || undefined,
        status: filterStatus || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      console.error("加载日志失败", e);
    } finally {
      setLoading(false);
    }
  }, [filterType, filterProvider, filterStatus, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [filterType, filterProvider, filterStatus]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleClear() {
    const ok = await confirm({
      title: "清空任务日志",
      message: `确定清空全部 ${total} 条日志记录吗？此操作不可恢复。`,
      confirmText: "清空",
    });
    if (!ok) return;
    setClearing(true);
    try {
      await apiClient.clearApiLogs();
      setExpanded(new Set());
      await load();
    } catch (e) {
      console.error("清空日志失败", e);
    } finally {
      setClearing(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="md" onClick={() => router.back()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-1">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            返回
          </Button>
          <h1 className="font-serif text-xl font-semibold text-slate-800">任务日志</h1>
          <span className="text-sm text-slate-400">共 {total} 条</span>
        </div>
        <Button variant="danger" size="md" loading={clearing} onClick={handleClear} disabled={total === 0}>
          清空日志
        </Button>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <FilterPill active={filterType === ""} onClick={() => setFilterType("")}>全部</FilterPill>
          <FilterPill active={filterType === "image"} onClick={() => setFilterType("image")}>图片</FilterPill>
          <FilterPill active={filterType === "video"} onClick={() => setFilterType("video")}>视频</FilterPill>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-500">供应商</span>
          <Select value={filterProvider} onChange={setFilterProvider} options={PROVIDER_OPTIONS} className="w-36" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-500">状态</span>
          <Select value={filterStatus} onChange={setFilterStatus} options={STATUS_OPTIONS} className="w-28" />
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-slate-400">加载中…</div>
      ) : items.length === 0 ? (
        <div className="py-20 text-center text-slate-400">暂无日志记录</div>
      ) : (
        <div className="space-y-2">
          {items.map((log) => {
            const isOpen = expanded.has(log.id);
            return (
              <div key={log.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => toggleExpand(log.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${log.type === "image" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}`}>
                      {log.type === "image" ? "图片" : "视频"}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">{formatTime(log.createdAt)}</span>
                    <span className="truncate text-sm text-slate-600">{log.provider} · {log.model}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${log.status === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                      {log.status === "success" ? "成功" : "失败"}
                    </span>
                    <span className="text-xs text-slate-400">{log.durationMs}ms</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className={`text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}>
                      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-slate-100 px-4 py-3">
                    <div>
                      <p className="mb-1 text-xs font-medium text-slate-500">目标地址</p>
                      <p className="break-all font-mono text-xs text-slate-600">{log.upstreamUrl || "(空)"}</p>
                    </div>
                    {log.error && (
                      <div>
                        <p className="mb-1 text-xs font-medium text-red-500">错误</p>
                        <pre className="overflow-x-auto rounded-lg bg-red-50 p-2 text-xs text-red-700">{log.error}</pre>
                      </div>
                    )}
                    <div>
                      <p className="mb-1 text-xs font-medium text-slate-500">请求参数（实际发给上游）</p>
                      <pre className="max-h-80 overflow-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{prettyJson(log.requestBody)}</pre>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-slate-500">上游响应</p>
                      <pre className="max-h-80 overflow-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{prettyJson(log.responseBody)}</pre>
                    </div>
                    {log.finalStatus && (
                      <div>
                        <p className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-500">
                          轮询最终结果
                          <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${log.finalStatus === "done" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                            {log.finalStatus === "done" ? "成功" : log.finalStatus === "expired" ? "超时" : "失败"}
                          </span>
                        </p>
                        <pre className="max-h-60 overflow-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{log.finalResult || "(空)"}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>
            上一页
          </Button>
          <span className="text-sm text-slate-500">第 {currentPage} / {pageCount} 页</span>
          <Button variant="secondary" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset((o) => o + PAGE_SIZE)}>
            下一页
          </Button>
        </div>
      )}
    </main>
  );
}
