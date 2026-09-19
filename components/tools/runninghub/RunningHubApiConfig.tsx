"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import {
  getRunningHubSettings,
  saveRunningHubSettings,
  RUNNINGHUB_BASE_URL,
} from "@/lib/runninghub-client";

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

/**
 * RunningHub API 配置卡片：页面内直接查看与修改（掩码显示 + 显示/隐藏 + 内联修改）。
 * 所有 RunningHub 小工具共用（settings key="runninghub"）。
 */
export default function RunningHubApiConfig({
  appId,
  onConfiguredChange,
}: {
  /** 当前工具使用的 AI 应用 ID，仅用于展示 */
  appId: string;
  /** 首次加载及保存后回调配置状态 */
  onConfiguredChange: (configured: boolean) => void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    let alive = true;
    void getRunningHubSettings().then((s) => {
      if (!alive) return;
      setConfigured(!!s?.apiKey);
      setApiKey(s?.apiKey ?? "");
      if (!s?.apiKey) setEditingKey(true);
      onConfiguredChange(!!s?.apiKey);
    });
    return () => {
      alive = false;
    };
  }, [onConfiguredChange]);

  async function handleSaveKey() {
    const v = apiKeyInput.trim();
    if (!v) return;
    await saveRunningHubSettings({ apiKey: v });
    setApiKey(v);
    setApiKeyInput("");
    setEditingKey(false);
    setConfigured(true);
    onConfiguredChange(true);
  }

  if (configured === null) {
    return <div className="py-6 text-center text-sm text-slate-400">加载中…</div>;
  }

  return (
    <div
      className={`rounded-lg border p-4 ${
        configured ? "border-slate-200 bg-slate-50/60" : "border-amber-medium/40 bg-amber-light/40"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-serif text-base font-semibold text-slate-800">
          {configured ? "API 配置（RunningHub）" : "需要 RunningHub API Key"}
        </p>
        {configured && !editingKey && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setApiKeyInput("");
              setEditingKey(true);
            }}
          >
            修改
          </Button>
        )}
      </div>
      {!configured && (
        <p className="mt-1 text-sm text-slate-600">
          本工具基于 RunningHub 云端 ComfyUI 工作流，首次使用需填写 API Key。
          前往 runninghub.ai 账号后台获取 32 位 API Key。
        </p>
      )}
      {editingKey ? (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <input
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              type={showKey ? "text" : "password"}
              placeholder="32 位 API Key"
              className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
            <Button variant="ghost" size="sm" onClick={() => setShowKey((v) => !v)}>
              {showKey ? "隐藏" : "显示"}
            </Button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" onClick={handleSaveKey} disabled={!apiKeyInput.trim()}>
              保存
            </Button>
            {configured && (
              <Button variant="ghost" size="sm" onClick={() => setEditingKey(false)}>
                取消
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600">API Key：</span>
          <code className="rounded border border-slate-200 bg-white px-2 py-0.5 text-sm text-slate-700">
            {showKey ? apiKey : maskKey(apiKey)}
          </code>
          <Button variant="ghost" size="sm" onClick={() => setShowKey((v) => !v)}>
            {showKey ? "隐藏" : "显示"}
          </Button>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-400">
        接口地址 {RUNNINGHUB_BASE_URL} · 应用 ID {appId} · Key 仅保存在本机数据库，用于本地后端转发请求时添加鉴权头。
      </p>
    </div>
  );
}
