import { transferToQiniu } from "@/lib/qiniu-transfer";
import type { QiniuSettings } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: {
    sourceUrl: string;
    settings: QiniuSettings;
    prefix?: string; // 可选，七牛 key 前缀，默认 "ai-script/assets"
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const { sourceUrl, settings, prefix = "ai-script/assets" } = body;
  if (!sourceUrl || !settings.accessKey || !settings.secretKey || !settings.bucket || !settings.domain) {
    return Response.json(
      { error: "缺少必要参数（sourceUrl / settings）" },
      { status: 400 }
    );
  }

  try {
    const { url, key } = await transferToQiniu(settings, sourceUrl, prefix);
    return Response.json({
      url,
      key,
      bucket: settings.bucket,
      region: settings.region,
    });
  } catch (e) {
    return Response.json(
      { error: (e as Error).message },
      { status: 502 }
    );
  }
}
