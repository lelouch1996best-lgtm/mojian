import type { VideoGenSettings } from "@/lib/types";

export const runtime = "nodejs";

/**
 * 取消视频生成任务。
 * - ark / ark-plan / custom：DELETE /api/v3/contents/generations/tasks/{id}，仅排队中（queued）的任务可取消。
 * - apimart：无取消接口，本地取消（直接返回成功，不调用上游）。
 */
export async function POST(req: Request) {
  let body: { provider?: VideoGenSettings["provider"]; apiKey: string; baseURL: string; taskId: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body.baseURL || !body.apiKey || !body.taskId) {
    return Response.json(
      { error: "缺少必要参数（baseURL / apiKey / taskId）" },
      { status: 400 }
    );
  }

  // APIMart 无取消接口：本地取消，不调用上游
  if (body.provider === "apimart") {
    return Response.json({ ok: true });
  }

  const base = body.baseURL.replace(/\/+$/, "");
  const url = `${base}/contents/generations/tasks/${encodeURIComponent(body.taskId)}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${body.apiKey}`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `请求上游失败：${msg}` }, { status: 502 });
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    let friendly = errText.slice(0, 500);
    try {
      const errJson = JSON.parse(errText);
      friendly = errJson?.error?.message ?? friendly;
    } catch {
      /* keep raw */
    }
    return Response.json(
      { error: `${upstream.status === 404 ? "任务不存在或已过期" : "上游错误"}（${upstream.status}）：${friendly}` },
      { status: upstream.status || 502 }
    );
  }

  return Response.json({ ok: true });
}
