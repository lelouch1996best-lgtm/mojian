"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ModelOption } from "@/lib/model-presets";

/**
 * 跨供应商模型选择器：按钮触发 + 弹框（按供应商分组 + 搜索）。
 * 用于图片/视频生成的模型选择，聚合所有「已配置 API Key」供应商的全部模型。
 * 选中后回传 (provider, model)，由调用方写入卡片/默认配置，生成时按 provider 路由凭证。
 */
export function ModelPicker({
  options,
  provider,
  model,
  onSelect,
  disabled,
  placeholder = "选择模型",
  buttonClassName = "",
  emptyText = "暂无可用模型，请先在设置中配置供应商 API Key",
}: {
  options: ModelOption[];
  provider?: string;
  model: string;
  onSelect: (provider: string, model: string) => void;
  disabled?: boolean;
  placeholder?: string;
  buttonClassName?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const current = useMemo(
    () =>
      options.find((o) => o.provider === provider && o.entry.value === model) ??
      options.find((o) => o.entry.value === model),
    [options, provider, model]
  );
  const currentLabel = current
    ? current.entry.label || current.entry.value
    : model || placeholder;

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? options.filter(
          (o) =>
            o.entry.value.toLowerCase().includes(q) ||
            (o.entry.label?.toLowerCase().includes(q) ?? false) ||
            o.providerLabel.toLowerCase().includes(q)
        )
      : options;
    const map = new Map<string, { providerLabel: string; items: ModelOption[] }>();
    for (const o of filtered) {
      if (!map.has(o.provider)) map.set(o.provider, { providerLabel: o.providerLabel, items: [] });
      map.get(o.provider)!.items.push(o);
    }
    return Array.from(map.entries()).map(([prov, g]) => ({ provider: prov, ...g }));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  function handleSelect(o: ModelOption) {
    onSelect(o.provider, o.entry.value);
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => setOpen(true)}
        className={`flex w-full items-center justify-between gap-1.5 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 transition-colors hover:border-brand-400 focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${buttonClassName}`}
        title={current ? `${current.providerLabel} · ${current.entry.value}` : placeholder}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {current && (
            <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-500">
              {current.providerLabel}
            </span>
          )}
          <span className="truncate">{currentLabel}</span>
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="shrink-0 text-slate-400">
          <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-800">选择模型</h3>
                <button
                  onClick={() => setOpen(false)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label="关闭"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="border-b border-slate-200 px-4 py-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索模型名称 / 供应商…"
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-2 py-2">
                {grouped.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-slate-400">
                    {options.length === 0 ? emptyText : "未找到匹配的模型"}
                  </p>
                ) : (
                  grouped.map((g) => (
                    <div key={g.provider} className="mb-2">
                      <div className="sticky top-0 z-10 bg-white px-2 py-1 text-[11px] font-medium text-slate-400">
                        {g.providerLabel}
                      </div>
                      {g.items.map((o) => {
                        const selected = o.provider === provider && o.entry.value === model;
                        return (
                          <button
                            key={`${o.provider}:${o.entry.value}`}
                            type="button"
                            onClick={() => handleSelect(o)}
                            className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                              selected ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            <span className="mt-0.5 shrink-0 text-brand-500">
                              {selected ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                  <path
                                    d="M5 13l4 4L19 7"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              ) : (
                                <span className="block h-3.5 w-3.5" />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">
                                {o.entry.label ? o.entry.label : o.entry.value}
                              </span>
                              <span className="block truncate text-[10px] text-slate-400">{o.entry.value}</span>
                              {o.entry.hint && (
                                <span className="mt-0.5 block truncate text-[10px] text-slate-400">{o.entry.hint}</span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
