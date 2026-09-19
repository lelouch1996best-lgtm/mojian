export const runtime = "nodejs";

/** 本地 ComfyUI 模型列表代理：并行 GET {baseUrl}/object_info/{UNETLoader,CLIPLoader,VAELoader} */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const baseUrl = (searchParams.get("baseUrl") ?? "").replace(/\/+$/, "");
  if (!baseUrl) return Response.json({ error: "缺少 baseUrl" }, { status: 400 });

  // ComfyUI /object_info/{Node} 响应结构为 {NodeName: {input: {required: {字段: [[选项...], ...]}}}}，
  // 需先按节点名解包再取字段，否则解析失败会静默返回空列表
  const pick = (resp: Record<string, unknown> | undefined, nodeName: string, key: string): string[] => {
    const inner = resp?.[nodeName] as Record<string, unknown> | undefined;
    const input = inner?.input as { required?: Record<string, unknown> } | undefined;
    const v = input?.required?.[key];
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
    // LoRA 列表单独拉取：优先 LoraLoaderBypassModelOnly（加速模式用），失败回退标准 LoraLoader，再失败返回空
    let lora: string[] = [];
    try {
      const r = await fetch(`${baseUrl}/object_info/LoraLoaderBypassModelOnly`);
      if (r.ok) lora = pick(await r.json(), "LoraLoaderBypassModelOnly", "lora_name");
    } catch {
      /* ignore */
    }
    if (!lora.length) {
      try {
        const r = await fetch(`${baseUrl}/object_info/LoraLoader`);
        if (r.ok) lora = pick(await r.json(), "LoraLoader", "lora_name");
      } catch {
        /* ignore */
      }
    }
    return Response.json({
      unet: pick(unet, "UNETLoader", "unet_name"),
      clip: pick(clip, "CLIPLoader", "clip_name"),
      vae: pick(vae, "VAELoader", "vae_name"),
      lora,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `拉取模型列表失败：${msg}` }, { status: 502 });
  }
}
