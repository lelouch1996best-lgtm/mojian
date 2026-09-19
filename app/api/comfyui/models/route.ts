export const runtime = "nodejs";

/** 本地 ComfyUI 模型列表代理：并行 GET {baseUrl}/object_info/{UNETLoader,CLIPLoader,VAELoader} */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const baseUrl = (searchParams.get("baseUrl") ?? "").replace(/\/+$/, "");
  if (!baseUrl) return Response.json({ error: "缺少 baseUrl" }, { status: 400 });

  const pick = (node: Record<string, unknown> | undefined, key: string): string[] => {
    const input = (node as { input?: Record<string, unknown> } | undefined)?.input;
    const required = (input as { required?: Record<string, unknown> } | undefined)?.required;
    const v = (required as Record<string, unknown> | undefined)?.[key];
    return Array.isArray(v) && Array.isArray(v[0]) ? (v[0] as string[]) : [];
  };

  try {
    const [unet, clip, vae] = await Promise.all(
      ["UNETLoader", "CLIPLoader", "VAELoader"].map((n) =>
        fetch(`${baseUrl}/object_info/${n}`).then((r) => {
          if (!r.ok) throw new Error(`object_info/${n} 返回 HTTP ${r.status}`);
          return r.json();
        })
      )
    );
    return Response.json({
      unet: pick(unet, "unet_name"),
      clip: pick(clip, "clip_name"),
      vae: pick(vae, "vae_name"),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `拉取模型列表失败：${msg}` }, { status: 502 });
  }
}
