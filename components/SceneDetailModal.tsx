"use client";

import type { SceneProfile } from "@/lib/types";
import Modal from "./ui/Modal";
import AssetImageZone from "./AssetImageZone";

interface SceneDetailModalProps {
  scene: SceneProfile | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (field: keyof SceneProfile, value: string) => void;
  onGenerateImage: () => void;
  isGenerating: boolean;
  onUploadImage: (file: File) => void;
  isUploading: boolean;
  onRandomAppearance: () => void;
}

const INPUT_CLASS =
  "w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

export function SceneDetailModal({
  scene,
  open,
  onClose,
  onUpdate,
  onGenerateImage,
  isGenerating,
  onUploadImage,
  isUploading,
  onRandomAppearance,
}: SceneDetailModalProps) {
  if (!open || !scene) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${scene.name || "未命名场景"} · 详情`}
      width="max-w-3xl"
      zIndexClass="z-40"
    >
      <div className="space-y-3">
        <AssetImageZone
          imageUrl={scene.imageUrl}
          name={scene.name}
          isGenerating={isGenerating}
          isUploading={isUploading}
          onGenerate={onGenerateImage}
          onUpload={onUploadImage}
          onPasteUrl={(url) => onUpdate("imageUrl", url)}
          height="h-44"
        />

        <Field label="📝 名称">
          <input type="text" value={scene.name}
            onChange={(e) => onUpdate("name", e.target.value)} placeholder="场景名称"
            className={INPUT_CLASS} />
        </Field>

        <Field label="🏷️ 版本标签">
          <input type="text" value={scene.versionLabel}
            onChange={(e) => onUpdate("versionLabel", e.target.value)}
            placeholder="如：白天、夜晚、战火后…"
            className={INPUT_CLASS} />
        </Field>

        <Field label="📦 分类" hint="室内/室外/特定地点等">
          <input type="text" value={scene.category}
            onChange={(e) => onUpdate("category", e.target.value)}
            placeholder="如：室内、室外、奇幻地…" className={INPUT_CLASS} />
        </Field>

        <Field label="🎨 外观描述" hint="视觉特征、布局、建筑风格" action={
          <button onClick={onRandomAppearance} title="随机生成外观"
            className="text-xs text-brand-600 transition-colors hover:text-brand-700">
            ✨
          </button>
        }>
          <textarea value={scene.appearance}
            onChange={(e) => onUpdate("appearance", e.target.value)}
            placeholder="如：古朴的木质茶馆，挂着红灯笼，门前有石阶流水…"
            className={`${INPUT_CLASS} resize-y`} rows={3} />
        </Field>

        <Field label="💡 光影氛围" hint="光线、色调、氛围">
          <textarea value={scene.lightingMood}
            onChange={(e) => onUpdate("lightingMood", e.target.value)}
            placeholder="如：黄昏暖光、逆光剪影、冷色调月光…"
            className={`${INPUT_CLASS} resize-y`} rows={2} />
        </Field>

        <Field label="📖 来源背景">
          <textarea value={scene.origin}
            onChange={(e) => onUpdate("origin", e.target.value)}
            placeholder="如：主角家族传承的老宅，隐藏在深巷百年…"
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
