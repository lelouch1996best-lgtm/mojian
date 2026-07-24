"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Button from "@/components/ui/Button";
import { useConfirm, useErrorDialog } from "@/components/ui/ConfirmDialog";
import { getSeries, saveSeries, recordMediaAsset } from "@/lib/storage";
import { emptyObjectProfile, isObjectProfileValid } from "@/lib/object-settings";
import { debounce, uuid, AUTOSAVE_DEBOUNCE_MS } from "@/lib/utils";
import { useUnloadPersist } from "@/lib/use-unload-persist";
import { generateImage, getImageSettings, DEFAULT_ASSET_IMAGE_CONFIG, getDefaultAssetImageConfig, resumeImageGeneration, getAllConfiguredImageModels } from "@/lib/image-client";
import { type ModelOption } from "@/lib/model-presets";
import { getAssetTemplate, getAssetReferenceImage } from "@/lib/style-settings";
import { isCosConfigured, transferAsset, uploadBase64, uploadRefBase64 } from "@/lib/cos-client";
import { ImageGenerationDialog } from "@/components/ImageGenerationDialog";
import { AppearanceGenerateDialog } from "@/components/AppearanceGenerateDialog";
import { getSettings as getLlmSettings } from "@/lib/llm-client";
import type { AssetImageConfig, ObjectProfile, Series } from "@/lib/types";
import { ObjectCard } from "./ObjectCard";

