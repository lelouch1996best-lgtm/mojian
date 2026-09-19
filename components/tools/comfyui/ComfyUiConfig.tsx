"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import {
  checkComfyUiStatus,
  getComfyUiSettings,
  saveComfyUiSettings,
  COMFYUI_DEFAULT_BASE_URL,
} from "@/lib/comfyui-client";

/**
 * 本地 ComfyUI 连接配置卡片：页面内直接查看/修改服务地址 + 在线状态探测。
 * 所有本地直连小工具共用（settings key="comfyui"）。
 */
export default function ComfyUiConfig({
  onStatusChange,
}: {
  /** 配置加载完成及状态探测后回调（online 为 null 表示尚未探测完成） */
  onStatusChange: (online: boolean | null, baseUrl: string) => void;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [online, setOnline] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [checking, setChecking] = useState(false);

  const probe = useCallback(async (url: string) => {
    setChecking(true);
    try {
      const r = await checkComfyUiStatus(url);
      setOnline(r.online);
      setVersion(r.version);
      onStatusChange(r.online, url);
    } finally {
      setChecking(false);
    }
  }, [onStatusChange]);

  useEffect(() => {
    let alive = true;
    void getComfyUiSettings().then((s) => {
      if (!alive) return;
      setBaseUrl(s.baseUrl);
      void probe(s.baseUrl);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    const v = input.trim().replace(/\/+$/, "");
    if (!v) return;
    await saveComfyUiSettings({ baseUrl: v });
    setBaseUrl(v);
    setInput("");
    setEditing(false);
    void probe(v);
  }

  return (
    <div
      className={`rounded-lg border p-4 ${
        online ? "border-slate-200 bg-slate-50/60" : "border-amber-medium/40 bg-amber-light/40"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-serif text-base font-semibold text-slate-800">
          本地 ComfyUI 连接
          <span
            className={`ml-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-normal ${
              online === null
                ? "bg-slate-200 text-slate-600"
                : online
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-red-100 text-red-700"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                online === null ? "bg-slate-400" : online ? "bg-emerald-500" : "bg-red-500"
              }`}
            />
            {online === null ? "检测中" : online ? `在线${version ? ` · v${version}` : ""}` : "离线"}
          </span>
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={checking || !baseUrl} onClick={() => void probe(baseUrl)}>
            {checking ? "检测中…" : "刷新"}
          </Button>
          {!editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setInput(baseUrl);
                setEditing(true);
              }}
            >
              修改
            </Button>
          )}
        </div>
      </div>
      {editing ? (
        <div className="mt-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`ComfyUI 服务地址，默认 ${COMFYUI_DEFAULT_BASE_URL}`}
            className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          />
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" onClick={handleSave} disabled={!input.trim()}>
              保存
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-600">
          服务地址：<code className="rounded border border-slate-200 bg-white px-2 py-0.5 text-sm">{baseUrl}</code>
        </p>
      )}
      {online === false && (
        <p className="mt-2 text-sm text-amber-dark">
          未检测到本地 ComfyUI：请先启动本机 ComfyUI（默认 {COMFYUI_DEFAULT_BASE_URL}）再使用本工具。地址仅保存在本机数据库。
        </p>
      )}
    </div>
  );
}
