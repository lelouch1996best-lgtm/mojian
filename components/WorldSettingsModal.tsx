"use client";

import { useEffect, useState } from "react";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import { getWorldSettings, saveWorldSettings, hasWorldSettings } from "@/lib/world-settings";
import type { WorldSettings } from "@/lib/types";

interface WorldSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** 外部传入的初始设定（系列级），有值时优先使用，不读写全局 localStorage */
  initialSettings?: WorldSettings;
  /** 外部保存回调，有值时不再调用全局 saveWorldSettings */
  onSave?: (settings: WorldSettings) => void;
}

function GlobeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
      <ellipse cx="12" cy="12" rx="4" ry="10" stroke="currentColor" strokeWidth="1.8" />
      <path d="M2 12h20" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export default function WorldSettingsModal({ open, onClose, initialSettings, onSave }: WorldSettingsModalProps) {
  const [settings, setSettings] = useState<WorldSettings>({
    background: "",
    theme: "",
    style: "",
  });
  const [saved, setSaved] = useState(false);
  const [hasSettings, setHasSettings] = useState(false);

  useEffect(() => {
    if (open) {
      (async () => {
      setSettings(initialSettings ?? await getWorldSettings());
      setSaved(false);
      setHasSettings(await hasWorldSettings());
      })();
    }
  }, [open, initialSettings]);

  function update<K extends keyof WorldSettings>(key: K, value: WorldSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function handleSave() {
    if (onSave) {
      onSave(settings);
    } else {
      saveWorldSettings(settings);
    }
    setSaved(true);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <GlobeIcon size={20} />
          世界设定
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          世界设定是整个故事宇宙的基础。填写后，故事扩写和分镜生成会自动参考这些设定，保持风格和世界观的一致性。
        </div>

        <Field label="故事背景" hint="时代、地点、世界观">
          <textarea
            value={settings.background}
            onChange={(e) => update("background", e.target.value)}
            placeholder="如：2045年，人类与 AI 共存的近未来都市。社会分层加剧，上城区由 AI 管理，下城区是人类的聚居地…"
            className="input multiline"
            rows={4}
          />
        </Field>

        <Field label="核心主题" hint="故事要表达的思想">
          <textarea
            value={settings.theme}
            onChange={(e) => update("theme", e.target.value)}
            placeholder="如：人类与技术的边界、自由意志、身份认同"
            className="input multiline"
            rows={3}
          />
        </Field>

        <Field label="写作风格" hint="叙事语气、节奏、修辞偏好">
          <textarea
            value={settings.style}
            onChange={(e) => update("style", e.target.value)}
            placeholder="如：冷峻克制的叙述风格，多使用短句和视觉化描写。对话简洁有力，善用留白和环境烘托情绪。每句应包含可视觉化的画面信息。"
            className="input multiline"
            rows={4}
          />
        </Field>

        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {hasSettings ? "已配置世界设定" : "尚未配置世界设定"}
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
            font-size: 14px;
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
