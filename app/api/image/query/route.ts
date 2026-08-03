import type {
  ImageQueryProxyRequest,
  ImageQueryProxyResponse,
} from "@/lib/types";
import { queryUpstreamImageTask } from "@/lib/image-upstream";

export const runtime = "nodejs";

/**
 * 查询异步图片任务状态（单次）。
 * 状态归一化逻辑在 lib/image-upstream.ts（与服务端任务中心共用）。
 * 瞬态错误（网络/5xx/非JSON/未知状态）返回 200 + running，由调用方继续轮询；
 * 仅上游明确失败时才返回 failed。
 */
export async function POST(req: Request) {
  let body: ImageQueryProxyRequest;
  try {
    body = (await req.json()) as ImageQueryProxyRequest;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body.baseURL || !body.apiKey || !body.jobId) {
    return Response.json(
      { error: "缺少必要参数（baseURL / apiKey / jobId）" },
      { status: 400 }
    );
  }

  const result = await queryUpstreamImageTask(
    body.provider,
    { apiKey: body.apiKey, baseURL: body.baseURL },
    body.jobId
  );

  const response: ImageQueryProxyResponse = {
    status: result.status,
    imageUrl: result.imageUrl,
    error: result.error,
  };
  return Response.json(response);
}
