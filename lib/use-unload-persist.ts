import { useEffect, useRef } from "react";

export const STORAGE_TOKEN = process.env.NEXT_PUBLIC_STORAGE_TOKEN ?? "";

type Endpoint = "/api/data/episodes" | "/api/data/series";

/**
 * 组件卸载时兜底落盘，覆盖两类场景：
 * 1) 刷新 / 关闭标签页 —— beforeunload（keepalive fetch，页面拆毁时仍能发出）
 * 2) App Router 内路由跳转（如点返回箭头离开本页）—— 组件卸载 cleanup
 *
 * 与 1500ms 防抖 persist 互补：防抖依赖静置，离开页面时往往没到点，
 * 若不兜底则进行中任务的状态（imageTaskId / videoTaskId 等）会丢失，
 * 导致回来后无法恢复轮询。
 *
 * @param getPayload 返回最新待保存数据（在卸载/beforeunload 时读取，故需读实时值）
 * @param endpoint 落盘端点
 */
export function useUnloadPersist<T>(getPayload: () => T | null | undefined, endpoint: Endpoint) {
  const payloadRef = useRef<T | null | undefined>(undefined);
  payloadRef.current = getPayload();

  useEffect(() => {
    const flush = () => {
      const data = payloadRef.current;
      if (data == null) return;
      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${STORAGE_TOKEN}`,
        },
        body: JSON.stringify(data),
        keepalive: true,
      }).catch(() => {});
    };

    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [endpoint]);
}
