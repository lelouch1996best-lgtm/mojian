"use client";

import { useEffect, useState } from "react";

/** 根据本地 File 生成本地预览 URL（objectURL），file 变化/卸载时自动回收 */
export function usePreviewUrl(file: File | null): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}
