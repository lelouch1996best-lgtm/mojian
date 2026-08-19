"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * 管理 AbortController 生命周期，支持按 key 区分多个并发任务。
 * 卸载（切页/路由离开/刷新）时自动 abort 所有进行中的任务。
 *
 * 用于统一 LLM 调用、视频轮询等可中止异步任务的停止交互：
 *   const task = useAbortableTask();
 *   const signal = task.start(shot.id);     // 启动/重启某任务
 *   await callLLM(messages, { signal });
 *   task.stop(shot.id);                      // 用户点击停止
 *   task.clear(shot.id);                     // 正常结束后清理
 */
export function useAbortableTask() {
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllersRef.current.forEach((c) => c.abort());
      controllersRef.current.clear();
    };
  }, []);

  /** 启动一个任务并返回 signal；若同 key 已有任务，先 abort 旧任务。 */
  const start = useCallback((key: string): AbortSignal => {
    controllersRef.current.get(key)?.abort();
    const controller = new AbortController();
    controllersRef.current.set(key, controller);
    return controller.signal;
  }, []);

  /** 中止指定 key 的任务并移除记录。 */
  const stop = useCallback((key: string) => {
    controllersRef.current.get(key)?.abort();
    controllersRef.current.delete(key);
  }, []);

  /** 中止所有进行中的任务。 */
  const stopAll = useCallback(() => {
    controllersRef.current.forEach((c) => c.abort());
    controllersRef.current.clear();
  }, []);

  /** 任务正常结束后清理记录（不触发 abort）。 */
  const clear = useCallback((key: string) => {
    controllersRef.current.delete(key);
  }, []);

  return { start, stop, stopAll, clear, mountedRef };
}
