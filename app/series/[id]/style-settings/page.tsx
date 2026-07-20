"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Button from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { getSeries, saveSeries } from "@/lib/storage";
import {
  createEmptyCustomPreset,
  getAllStylesSync,
  getDefaultPreset,
  isBuiltinPreset,
  normalizeStyleSettings,
} from "@/lib/style-settings";
import { debounce } from "@/lib/utils";
import type { Series, StylePreset, StyleSettings } from "@/lib/types";

export default function StyleSettingsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const seriesId = params.id;
  const confirm = useConfirm();

  const [series, setSeries] = useState<Series | null>(null);
  const [settings, setSettings] = useState<StyleSettings>(() =>
    normalizeStyleSettings(null)
  );
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
    setSettings(normalizeStyleSettings(s.styleSettings));
  }, [seriesId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ===== 自动保存（防抖 500ms） =====
  const seriesRef = useRef<Series | null>(null);
  seriesRef.current = series;
  const settingsRef = useRef<StyleSettings>(settings);
  settingsRef.current = settings;
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
    }, 500),
    []
  );

  useEffect(() => {
    if (skipPersistRef.current) {
      // 首次加载完 series 后再开启自动保存，避免覆盖远端数据
      if (seriesRef.current) skipPersistRef.current = false;
      return;
    }
    persist(settings);
  }, [settings, persist]);

  // 页面卸载（切路由/刷新/关闭）时兜底保存，防止防抖 persist 未触发导致修改丢失
  useEffect(() => {
    const handler = () => {
      const s = seriesRef.current;
      const ss = settingsRef.current;
      if (!s) return;
      const updatedSeries = { ...s, styleSettings: ss };
      fetch("/api/data/series", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_STORAGE_TOKEN ?? ""}`,
        },
        body: JSON.stringify(updatedSeries),
        keepalive: true,
      });
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // 当前编辑中的风格（从 settings 派生）
  const allStyles = useMemo(() => getAllStylesSync(settings), [settings]);
  const editingStyle = useMemo<StylePreset | null>(() => {
    return allStyles.find((p) => p.id === settings.selectedStyleId) ?? allStyles[0] ?? null;
  }, [allStyles, settings.selectedStyleId]);

  function selectStyle(styleId: string) {
    setSettings((prev) => ({ ...prev, selectedStyleId: styleId }));
  }

  /** 计算内置预设的 override（仅记录与默认值不同的字段；完全相同时返回 undefined） */
  function computeOverride(
    editing: StylePreset,
    defaultPreset: StylePreset
  ): Partial<Omit<StylePreset, "id">> | undefined {
    const override: Partial<Omit<StylePreset, "id">> = {};
    if (editing.name !== defaultPreset.name) override.name = editing.name;
    if (editing.description !== defaultPreset.description) override.description = editing.description;
    if (editing.characterTemplate !== defaultPreset.characterTemplate) override.characterTemplate = editing.characterTemplate;
    if (editing.sceneTemplate !== defaultPreset.sceneTemplate) override.sceneTemplate = editing.sceneTemplate;
    if (editing.objectTemplate !== defaultPreset.objectTemplate) override.objectTemplate = editing.objectTemplate;
    if (editing.storyboardTemplate !== defaultPreset.storyboardTemplate) override.storyboardTemplate = editing.storyboardTemplate;
    return Object.keys(override).length > 0 ? override : undefined;
  }

  function updateTemplate(field: keyof Omit<StylePreset, "id">, value: string) {
    setSettings((prev) => {
      const id = prev.selectedStyleId;
      const defaultPreset = getDefaultPreset(id);
      const current = defaultPreset
        ? { ...defaultPreset, ...(prev.overrides?.[id] ?? {}) }
        : prev.customPresets?.find((p) => p.id === id);
      if (!current) return prev;
      const newEditing: StylePreset = { ...current, [field]: value };
      if (defaultPreset) {
        const override = computeOverride(newEditing, defaultPreset);
        const newOverrides = { ...prev.overrides };
        if (override) newOverrides[id] = override;
        else delete newOverrides[id];
        return { ...prev, overrides: newOverrides };
      }
      const newCustom = (prev.customPresets ?? []).map((p) =>
        p.id === id ? { ...newEditing } : p
      );
      return { ...prev, customPresets: newCustom };
    });
  }

  function handleAddPreset() {
    const source = editingStyle;
    const newPreset = createEmptyCustomPreset(source);
    setSettings((prev) => ({
      ...prev,
      selectedStyleId: newPreset.id,
      customPresets: [...(prev.customPresets ?? []), newPreset],
    }));
  }

  async function handleDeletePreset(id: string) {
    if (!await confirm({
      message: "确定删除该自定义风格？该操作不可恢复。",
      confirmText: "删除",
      variant: "danger",
    })) return;
    setSettings((prev) => {
      const newCustom = (prev.customPresets ?? []).filter((p) => p.id !== id);
      const newSelected = prev.selectedStyleId === id
        ? (getDefaultPreset("realistic")?.id ?? "realistic")
        : prev.selectedStyleId;
      return { ...prev, selectedStyleId: newSelected, customPresets: newCustom };
    });
  }

  function handleReset() {
    if (!editingStyle) return;
    const id = editingStyle.id;
    if (!isBuiltinPreset(id)) return;
    setSettings((prev) => {
      const newOverrides = { ...prev.overrides };
      delete newOverrides[id];
      return { ...prev, overrides: newOverrides };
    });
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

  const isCustomPresetSelected = editingStyle ? !isBuiltinPreset(editingStyle.id) : false;
  const isCustomized = editingStyle ? !!settings.overrides[editingStyle.id] : false;

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
        选择风格设定后，资产生成、图片生成和视频生成会自动应用对应风格的提示词模板。模板内容修改后会自动保存；也可点击「新增模板」添加自己的风格。
      </div>

      {/* 风格选择卡片 */}
      <div className="mb-6">
        <label className="mb-3 block text-sm font-medium text-slate-700">选择风格</label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {allStyles.map((style) => {
            const isSelected = settings.selectedStyleId === style.id;
            const isCustom = !isBuiltinPreset(style.id);
            return (
              <div
                key={style.id}
                className={`group relative rounded-lg border-2 px-4 py-3 text-left transition-all ${
                  isSelected
                    ? "border-brand-500 bg-brand-50/50 shadow-sm"
                    : "border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/30"
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectStyle(style.id)}
                  className="block w-full pr-6 text-left"
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
                    {isCustom && (
                      <span className="inline-block rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">
                        自定义
                      </span>
                    )}
                    {!!settings.overrides[style.id] && (
                      <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                        已修改
                      </span>
                    )}
                  </div>
                </button>
                {isCustom && (
                  <button
                    type="button"
                    onClick={() => handleDeletePreset(style.id)}
                    className="absolute right-1.5 top-1.5 rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                    title="删除该风格"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
          {/* 新增模板按钮 */}
          <button
            type="button"
            onClick={handleAddPreset}
            className="flex items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 bg-white/40 py-3 text-sm text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-500"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            新增模板
          </button>
        </div>
      </div>

      {/* 模板编辑区 */}
      {editingStyle && (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <span className="text-sm font-medium text-slate-700">
              模板编辑 - {editingStyle.name}
            </span>
            {isCustomPresetSelected ? (
              <button
                type="button"
                onClick={() => handleDeletePreset(editingStyle.id)}
                className="text-xs text-slate-400 transition-colors hover:text-red-600"
              >
                删除模板
              </button>
            ) : isCustomized ? (
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-slate-400 transition-colors hover:text-amber-600"
              >
                恢复默认
              </button>
            ) : null}
          </div>

          <TemplateField label="名称">
            <input
              type="text"
              value={editingStyle.name}
              onChange={(e) => updateTemplate("name", e.target.value)}
              className="ss-input"
              placeholder="风格名称"
            />
          </TemplateField>

          <TemplateField label="描述" hint="简短说明该风格的特色">
            <input
              type="text"
              value={editingStyle.description}
              onChange={(e) => updateTemplate("description", e.target.value)}
              className="ss-input"
              placeholder="如：电影级写实，自然光影"
            />
          </TemplateField>

          <TemplateField label="人物图片提示词模板" hint="包含三视图要求，拼接到 LLM 生成的提示词末尾">
            <textarea
              value={editingStyle.characterTemplate}
              onChange={(e) => updateTemplate("characterTemplate", e.target.value)}
              className="ss-input resize-y"
              rows={4}
            />
          </TemplateField>

          <TemplateField label="场景图片提示词模板">
            <textarea
              value={editingStyle.sceneTemplate}
              onChange={(e) => updateTemplate("sceneTemplate", e.target.value)}
              className="ss-input resize-y"
              rows={3}
            />
          </TemplateField>

          <TemplateField label="物品图片提示词模板">
            <textarea
              value={editingStyle.objectTemplate}
              onChange={(e) => updateTemplate("objectTemplate", e.target.value)}
              className="ss-input resize-y"
              rows={3}
            />
          </TemplateField>

          <TemplateField label="故事板图片提示词模板" hint="可用 {镜头信息} 占位符标记镜头信息插入位置；无占位符时镜头信息追加在末尾">
            <textarea
              value={editingStyle.storyboardTemplate}
              onChange={(e) => updateTemplate("storyboardTemplate", e.target.value)}
              className="ss-input resize-y"
              rows={6}
            />
          </TemplateField>
        </div>
      )}

      <style jsx>{`
        :global(.ss-input) {
          width: 100%;
          border-radius: 8px;
          border: 1px solid #D9D3C8;
          background: #fff;
          padding: 10px 14px;
          font-size: 13px;
          color: #44403C;
          line-height: 1.6;
        }
        :global(.ss-input:focus) {
          outline: none;
          border-color: #D97706;
          box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.2);
        }
        :global(.ss-input::placeholder) {
          color: #A8A29E;
        }
      `}</style>
    </main>
  );
}

function TemplateField({
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
