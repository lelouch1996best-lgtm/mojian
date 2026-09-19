"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import {
  TOOL_REGISTRY,
  getEnabledTools,
  CATEGORY_LABELS,
  SOURCE_LABELS,
  type ToolCategory,
  type ToolSource,
} from "@/lib/tools/registry";

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

function TaskIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M8 10h8M8 14h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
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

export default function ToolsHubPage() {
  const router = useRouter();
  const [source, setSource] = useState<ToolSource>("runninghub");
  const [filter, setFilter] = useState<ToolCategory | "all">("all");
  const enabled = getEnabledTools();
  const tools = enabled.filter(
    (t) => t.source === source && (filter === "all" || t.category === filter)
  );
  const categories = Array.from(
    new Set(enabled.filter((t) => t.source === source).map((t) => t.category))
  );

  return (
    <main className="mx-auto min-h-screen max-w-[1400px] px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="md" onClick={() => router.push("/")}>
            <BackArrow />
            返回
          </Button>
          <h1 className="font-serif text-xl font-semibold text-slate-800">AI 小工具</h1>
          <span className="text-sm text-slate-400">集合各类 AI 辅助能力</span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => router.push("/tools/tasks")}>
          <TaskIcon />
          任务中心
        </Button>
      </header>

      {/* 来源页签：RunningHub 云端 / 本地 ComfyUI */}
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(["runninghub", "local"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              source === s
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {`${SOURCE_LABELS[s]}（${enabled.filter((t) => t.source === s).length}）`}
          </button>
        ))}
      </div>

      {/* 分类筛选 */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
          全部
        </FilterPill>
        {categories.map((c) => (
          <FilterPill key={c} active={filter === c} onClick={() => setFilter(c)}>
            {CATEGORY_LABELS[c]}
          </FilterPill>
        ))}
      </div>

      {/* 卡片网格 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={() => router.push(`/tools/${t.id}`)}
            className="group rounded-card border border-slate-200 bg-white p-5 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warm-100 text-brand-600">
                {t.icon}
              </div>
              {t.badge && (
                <span className="rounded-md bg-amber-light px-2 py-0.5 text-xs font-medium text-amber-dark">
                  {t.badge}
                </span>
              )}
            </div>
            <h3 className="font-serif text-base font-semibold text-slate-800">{t.name}</h3>
            <p className="mt-1.5 text-sm text-slate-600 line-clamp-2">{t.description}</p>
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
              <span className="rounded bg-slate-100 px-1.5 py-0.5">{CATEGORY_LABELS[t.category]}</span>
              <span
                className={`rounded px-1.5 py-0.5 ${
                  t.source === "local" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"
                }`}
              >
                {SOURCE_LABELS[t.source]}
              </span>
              <span>v{t.version}</span>
            </div>
          </button>
        ))}
        {tools.length === 0 && (
          <div className="col-span-full py-20 text-center text-slate-400">暂无工具</div>
        )}
      </div>
    </main>
  );
}
