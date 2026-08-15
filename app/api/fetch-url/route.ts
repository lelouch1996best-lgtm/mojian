import { getDb } from "@/lib/db";
import { validateAuth, authError } from "@/lib/auth";
import type { LLMSettings, LLMMessage } from "@/lib/types";
import { VIDEO_PROVIDER_PRESETS } from "@/lib/video-client";
import type { ModelEntry } from "@/lib/model-presets";

export const runtime = "nodejs";

interface FetchUrlBody {
  url: string;
  provider: string;
  models: Array<{ value: string; label?: string; resolutions: string[] }>;
}

/** 从 setting 读取 LLM 配置（服务端直接读 db，绕过相对路径 fetch） */
async function getLLMSettings(): Promise<LLMSettings | null> {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("llm") as
    | { value: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as LLMSettings;
  } catch {
    return null;
  }
}

/** 清洗 HTML 为纯文本 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: Request) {
  if (!validateAuth(req)) return authError();

  let body: FetchUrlBody;
  try {
    body = (await req.json()) as FetchUrlBody;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const { url, provider, models } = body;
  if (!url || typeof url !== "string") {
    return Response.json({ error: "缺少 url 参数" }, { status: 400 });
  }

  // 校验 URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!/^https?:$/.test(parsedUrl.protocol)) {
      return Response.json({ error: "URL 必须以 http:// 或 https:// 开头" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "URL 格式无效" }, { status: 400 });
  }

  // 1. 抓取网页
  let html: string;
  try {
    const res = await fetch(parsedUrl.href, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      return Response.json({ error: `抓取失败：HTTP ${res.status}` }, { status: 502 });
    }
    html = await res.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("abort") || msg.includes("timeout")) {
      return Response.json({ error: "抓取超时（15秒）" }, { status: 504 });
    }
    return Response.json({ error: `抓取失败：${msg}` }, { status: 502 });
  }

  // 2. 清洗 HTML
  const content = htmlToText(html).slice(0, 20000);

  // 3. 读取 LLM 配置
  const llmSettings = await getLLMSettings();
  if (!llmSettings || !llmSettings.apiKey || !llmSettings.baseURL) {
    return Response.json({ error: "未配置 LLM，请先在右上角设置中配置" }, { status: 400 });
  }

  // 4. 构造 LLM prompt
  const providerLabel = VIDEO_PROVIDER_PRESETS[provider as keyof typeof VIDEO_PROVIDER_PRESETS]?.label ?? provider;
  const modelList = models
    .map((m) => `- ${m.value} (${m.label ?? m.value})：支持分辨率 ${m.resolutions.join("/")}`)
    .join("\n");

  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "你是价格信息提取助手。从网页内容中提取视频生成模型的价格，换算为每秒单价（元/秒）。只输出 JSON，不要任何其他文字。",
    },
    {
      role: "user",
      content: `从以下网页内容中提取视频生成模型的价格信息。

供应商：${providerLabel}
该供应商的模型及支持分辨率：
${modelList}

请输出 JSON，key 为模型 value，value 为 { 分辨率: 每秒单价(元) }：
{"doubao-seedance-2.0": {"480p": 0.77, "720p": 1.65}, "wan2.7": {"720P": 0.84}}

规则：
- 美元价按 1 USD = 7 CNY 换算
- 按条计费（如 5秒=¥4.95）换算为每秒单价（4.95/5=0.99）
- 未找到价格的模型/分辨率不要包含在结果中
- 只输出 JSON 对象

网页内容（来自 ${parsedUrl.href}）：
${content}`,
    },
  ];

  // 5. 调用上游 LLM（直接 fetch，不走相对路径 /api/llm）
  const base = llmSettings.baseURL.replace(/\/+$/, "");
  const upstreamUrl = `${base}/chat/completions`;
  const upstreamPayload = {
    model: llmSettings.model,
    messages,
    stream: false,
    temperature: 0.2,
    response_format: { type: "json_object" },
  };

  let llmContent: string;
  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llmSettings.apiKey}`,
      },
      body: JSON.stringify(upstreamPayload),
      signal: AbortSignal.timeout(60000),
    });
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      return Response.json(
        { error: `LLM 调用失败（${upstream.status}）：${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }
    const data = await upstream.json();
    llmContent = data.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `LLM 调用异常：${msg}` }, { status: 502 });
  }

  // 6. 解析 LLM 返回的 JSON
  let prices: Record<string, Record<string, number>>;
  try {
    prices = JSON.parse(llmContent);
  } catch {
    return Response.json(
      { error: "LLM 返回的内容不是合法 JSON，无法解析", raw: llmContent.slice(0, 500) },
      { status: 502 }
    );
  }

  // 7. 校验并规范化结构
  const cleaned: Record<string, Record<string, number>> = {};
  for (const [modelValue, resMap] of Object.entries(prices)) {
    if (typeof resMap !== "object" || resMap === null) continue;
    const entry: Record<string, number> = {};
    for (const [res, price] of Object.entries(resMap)) {
      const num = Number(price);
      if (Number.isFinite(num) && num > 0) {
        entry[res] = Math.round(num * 100) / 100; // 保留 2 位
      }
    }
    if (Object.keys(entry).length > 0) {
      cleaned[modelValue] = entry;
    }
  }

  return Response.json({ prices: cleaned });
}
