import { getToolTaskCenter, type RegisterToolTaskInput } from "@/lib/tool-task-center";
import { validateAuth, authError } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/tool-tasks - 任务列表（created_at 降序，status=active 查进行中；GET 内部惰性恢复轮询）
 * POST /api/tool-tasks - 注册任务（工具页提交上游成功后调用，服务端接管轮询）
 * DELETE /api/tool-tasks - 批量删除；ids 为空时清空全部
 */

const ALLOWED_SOURCE = new Set(["runninghub", "comfyui"]);
const ALLOWED_MEDIA = new Set(["image", "video"]);

export async function GET(request: Request) {
  if (!validateAuth(request)) return authError();
  const center = getToolTaskCenter();
  center.ensureRunning();

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "";
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1),
    200
  );
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

  const res = center.listTasks({ status, limit, offset });
  return Response.json(res);
}

export async function POST(request: Request) {
  if (!validateAuth(request)) return authError();
  let body: Partial<RegisterToolTaskInput>;
  try {
    body = (await request.json()) as Partial<RegisterToolTaskInput>;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const source = String(body?.source ?? "");
  const mediaType = String(body?.mediaType ?? "");
  if (!body?.toolId || !body?.toolName || !ALLOWED_SOURCE.has(source) || !ALLOWED_MEDIA.has(mediaType)) {
    return Response.json({ error: "参数无效（toolId / toolName / source / mediaType）" }, { status: 400 });
  }
  if (typeof body.upstreamTaskId !== "string" || !body.upstreamTaskId) {
    return Response.json({ error: "参数无效（upstreamTaskId）" }, { status: 400 });
  }
  if (source === "comfyui" && !body.baseUrl) {
    return Response.json({ error: "comfyui 任务缺少 baseUrl" }, { status: 400 });
  }

  const center = getToolTaskCenter();
  const task = center.registerTask({
    toolId: body.toolId,
    toolName: body.toolName,
    source: source as RegisterToolTaskInput["source"],
    mediaType: mediaType as "image" | "video",
    title: body.title,
    prompt: body.prompt,
    upstreamTaskId: body.upstreamTaskId,
    baseUrl: body.baseUrl,
  });
  return Response.json({ task });
}

export async function DELETE(request: Request) {
  if (!validateAuth(request)) return authError();
  let ids: string[] = [];
  try {
    const body = await request.json();
    ids = Array.isArray(body?.ids)
      ? body.ids.filter((x: unknown) => typeof x === "string")
      : [];
  } catch {
    return Response.json({ error: "请求体无效" }, { status: 400 });
  }
  const deleted = getToolTaskCenter().deleteTasks(ids);
  return Response.json({ ok: true, deleted });
}
