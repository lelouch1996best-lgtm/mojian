"use client";

import { useEffect, useState } from "react";

/* ============================================
   墨间 - 激活页
   Electron 未激活时主进程加载 /activate
   通过 window.electronAPI（preload 注入）与主进程通信
   ============================================ */

// 笔刷 Logo，与全站品牌标识保持一致
function BrushIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 21L7.5 16.5M7.5 16.5C6 15 6 13 7.5 11.5L14 5C15.5 3.5 17.5 3.5 19 5C20.5 6.5 20.5 8.5 19 10L12.5 16.5C11 18 9 18 7.5 16.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 复制图标
function CopyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function ActivatePage() {
  const [machineId, setMachineId] = useState<string | null>(null);
  const [serial, setSerial] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // 复制按钮的瞬时反馈状态
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // 非 Electron 环境下 window.electronAPI 不存在，需提示用户在桌面端打开
    if (!window.electronAPI) {
      setError("请在桌面客户端中打开激活页");
      return;
    }
    // 拉取分组展示形式的机器码供用户抄录
    window.electronAPI
      .getDisplayMachineId()
      .then((id) => setMachineId(id))
      .catch(() => setError("获取机器码失败，请重启应用后重试"));
    // 通知主进程激活页已就绪
    window.electronAPI.activateReady();
  }, []);

  // 复制机器码到剪贴板（getDisplayMachineId 返回的分组形式原样复制）
  async function handleCopy() {
    if (!machineId) return;
    try {
      await navigator.clipboard.writeText(machineId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选中复制");
    }
  }

  // 提交序列号激活
  async function handleSubmit() {
    if (!window.electronAPI) {
      setError("请在桌面客户端中打开激活页");
      return;
    }
    // 去除换行与空格后再提交
    const cleaned = serial.replace(/\s+/g, "").trim();
    if (!cleaned) return;

    setLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.submitSerial(cleaned);
      if (res.ok) {
        // 成功时主进程会自动 loadURL 切换到主应用，前端仅需展示提示
        setSuccess(true);
      } else {
        setError(res.error || "序列号无效，请检查后重试");
      }
    } catch {
      setError("激活请求失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = serial.trim().length > 0 && !loading && !success;

  return (
    <main
      className="flex min-h-screen w-full items-center justify-center px-4 py-10"
      style={{ backgroundColor: "#FFFBEB" }}
    >
      <div className="w-full max-w-[480px]">
        {/* 品牌标识 */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warm-950 text-warm-50 shadow-cta">
            <BrushIcon size={22} />
          </div>
          <span
            className="font-serif text-[20px] font-bold text-warm-950"
            style={{ letterSpacing: "2px" }}
          >
            墨间
          </span>
        </div>

        {/* 卡片主体 */}
        <section className="rounded-card border border-warm-200 bg-white/80 p-7 shadow-card backdrop-blur-sm sm:p-9">
          {/* 标题 + 副标题 */}
          <header className="mb-7 text-center">
            <h1 className="font-serif text-[26px] font-bold text-warm-950">激活墨间</h1>
            <p className="mt-2 text-sm leading-relaxed text-warm-800">
              请输入序列号以激活应用，开启你的创作之旅
            </p>
          </header>

          {/* 机器码展示区 */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-warm-950">本机机器码</label>
            <div className="flex items-stretch gap-2">
              <div className="flex flex-1 items-center rounded-lg border border-warm-300 bg-warm-50 px-3.5 py-2.5">
                {machineId === null ? (
                  <span className="text-sm text-warm-600">获取中…</span>
                ) : (
                  <span className="select-all break-all font-mono text-sm text-warm-900">
                    {machineId}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!machineId}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-warm-300 bg-white px-3.5 py-2.5 text-sm font-medium text-warm-900 transition-colors hover:bg-warm-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CopyIcon size={16} />
                {copied ? "已复制" : "复制"}
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-warm-700">
              请将此机器码发送给开发者，用以签发与你设备绑定的序列号
            </p>
          </div>

          {/* 序列号输入框 */}
          <div className="mb-6">
            <label htmlFor="serial" className="mb-2 block text-sm font-medium text-warm-950">
              序列号
            </label>
            <textarea
              id="serial"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="eyJwc...-....-...."
              rows={3}
              spellCheck={false}
              className="w-full resize-none rounded-lg border border-warm-300 bg-white px-3.5 py-2.5 font-mono text-sm text-warm-950 placeholder:text-warm-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="mt-2 text-xs leading-relaxed text-warm-700">
              支持直接粘贴含换行的序列号，提交时会自动去除空格与换行
            </p>
          </div>

          {/* 错误提示区 */}
          {error && (
            <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* 成功提示区 */}
          {success && (
            <div className="mb-5 rounded-lg border border-brand-400/40 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-400">
              激活成功，正在进入应用…
            </div>
          )}

          {/* 激活按钮（主 CTA：深墨色背景 + 浅色文字） */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-warm-950 px-5 py-3 text-base font-medium text-warm-50 shadow-cta transition-colors hover:bg-warm-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-warm-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                正在激活…
              </>
            ) : (
              "激活"
            )}
          </button>
        </section>

        {/* 底部说明 */}
        <p className="mt-6 text-center text-xs text-warm-700">
          遇到问题？请将机器码与报错信息反馈给开发者
        </p>
      </div>
    </main>
  );
}
