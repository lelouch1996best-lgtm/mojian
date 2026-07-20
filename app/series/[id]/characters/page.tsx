"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { getSeries, saveSeries } from "@/lib/storage";
import { emptyCharacterProfile } from "@/lib/character-settings";
import { debounce, uuid } from "@/lib/utils";
import { generateImage, getImageSettings, DEFAULT_ASSET_IMAGE_CONFIG, resumeImageGeneration } from "@/lib/image-client";
import { getImageModels, getAudioModels, getDefaultModelValue, type ModelEntry } from "@/lib/model-presets";
import { isAudioConfigured, generateVoice, type VoiceGenParams } from "@/lib/audio-client";
import { getAssetTemplate } from "@/lib/style-settings";
import { getCosSettings, isCosConfigured, uploadRefBase64, uploadRefFile } from "@/lib/cos-client";
import { ImageGenerationDialog } from "@/components/ImageGenerationDialog";
import { VoiceGenerationDialog } from "@/components/VoiceGenerationDialog";
import AssetPicker, { type PickedAssetItem } from "@/components/AssetPicker";
import type { AssetImageConfig, CharacterProfile, ImageGenSettings, Series } from "@/lib/types";
import { CharacterCard } from "./CharacterCard";

export default function CharacterSettingsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const seriesId = params.id;
  const confirm = useConfirm();

  const [series, setSeries] = useState<Series | null>(null);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
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
  const [audioModels, setAudioModels] = useState<ModelEntry[]>([]);
  const [audioConfigured, setAudioConfigured] = useState(false);
  const [generatingVoiceIds, setGeneratingVoiceIds] = useState<Set<string>>(new Set());
  const [uploadingVoiceIds, setUploadingVoiceIds] = useState<Set<string>>(new Set());
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  const [voiceTargetId, setVoiceTargetId] = useState<string | null>(null);
  const [voiceAssetPickerOpen, setVoiceAssetPickerOpen] = useState(false);
  const [voiceAssetTargetId, setVoiceAssetTargetId] = useState<string | null>(null);

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
    isAudioConfigured().then(setAudioConfigured);
    getAudioModels("mimo").then(setAudioModels);
  }, []);

  const refresh = useCallback(async () => {
    if (!seriesId) return;
    const s = await getSeries(seriesId);
    if (!s) { setNotFound(true); return; }
    setSeries(s);
    setCharacters((s.characterSettings ?? []).map((c) => ({ ...c })));
  }, [seriesId]);

  useEffect(() => { refresh(); }, [refresh]);

  // 自动保存：防抖持久化 characters 变化
  const seriesRef = useRef<Series | null>(null);
  seriesRef.current = series;
  const skipPersistRef = useRef(true);

  const persist = useCallback(
    debounce(async (chars: CharacterProfile[]) => {
      const s = seriesRef.current;
      if (!s) return;
      const valid = chars.filter((c) => c.name.trim());
      const updated: Series = { ...s, characterSettings: valid };
      await saveSeries(updated);
      seriesRef.current = updated;
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 1500);
    }, 500),
    []
  );

  useEffect(() => {
    if (skipPersistRef.current) {
      if (characters.length > 0 || seriesRef.current) skipPersistRef.current = false;
      return;
    }
    persist(characters);
  }, [characters, persist]);

  // 组件级 AbortController：卸载（切路由/刷新）时取消所有进行中的图片生成轮询，
  // 避免孤儿轮询与重新挂载后的恢复轮询产生重复。
  // 同步初始化（而非在 useEffect 中创建），确保首次渲染即可向 generateImage 传递 signal。
  const abortRef = useRef<AbortController | null>(null);
  if (abortRef.current === null) abortRef.current = new AbortController();
  useEffect(() => {
    const ac = abortRef.current!;
    return () => ac.abort();
  }, []);

  // 始终指向最新 characters，供恢复轮询的异步回调读取最新状态做去重/已完成判断，
  // 避免闭包捕获过期数据导致重复处理或漏处理。
  const charactersRef = useRef(characters);
  charactersRef.current = characters;

  // 页面卸载（切路由/刷新/关闭）时兜底保存，防止防抖 persist 未触发导致 imageTaskId 丢失
  useEffect(() => {
    const handler = () => {
      const s = seriesRef.current;
      const chars = charactersRef.current;
      if (!s) return;
      const valid = chars.filter((c) => c.name.trim());
      const updatedSeries = { ...s, characterSettings: valid };
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
    const ids = characters.filter((c) => c.imageTaskId).map((c) => c.id);
    if (ids.length > 0) {
      setGeneratingImageIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters]);

  // 进入页面时，恢复未完成的生图轮询（刷新/切页后任务不丢失）。
  const resumeRef = useRef(false);
  useEffect(() => {
    if (resumeRef.current) return;
    if (!imageConfigured || imageModels.length === 0) return;
    resumeRef.current = true;
    const signal = abortRef.current?.signal;

    for (const char of characters) {
      if (!char.imageTaskId) continue;
      // 进入恢复时立即显示占位（重新生成场景下旧 imageUrl 仍在，但 imageTaskId 表明有进行中任务）
      setGeneratingImageIds((prev) => new Set(prev).add(char.id));

      resumeImageGeneration(char.imageTaskId, undefined, signal)
        .then(async (result) => {
          // 读取最新状态做去重判断（避免闭包捕获过期数据；切页期间原轮询可能已完成并写入新 imageUrl）
          const latest = charactersRef.current.find((c) => c.id === char.id);
          if (latest && latest.imageTaskId !== char.imageTaskId) {
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
                    prefix: "ai-script/characters",
                  }),
                });
                const data = await res.json();
                if (res.ok && data.url) {
                  imageUrl = data.url;
                }
              }
            }
          } catch (e) {
            console.error("人物转存 COS 失败：", (e as Error).message);
          }
          const updated = charactersRef.current.map((c) => (c.id === char.id ? { ...c, imageUrl, imageTaskId: undefined } : c));
          setCharacters(updated);
          const s = seriesRef.current;
          if (s) {
            const updatedSeries = { ...s, characterSettings: updated };
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
            setCharacters((prev) => prev.map((c) => (c.id === char.id ? { ...c, imageTaskId: undefined } : c)));
            setError(`「${char.name}」图片生成失败：${(err as Error).message}`);
          }
        })
        .finally(() => {
          setGeneratingImageIds((prev) => { const n = new Set(prev); n.delete(char.id); return n; });
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageConfigured, imageModels]);

  const grouped = useMemo(() => {
    const map = new Map<string, CharacterProfile[]>();
    for (const c of characters) {
      const gid = c.characterId || c.id;
      const arr = map.get(gid);
      if (arr) arr.push(c);
      else map.set(gid, [c]);
    }
    const groups = Array.from(map.values());
    groups.forEach((g) => g.sort((a, b) => (b.version ?? 1) - (a.version ?? 1)));
    return groups;
  }, [characters]);

  function updateField(id: string, field: keyof CharacterProfile, value: string) {
    setCharacters((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  }

  function handleAdd() {
    const newChar: CharacterProfile = {
      ...emptyCharacterProfile(), id: uuid(), characterId: uuid(), version: 1, versionLabel: "v1",
    };
    setCharacters((prev) => [...prev, newChar]);
    setExpandedIds((prev) => new Set(prev).add(newChar.id));
  }

  function handleAddVersion(charId: string) {
    const source = characters.find((c) => c.id === charId);
    if (!source) return;
    const sameGroup = characters.filter((c) => (c.characterId || c.id) === (source.characterId || source.id));
    const maxVersion = sameGroup.reduce((max, c) => Math.max(max, c.version ?? 1), 0);
    const newVersion: CharacterProfile = {
      ...source, id: uuid(), characterId: source.characterId || source.id,
      version: maxVersion + 1, versionLabel: `v${maxVersion + 1}`,
      imageUrl: undefined, referenceImages: [], imageTaskId: undefined,
    };
    setCharacters((prev) => [...prev, newVersion]);
    setExpandedIds((prev) => new Set(prev).add(newVersion.id));
  }

  async function handleDelete(id: string) {
    if (!await confirm({
      message: "确定删除该人物版本？",
      confirmText: "删除",
    })) return;
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    setExpandedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  /** 打开图片生成弹框（先做必要校验） */
  async function openGenerateImageDialog(char: CharacterProfile) {
    if (!imageConfigured) {
      setError("未配置图片生成 API，请先在「设置」中配置");
      return;
    }
    setError(null);
    const template = await getAssetTemplate("character", series?.styleSettings ?? null);
    setStyleTemplate(template);
    const prompt = char.appearance.trim() || char.name.trim();
    setGenInitialPrompt(prompt);
    setGenTargetId(char.id);
    setRefImages(char.referenceImages ?? []);
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
      const url = await uploadRefBase64(base64, `ref-char-${genTargetId ?? "asset"}-${Date.now()}`);
      urls.push(url);
    }
    return urls;
  }

  /** 参考图变更：更新 refImages 状态并同步到人物设定数据（触发自动保存） */
  function handleRefImagesChange(newImages: string[]) {
    setRefImages(newImages);
    if (genTargetId) {
      setCharacters((prev) => prev.map((c) =>
        c.id === genTargetId ? { ...c, referenceImages: newImages } : c
      ));
    }
  }

  /** 为人物生成图片（提示词 + 可选参考图，由弹框确认传入） */
  async function handleGenerateImage(
    char: CharacterProfile,
    params: { prompt: string; images: string[]; config: AssetImageConfig }
  ) {
    setGeneratingImageIds((prev) => new Set(prev).add(char.id));
    try {
      const { prompt, images, config } = params;
      const result = await generateImage(prompt, config, images.length > 0 ? images : undefined, imageModels, async (jobId) => {
        // 异步任务创建后立即持久化 jobId（切页/刷新后可恢复轮询）
        // 用 keepalive fetch 同步落库，避免 SPA 路由切换取消普通 fetch 导致 jobId 丢失
        const updated = charactersRef.current.map((c) => (c.id === char.id ? { ...c, imageTaskId: jobId } : c));
        setCharacters(updated);
        const s = seriesRef.current;
        if (s) {
          const updatedSeries = { ...s, characterSettings: updated };
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
                prefix: "ai-script/characters",
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

      const updated = charactersRef.current.map((c) => (c.id === char.id ? { ...c, imageUrl, imageTaskId: undefined } : c));
      setCharacters(updated);
      if (series) {
        const updatedSeries = { ...series, characterSettings: updated };
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
        setCharacters((prev) => prev.map((c) => (c.id === char.id ? { ...c, imageTaskId: undefined } : c)));
        setError(`「${char.name}」图片生成失败：${(e as Error).message}`);
      }
    } finally {
      setGeneratingImageIds((prev) => { const n = new Set(prev); n.delete(char.id); return n; });
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function expandAll() { setExpandedIds(new Set(characters.map((c) => c.id))); }
  function collapseAll() { setExpandedIds(new Set()); }

  /** 上传本地图片作为人物形象图（转 base64 后调用 COS 上传 API） */
  async function handleUploadImage(char: CharacterProfile, file: File) {
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
    setUploadingImageIds((prev) => new Set(prev).add(char.id));
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
      const updated = characters.map((c) => (c.id === char.id ? { ...c, imageUrl: data.url } : c));
      setCharacters(updated);
      if (series) {
        const updatedSeries = { ...series, characterSettings: updated };
        await saveSeries(updatedSeries);
        seriesRef.current = updatedSeries;
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
      }
    } catch (e) {
      setError(`「${char.name}」图片上传失败：${(e as Error).message}`);
    } finally {
      setUploadingImageIds((prev) => { const n = new Set(prev); n.delete(char.id); return n; });
    }
  }

  /** 打开音色生成弹框 */
  function handleGenerateVoice(char: CharacterProfile) {
    if (!audioConfigured) {
      setError("未配置音频生成 API，请先在「设置」中配置");
      return;
    }
    setError(null);
    setVoiceTargetId(char.id);
    setVoiceDialogOpen(true);
  }

  /** 提交音色生成参数：立即关闭弹框，在卡片音色模块显示 loading，后台执行生成 */
  async function handleVoiceGenerate(params: VoiceGenParams) {
    const targetId = voiceTargetId;
    if (!targetId) return;
    setVoiceDialogOpen(false);
    setGeneratingVoiceIds((prev) => new Set(prev).add(targetId));
    setError(null);
    try {
      const result = await generateVoice(params);
      const updated = characters.map((c) =>
        c.id === targetId
          ? {
              ...c,
              voiceUrl: result.voiceUrl,
              voicePrompt: result.voicePrompt,
              voiceModel: result.voiceModel,
              voiceId: result.voiceId,
            }
          : c
      );
      setCharacters(updated);
      if (series) {
        const updatedSeries = { ...series, characterSettings: updated };
        await saveSeries(updatedSeries);
        seriesRef.current = updatedSeries;
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
      }
    } catch (e) {
      setError(`音色生成失败：${(e as Error).message}`);
    } finally {
      setGeneratingVoiceIds((prev) => { const n = new Set(prev); n.delete(targetId); return n; });
    }
  }

  /** 从资产库选取音频作为人物音色 */
  function handleAddVoiceFromAsset(char: CharacterProfile) {
    setError(null);
    setVoiceAssetTargetId(char.id);
    setVoiceAssetPickerOpen(true);
  }

  /** 上传本地音频文件作为人物音色 */
  async function handleUploadVoice(char: CharacterProfile, file: File) {
    if (!cosConfigured) {
      setError("未配置 COS 存储，请先在「设置」中配置腾讯云 COS");
      return;
    }
    setError(null);
    setUploadingVoiceIds((prev) => new Set(prev).add(char.id));
    try {
      const nameHint = `voice-${char.id}-${Date.now()}`;
      const url = await uploadRefFile(file, nameHint);
      const updated = characters.map((c) =>
        c.id === char.id
          ? { ...c, voiceUrl: url, voicePrompt: undefined, voiceModel: undefined, voiceId: undefined }
          : c
      );
      setCharacters(updated);
      if (series) {
        const updatedSeries = { ...series, characterSettings: updated };
        await saveSeries(updatedSeries);
        seriesRef.current = updatedSeries;
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
      }
    } catch (e) {
      setError(`「${char.name}」音频上传失败：${(e as Error).message}`);
    } finally {
      setUploadingVoiceIds((prev) => { const n = new Set(prev); n.delete(char.id); return n; });
    }
  }

  /** 资产库确认：回填 voiceUrl 并保存 */
  async function handleVoiceAssetConfirm(items: PickedAssetItem[]) {
    setVoiceAssetPickerOpen(false);
    if (items.length === 0 || !voiceAssetTargetId) return;
    const item = items[0];
    const updated = characters.map((c) =>
      c.id === voiceAssetTargetId ? { ...c, voiceUrl: item.url } : c
    );
    setCharacters(updated);
    setVoiceAssetTargetId(null);
    if (series) {
      const updatedSeries = { ...series, characterSettings: updated };
      await saveSeries(updatedSeries);
      seriesRef.current = updatedSeries;
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 1500);
    }
  }

  /** 移除人物音色 */
  async function handleRemoveVoice(char: CharacterProfile) {
    const updated = characters.map((c) =>
      c.id === char.id
        ? { ...c, voiceUrl: undefined, voicePrompt: undefined, voiceModel: undefined, voiceId: undefined }
        : c
    );
    setCharacters(updated);
    if (series) {
      const updatedSeries = { ...series, characterSettings: updated };
      await saveSeries(updatedSeries);
      seriesRef.current = updatedSeries;
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 1500);
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

  const validCount = characters.filter((c) => c.name.trim()).length;
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
            <h1 className="text-lg font-semibold text-slate-800">人物设定</h1>
            <p className="text-xs text-slate-400">{series.title || "未命名企划"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedHint && <span className="text-xs text-emerald-600">已保存 ✓</span>}
        </div>
      </header>

      <div className="mb-5 rounded-md bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">
        人物设定是整个故事宇宙中角色的档案。同一角色可以有多个版本（如剧情发展中外貌/性格变化）。系统在扩写和分镜生成时默认使用最新版本。也可以在内容扩写完成后，点击「提取人物设定」由 AI 自动提取。
      </div>

      {!imageConfigured && (
        <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          图片生成 API 尚未配置。请前往「设置」页面配置图片生成 API。
        </div>
      )}

      {!audioConfigured && (
        <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          音频生成 API 尚未配置。请前往「设置」页面配置音频生成（TTS）API。
        </div>
      )}

      {characters.length > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            共 {groupCount} 个角色 · {validCount} 条记录
          </span>
          <div className="flex gap-2">
            <button onClick={expandAll} className="text-xs text-slate-500 hover:text-brand-500">全部展开</button>
            <span className="text-slate-300">|</span>
            <button onClick={collapseAll} className="text-xs text-slate-500 hover:text-brand-500">全部收起</button>
          </div>
        </div>
      )}

      {characters.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/50 py-20 text-center">
          <div className="mb-3 text-4xl opacity-30">👥</div>
          <p className="mb-1 text-sm text-slate-500">还没有人物设定</p>
          <p className="mb-4 text-xs text-slate-400">点击下方按钮添加人物，或在内容扩写后由 AI 自动提取</p>
          <Button size="sm" onClick={handleAdd}>+ 添加人物</Button>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => {
            const latest = group[0];
            const gid = latest.characterId || latest.id;
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
                  {group.map((char) => (
                    <CharacterCard key={char.id} character={char} isLatest={char.id === latest.id}
                      expanded={expandedIds.has(char.id)} onToggle={() => toggleExpand(char.id)}
                      onUpdate={(field, value) => updateField(char.id, field, value)}
                      onDelete={() => handleDelete(char.id)}
                      onGenerateImage={() => openGenerateImageDialog(char)}
                      isGenerating={generatingImageIds.has(char.id)}
                      onUploadImage={(file) => handleUploadImage(char, file)}
                      isUploading={uploadingImageIds.has(char.id)}
                      onGenerateVoice={() => handleGenerateVoice(char)}
                      isGeneratingVoice={generatingVoiceIds.has(char.id)}
                      onAddVoiceFromAsset={() => handleAddVoiceFromAsset(char)}
                      onUploadVoice={(file) => handleUploadVoice(char, file)}
                      isUploadingVoice={uploadingVoiceIds.has(char.id)}
                      onRemoveVoice={() => handleRemoveVoice(char)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {characters.length > 0 && (
        <button onClick={handleAdd}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 bg-white/40 py-3 text-sm text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-500">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          添加人物
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
          const target = characters.find((c) => c.id === genTargetId);
          if (target) void handleGenerateImage(target, params);
        }}
      />

      <VoiceGenerationDialog
        open={voiceDialogOpen}
        onClose={() => setVoiceDialogOpen(false)}
        onGenerate={handleVoiceGenerate}
        character={characters.find((c) => c.id === voiceTargetId)}
        audioModels={audioModels}
        cosConfigured={cosConfigured}
      />

      <AssetPicker
        open={voiceAssetPickerOpen}
        onClose={() => setVoiceAssetPickerOpen(false)}
        mediaType="audio"
        multiple={false}
        selectedUrls={[]}
        onConfirm={handleVoiceAssetConfirm}
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
