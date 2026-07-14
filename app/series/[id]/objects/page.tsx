"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Button from "@/components/ui/Button";
import { getSeries, saveSeries } from "@/lib/storage";
import { emptyObjectProfile } from "@/lib/object-settings";
import { debounce, uuid } from "@/lib/utils";
import { generateImage, getImageSettings, DEFAULT_ASSET_IMAGE_CONFIG } from "@/lib/image-client";
import { getImageModels, getDefaultModelValue, type ModelEntry } from "@/lib/model-presets";
import { getAssetTemplate } from "@/lib/style-settings";
import { getCosSettings, isCosConfigured, uploadRefBase64 } from "@/lib/cos-client";
import { ImageGenerationDialog } from "@/components/ImageGenerationDialog";
import type { AssetImageConfig, ImageGenSettings, ObjectProfile, Series } from "@/lib/types";
import { ObjectCard } from "./ObjectCard";

export default function ObjectSettingsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const seriesId = params.id;

  const [series, setSeries] = useState<Series | null>(null);
  const [objects, setObjects] = useState<ObjectProfile[]>([]);
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
    setObjects((s.objectSettings ?? []).map((o) => ({ ...o })));
  }, [seriesId]);

  useEffect(() => { refresh(); }, [refresh]);

  // 自动保存：防抖持久化 objects 变化
  const seriesRef = useRef<Series | null>(null);
  seriesRef.current = series;
  const skipPersistRef = useRef(true);

  const persist = useCallback(
    debounce(async (objs: ObjectProfile[]) => {
      const s = seriesRef.current;
      if (!s) return;
      const valid = objs.filter((o) => o.name.trim());
      const updated: Series = { ...s, objectSettings: valid };
      await saveSeries(updated);
      seriesRef.current = updated;
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 1500);
    }, 500),
    []
  );

  useEffect(() => {
    if (skipPersistRef.current) {
      if (objects.length > 0 || seriesRef.current) skipPersistRef.current = false;
      return;
    }
    persist(objects);
  }, [objects, persist]);

  const grouped = useMemo(() => {
    const map = new Map<string, ObjectProfile[]>();
    for (const o of objects) {
      const gid = o.objectId || o.id;
      const arr = map.get(gid);
      if (arr) arr.push(o);
      else map.set(gid, [o]);
    }
    const groups = Array.from(map.values());
    groups.forEach((g) => g.sort((a, b) => (b.version ?? 1) - (a.version ?? 1)));
    return groups;
  }, [objects]);

  function updateField(id: string, field: keyof ObjectProfile, value: string) {
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, [field]: value } : o)));
  }

  function handleAdd() {
    const newObj: ObjectProfile = {
      ...emptyObjectProfile(), id: uuid(), objectId: uuid(), version: 1, versionLabel: "v1",
    };
    setObjects((prev) => [...prev, newObj]);
    setExpandedIds((prev) => new Set(prev).add(newObj.id));
  }

  function handleAddVersion(objId: string) {
    const source = objects.find((o) => o.id === objId);
    if (!source) return;
    const sameGroup = objects.filter((o) => (o.objectId || o.id) === (source.objectId || source.id));
    const maxVersion = sameGroup.reduce((max, o) => Math.max(max, o.version ?? 1), 0);
    const newVersion: ObjectProfile = {
      ...source, id: uuid(), objectId: source.objectId || source.id,
      version: maxVersion + 1, versionLabel: `v${maxVersion + 1}`,
    };
    setObjects((prev) => [...prev, newVersion]);
    setExpandedIds((prev) => new Set(prev).add(newVersion.id));
  }

  function handleDelete(id: string) {
    if (!confirm("确定删除该物品版本？")) return;
    setObjects((prev) => prev.filter((o) => o.id !== id));
    setExpandedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  /** 打开图片生成弹框（先做必要校验） */
  async function openGenerateImageDialog(obj: ObjectProfile) {
    if (!imageConfigured) {
      setError("未配置图片生成 API，请先在「设置」中配置");
      return;
    }
    setError(null);
    const template = await getAssetTemplate("object", series?.styleSettings ?? null);
    setStyleTemplate(template);
    const prompt = obj.appearance.trim() || obj.name.trim();
    setGenInitialPrompt(prompt);
    setGenTargetId(obj.id);
    setRefImages(obj.referenceImages ?? []);
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
      const url = await uploadRefBase64(base64, `ref-obj-${genTargetId ?? "asset"}-${Date.now()}`);
      urls.push(url);
    }
    return urls;
  }

  /** 参考图变更：更新 refImages 状态并同步到物品设定数据（触发自动保存） */
  function handleRefImagesChange(newImages: string[]) {
    setRefImages(newImages);
    if (genTargetId) {
      setObjects((prev) => prev.map((o) =>
        o.id === genTargetId ? { ...o, referenceImages: newImages } : o
      ));
    }
  }

  /** 为物品生成图片（提示词 + 可选参考图，由弹框确认传入） */
  async function handleGenerateImage(
    obj: ObjectProfile,
    params: { prompt: string; images: string[]; config: AssetImageConfig }
  ) {
    setGeneratingImageIds((prev) => new Set(prev).add(obj.id));
    try {
      const { prompt, images, config } = params;
      const result = await generateImage(prompt, config, images.length > 0 ? images : undefined, imageModels);
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
                prefix: "ai-script/objects",
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

      const updated = objects.map((o) => (o.id === obj.id ? { ...o, imageUrl } : o));
      setObjects(updated);
      if (series) {
        const updatedSeries = { ...series, objectSettings: updated };
        await saveSeries(updatedSeries);
        seriesRef.current = updatedSeries;
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
      }
    } catch (e) {
      setError(`「${obj.name}」图片生成失败：${(e as Error).message}`);
    } finally {
      setGeneratingImageIds((prev) => { const n = new Set(prev); n.delete(obj.id); return n; });
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function expandAll() { setExpandedIds(new Set(objects.map((o) => o.id))); }
  function collapseAll() { setExpandedIds(new Set()); }

  /** 上传本地图片作为物品形象图（转 base64 后调用 COS 上传 API） */
  async function handleUploadImage(obj: ObjectProfile, file: File) {
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
    setUploadingImageIds((prev) => new Set(prev).add(obj.id));
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
      const updated = objects.map((o) => (o.id === obj.id ? { ...o, imageUrl: data.url } : o));
      setObjects(updated);
      if (series) {
        const updatedSeries = { ...series, objectSettings: updated };
        await saveSeries(updatedSeries);
        seriesRef.current = updatedSeries;
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
      }
    } catch (e) {
      setError(`「${obj.name}」图片上传失败：${(e as Error).message}`);
    } finally {
      setUploadingImageIds((prev) => { const n = new Set(prev); n.delete(obj.id); return n; });
    }
  }

  function handleBack() {
    router.push(`/series/${seriesId}`);
  }

  if (notFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-slate-500">
        <p>未找到该企划</p>
        <Button onClick={() => router.push("/home")}>返回首页</Button>
      </main>
    );
  }
  if (!series) {
    return <main className="flex min-h-screen items-center justify-center text-slate-400">加载中…</main>;
  }

  const validCount = objects.filter((o) => o.name.trim()).length;
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
            <h1 className="text-lg font-semibold text-slate-800">物品设定</h1>
            <p className="text-xs text-slate-400">{series.title || "未命名企划"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedHint && <span className="text-xs text-emerald-600">已保存 ✓</span>}
        </div>
      </header>

      <div className="mb-5 rounded-md bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">
        物品设定是整个故事宇宙中物品的档案（武器、道具、载具等）。同一物品可以有多个版本（如不同形态/等级）。系统在扩写和分镜生成时默认使用最新版本。也可以在资产准备中，把物品资产卡片提取为物品设定。
      </div>

      {!imageConfigured && (
        <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          图片生成 API 尚未配置。请前往「设置」页面配置图片生成 API。
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {objects.length > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            共 {groupCount} 个物品 · {validCount} 条记录
          </span>
          <div className="flex gap-2">
            <button onClick={expandAll} className="text-xs text-slate-500 hover:text-brand-500">全部展开</button>
            <span className="text-slate-300">|</span>
            <button onClick={collapseAll} className="text-xs text-slate-500 hover:text-brand-500">全部收起</button>
          </div>
        </div>
      )}

      {objects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/50 py-20 text-center">
          <div className="mb-3 text-4xl opacity-30">📦</div>
          <p className="mb-1 text-sm text-slate-500">还没有物品设定</p>
          <p className="mb-4 text-xs text-slate-400">点击下方按钮添加物品，或在资产准备中提取</p>
          <Button size="sm" onClick={handleAdd}>+ 添加物品</Button>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => {
            const latest = group[0];
            const gid = latest.objectId || latest.id;
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
                  {group.map((obj) => (
                    <ObjectCard key={obj.id} object={obj} isLatest={obj.id === latest.id}
                      expanded={expandedIds.has(obj.id)} onToggle={() => toggleExpand(obj.id)}
                      onUpdate={(field, value) => updateField(obj.id, field, value)}
                      onDelete={() => handleDelete(obj.id)}
                      onGenerateImage={() => openGenerateImageDialog(obj)}
                      isGenerating={generatingImageIds.has(obj.id)}
                      onUploadImage={(file) => handleUploadImage(obj, file)}
                      isUploading={uploadingImageIds.has(obj.id)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {objects.length > 0 && (
        <button onClick={handleAdd}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 bg-white/40 py-3 text-sm text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-500">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          添加物品
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
          const target = objects.find((o) => o.id === genTargetId);
          if (target) void handleGenerateImage(target, params);
        }}
      />
    </main>
  );
}
