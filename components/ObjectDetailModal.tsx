"use client";

import type { ObjectProfile } from "@/lib/types";
import Modal from "./ui/Modal";
import AssetImageZone from "./AssetImageZone";

interface ObjectDetailModalProps {
  object: ObjectProfile | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (field: keyof ObjectProfile, value: string) => void;
  onGenerateImage: () => void;
  isGenerating: boolean;
  onUploadImage: (file: File) => void;
  isUploading: boolean;
  onRandomAppearance: () => void;
}

const INPUT_CLASS =
  "w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

export function ObjectDetailModal({
  object,
  open,
  onClose,
  onUpdate,
  onGenerateImage,
  isGenerating,
  onUploadImage,
  isUploading,
  onRandomAppearance,
}: ObjectDetailModalProps) {
  if (!open || !object) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${object.name || "未命名物品"} · 详情`}
      width="max-w-3xl"
      zIndexClass="z-40"
    >
      <div className="space-y-3">
        <AssetImageZone
          imageUrl={object.imageUrl}
          name={object.name}
          isGenerating={isGenerating}
          isUploading={isUploading}
          onGenerate={onGenerateImage}
          onUpload={onUploadImage}
          onPasteUrl={(url) => onUpdate("imageUrl", url)}
          height="h-44"
        />

        <Field label="📝 名称">
          <input type="text" value={object.name}
            onChange={(e) => onUpdate("name", e.target.value)} placeholder="物品名称"
            className={INPUT_CLASS} />
        </Field>

        <Field label="🏷️ 版本标签">
          <input type="text" value={object.versionLabel}
            onChange={(e) => onUpdate("versionLabel", e.target.value)}
            placeholder="如：初始形态、觉醒后…"
            className={INPUT_CLASS} />
        </Field>

        <Field label="📦 分类" hint="武器/道具/载具等">
          <input type="text" value={object.category}
            onChange={(e) => onUpdate("category", e.target.value)}
            placeholder="如：法器、载具、生活道具…" className={INPUT_CLASS} />
        </Field>

        <Field label="🎨 外观" hint="外观特征、材质造型" action={
          <button onClick={onRandomAppearance} title="随机生成外观"
            className="text-xs text-brand-600 transition-colors hover:text-brand-700">
            ✨
          </button>
        }>
          <textarea value={object.appearance}
            onChange={(e) => onUpdate("appearance", e.target.value)}
            placeholder="如：青铜长剑，剑身刻有云纹，剑柄缠红绳…"
            className={`${INPUT_CLASS} resize-y`} rows={3} />
        </Field>

        <Field label="⚙️ 功能用途" hint="功能、效果、用法">
          <textarea value={object.purpose}
            onChange={(e) => onUpdate("purpose", e.target.value)}
            placeholder="如：可斩妖除魔，剑气可破护体罡气…"
            className={`${INPUT_CLASS} resize-y`} rows={2} />
        </Field>

        <Field label="📖 来源背景">
          <textarea value={object.origin}
            onChange={(e) => onUpdate("origin", e.target.value)}
            placeholder="如：上古仙人遗落凡间的法器，传承数千年…"
            className={`${INPUT_CLASS} resize-y`} rows={3} />
        </Field>
      </div>
    </Modal>
  );
}

function Field({ label, hint, action, children }: { label: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-xs font-semibold text-black">{label}</label>
        <div className="flex items-center gap-1.5">
          {hint && <span className="text-xs text-slate-400">{hint}</span>}
          {action}
        </div>
      </div>
      {children}
    </div>
  );
}
