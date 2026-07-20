"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { getSeries, saveSeries } from "@/lib/storage";
import { emptySceneProfile } from "@/lib/scene-settings";
import { debounce, uuid } from "@/lib/utils";
import { generateImage, getImageSettings, DEFAULT_ASSET_IMAGE_CONFIG, resumeImageGeneration } from "@/lib/image-client";
import { getImageModels, getDefaultModelValue, type ModelEntry } from "@/lib/model-presets";
import { getAssetTemplate } from "@/lib/style-settings";
import { getCosSettings, isCosConfigured, uploadRefBase64 } from "@/lib/cos-client";
import { ImageGenerationDialog } from "@/components/ImageGenerationDialog";
import type { AssetImageConfig, ImageGenSettings, SceneProfile, Series } from "@/lib/types";
import { SceneCard } from "./SceneCard";

export default function SceneSettingsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const seriesId = params.id;
  const confirm = useConfirm();

  const [series, setSeries] = useState<Series | null>(null);
  const [scenes, setScenes] = useState<SceneProfile[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [savedHint, setSavedHint] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set());
  const [uploadingImageIds, setUploadingImageIds] = useState<Set<string>>(new Set());
  const [imageConfigured, setImageConfigured] = useState(false);
  const [cosConfigured, setCosConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageConfig, setImageConfig] = useState<AssetImageConfig>(DEFAULT_ASSET_IMAGE_CONFIG);
  const [imageProvider, setImageProvider] = useState<ImageGenSettings["provider"]>("ark");
  const [imageModels, setImageModels] = useState<ModelEntry[]>([]);
  const [genTargetId, setGenTargetId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [genInitialPrompt, setGenInitialPrompt] = useState("");
  const [styleTemplate, setStyleTemplate] = useState<string | null>(null);
  const [refImages, setRefImages] = useState<string[]>([]);

  useEffect(() => {
    getImageSettings().then(async (s) => {
      setImageConfigured(!!s?.apiKey);
      const provider = s?.provider ?? "ark";
      if (s?.provider) setImageProvider(s.provider);
      const models = await getImageModels(provider);
      setImageModels(models);
      const defaultModel = getDefaultModelValue(models);
      if (defaultModel) {
        setImageConfig((prev) => ({ ...prev, model: defaultModel }));
      }
    });
    isCosConfigured().then(setCosConfigured);
  }, []);

  const refresh = useCallback(async () => {
    if (!seriesId) return;
    const s = await getSeries(seriesId);
    if (!s) { setNotFound(true); return; }
    setSeries(s);
    setScenes((s.sceneSettings ?? []).map((o) => ({ ...o })));
  }, [seriesId]);

  useEffect(() => { refresh(); }, [refresh]);

  // 自动保存：防抖持久化 scenes 变化
  const seriesRef = useRef<Series | null>(null);
  seriesRef.current = series;
  const skipPersistRef = useRef(true);

  const persist = useCallback(
    debounce(async (scs: SceneProfile[]) => {
      const s = seriesRef.current;
      if (!s) return;
      const valid = scs.filter((o) => o.name.trim());
      const updated: Series = { ...s, sceneSettings: valid };
      await saveSeries(updated);
      seriesRef.current = updated;
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 1500);
    }, 500),
    []
  );

  useEffect(() => {
    if (skipPersistRef.current) {
      if (scenes.length > 0 || seriesRef.current) skipPersistRef.current = false;
      return;
    }
    persist(scenes);
  }, [scenes, persist]);

  // 组件级 AbortController：卸载（切路由/刷新）时取消所有进行中的图片生成轮询，
  // 避免孤儿轮询与重新挂载后的恢复轮询产生重复。
  // 同步初始化（而非在 useEffect 中创建），确保首次渲染即可向 generateImage 传递 signal。
  const abortRef = useRef<AbortController | null>(null);
  if (abortRef.current === null) abortRef.current = new AbortController();
  useEffect(() => {
    const ac = abortRef.current!;
    return () => ac.abort();
  }, []);

  // 始终指向最新 scenes，供恢复轮询的异步回调读取最新状态做去重/已完成判断，
  // 避免闭包捕获过期数据导致重复处理或漏处理。
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;

  // 页面卸载（切路由/刷新/关闭）时兜底保存，防止防抖 persist 未触发导致 imageTaskId 丢失
  useEffect(() => {
    const handler = () => {
      const s = seriesRef.current;
      const scs = scenesRef.current;
      if (!s) return;
      const valid = scs.filter((o) => o.name.trim());
      const updatedSeries = { ...s, sceneSettings: valid };
      fetch("/api/data/series", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_STORAGE_TOKEN ?? ""}`,
        },
        body: JSON.stringify(updatedSeries),
        keepalive: true,
      });
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // 切页/刷新回来后，立即根据 imageTaskId 恢复生图中占位（不等待 imageConfigured/imageModels 加载完成）。
  // 仅以 imageTaskId 为准（重新生成时旧 imageUrl 仍在，但不阻断占位恢复）。
  const didRestoreLoading = useRef(false);
  useEffect(() => {
    if (didRestoreLoading.current) return;
    didRestoreLoading.current = true;
    const ids = scenes.filter((o) => o.imageTaskId).map((o) => o.id);
    if (ids.length > 0) {
      setGeneratingImageIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes]);

  // 进入页面时，恢复未完成的生图轮询（刷新/切页后任务不丢失）。
  const resumeRef = useRef(false);
  useEffect(() => {
    if (resumeRef.current) return;
    if (!imageConfigured || imageModels.length === 0) return;
    resumeRef.current = true;
    const signal = abortRef.current?.signal;

    for (const sc of scenes) {
      if (!sc.imageTaskId) continue;
      // 进入恢复时立即显示占位（重新生成场景下旧 imageUrl 仍在，但 imageTaskId 表明有进行中任务）
      setGeneratingImageIds((prev) => new Set(prev).add(sc.id));

      resumeImageGeneration(sc.imageTaskId, undefined, signal)
        .then(async (result) => {
          // 读取最新状态做去重判断（避免闭包捕获过期数据；切页期间原轮询可能已完成并写入新 imageUrl）
          const latest = scenesRef.current.find((o) => o.id === sc.id);
          if (latest && latest.imageTaskId !== sc.imageTaskId) {
            // taskId 已变化（被新的生成覆盖），不处理这次结果
            return;
          }
          let imageUrl = result.imageUrl;
          // 转存到 COS（Seedream 图片 URL 只有 24h 有效期）；使用 isCosConfigured() 避免 cosConfigured 状态闭包过期
          try {
            if (await isCosConfigured()) {
              const cosSettings = await getCosSettings();
              if (cosSettings) {
                const res = await fetch("/api/cos/transfer", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    sourceUrl: imageUrl,
                    settings: cosSettings,
                    prefix: "ai-script/scenes",
                  }),
                });
                const data = await res.json();
                if (res.ok && data.url) {
                  imageUrl = data.url;
                }
              }
            }
          } catch (e) {
            console.error("场景转存 COS 失败：", (e as Error).message);
          }
          const updated = scenesRef.current.map((o) => (o.id === sc.id ? { ...o, imageUrl, imageTaskId: undefined } : o));
          setScenes(updated);
          const s = seriesRef.current;
          if (s) {
            const updatedSeries = { ...s, sceneSettings: updated };
            await saveSeries(updatedSeries);
            seriesRef.current = updatedSeries;
            setSavedHint(true);
            setTimeout(() => setSavedHint(false), 1500);
          }
        })
        .catch((err) => {
          // 切页/卸载导致轮询被取消时，保留 imageTaskId 以便下次重新挂载后继续恢复；
          // 仅在真实失败（API 错误/超时）时清除 imageTaskId 并提示错误
          const isAborted = signal?.aborted || (err as Error)?.name === "AbortError" || (err as Error)?.message === "已取消";
          if (!isAborted) {
            setScenes((prev) => prev.map((o) => (o.id === sc.id ? { ...o, imageTaskId: undefined } : o)));
            setError(`「${sc.name}」图片生成失败：${(err as Error).message}`);
          }
        })
        .finally(() => {
          setGeneratingImageIds((prev) => { const n = new Set(prev); n.delete(sc.id); return n; });
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageConfigured, imageModels]);

  const grouped = useMemo(() => {
    const map = new Map<string, SceneProfile[]>();
    for (const o of scenes) {
      const gid = o.sceneId || o.id;
      const arr = map.get(gid);
      if (arr) arr.push(o);
      else map.set(gid, [o]);
    }
    const groups = Array.from(map.values());
    groups.forEach((g) => g.sort((a, b) => (b.version ?? 1) - (a.version ?? 1)));
    return groups;
  }, [scenes]);

  function updateField(id: string, field: keyof SceneProfile, value: string) {
    setScenes((prev) => prev.map((o) => (o.id === id ? { ...o, [field]: value } : o)));
  }

  function handleAdd() {
    const newObj: SceneProfile = {
      ...emptySceneProfile(), id: uuid(), sceneId: uuid(), version: 1, versionLabel: "v1",
    };
    setScenes((prev) => [...prev, newObj]);
    setExpandedIds((prev) => new Set(prev).add(newObj.id));
  }

  function handleAddVersion(sceneId: string) {
    const source = scenes.find((o) => o.id === sceneId);
    if (!source) return;
    const sameGroup = scenes.filter((o) => (o.sceneId || o.id) === (source.sceneId || source.id));
    const maxVersion = sameGroup.reduce((max, o) => Math.max(max, o.version ?? 1), 0);
    const newVersion: SceneProfile = {
      ...source, id: uuid(), sceneId: source.sceneId || source.id,
      version: maxVersion + 1, versionLabel: `v${maxVersion + 1}`,
      imageUrl: undefined, referenceImages: [], imageTaskId: undefined,
    };
    setScenes((prev) => [...prev, newVersion]);
    setExpandedIds((prev) => new Set(prev).add(newVersion.id));
  }

  async function handleDelete(id: string) {
    if (!await confirm({
      message: "确定删除该场景版本？",
      confirmText: "删除",
    })) return;
    setScenes((prev) => prev.filter((o) => o.id !== id));
    setExpandedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  /** 打开图片生成弹框（先做必要校验） */
  async function openGenerateImageDialog(sc: SceneProfile) {
    if (!imageConfigured) {
      setError("未配置图片生成 API，请先在「设置」中配置");
      return;
    }
    setError(null);
    const template = await getAssetTemplate("scene", series?.styleSettings ?? null);
    setStyleTemplate(template);
    const prompt = sc.appearance.trim() || sc.name.trim();
    setGenInitialPrompt(prompt);
    setGenTargetId(sc.id);
    setRefImages(sc.referenceImages ?? []);
    setConfigOpen(true);
  }

  /** 上传参考图文件到 COS，返回 URL 列表（COS 未配置时回退 base64） */
  async function handleUploadRefFiles(files: File[]): Promise<string[]> {
    if (!cosConfigured) {
      return Promise.all(files.map((f) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(f);
      })));
    }
    const urls: string[] = [];
    for (const f of files) {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(f);
      });
      const url = await uploadRefBase64(base64, `ref-scene-${genTargetId ?? "asset"}-${Date.now()}`);
      urls.push(url);
    }
    return urls;
  }

  /** 参考图变更：更新 refImages 状态并同步到场景设定数据（触发自动保存） */
  function handleRefImagesChange(newImages: string[]) {
    setRefImages(newImages);
    if (genTargetId) {
      setScenes((prev) => prev.map((o) =>
        o.id === genTargetId ? { ...o, referenceImages: newImages } : o
      ));
    }
  }

  /** 为场景生成图片（提示词 + 可选参考图，由弹框确认传入） */
  async function handleGenerateImage(
    sc: SceneProfile,
    params: { prompt: string; images: string[]; config: AssetImageConfig }
  ) {
    setGeneratingImageIds((prev) => new Set(prev).add(sc.id));
    try {
      const { prompt, images, config } = params;
      const result = await generateImage(prompt, config, images.length > 0 ? images : undefined, imageModels, async (jobId) => {
        // 异步任务创建后立即持久化 jobId（切页/刷新后可恢复轮询）
        // 用 keepalive fetch 同步落库，避免 SPA 路由切换取消普通 fetch 导致 jobId 丢失
        const updated = scenesRef.current.map((o) => (o.id === sc.id ? { ...o, imageTaskId: jobId } : o));
        setScenes(updated);
        const s = seriesRef.current;
        if (s) {
          const updatedSeries = { ...s, sceneSettings: updated };
          seriesRef.current = updatedSeries;
          fetch("/api/data/series", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.NEXT_PUBLIC_STORAGE_TOKEN ?? ""}`,
            },
            body: JSON.stringify(updatedSeries),
            keepalive: true,
          });
        }
      }, abortRef.current?.signal);
      let imageUrl = result.imageUrl;

      // 自动转存到 COS（Seedream URL 24h 过期）
      if (cosConfigured) {
        const cosSettings = await getCosSettings();
        if (cosSettings) {
          try {
            const res = await fetch("/api/cos/transfer", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sourceUrl: imageUrl,
                settings: cosSettings,
                prefix: "ai-script/scenes",
              }),
            });
            const data = await res.json();
            if (res.ok && data.url) {
              imageUrl = data.url;
            }
          } catch {
            // 转存失败不阻断流程，保留原始 URL
          }
        }
      }

      const updated = scenesRef.current.map((o) => (o.id === sc.id ? { ...o, imageUrl, imageTaskId: undefined } : o));
      setScenes(updated);
      if (series) {
        const updatedSeries = { ...series, sceneSettings: updated };
        await saveSeries(updatedSeries);
        seriesRef.current = updatedSeries;
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
      }
    } catch (e) {
      // 切页/卸载导致轮询被取消时，保留 imageTaskId 以便重新挂载后恢复；
      // 仅在真实失败（API 错误/超时）时清除 imageTaskId 并提示错误
      const isAborted = abortRef.current?.signal.aborted || (e as Error)?.name === "AbortError" || (e as Error)?.message === "已取消";
      if (!isAborted) {
        setScenes((prev) => prev.map((o) => (o.id === sc.id ? { ...o, imageTaskId: undefined } : o)));
        setError(`「${sc.name}」图片生成失败：${(e as Error).message}`);
      }
    } finally {
      setGeneratingImageIds((prev) => { const n = new Set(prev); n.delete(sc.id); return n; });
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function expandAll() { setExpandedIds(new Set(scenes.map((o) => o.id))); }
  function collapseAll() { setExpandedIds(new Set()); }

  /** 上传本地图片作为场景形象图（转 base64 后调用 COS 上传 API） */
  async function handleUploadImage(sc: SceneProfile, file: File) {
    if (!cosConfigured) {
      setError("未配置对象存储（COS），无法上传图片，请先在「设置」中配置");
      return;
    }
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];
    if (!allowed.includes(file.type)) {
      setError(`不支持的图片格式：${file.type || "未知"}，仅支持 png/jpg/webp/gif/bmp`);
      return;
    }
    setError(null);
    setUploadingImageIds((prev) => new Set(prev).add(sc.id));
    try {
      const cosSettings = await getCosSettings();
      if (!cosSettings) {
        setError("无法读取 COS 配置，请先在「设置」中配置");
        return;
      }
      // 读取文件为 base64 data URL
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/cos/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64,
          fileName: file.name,
          settings: cosSettings,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || "上传失败");
      }
      const updated = scenes.map((o) => (o.id === sc.id ? { ...o, imageUrl: data.url } : o));
      setScenes(updated);
      if (series) {
        const updatedSeries = { ...series, sceneSettings: updated };
        await saveSeries(updatedSeries);
        seriesRef.current = updatedSeries;
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
      }
    } catch (e) {
      setError(`「${sc.name}」图片上传失败：${(e as Error).message}`);
    } finally {
      setUploadingImageIds((prev) => { const n = new Set(prev); n.delete(sc.id); return n; });
    }
  }

  function handleBack() {
    router.back();
  }

  if (notFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-slate-500">
        <p>未找到该企划</p>
        <Button onClick={() => router.push("/")}>返回首页</Button>
      </main>
    );
  }
  if (!series) {
    return <main className="flex min-h-screen items-center justify-center text-slate-400">加载中…</main>;
  }

  const validCount = scenes.filter((o) => o.name.trim()).length;
  const groupCount = grouped.length;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="text-slate-400 hover:text-slate-600" title="返回企划">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">场景设定</h1>
            <p className="text-xs text-slate-400">{series.title || "未命名企划"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedHint && <span className="text-xs text-emerald-600">已保存 ✓</span>}
        </div>
      </header>

      <div className="mb-5 rounded-md bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">
        场景设定是整个故事宇宙中场景的档案（室内、室外、特定地点等）。同一场景可以有多个版本（如白天/夜晚/战火后）。系统在扩写和分镜生成时默认使用最新版本。也可以在资产准备中，把场景资产卡片提取为场景设定。
      </div>

      {!imageConfigured && (
        <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          图片生成 API 尚未配置。请前往「设置」页面配置图片生成 API。
        </div>
      )}

      {scenes.length > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            共 {groupCount} 个场景 · {validCount} 条记录
          </span>
          <div className="flex gap-2">
            <button onClick={expandAll} className="text-xs text-slate-500 hover:text-brand-500">全部展开</button>
            <span className="text-slate-300">|</span>
            <button onClick={collapseAll} className="text-xs text-slate-500 hover:text-brand-500">全部收起</button>
          </div>
        </div>
      )}

      {scenes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/50 py-20 text-center">
          <div className="mb-3 text-4xl opacity-30">🏞️</div>
          <p className="mb-1 text-sm text-slate-500">还没有场景设定</p>
          <p className="mb-4 text-xs text-slate-400">点击下方按钮添加场景，或在资产准备中提取</p>
          <Button size="sm" onClick={handleAdd}>+ 添加场景</Button>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => {
            const latest = group[0];
            const gid = latest.sceneId || latest.id;
            return (
              <div key={gid} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                <div className="mb-3 flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700">{latest.name || "未命名"}</span>
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-500">{group.length} 个版本</span>
                  </div>
                  <button onClick={() => handleAddVersion(latest.id)} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    新建版本
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {group.map((sc) => (
                    <SceneCard key={sc.id} scene={sc} isLatest={sc.id === latest.id}
                      expanded={expandedIds.has(sc.id)} onToggle={() => toggleExpand(sc.id)}
                      onUpdate={(field, value) => updateField(sc.id, field, value)}
                      onDelete={() => handleDelete(sc.id)}
                      onGenerateImage={() => openGenerateImageDialog(sc)}
                      isGenerating={generatingImageIds.has(sc.id)}
                      onUploadImage={(file) => handleUploadImage(sc, file)}
                      isUploading={uploadingImageIds.has(sc.id)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {scenes.length > 0 && (
        <button onClick={handleAdd}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 bg-white/40 py-3 text-sm text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-500">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          添加场景
        </button>
      )}

      <ImageGenerationDialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        initialPrompt={genInitialPrompt}
        styleTemplate={styleTemplate ?? undefined}
        initialConfig={imageConfig}
        images={refImages}
        onImagesChange={handleRefImagesChange}
        onUploadFiles={handleUploadRefFiles}
        provider={imageProvider}
        imageModels={imageModels}
        loading={genTargetId ? generatingImageIds.has(genTargetId) : false}
        onConfirm={(params) => {
          setImageConfig(params.config);
          setConfigOpen(false);
          const target = scenes.find((o) => o.id === genTargetId);
          if (target) void handleGenerateImage(target, params);
        }}
      />

      <Modal
        open={!!error}
        onClose={() => setError(null)}
        title="出错了"
        width="max-w-sm"
        footer={
          <Button variant="danger" onClick={() => setError(null)}>
            我知道了
          </Button>
        }
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p className="pt-1 text-sm leading-relaxed text-slate-600 whitespace-pre-line">{error}</p>
        </div>
      </Modal>
    </main>
  );
}
