"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Button from "@/components/ui/Button";
import { getSeries, saveSeries } from "@/lib/storage";
import {
  getDefaultPresets,
  getDefaultPreset,
} from "@/lib/style-settings";
import type { Series, StylePreset, StyleSettings } from "@/lib/types";

export default function StyleSettingsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const seriesId = params.id;

  const [series, setSeries] = useState<Series | null>(null);
  const [settings, setSettings] = useState<StyleSettings>({
    selectedStyleId: "realistic",
    overrides: {},
  });
  const [editingStyle, setEditingStyle] = useState<StylePreset | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState(false);
  const [notFound, setNotFound] = useState(false);

  function computeStyles(ss: StyleSettings) {
    return getDefaultPresets().map((preset) => {
      const override = ss.overrides[preset.id];
      return override ? { ...preset, ...override } : { ...preset };
    });
  }

  const refresh = useCallback(async () => {
    if (!seriesId) return;
    const s = await getSeries(seriesId);
    if (!s) {
      setNotFound(true);
      return;
    }
    setSeries(s);
    const ss = s.styleSettings ?? { selectedStyleId: "realistic", overrides: {} };
    setSettings(ss);
    const all = computeStyles(ss);
    const active = all.find((p) => p.id === ss.selectedStyleId) ?? all[0];
    setEditingStyle(active ? { ...active } : null);
  }, [seriesId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function selectStyle(styleId: string) {
    setSettings((prev) => ({ ...prev, selectedStyleId: styleId }));
    setDirty(true);
    const all = computeStyles({ ...settings, selectedStyleId: styleId });
    const target = all.find((p) => p.id === styleId) ?? all[0];
    setEditingStyle(target ? { ...target } : null);
  }

  function updateTemplate(field: keyof Omit<StylePreset, "id">, value: string) {
    if (!editingStyle) return;
    setEditingStyle((prev) => (prev ? { ...prev, [field]: value } : prev));
    setDirty(true);
  }

  async function handleSave() {
    if (!series || !editingStyle) return;
    setSaving(true);
    const defaultPreset = getDefaultPreset(editingStyle.id);
    if (!defaultPreset) return;

    const override: Partial<Omit<StylePreset, "id">> = {};
    if (editingStyle.name !== defaultPreset.name) override.name = editingStyle.name;
    if (editingStyle.description !== defaultPreset.description) override.description = editingStyle.description;
    if (editingStyle.characterTemplate !== defaultPreset.characterTemplate) override.characterTemplate = editingStyle.characterTemplate;
    if (editingStyle.sceneTemplate !== defaultPreset.sceneTemplate) override.sceneTemplate = editingStyle.sceneTemplate;
    if (editingStyle.objectTemplate !== defaultPreset.objectTemplate) override.objectTemplate = editingStyle.objectTemplate;

    const newOverrides = { ...settings.overrides };
    if (Object.keys(override).length > 0) {
      newOverrides[editingStyle.id] = override;
    } else {
      delete newOverrides[editingStyle.id];
    }

    const newSettings: StyleSettings = {
      selectedStyleId: settings.selectedStyleId,
      overrides: newOverrides,
    };
    setSettings(newSettings);
    const updated: Series = { ...series, styleSettings: newSettings };
    await saveSeries(updated);
    setSeries(updated);
    setDirty(false);
    setSaving(false);
    setSavedHint(true);
    setTimeout(() => setSavedHint(false), 1500);
  }

  function handleReset() {
    if (!editingStyle) return;
    const defaultPreset = getDefaultPreset(editingStyle.id);
    if (!defaultPreset) return;
    setEditingStyle({ ...defaultPreset });
    const newOverrides = { ...settings.overrides };
    delete newOverrides[editingStyle.id];
    const newSettings: StyleSettings = {
      selectedStyleId: settings.selectedStyleId,
      overrides: newOverrides,
    };
    setSettings(newSettings);
    setDirty(true);
  }

  function handleBack() {
    if (dirty) {
      if (!confirm("有未保存的修改，确定离开？")) return;
    }
    router.push(`/series/${seriesId}`);
  }

  if (notFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-slate-500">
        <p>未找到该企划</p>
        <Button onClick={() => router.push("/home")}>返回首页</Button>
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

  const allStyles = computeStyles(settings);
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
            <h1 className="text-lg font-semibold text-slate-800">漫剧风格</h1>
            <p className="text-xs text-slate-400">{series.title || "未命名企划"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedHint && (
            <span className="text-xs text-emerald-600">已保存 ✓</span>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            loading={saving}
            disabled={!dirty}
          >
            保存
          </Button>
        </div>
      </header>

      {/* 说明条 */}
      <div className="mb-5 rounded-md bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">
        选择漫剧风格后，资产生成、图片生成和视频生成会自动应用对应风格的提示词模板。模板内容可自行修改，修改后保存即生效。
      </div>

      {dirty && (
        <div className="mb-4 text-xs text-amber-600">● 有未保存的修改</div>
      )}

      {/* 风格选择卡片 */}
      <div className="mb-6">
        <label className="mb-3 block text-sm font-medium text-slate-700">选择风格</label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {allStyles.map((style) => {
            const isSelected = settings.selectedStyleId === style.id;
            return (
              <button
                key={style.id}
                onClick={() => selectStyle(style.id)}
                className={`rounded-lg border-2 px-4 py-3 text-left transition-all ${
                  isSelected
                    ? "border-brand-500 bg-brand-50/50 shadow-sm"
                    : "border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/30"
                }`}
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
                {!!settings.overrides[style.id] && (
                  <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                    已自定义
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 模板编辑区 */}
      {editingStyle && (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <span className="text-sm font-medium text-slate-700">
              模板编辑 — {editingStyle.name}
            </span>
            {isCustomized && (
              <button
                onClick={handleReset}
                className="text-xs text-slate-400 hover:text-amber-600 transition-colors"
              >
                恢复默认
              </button>
            )}
          </div>

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
