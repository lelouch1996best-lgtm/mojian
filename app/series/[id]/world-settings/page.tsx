"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Button from "@/components/ui/Button";
import { getSeries, saveSeries } from "@/lib/storage";
import { debounce, AUTOSAVE_DEBOUNCE_MS } from "@/lib/utils";
import { useUnloadPersist } from "@/lib/use-unload-persist";
import type { Series, WorldSettings } from "@/lib/types";

export default function WorldSettingsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const seriesId = params.id;

  const [series, setSeries] = useState<Series | null>(null);
  const [settings, setSettings] = useState<WorldSettings>({
    background: "",
    theme: "",
    style: "",
  });
  const [savedHint, setSavedHint] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const refresh = useCallback(async () => {
    if (!seriesId) return;
    const s = await getSeries(seriesId);
    if (!s) {
      setNotFound(true);
      return;
    }
    setSeries(s);
    setSettings(s.worldSettings ?? { background: "", theme: "", style: "" });
  }, [seriesId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 自动保存：防抖持久化 settings 变化
  const seriesRef = useRef<Series | null>(null);
  seriesRef.current = series;
  const settingsRef = useRef<WorldSettings>(settings);
  settingsRef.current = settings;
  const skipPersistRef = useRef(true);

  const persist = useCallback(
    debounce(async (ws: WorldSettings) => {
      const s = seriesRef.current;
      if (!s) return;
      const updated: Series = { ...s, worldSettings: ws };
      await saveSeries(updated);
      seriesRef.current = updated;
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 1500);
    }, AUTOSAVE_DEBOUNCE_MS),
    []
  );

  useEffect(() => {
    if (skipPersistRef.current) {
      if (seriesRef.current) skipPersistRef.current = false;
      return;
    }
    persist(settings);
  }, [settings, persist]);

  // 卸载兜底落盘：刷新/关闭走 beforeunload，SPA 路由离开走组件卸载 cleanup，
  // 防止 1500ms 防抖未触发导致最新输入丢失。
  useUnloadPersist(() => {
    const s = seriesRef.current;
    if (!s) return null;
    return { ...s, worldSettings: settingsRef.current };
  }, "/api/data/series");

  function update<K extends keyof WorldSettings>(key: K, value: WorldSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function handleBack() {
    router.back();
  }

  if (notFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-slate-500">
        <p>未找到该企划</p>
        <Button onClick={() => router.push("/")}>返回首页</Button>
      </main>
    );
  }

  if (!series) {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-400">
        加载中…
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="text-slate-400 hover:text-slate-600"
            title="返回企划"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">世界设定</h1>
            <p className="text-xs text-slate-400">{series.title || "未命名企划"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedHint && (
            <span className="text-xs text-emerald-600">已保存 ✓</span>
          )}
        </div>
      </header>

      {/* 说明条 */}
      <div className="mb-5 rounded-md bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">
        世界设定是整个故事宇宙的基础。填写后，故事扩写和分镜生成会自动参考这些设定，保持风格和世界观的一致性。
      </div>

      {/* 表单 */}
      <div className="space-y-5">
        <Field label="故事背景" hint="时代、地点、世界观">
          <textarea
            value={settings.background}
            onChange={(e) => update("background", e.target.value)}
            placeholder="如：2045年，人类与 AI 共存的近未来都市。社会分层加剧，上城区由 AI 管理，下城区是人类的聚居地…"
            className="ws-input resize-y"
            rows={5}
          />
        </Field>

        <Field label="核心主题" hint="故事要表达的思想">
          <textarea
            value={settings.theme}
            onChange={(e) => update("theme", e.target.value)}
            placeholder="如：人类与技术的边界、自由意志、身份认同"
            className="ws-input resize-y"
            rows={3}
          />
        </Field>

        <Field label="写作风格" hint="叙事语气、节奏、修辞偏好">
          <textarea
            value={settings.style}
            onChange={(e) => update("style", e.target.value)}
            placeholder="如：冷峻克制的叙述风格，多使用短句和视觉化描写。对话简洁有力，善用留白和环境烘托情绪。每句应包含可视觉化的画面信息。"
            className="ws-input resize-y"
            rows={5}
          />
        </Field>
      </div>

      <style jsx>{`
        :global(.ws-input) {
          width: 100%;
          border-radius: 8px;
          border: 1px solid #D9D3C8;
          background: #fff;
          padding: 10px 14px;
          font-size: 14px;
          color: #44403C;
          line-height: 1.6;
        }
        :global(.ws-input:focus) {
          outline: none;
          border-color: #D97706;
          box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.2);
        }
        :global(.ws-input::placeholder) {
          color: #A8A29E;
        }
      `}</style>
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="text-sm font-medium text-slate-700">{label}</label>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
