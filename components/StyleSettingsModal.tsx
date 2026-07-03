"use client";

import { useEffect, useState } from "react";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import {
  getStyleSettings,
  saveStyleSettings,
  getDefaultPresets,
  getDefaultPreset,
  resetStyleOverride,
} from "@/lib/style-settings";
import type { StylePreset, StyleSettings } from "@/lib/types";

interface StyleSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** 外部传入的初始设定（系列级），有值时优先使用，不读写全局 localStorage */
  initialSettings?: StyleSettings;
  /** 外部保存回调，有值时不再调用全局 saveStyleSettings */
  onSave?: (settings: StyleSettings) => void;
}

function PaletteIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-4.97-4.5-9-10-9z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" />
      <circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" />
      <circle cx="15" cy="8" r="1.2" fill="currentColor" />
      <circle cx="17.5" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}

export default function StyleSettingsModal({ open, onClose, initialSettings, onSave }: StyleSettingsModalProps) {
  const [settings, setSettings] = useState<StyleSettings>({
    selectedStyleId: "realistic",
    overrides: {},
  });
  const [saved, setSaved] = useState(false);
  const [editingStyle, setEditingStyle] = useState<StylePreset | null>(null);

  /** 根据给定的 StyleSettings 计算带 override 的完整风格列表 */
  function computeStyles(ss: StyleSettings) {
    return getDefaultPresets().map((preset) => {
      const override = ss.overrides[preset.id];
      return override ? { ...preset, ...override } : { ...preset };
    });
  }

  useEffect(() => {
    if (open) {
      (async () => {
      const s = initialSettings ?? await getStyleSettings();
      setSettings(s);
      setSaved(false);
      const all = computeStyles(s);
      const active = all.find((p) => p.id === s.selectedStyleId) ?? all[0];
      setEditingStyle(active);
      })();
    }
  }, [open, initialSettings]);

  /** 切换选中的风格 */
  function selectStyle(styleId: string) {
    setSettings((prev) => ({ ...prev, selectedStyleId: styleId }));
    setSaved(false);
    const all = computeStyles({ ...settings, selectedStyleId: styleId });
    const target = all.find((p) => p.id === styleId) ?? all[0];
    setEditingStyle({ ...target });
  }

  /** 编辑当前风格的某个模板字段 */
  function updateTemplate(field: keyof Omit<StylePreset, "id">, value: string) {
    if (!editingStyle) return;
    setEditingStyle((prev) => (prev ? { ...prev, [field]: value } : prev));
    setSaved(false);
  }

  /** 保存：把 editingStyle 的修改写入 overrides */
  function handleSave() {
    if (!editingStyle) return;
    const defaultPreset = getDefaultPreset(editingStyle.id);
    if (!defaultPreset) return;

    // 只保存与默认值不同的字段
    const override: Partial<Omit<StylePreset, "id">> = {};
    if (editingStyle.name !== defaultPreset.name) override.name = editingStyle.name;
    if (editingStyle.description !== defaultPreset.description) override.description = editingStyle.description;
    if (editingStyle.characterTemplate !== defaultPreset.characterTemplate) override.characterTemplate = editingStyle.characterTemplate;
    if (editingStyle.sceneTemplate !== defaultPreset.sceneTemplate) override.sceneTemplate = editingStyle.sceneTemplate;
    if (editingStyle.objectTemplate !== defaultPreset.objectTemplate) override.objectTemplate = editingStyle.objectTemplate;
    if (editingStyle.videoStyleSuffix !== defaultPreset.videoStyleSuffix) override.videoStyleSuffix = editingStyle.videoStyleSuffix;

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
    if (onSave) {
      onSave(newSettings);
    } else {
      saveStyleSettings(newSettings);
    }
    setSaved(true);
  }

  /** 恢复当前风格为默认值 */
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
    if (onSave) {
      onSave(newSettings);
    } else {
      saveStyleSettings(newSettings);
    }
    setSaved(true);
  }

  const allStyles = computeStyles(settings);
  const isCustomized = editingStyle ? !!settings.overrides[editingStyle.id] : false;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={
        <div className="flex items-center gap-2">
          <PaletteIcon size={20} />
          漫剧风格
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          选择漫剧风格后，资产生成、图片生成和视频生成会自动应用对应风格的提示词模板。模板内容可自行修改，修改后保存即生效。
        </div>

        {/* 风格选择卡片 */}
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">选择风格</label>
          <div className="grid grid-cols-2 gap-3">
            {allStyles.map((style) => {
              const isSelected = settings.selectedStyleId === style.id;
              const isEditing = editingStyle?.id === style.id;
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
          <>
            <div className="border-t border-slate-200 pt-3">
              <div className="mb-3 flex items-center justify-between">
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
            </div>

            <TemplateField
              label="人物图片提示词模板"
              hint="包含三视图要求，拼接到 LLM 生成的提示词末尾"
            >
              <textarea
                value={editingStyle.characterTemplate}
                onChange={(e) => updateTemplate("characterTemplate", e.target.value)}
                className="input multiline"
                rows={3}
              />
            </TemplateField>

            <TemplateField label="场景图片提示词模板">
              <textarea
                value={editingStyle.sceneTemplate}
                onChange={(e) => updateTemplate("sceneTemplate", e.target.value)}
                className="input multiline"
                rows={2}
              />
            </TemplateField>

            <TemplateField label="物品图片提示词模板">
              <textarea
                value={editingStyle.objectTemplate}
                onChange={(e) => updateTemplate("objectTemplate", e.target.value)}
                className="input multiline"
                rows={2}
              />
            </TemplateField>

            <TemplateField label="视频风格后缀" hint="拼接到视频提示词末尾">
              <textarea
                value={editingStyle.videoStyleSuffix}
                onChange={(e) => updateTemplate("videoStyleSuffix", e.target.value)}
                className="input multiline"
                rows={2}
              />
            </TemplateField>
          </>
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">
            当前风格：{allStyles.find((s) => s.id === settings.selectedStyleId)?.name ?? "未选择"}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>关闭</Button>
            <Button size="sm" onClick={handleSave}>
              {saved ? "已保存 ✓" : "保存"}
            </Button>
          </div>
        </div>

        <style jsx>{`
          :global(.input) {
            width: 100%;
            border-radius: 8px;
            border: 1px solid #D9D3C8;
            background: #fff;
            padding: 8px 12px;
            font-size: 13px;
            color: #44403C;
          }
          :global(.input.multiline) {
            resize: vertical;
          }
          :global(.input:focus) {
            outline: none;
            border-color: #D97706;
            box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.25);
          }
        `}</style>
      </div>
    </Modal>
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
