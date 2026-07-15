"use client";

import { useEffect } from "react";
import { IMAGE_ASPECT_RATIOS } from "@/lib/image-client";
import { getImageModelCapability } from "@/lib/model-presets";
import type { AssetImageConfig, ImageGenSettings } from "@/lib/types";
import type { ModelEntry } from "@/lib/model-presets";

/**
 * 图片生成参数表单（模型 / 分辨率 / 宽高比 / 输出格式 / 水印 / 联网搜索 / 提示词优化 / 返回格式）。
 * 纯受控字段，嵌入弹框的「高级参数」折叠区，供「资产生成」与各设定页复用。
 * 字段可见性由 getImageModelCapability() 按模型能力动态控制（参照 docs/image.md 参数支持矩阵）。
 */
export function ImageConfigFields({
  value,
  onChange,
  provider,
  imageModels,
}: {
  value: AssetImageConfig;
  onChange: (patch: Partial<AssetImageConfig>) => void;
  provider: ImageGenSettings["provider"];
  imageModels: ModelEntry[];
}) {
  void provider;
  const cap = getImageModelCapability(value.model, imageModels);

  // 切换模型后，收敛不支持的配置项
  useEffect(() => {
    const patch: Partial<AssetImageConfig> = {};
    if (cap.resolutions.length > 0 && !cap.resolutions.includes(value.resolution)) {
      patch.resolution = cap.resolutions[0];
    }
    if (!cap.webSearch && value.webSearch) {
      patch.webSearch = false;
    }
    if (!cap.optimizePrompt && value.optimizePromptMode !== "standard") {
      patch.optimizePromptMode = "standard";
    }
    if (cap.optimizePrompt && !cap.optimizePromptFast && value.optimizePromptMode === "fast") {
      patch.optimizePromptMode = "standard";
    }
    if (Object.keys(patch).length > 0) {
      onChange(patch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.model]);

  return (
    <div className="space-y-2">
      {/* 模型 */}
      <div>
        <label className="mb-0.5 block text-xs text-slate-400">模型</label>
        {imageModels.length > 0 ? (
          <select
            value={value.model}
            onChange={(e) => onChange({ model: e.target.value })}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 focus:border-brand-500 focus:outline-none"
          >
            {imageModels.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label ? `${m.label}（${m.value}）` : m.value}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={value.model}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder="模型 ID，如 doubao-seedream-5-0-260128"
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 focus:border-brand-500 focus:outline-none"
          />
        )}
      </div>
      {/* 分辨率（方式2，通过 size 字段传输） */}
      <div>
        <label className="mb-0.5 block text-xs text-slate-400">分辨率</label>
        <div className="flex flex-wrap gap-1.5">
          {cap.resolutions.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onChange({ resolution: r })}
              className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                value.resolution === r
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {/* 宽高比（方式2，拼接到提示词中） */}
      <div>
        <label className="mb-0.5 block text-xs text-slate-400">宽高比</label>
        <div className="flex flex-wrap gap-1.5">
          {IMAGE_ASPECT_RATIOS.map((ar) => (
            <button
              key={ar}
              type="button"
              onClick={() => onChange({ aspectRatio: ar })}
              className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                value.aspectRatio === ar
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {ar}
            </button>
          ))}
        </div>
        <p className="mt-0.5 text-[10px] text-slate-400">宽高比会自动拼接到提示词末尾</p>
      </div>
      {/* 输出格式（仅 doubao-seedream-5.0-lite 支持） */}
      {cap.outputFormat && (
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">输出格式</label>
          <div className="flex gap-1.5">
            {(["png", "jpeg"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onChange({ outputFormat: f })}
                className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                  value.outputFormat === f
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* 水印 */}
      {cap.watermark && (
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={value.watermark}
            onChange={(e) => onChange({ watermark: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-xs text-slate-600">{value.watermark ? "添加水印" : "不添加水印"}</span>
        </label>
      )}
      {/* 联网搜索（仅 doubao-seedream-5.0-lite 支持） */}
      {cap.webSearch && (
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={value.webSearch}
            onChange={(e) => onChange({ webSearch: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-xs text-slate-600">联网搜索（提升时效性，增加时延）</span>
        </label>
      )}
      {/* 提示词优化（5.0 Lite / 4.5 / 4.0 支持） */}
      {cap.optimizePrompt && (
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">提示词优化</label>
          <div className="flex gap-1.5">
            {(["standard", ...(cap.optimizePromptFast ? ["fast" as const] : [])] as ("standard" | "fast")[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ optimizePromptMode: m })}
                className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                  value.optimizePromptMode === m
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                {m === "standard" ? "标准（高质量）" : "快速"}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* 画质（仅 gpt-image-2 支持） */}
      {cap.quality && (
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">画质</label>
          <div className="flex flex-wrap gap-1.5">
            {(["auto", "low", "medium", "high"] as const).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onChange({ quality: q })}
                className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                  (value.quality ?? "auto") === q
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                {q === "auto" ? "自动" : q}
              </button>
            ))}
          </div>
          <p className="mt-0.5 text-[10px] text-slate-400">画质越高，生成质量越好，消耗 token 越多</p>
        </div>
      )}
      {/* 返回格式 */}
      {cap.responseFormat && (
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">返回格式</label>
          <div className="flex gap-1.5">
            {(["url", "b64_json"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onChange({ responseFormat: f })}
                className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                  value.responseFormat === f
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                {f === "url" ? "URL" : "Base64"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
