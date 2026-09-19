"use client";

import { useRef, useState } from "react";
import type { CharacterProfile } from "@/lib/types";
import Modal from "./ui/Modal";
import AssetImageZone from "./AssetImageZone";
import ImageLightbox from "./ImageLightbox";
import Spinner from "./ui/Spinner";
import VoicePlayerBar from "./VoicePlayerBar";

interface CharacterDetailModalProps {
  character: CharacterProfile | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (field: keyof CharacterProfile, value: string) => void;
  onGenerateImage: () => void;
  isGenerating: boolean;
  onUploadImage: (file: File) => void;
  isUploading: boolean;
  onRandomAppearance: () => void;
  onGenerateVoice: () => void;
  isGeneratingVoice: boolean;
  onAddVoiceFromAsset: () => void;
  onUploadVoice: (file: File) => void;
  isUploadingVoice: boolean;
  onRemoveVoice: () => void;
  /** 打开人物资产图生成弹框（自动带主图作参考图） */
  onGenerateAssetImage: () => void;
  isGeneratingAsset: boolean;
  onUploadAssetImage: (file: File) => void;
  isUploadingAsset: boolean;
  onRemoveAssetImage: (url: string) => void;
}

const INPUT_CLASS =
  "w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

type Tab = "basic" | "assets" | "relations";

