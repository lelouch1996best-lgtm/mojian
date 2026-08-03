"use client";

import { useState } from "react";

interface ImageUrlPastePanelProps {
  /** 确认回调，传入校验通过后的图片 URL */
  onConfirm: (url: string) => void;
  /** 取消回调 */
  onCancel: () => void;
}

/** 图片区底部内联的「粘贴 URL」输入面板，校验 http(s):// 前缀 */
export default function ImageUrlPastePanel({ onConfirm, onCancel }: ImageUrlPastePanelProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  function handleConfirm() {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("请填写图片URL");
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      setError("URL 需以 http(s):// 开头");
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <div className="absolute inset-x-2 bottom-2 z-20 rounded-lg border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur">
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          type="text"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="粘贴图片URL（建议 COS 持久地址）"
          className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <button
          type="button"
          onClick={handleConfirm}
          className="rounded-md bg-brand-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-600"
        >
          确认
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-50"
        >
          取消
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
