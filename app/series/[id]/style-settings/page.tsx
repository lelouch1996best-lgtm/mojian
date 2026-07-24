"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Button from "@/components/ui/Button";
import { getSeries, saveSeries } from "@/lib/storage";
import {
  getStyleTemplates,
  isBuiltinPreset,
} from "@/lib/style-settings";
import { debounce, AUTOSAVE_DEBOUNCE_MS } from "@/lib/utils";
import { useUnloadPersist } from "@/lib/use-unload-persist";
import type { Series, StylePreset, StyleSettings } from "@/lib/types";

export default function StyleSettingsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const seriesId = params.id;

  const [series, setSeries] = useState<Series | null>(null);
  const [templates, setTemplates] = useState<StylePreset[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string>("");
  const [savedHint, setSavedHint] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!seriesId) return;
    const [s, tpls] = await Promise.all([
      getSeries(seriesId),
      getStyleTemplates(),
    ]);
    if (!s) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setSeries(s);
    setTemplates(tpls);
    setSelectedStyleId(s.styleSettings.selectedStyleId);
    setLoading(false);
  }, [seriesId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ===== 自动保存（防抖 500ms） =====
  const seriesRef = useRef<Series | null>(null);
  seriesRef.current = series;
  const selectedRef = useRef<string>(selectedStyleId);
  selectedRef.current = selectedStyleId;
  const skipPersistRef = useRef(true);

  const persist = useCallback(
    debounce(async (ss: StyleSettings) => {
      const s = seriesRef.current;
      if (!s) return;
      const updated: Series = { ...s, styleSettings: ss };
      await saveSeries(updated);
      seriesRef.current = updated;
      setSeries(updated);
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
    const ss: StyleSettings = { selectedStyleId };
    persist(ss);
  }, [selectedStyleId, persist]);

  // 卸载兜底落盘：刷新/关闭走 beforeunload，SPA 路由离开走组件卸载 cleanup，
  // 防止 1500ms 防抖未触发导致选中的风格 ID 丢失。
  useUnloadPersist(() => {
    const s = seriesRef.current;
    if (!s) return null;
    return { ...s, styleSettings: { selectedStyleId: selectedRef.current } };
  }, "/api/data/series");

  function selectStyle(styleId: string) {
    setSelectedStyleId(styleId);
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

  if (loading || !series) {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-400">
        加载中…
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6">
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
            <h1 className="text-lg font-semibold text-slate-800">风格设定</h1>
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
        选择风格后，资产生成、图片生成和视频生成会自动应用对应风格的提示词模板。如需新增或编辑风格模板，请前往
        <button
          type="button"
          onClick={() => router.push("/style-templates")}
          className="mx-1 font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700"
        >
          风格模板
        </button>
        页面管理。
      </div>

      {/* 风格选择卡片 */}
      <div className="mb-6">
        <label className="mb-3 block text-sm font-medium text-slate-700">选择风格</label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {templates.map((style) => {
            const isSelected = selectedStyleId === style.id;
            const isBuiltin = isBuiltinPreset(style.id);
            return (
              <div
                key={style.id}
                className={`rounded-lg border-2 px-4 py-3 text-left transition-all ${
                  isSelected
                    ? "border-brand-500 bg-brand-50/50 shadow-sm"
                    : "border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/30"
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectStyle(style.id)}
                  className="block w-full text-left"
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold ${isSelected ? "text-brand-800" : "text-slate-700"}`}>
                      {style.name}
                    </span>
                    {isSelected && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-brand-600">
                        <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{style.description}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {isBuiltin && (
                      <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                        内置
                      </span>
                    )}
                  </div>
                </button>
              </div>
            );
          })}
          {templates.length === 0 && (
            <div className="col-span-full rounded-lg border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400">
              暂无风格模板，请先前往「风格模板」页面创建。
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
