import { getImageTaskCenter, type RegisterImageTaskInput } from "@/lib/image-task-center";
import { validateAuth, authError } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/image-tasks?ids=a,b,c — 批量查询任务状态（前端订阅用）
 * POST /api/image-tasks — attach 存量任务（幂等注册，服务端接管轮询）
 */

export async function GET(req: Request) {
  if (!validateAuth(req)) return authError();
  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const center = getImageTaskCenter();
  center.ensureRunning();
  return Response.json({ tasks: center.getTasks(ids) });
}

export async function POST(req: Request) {
  if (!validateAuth(req)) return authError();
  let body: Partial<RegisterImageTaskInput>;
  try {
    body = (await req.json()) as Partial<RegisterImageTaskInput>;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body.jobId || !body.provider || !body.apiKey || !body.baseURL) {
    return Response.json(
      { error: "缺少必要参数（jobId / provider / apiKey / baseURL）" },
      { status: 400 }
    );
  }

  const center = getImageTaskCenter();
  center.ensureRunning();
  const task = center.registerTask({
    jobId: body.jobId,
    provider: body.provider,
    apiKey: body.apiKey,
    baseURL: body.baseURL,
    model: body.model,
    cosPrefix: body.cosPrefix,
  });
  return Response.json({ task });
}
