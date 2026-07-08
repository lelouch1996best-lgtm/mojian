import type { LLMSettings, LLMMessage, LLMProxyRequest } from "./types";
import { apiClient } from "./api-client";

/** 预设 provider 默认值 */
export interface ProviderPreset {
  baseURL: string;
  model: string;
  label: string;
  /** API Key 前缀提示，用于输入框 placeholder */
  keyPrefix?: string;
  /** 可选模型列表，设置弹窗中会渲染为下拉选择 */
  models?: string[];
  /** 额外说明，显示在服务商按钮下方或表单提示处 */
  hint?: string;
}

export const PROVIDER_PRESETS: Record<LLMSettings["provider"], ProviderPreset> = {
  deepseek: {
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    label: "DeepSeek",
    keyPrefix: "sk-",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  glm: {
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-plus",
    label: "智谱 GLM",
    keyPrefix: "",
    models: ["glm-4-plus", "glm-4", "glm-4-flash"],
  },
  mimo: {
    baseURL: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.5-pro",
    label: "小米 MiMo（按量付费）",
    keyPrefix: "sk-",
    models: ["mimo-v2.5-pro", "mimo-v2.5"],
    hint: "按实际使用量计费，适合轻度使用。前往 platform.xiaomimimo.com 创建 API Key。",
  },
  "mimo-plan": {
    baseURL: "https://token-plan-cn.xiaomimimo.com/v1",
    model: "mimo-v2.5-pro",
    label: "小米 MiMo（Token Plan）",
    keyPrefix: "tp-",
    models: ["mimo-v2.5-pro", "mimo-v2.5"],
    hint:
      "固定订阅费、按套餐限量调用。需先在 platform.xiaomimimo.com 订阅后获取专属 Base URL 和 tp- 开头的 Key。默认中国节点，新加坡/欧洲用户请改 Base URL 为 token-plan-sgp / token-plan-ams。",
  },
  custom: { baseURL: "", model: "", label: "自定义" },
};

export async function getSettings(): Promise<LLMSettings | null> {
  try { return await apiClient.getSetting<LLMSettings>("llm"); } catch { return null; }
}

export async function saveSettings(s: LLMSettings): Promise<void> {
  const normalized: LLMSettings = { ...s, baseURL: s.baseURL.replace(/\/+$/, "") };
  await apiClient.saveSetting("llm", normalized);
}

interface CallOptions {
  temperature?: number;
  responseFormat?: "json_object" | "text";
  signal?: AbortSignal;
}

async function buildBody(
  messages: LLMMessage[],
  stream: boolean,
  options?: CallOptions
): Promise<LLMProxyRequest> {
  const settings = await getSettings();
  if (!settings) throw new Error("未配置 LLM，请先在右上角设置中填写");
  return {
    baseURL: settings.baseURL,
    apiKey: settings.apiKey,
    model: settings.model,
    messages,
    stream,
    temperature: options?.temperature,
    responseFormat: options?.responseFormat,
  };
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** 流式调用，yield 每个文本片段 */
export async function* streamLLM(
  messages: LLMMessage[],
  options?: CallOptions
): AsyncGenerator<string, void, unknown> {
  const body = await buildBody(messages, true, options);
  const res = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(await parseError(res));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) yield chunk;
  }
}

/** 非流式调用，返回完整文本 */
export async function callLLM(
  messages: LLMMessage[],
  options?: CallOptions
): Promise<string> {
  const body = await buildBody(messages, false, options);
  const res = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const data = await res.json();
  return (data.content as string) ?? "";
}

/** 测试连接 */
export async function testConnection(s: LLMSettings): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseURL: s.baseURL.replace(/\/+$/, ""),
        apiKey: s.apiKey,
        model: s.model,
        messages: [{ role: "user", content: "你好" }],
        stream: false,
      } satisfies LLMProxyRequest),
    });
    if (res.ok) return { ok: true, message: "连接成功" };
    const err = await parseError(res);
    return { ok: false, message: `连接失败：${err}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `连接失败：${msg}` };
  }
}
