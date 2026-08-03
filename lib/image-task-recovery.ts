import { resumeImageGeneration } from "./image-client";
import type { ImageGenSettings } from "./types";

export interface ImageTaskRecoveryEntry {
  /** 业务侧标识（实体 id / 字段名等），原样透传给回调 */
  key: string;
  jobId: string;
  provider?: ImageGenSettings["provider"];
}

export interface ImageTaskRecoveryCallbacks {
  /** 任务完成：写回 imageUrl 并清理 taskId（imageUrl 已经服务端 COS 转存，无需再转存） */
  onDone: (key: string, imageUrl: string) => void | Promise<void>;
  /** 仅真实终态失败才回调（取消/切页不回调，taskId 保留待下次恢复） */
  onFailed?: (key: string, error: string) => void;
}

/**
 * 批量恢复图片任务订阅（页面刷新/切页回来后，对带 imageTaskId 的实体统一恢复）。
 * 内部对每个任务 attach 到服务端任务中心并订阅终态；
 * "已取消"/AbortError（切页/卸载）一律静默，绝不回调 onFailed——任务在服务端继续跑，不丢。
 */
export function recoverImageTasks(
  entries: ImageTaskRecoveryEntry[],
  callbacks: ImageTaskRecoveryCallbacks,
  signal?: AbortSignal
): void {
  for (const entry of entries) {
    void resumeImageGeneration(entry.jobId, entry.provider, undefined, signal)
      .then((result) => callbacks.onDone(entry.key, result.imageUrl))
      .catch((err: unknown) => {
        const e = err as Error;
        const isAborted = e?.name === "AbortError" || e?.message === "已取消";
        if (!isAborted) {
          callbacks.onFailed?.(entry.key, e?.message ?? "图片生成失败");
        }
      });
  }
}