export default function ObjectSettingsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const seriesId = params.id;
  const confirm = useConfirm();
  const showError = useErrorDialog();

  const [series, setSeries] = useState<Series | null>(null);
  const [objects, setObjects] = useState<ObjectProfile[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [savedHint, setSavedHint] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set());
  const [uploadingImageIds, setUploadingImageIds] = useState<Set<string>>(new Set());
  const [imageConfigured, setImageConfigured] = useState(false);
  const [cosConfigured, setCosConfigured] = useState(false);
  const [imageConfig, setImageConfig] = useState<AssetImageConfig>(DEFAULT_ASSET_IMAGE_CONFIG);
  // 所有「已配置 API Key」图片供应商的全部模型（聚合，供模型选择弹框使用）
  const [imageOptions, setImageOptions] = useState<ModelOption[]>([]);
  const [genTargetId, setGenTargetId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [genInitialPrompt, setGenInitialPrompt] = useState("");
  const [styleTemplate, setStyleTemplate] = useState<string | null>(null);
  const [templateReferenceImage, setTemplateReferenceImage] = useState<string | null>(null);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [appearanceDialogOpen, setAppearanceDialogOpen] = useState(false);
  const [appearanceDialogTargetId, setAppearanceDialogTargetId] = useState<string | null>(null);
  const [appearanceDialogInitialPrompt, setAppearanceDialogInitialPrompt] = useState("");

  useEffect(() => {
    (async () => {
      const s = await getImageSettings();
      setImageConfigured(!!s?.apiKey);
      setImageOptions(await getAllConfiguredImageModels());
      // 弹框初始参数 = 用户自定义默认生成参数（已含默认模型 + 所属供应商）
      const defaultCfg = await getDefaultAssetImageConfig();
      setImageConfig({ ...defaultCfg });
    })();
    isCosConfigured().then(setCosConfigured);
    getLlmSettings().then((s) => setLlmConfigured(!!s?.apiKey));
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
      const valid = objs.filter((o) => isObjectProfileValid(o));
      const updated: Series = { ...s, objectSettings: valid };
      await saveSeries(updated);
      seriesRef.current = updated;
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 1500);
    }, AUTOSAVE_DEBOUNCE_MS),
    []
  );

  useEffect(() => {
    if (skipPersistRef.current) {
      if (objects.length > 0 || seriesRef.current) skipPersistRef.current = false;
      return;
    }
    persist(objects);
  }, [objects, persist]);

  // 组件级 AbortController：卸载（切路由/刷新）时取消所有进行中的图片生成轮询，
  // 避免孤儿轮询与重新挂载后的恢复轮询产生重复。
  // 同步初始化（而非在 useEffect 中创建），确保首次渲染即可向 generateImage 传递 signal。
  const abortRef = useRef<AbortController | null>(null);
  if (abortRef.current === null) abortRef.current = new AbortController();
  useEffect(() => {
    const ac = abortRef.current!;
    return () => ac.abort();
  }, []);

  // 始终指向最新 objects，供恢复轮询的异步回调读取最新状态做去重/已完成判断，
  // 避免闭包捕获过期数据导致重复处理或漏处理。
  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  // 卸载兜底落盘：刷新/关闭走 beforeunload，SPA 路由离开走组件卸载 cleanup，
  // 防止 1500ms 防抖未触发导致进行中的图片任务状态（imageTaskId）丢失。
  useUnloadPersist(() => {
    const s = seriesRef.current;
    if (!s) return null;
    const valid = objectsRef.current.filter((o) => isObjectProfileValid(o));
    return { ...s, objectSettings: valid };
  }, "/api/data/series");

  // 切页/刷新回来后，立即根据 imageTaskId 恢复生图中占位（不等待 imageConfigured/imageOptions 加载完成）。
  // 仅以 imageTaskId 为准（重新生成时旧 imageUrl 仍在，但不阻断占位恢复）。
  const didRestoreLoading = useRef(false);
  useEffect(() => {
    if (didRestoreLoading.current) return;
    didRestoreLoading.current = true;
    const ids = objects.filter((o) => o.imageTaskId).map((o) => o.id);
    if (ids.length > 0) {
      setGeneratingImageIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects]);

  // 进入页面时，恢复未完成的生图轮询（刷新/切页后任务不丢失）。
  const resumeRef = useRef(false);
  useEffect(() => {
    if (resumeRef.current) return;
    if (!imageConfigured || imageOptions.length === 0) return;
    resumeRef.current = true;
    const signal = abortRef.current?.signal;

    for (const obj of objects) {
      if (!obj.imageTaskId) continue;
      // 进入恢复时立即显示占位（重新生成场景下旧 imageUrl 仍在，但 imageTaskId 表明有进行中任务）
      setGeneratingImageIds((prev) => new Set(prev).add(obj.id));

      resumeImageGeneration(obj.imageTaskId, obj.imageTaskProvider, undefined, signal)
        .then(async (result) => {
          // 读取最新状态做去重判断（避免闭包捕获过期数据；切页期间原轮询可能已完成并写入新 imageUrl）
          const latest = objectsRef.current.find((o) => o.id === obj.id);
          if (latest && latest.imageTaskId !== obj.imageTaskId) {
            // taskId 已变化（被新的生成覆盖），不处理这次结果
            return;
          }
          let imageUrl = result.imageUrl;
          // 转存到存储（Seedream 图片 URL 只有 24h 有效期）；使用 isCosConfigured() 避免 cosConfigured 状态闭包过期
          try {
            if (await isCosConfigured()) {
              const { url } = await transferAsset(imageUrl, "ai-script/objects");
              imageUrl = url;
            }
          } catch (e) {
            console.error("物品转存失败：", (e as Error).message);
          }
          const updated = objectsRef.current.map((o) => (o.id === obj.id ? { ...o, imageUrl, imageTaskId: undefined } : o));
          setObjects(updated);
          const s = seriesRef.current;
          if (s) {
            const updatedSeries = { ...s, objectSettings: updated };
            await saveSeries(updatedSeries);
            seriesRef.current = updatedSeries;
            setSavedHint(true);
            setTimeout(() => setSavedHint(false), 1500);
            void recordMediaAsset({
              mediaType: "image",
              url: imageUrl,
              entityType: "object",
              entityName: obj.name || "未命名物品",
              source: "profile-object",
              seriesId: s.id,
              seriesTitle: s.title,
            });
          }
        })
        .catch((err) => {
          // 切页/卸载导致轮询被取消时，保留 imageTaskId 以便下次重新挂载后继续恢复；
          // 仅在真实失败（API 错误/超时）时清除 imageTaskId 并提示错误。
          // 不依赖共享 signal.aborted：卸载后并发恢复轮询共享 signal 会被 abort，真实失败也会被误判为取消而静默。
          const isAborted = (err as Error)?.name === "AbortError" || (err as Error)?.message === "已取消";
          if (!isAborted) {
            setObjects((prev) => prev.map((o) => (o.id === obj.id ? { ...o, imageTaskId: undefined } : o)));
            showError(`「${obj.name}」图片生成失败：${(err as Error).message}`);
          }
        })
        .finally(() => {
          setGeneratingImageIds((prev) => { const n = new Set(prev); n.delete(obj.id); return n; });
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageConfigured, imageOptions]);

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
      imageUrl: undefined, referenceImages: [], imageTaskId: undefined,
    };
    setObjects((prev) => [...prev, newVersion]);
    setExpandedIds((prev) => new Set(prev).add(newVersion.id));
  }

  async function handleDelete(id: string) {
    if (!await confirm({
      message: "确定删除该物品版本？",
      confirmText: "删除",
    })) return;
    setObjects((prev) => prev.filter((o) => o.id !== id));
    setExpandedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  /** 打开图片生成弹框（先做必要校验） */
  async function openGenerateImageDialog(obj: ObjectProfile) {
    if (!imageConfigured) {
      showError("未配置图片生成 API，请先在「设置」中配置");
      return;
    }
    const template = await getAssetTemplate("object", series?.styleSettings ?? null);
    setStyleTemplate(template);
    const refImage = await getAssetReferenceImage("object", series?.styleSettings ?? null);
    setTemplateReferenceImage(refImage ?? null);
    const prompt = obj.appearance.trim() || obj.name.trim();
    setGenInitialPrompt(prompt);
    setGenTargetId(obj.id);
    setRefImages(obj.referenceImages ?? []);
    setConfigOpen(true);
  }

  /** 构建随机外观生成的提示词（含外观本身，便于在简短外观基础上扩展） */
  function buildAppearancePrompt(obj: ObjectProfile): string {
    const lines: string[] = [];
    if (obj.name.trim()) lines.push(`名称：${obj.name.trim()}`);
    if (obj.category.trim()) lines.push(`分类：${obj.category.trim()}`);
    if (obj.appearance.trim()) lines.push(`外观：${obj.appearance.trim()}`);
    if (obj.purpose.trim()) lines.push(`功能用途：${obj.purpose.trim()}`);
    if (obj.origin.trim()) lines.push(`来源背景：${obj.origin.trim()}`);
    return lines.join("\n");
  }

  /** 打开随机外观生成弹框（先做必要校验） */
  function openRandomAppearanceDialog(obj: ObjectProfile) {
    if (!llmConfigured) {
      showError("未配置 LLM，请先在「设置」中配置大模型 API");
      return;
    }
    if (!obj.category.trim()) {
      showError("请先填写「分类」后再随机生成外观");
      return;
    }
    setAppearanceDialogInitialPrompt(buildAppearancePrompt(obj));
    setAppearanceDialogTargetId(obj.id);
    setAppearanceDialogOpen(true);
  }

  /** 应用随机生成的外观结果到卡片 */
  function handleApplyAppearance(result: string) {
    if (!appearanceDialogTargetId) return;
    setObjects((prev) => prev.map((o) => (o.id === appearanceDialogTargetId ? { ...o, appearance: result } : o)));
    setAppearanceDialogOpen(false);
    setAppearanceDialogTargetId(null);
  }

  /** 上传参考图文件到存储，返回 URL 列表（存储未配置时回退 base64） */
  async function handleUploadRefFiles(files: File[]): Promise<string[]> {
    if (!(await isCosConfigured())) {
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
      const targetName = objects.find((o) => o.id === genTargetId)?.name;
      void recordMediaAsset({
        mediaType: "image",
        url,
        entityType: "other",
        entityName: targetName ? `${targetName} - 参考图` : f.name,
        source: "manual",
        seriesId: series?.id ?? "",
        seriesTitle: series?.title ?? "",
      });
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
      const result = await generateImage(prompt, config, images.length > 0 ? images : undefined, async (jobId) => {
        // 异步任务创建后立即持久化 jobId + imageTaskProvider（切页/刷新后可恢复轮询，按 provider 路由凭证）
        // 用 keepalive fetch 同步落库，避免 SPA 路由切换取消普通 fetch 导致 jobId 丢失
        const updated = objectsRef.current.map((o) => (o.id === obj.id ? { ...o, imageTaskId: jobId, imageTaskProvider: config.provider } : o));
        setObjects(updated);
        const s = seriesRef.current;
        if (s) {
          const updatedSeries = { ...s, objectSettings: updated };
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

      // 自动转存到存储（Seedream URL 24h 过期）
      if (await isCosConfigured()) {
        try {
          const { url } = await transferAsset(imageUrl, "ai-script/objects");
          imageUrl = url;
        } catch {
          // 转存失败不阻断流程，保留原始 URL
        }
      }

      const updated = objectsRef.current.map((o) => (o.id === obj.id ? { ...o, imageUrl, imageTaskId: undefined } : o));
      setObjects(updated);
      if (series) {
        const updatedSeries = { ...series, objectSettings: updated };
        await saveSeries(updatedSeries);
        seriesRef.current = updatedSeries;
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
        void recordMediaAsset({
          mediaType: "image",
          url: imageUrl,
          entityType: "object",
          entityName: obj.name || "未命名物品",
          prompt,
          source: "profile-object",
          seriesId: series.id,
          seriesTitle: series.title,
        });
      }
    } catch (e) {
      // 切页/卸载导致轮询被取消时，保留 imageTaskId 以便重新挂载后恢复；
      // 仅在真实失败（API 错误/超时）时清除 imageTaskId 并提示错误。
      // 不依赖共享 signal.aborted：卸载后所有并发轮询共享 signal 会被 abort，真实失败也会被误判为取消而静默。
      const isAborted = (e as Error)?.name === "AbortError" || (e as Error)?.message === "已取消";
      if (!isAborted) {
        setObjects((prev) => prev.map((o) => (o.id === obj.id ? { ...o, imageTaskId: undefined } : o)));
        showError(`「${obj.name}」图片生成失败：${(e as Error).message}`);
      }
    } finally {
      setGeneratingImageIds((prev) => { const n = new Set(prev); n.delete(obj.id); return n; });
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function expandAll() { setExpandedIds(new Set(objects.map((o) => o.id))); }
  function collapseAll() { setExpandedIds(new Set()); }

  /** 上传本地图片作为物品形象图（转 base64 后调用存储上传 API） */
  async function handleUploadImage(obj: ObjectProfile, file: File) {
    if (!(await isCosConfigured())) {
      showError("未配置对象存储（COS），无法上传图片，请先在「设置」中配置");
      return;
    }
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];
    if (!allowed.includes(file.type)) {
      showError(`不支持的图片格式：${file.type || "未知"}，仅支持 png/jpg/webp/gif/bmp`);
      return;
    }
    setUploadingImageIds((prev) => new Set(prev).add(obj.id));
    try {
      // 读取文件为 base64 data URL
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(file);
      });
      const { url } = await uploadBase64(base64, file.name);
      const updated = objects.map((o) => (o.id === obj.id ? { ...o, imageUrl: url } : o));
      setObjects(updated);
      if (series) {
        const updatedSeries = { ...series, objectSettings: updated };
        await saveSeries(updatedSeries);
        seriesRef.current = updatedSeries;
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
        void recordMediaAsset({
          mediaType: "image",
          url,
          entityType: "object",
          entityName: obj.name || "未命名物品",
          source: "profile-object",
          seriesId: series.id,
          seriesTitle: series.title,
        });
      }
    } catch (e) {
      showError(`「${obj.name}」图片上传失败：${(e as Error).message}`);
    } finally {
      setUploadingImageIds((prev) => { const n = new Set(prev); n.delete(obj.id); return n; });
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
                      isUploading={uploadingImageIds.has(obj.id)}
                      onRandomAppearance={() => openRandomAppearanceDialog(obj)} />
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
        templateReferenceImage={templateReferenceImage ?? undefined}
        initialConfig={imageConfig}
        images={refImages}
        onImagesChange={handleRefImagesChange}
        onUploadFiles={handleUploadRefFiles}
        imageOptions={imageOptions}
        loading={genTargetId ? generatingImageIds.has(genTargetId) : false}
        onConfirm={(params) => {
          setImageConfig(params.config);
          setConfigOpen(false);
          const target = objects.find((o) => o.id === genTargetId);
          if (target) void handleGenerateImage(target, params);
        }}
      />

      <AppearanceGenerateDialog
        open={appearanceDialogOpen}
        onClose={() => { setAppearanceDialogOpen(false); setAppearanceDialogTargetId(null); }}
        onApply={handleApplyAppearance}
        initialPrompt={appearanceDialogInitialPrompt}
        entityType="object"
      />
    </main>
  );
}
