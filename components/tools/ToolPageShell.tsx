"use client";

import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { CATEGORY_LABELS, type ToolDefinition } from "@/lib/tools/registry";

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

export default function ToolPageShell({ tool }: { tool: ToolDefinition }) {
  const router = useRouter();
  const Comp = tool.Component;
  return (
    <main className="mx-auto min-h-screen max-w-[1400px] px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="md" onClick={() => router.push("/tools")}>
            <BackArrow />
            返回
          </Button>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warm-100 text-brand-600">
            {tool.icon}
          </div>
          <h1 className="font-serif text-xl font-semibold text-slate-800">{tool.name}</h1>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
            {CATEGORY_LABELS[tool.category]}
          </span>
          <span className="text-sm text-slate-400">v{tool.version}</span>
        </div>
        {tool.badge && (
          <span className="rounded-md bg-amber-light px-2 py-0.5 text-xs font-medium text-amber-dark">
            {tool.badge}
          </span>
        )}
      </header>
      <div className="rounded-card border border-slate-200 bg-white p-6 shadow-card">
        <Comp />
      </div>
    </main>
  );
}
