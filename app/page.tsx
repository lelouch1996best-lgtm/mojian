"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SeriesList from "@/components/SeriesList";
import Button from "@/components/ui/Button";
import { listSeries, saveSeries, deleteSeries } from "@/lib/storage";
import { emptySeries } from "@/lib/utils";
import { getSettings } from "@/lib/llm-client";
import type { Series } from "@/lib/types";
import { useConfirm } from "@/components/ui/ConfirmDialog";

function BrushIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 21L7.5 16.5M7.5 16.5C6 15 6 13 7.5 11.5L14 5C15.5 3.5 17.5 3.5 19 5C20.5 6.5 20.5 8.5 19 10L12.5 16.5C11 18 9 18 7.5 16.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Home() {
  const router = useRouter();
  const confirm = useConfirm();
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [mounted, setMounted] = useState(false);

  const refresh = useCallback(async () => {
    setSeriesList(await listSeries());
  }, []);

  useEffect(() => {
    setMounted(true);
    refresh();
  }, [refresh]);

  async function handleNew() {
    const s = getSettings();
    if (!s) {
      router.push("/settings");
      return;
    }
    const maxOrder = seriesList.length > 0 ? Math.max(...seriesList.map((s) => s.order)) : 0;
    const ser = emptySeries(maxOrder + 1);
    const result = await saveSeries(ser);
    if (!result.ok) {
      alert(result.error ?? "创建失败");
      return;
    }
    router.push(`/series/${ser.id}`);
  }

  async function handleDelete(id: string) {
    if (!await confirm({
      message: "确定删除该企划及其所有剧集？此操作不可撤销。",
      confirmText: "删除",
    })) return;
    await deleteSeries(id);
    await refresh();
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
            title="返回首页"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warm-950 text-warm-50">
              <BrushIcon size={18} />
              <span className="sr-only">墨间</span>
            </div>
            <span
              className="font-serif font-bold text-[20px] text-warm-950"
              style={{ letterSpacing: "2px" }}
            >
              墨间
            </span>
          </a>
          <div className="h-8 w-px bg-warm-300" />
          <div>
            <h1 className="text-xl font-bold text-slate-800">我的企划</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              管理多个剧集系列，每个系列下创建独立的剧集
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="md" onClick={() => router.push("/assets")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-1">
              <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            </svg>
            资产库
          </Button>
          <Button variant="ghost" size="md" onClick={() => router.push("/preset-library")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-1">
              <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M19 17l2 2-2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            预设库
          </Button>
          <Button variant="ghost" size="md" onClick={() => router.push("/style-templates")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-1">
              <path
                d="M4 20h16M6 20V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9 10h6M9 14h6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            风格模板
          </Button>
          <Button variant="ghost" size="md" onClick={() => router.push("/logs")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-1">
              <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            任务日志
          </Button>
          <Button variant="ghost" size="md" onClick={() => router.push("/settings")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-1">
              <path
                d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
            设置
          </Button>
        </div>
      </header>

      {mounted ? (
        <SeriesList
          series={seriesList}
          onOpen={(id) => router.push(`/series/${id}`)}
          onDelete={handleDelete}
          onCreate={handleNew}
        />
      ) : (
        <div className="py-20 text-center text-slate-400">加载中…</div>
      )}
    </main>
  );
}
