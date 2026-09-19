export const runtime = "nodejs";

/** 本地 ComfyUI 图片上传代理：POST {baseUrl}/upload/image（multipart 透传） */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "请求体不是合法 multipart" }, { status: 400 });
  }
  const baseUrl = String(form.get("baseUrl") ?? "").replace(/\/+$/, "");
  const file = form.get("image");
  if (!baseUrl || !(file instanceof File)) {
    return Response.json({ error: "缺少 baseUrl 或 image" }, { status: 400 });
  }
  const upstreamForm = new FormData();
  upstreamForm.append("image", file, file.name);
  upstreamForm.append("overwrite", "true");
  upstreamForm.append("type", "input");
  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/upload/image`, { method: "POST", body: upstreamForm });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `无法连接本地 ComfyUI：${msg}` }, { status: 502 });
  }
  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    return Response.json(
      { error: `上传失败（${upstream.status}）：${errText.slice(0, 300)}` },
      { status: 502 }
    );
  }
  const data = await upstream.json();
  return Response.json({
    name: data?.name ?? "",
    subfolder: data?.subfolder ?? "",
    type: data?.type ?? "input",
  });
}
