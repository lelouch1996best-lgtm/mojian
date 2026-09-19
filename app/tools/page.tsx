"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import {
  TOOL_REGISTRY,
  getEnabledTools,
  CATEGORY_LABELS,
  type ToolCategory,
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
  const [filter, setFilter] = useState<ToolCategory | "all">("all");
  const tools = getEnabledTools().filter((t) => filter === "all" || t.category === filter);
  const categories = Array.from(new Set(getEnabledTools().map((t) => t.category)));

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
      </header>

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
