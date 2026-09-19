"use client";

import { useCallback, useRef, useState } from "react";

/** 发起冷却时长：提交结束（成功/失败）后按钮保持禁用 1s，防连点 */
const COOLDOWN_MS = 1000;

/**
 * 小工具「发起任务」防呆 hook：
 * - submitting：提交进行中（按钮禁用，文案「提交中…」）
 * - cooldown：提交结束后 1s 冷却（按钮仍禁用）
 * - run(fn)：包装提交函数，结束（无论成败）后自动进入冷却，1s 后恢复
 */
export function useTaskSubmit() {
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setSubmitting(true);
    try {
      await fn();
    } finally {
      setSubmitting(false);
      setCooldown(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCooldown(false), COOLDOWN_MS);
    }
  }, []);

  return { submitting, cooldown, disabled: submitting || cooldown, run };
}
