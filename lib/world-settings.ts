import type { WorldSettings } from "@/lib/types";
import { apiClient } from "@/lib/api-client";

const WORLD_KEY = "mojian_world_settings";
const STORAGE_MODE = process.env.NEXT_PUBLIC_STORAGE_MODE;

const DEFAULTS: WorldSettings = {
  background: "",
  theme: "",
  style: "",
};

export async function getWorldSettings(): Promise<WorldSettings> {
  if (STORAGE_MODE === "server") {
    try { return await apiClient.getSetting<WorldSettings>("world"); } catch { return { ...DEFAULTS }; }
  }
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(WORLD_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<WorldSettings>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveWorldSettings(s: WorldSettings): Promise<void> {
  if (STORAGE_MODE === "server") {
    await apiClient.saveSetting("world", s);
    return;
  }
  if (typeof window === "undefined") return;
  localStorage.setItem(WORLD_KEY, JSON.stringify(s));
}

/** 生成用于 LLM 上下文的世界设定文本片段，为空字段不输出 */
export function worldSettingsToText(s: WorldSettings): string {
  const parts: string[] = [];
  if (s.background?.trim()) parts.push(`【故事背景】\n${s.background.trim()}`);
  if (s.theme?.trim()) parts.push(`【核心主题】\n${s.theme.trim()}`);
  if (s.style?.trim()) parts.push(`【写作风格】\n${s.style.trim()}`);
  return parts.join("\n\n");
}

/** 检查是否有任何世界设定项已填写 */
export async function hasWorldSettings(): Promise<boolean> {
  const s = await getWorldSettings();
  return !!(s.background?.trim() || s.theme?.trim() || s.style?.trim());
}
