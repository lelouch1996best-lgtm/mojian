import { getImageTaskCenter } from "@/lib/image-task-center";
import { validateAuth, authError } from "@/lib/auth";

export const runtime = "nodejs";

/** POST /api/image-tasks/[jobId]/retry — 失败/过期任务重试 */
export async function POST(
  req: Request,
  { params }: { params: { jobId: string } }
) {
  if (!validateAuth(req)) return authError();
  const center = getImageTaskCenter();
  center.ensureRunning();
  const task = center.retryTask(params.jobId);
  if (!task) {
    return Response.json({ error: "任务不存在" }, { status: 404 });
  }
  return Response.json({ task });
}