export function CharacterDetailModal({
  character,
  open,
  onClose,
  onUpdate,
  onGenerateImage,
  isGenerating,
  onUploadImage,
  isUploading,
  onRandomAppearance,
  onGenerateVoice,
  isGeneratingVoice,
  onAddVoiceFromAsset,
  onUploadVoice,
  isUploadingVoice,
  onRemoveVoice,
  onGenerateAssetImage,
  isGeneratingAsset,
  onUploadAssetImage,
  isUploadingAsset,
  onRemoveAssetImage,
}: CharacterDetailModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("basic");
  const assetFileInputRef = useRef<HTMLInputElement>(null);

  if (!open || !character) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${character.name || "未命名人物"} · 详情`}
      width="max-w-3xl"
      zIndexClass="z-40"
    >
      {/* 标签页 */}
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <TabButton active={activeTab === "basic"} onClick={() => setActiveTab("basic")}>
          基础信息
        </TabButton>
        <TabButton active={activeTab === "assets"} onClick={() => setActiveTab("assets")}>
          人物资产
        </TabButton>
        <TabButton active={activeTab === "relations"} onClick={() => setActiveTab("relations")}>
          关联
        </TabButton>
      </div>

      {activeTab === "basic" ? (
        <div className="space-y-3">
          {/* 图片区 */}
          <AssetImageZone
            imageUrl={character.imageUrl}
            name={character.name}
            isGenerating={isGenerating}
            isUploading={isUploading}
            onGenerate={onGenerateImage}
            onUpload={onUploadImage}
            onPasteUrl={(url) => onUpdate("imageUrl", url)}
            height="h-44"
          />

          {/* 名称 */}
          <Field label="📝 名称">
            <input type="text" value={character.name}
              onChange={(e) => onUpdate("name", e.target.value)} placeholder="人物姓名"
              className={INPUT_CLASS} />
          </Field>

          {/* 版本标签 */}
          <Field label="🏷️ 版本标签">
            <input type="text" value={character.versionLabel}
              onChange={(e) => onUpdate("versionLabel", e.target.value)}
              placeholder="如：少年期、觉醒后…"
              className={INPUT_CLASS} />
          </Field>

          {/* 音色 */}
          <VoicePlayerBar
            voiceUrl={character.voiceUrl}
            name={character.name}
            versionLabel={character.versionLabel}
            version={character.version}
            isGenerating={isGeneratingVoice}
            isUploading={isUploadingVoice}
            onGenerate={onGenerateVoice}
            onAddFromAsset={onAddVoiceFromAsset}
            onUpload={onUploadVoice}
            onRemove={onRemoveVoice}
          />

          {/* 角色定位 / 性别年龄 */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="🎭 角色定位">
              <input type="text" value={character.role}
                onChange={(e) => onUpdate("role", e.target.value)}
                placeholder="主角、配角…" className={INPUT_CLASS} />
            </Field>
            <Field label="👤 性别年龄">
              <input type="text" value={character.genderAge}
                onChange={(e) => onUpdate("genderAge", e.target.value)}
                placeholder="男，25岁" className={INPUT_CLASS} />
            </Field>
          </div>

          <Field label="🎨 外貌" hint="外貌特征、穿着打扮" action={
            <button onClick={onRandomAppearance} title="随机生成外貌"
              className="text-xs text-brand-600 transition-colors hover:text-brand-700">
              ✨
            </button>
          }>
            <textarea value={character.appearance}
              onChange={(e) => onUpdate("appearance", e.target.value)}
              placeholder="如：短发，戴黑框眼镜，常穿深色风衣…"
              className={`${INPUT_CLASS} resize-y`} rows={3} />
          </Field>

          <Field label="💭 性格" hint="性格特点、行为方式">
            <textarea value={character.personality}
              onChange={(e) => onUpdate("personality", e.target.value)}
              placeholder="如：冷静内敛，不善言辞但观察力敏锐…"
              className={`${INPUT_CLASS} resize-y`} rows={2} />
          </Field>

          <Field label="📖 背景故事">
            <textarea value={character.background}
              onChange={(e) => onUpdate("background", e.target.value)}
              placeholder="如：曾是一名记者，因报道失误转行…"
              className={`${INPUT_CLASS} resize-y`} rows={3} />
          </Field>

          <Field label="🔗 人物关系" hint="与其他人物的关系">
            <textarea value={character.relationships}
              onChange={(e) => onUpdate("relationships", e.target.value)}
              placeholder="如：小红的丈夫，老张的下属…"
              className={`${INPUT_CLASS} resize-y`} rows={2} />
          </Field>
        </div>
      ) : activeTab === "assets" ? (
        <div>
          {/* 操作行 */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onGenerateAssetImage}
                disabled={isGeneratingAsset}
                className="flex items-center gap-1.5 rounded-md border border-brand-400 bg-brand-50 px-2.5 py-1.5 text-[13px] font-medium text-brand-600 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {isGeneratingAsset ? "生成中…" : "生成图片"}
              </button>
              <span className="text-xs text-slate-400">自动以主图为参考图</span>
            </div>
            <div className="flex items-center gap-2">
              {isUploadingAsset && <span className="text-xs text-slate-400">上传中…</span>}
              <button
                type="button"
                onClick={() => assetFileInputRef.current?.click()}
                disabled={isUploadingAsset}
                className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-[13px] text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M12 16V4m0 0L8 8m4-4l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                上传图片
              </button>
            </div>
          </div>

          {/* 资产图网格 */}
          {(character.assetImages?.length ?? 0) > 0 || isGeneratingAsset ? (
            <div className="grid grid-cols-3 gap-2">
              {(character.assetImages ?? []).map((url) => (
                <div key={url} className="group relative overflow-hidden rounded-md border border-slate-200">
                  <ImageLightbox src={url} alt={`${character.name}-资产图`} className="h-28 w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`${character.name}-资产图`} className="h-28 w-full object-cover" />
                  </ImageLightbox>
                  <button
                    type="button"
                    onClick={() => onRemoveAssetImage(url)}
                    title="删除该资产图"
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-xs text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              ))}
              {isGeneratingAsset && (
                <div className="flex h-28 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-brand-300 bg-brand-50/50 text-brand-500">
                  <Spinner size={20} />
                  <span className="text-xs">生成中…</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/50 py-12 text-center">
              <div className="mb-2 text-3xl opacity-25">🖼️</div>
              <p className="text-sm text-slate-500">暂无人物资产图</p>
              <p className="mt-1 text-xs text-slate-400">可点击「生成图片」（自动以主图为参考图）或上传本地图片</p>
            </div>
          )}

          <input ref={assetFileInputRef} type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUploadAssetImage(file);
              e.target.value = "";
            }} />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 text-4xl opacity-20">🕸️</div>
          <p className="text-sm text-slate-500">关系图谱与关联其他设定</p>
          <p className="mt-1 text-xs text-slate-400">该功能正在开发中，敬请期待</p>
        </div>
      )}
    </Modal>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
        active
          ? "border-brand-500 font-medium text-brand-600"
          : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
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
