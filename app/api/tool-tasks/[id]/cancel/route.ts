import { getToolTaskCenter } from "@/lib/tool-task-center";
import { validateAuth, authError } from "@/lib/auth";

export const runtime = "nodejs";

/** POST /api/tool-tasks/[id]/cancel - 取消进行中的任务（comfyui 任务尽力中断本机执行） */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  if (!validateAuth(request)) return authError();
  const task = getToolTaskCenter().cancelTask(params.id);
  if (!task) return Response.json({ error: "任务不存在" }, { status: 404 });
  return Response.json({ task });
}
