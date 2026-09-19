"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Button from "@/components/ui/Button";
import { useConfirm, useErrorDialog } from "@/components/ui/ConfirmDialog";
import { getSeries, saveSeries, recordMediaAsset } from "@/lib/storage";
import { emptyCharacterProfile, isCharacterProfileValid } from "@/lib/character-settings";
import { debounce, uuid, AUTOSAVE_DEBOUNCE_MS } from "@/lib/utils";
import { useUnloadPersist } from "@/lib/use-unload-persist";
import { generateImage, getImageSettings, DEFAULT_ASSET_IMAGE_CONFIG, getDefaultAssetImageConfig, getAllConfiguredImageModels } from "@/lib/image-client";
import { recoverImageTasks } from "@/lib/image-task-recovery";
import { getAudioModels, type ModelEntry, type ModelOption } from "@/lib/model-presets";
import { isAudioConfigured, generateVoice, type VoiceGenParams } from "@/lib/audio-client";
import { getAssetTemplate, getAssetReferenceImage } from "@/lib/style-settings";
import { isCosConfigured, uploadBase64, uploadRefFile, uploadRefBase64 } from "@/lib/cos-client";
import { ImageGenerationDialog } from "@/components/ImageGenerationDialog";
import { AppearanceGenerateDialog } from "@/components/AppearanceGenerateDialog";
import { getSettings as getLlmSettings } from "@/lib/llm-client";
import { VoiceGenerationDialog } from "@/components/VoiceGenerationDialog";
import AssetPicker, { type PickedAssetItem } from "@/components/AssetPicker";
import type { AssetImageConfig, CharacterProfile, Series } from "@/lib/types";
import { CharacterCard } from "./CharacterCard";
import { CharacterDetailModal } from "@/components/CharacterDetailModal";

export default function CharacterSettingsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const seriesId = params.id;
  const confirm = useConfirm();
  const showError = useErrorDialog();

  const [series, setSeries] = useState<Series | null>(null);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [detailTargetId, setDetailTargetId] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set());
  const [uploadingImageIds, setUploadingImageIds] = useState<Set<string>>(new Set());
  const [generatingAssetIds, setGeneratingAssetIds] = useState<Set<string>>(new Set());
  const [uploadingAssetIds, setUploadingAssetIds] = useState<Set<string>>(new Set());
  const [imageConfigured, setImageConfigured] = useState(false);
  const [cosConfigured, setCosConfigured] = useState(false);
  const [imageConfig, setImageConfig] = useState<AssetImageConfig>(DEFAULT_ASSET_IMAGE_CONFIG);
  // 所有「已配置 API Key」图片供应商的全部模型（聚合，供模型选择弹框使用）
  const [imageOptions, setImageOptions] = useState<ModelOption[]>([]);
  const [genTargetId, setGenTargetId] = useState<string | null>(null);
  // 弹框确认结果的去向：main = 写人物主图 imageUrl，asset = 追加到人物资产图 assetImages
  const [genMode, setGenMode] = useState<"main" | "asset">("main");
  const [configOpen, setConfigOpen] = useState(false);
  const [genInitialPrompt, setGenInitialPrompt] = useState("");
  const [styleTemplate, setStyleTemplate] = useState<string | null>(null);
  const [templateReferenceImage, setTemplateReferenceImage] = useState<string | null>(null);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [audioModels, setAudioModels] = useState<ModelEntry[]>([]);
  const [audioConfigured, setAudioConfigured] = useState(false);
  const [generatingVoiceIds, setGeneratingVoiceIds] = useState<Set<string>>(new Set());
  const [uploadingVoiceIds, setUploadingVoiceIds] = useState<Set<string>>(new Set());
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  const [voiceTargetId, setVoiceTargetId] = useState<string | null>(null);
  const [voiceAssetPickerOpen, setVoiceAssetPickerOpen] = useState(false);
  const [voiceAssetTargetId, setVoiceAssetTargetId] = useState<string | null>(null);
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
    isAudioConfigured().then(setAudioConfigured);
    getAudioModels("mimo").then(setAudioModels);
    getLlmSettings().then((s) => setLlmConfigured(!!s?.apiKey));
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
      const valid = chars.filter((c) => isCharacterProfileValid(c));
      const updated: Series = { ...s, characterSettings: valid };
      await saveSeries(updated);
      seriesRef.current = updated;
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 1500);
    }, AUTOSAVE_DEBOUNCE_MS),
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
  // 在 useEffect 中创建（而非渲染期同步初始化），避免 StrictMode 双挂载时
  // 首次挂载创建的 controller 被 abort 后仍被二次挂载复用。
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    return () => { ac.abort(); abortRef.current = null; };
  }, []);

  // 始终指向最新 characters，供恢复轮询的异步回调读取最新状态做去重/已完成判断，
  // 避免闭包捕获过期数据导致重复处理或漏处理。
  const charactersRef = useRef(characters);
  charactersRef.current = characters;

  // 卸载兜底落盘：刷新/关闭走 beforeunload，SPA 路由离开走组件卸载 cleanup，
  // 防止 1500ms 防抖未触发导致进行中的图片任务状态（imageTaskId）丢失。
  useUnloadPersist(() => {
    const s = seriesRef.current;
    if (!s) return null;
    const valid = charactersRef.current.filter((c) => isCharacterProfileValid(c));
    return { ...s, characterSettings: valid };
  }, "/api/data/series");

  // 数据加载完成信号：series 非 null 时 characters 已同批次载入（refresh 内一起 setState），
  // 恢复 effect 必须等到此时再执行，否则闭包捕获空数组导致恢复空转。
  const dataReady = series !== null;

  // 进入页面且数据加载完成后，恢复未完成的生图任务（刷新/切页后任务不丢失）。
  // 占位恢复也在此统一完成：entries 非空时先批量加入占位，onDone/onFailed 中移除对应占位。
  useEffect(() => {
    if (!dataReady) return;
    if (!imageConfigured || imageOptions.length === 0) return;
    const ac = new AbortController();

    const entries = characters
      .filter((c) => c.imageTaskId)
      .map((c) => ({ key: c.id, jobId: c.imageTaskId!, provider: c.imageTaskProvider }));
    // 人物资产图任务（每人可多个并发，用 复合键 charId::jobId 区分）
    for (const c of characters) {
      for (const t of c.assetImageTasks ?? []) {
        entries.push({ key: `${c.id}::${t.jobId}`, jobId: t.jobId, provider: t.provider });
      }
    }
    if (entries.length === 0) return;

    // 进入恢复时立即显示占位（重新生成场景下旧 imageUrl 仍在，但 imageTaskId 表明有进行中任务）
    setGeneratingImageIds((prev) => {
      const next = new Set(prev);
      entries.forEach((e) => { if (!e.key.includes("::")) next.add(e.key); });
      return next;
    });
    // 资产任务恢复占位：有人物维度的待恢复任务即显示网格占位格
    setGeneratingAssetIds((prev) => {
      const next = new Set(prev);
      entries.forEach((e) => { if (e.key.includes("::")) next.add(e.key.split("::")[0]); });
      return next;
    });

    recoverImageTasks(entries, {
      onDone: async (key, imageUrl) => {
        // imageUrl 已经服务端 COS 转存，无需再转存
        try {
          const entry = entries.find((e) => e.key === key);
          if (!entry) return;
          // 资产图任务（复合键 charId::jobId）：校验任务仍存在（未被新数据覆盖）后追加到 assetImages
          if (key.includes("::")) {
            const [charId, jobId] = [key.split("::")[0], key.split("::")[1]];
            const latest = charactersRef.current.find((c) => c.id === charId);
            if (!latest || !(latest.assetImageTasks ?? []).some((t) => t.jobId === jobId)) return;
            const updated = charactersRef.current.map((c) =>
              c.id === charId
                ? {
                    ...c,
                    assetImages: [...(c.assetImages ?? []), imageUrl],
                    assetImageTasks: (c.assetImageTasks ?? []).filter((t) => t.jobId !== jobId),
                  }
                : c
            );
            setCharacters(updated);
            const s = seriesRef.current;
            if (s) {
              const updatedSeries = { ...s, characterSettings: updated };
              await saveSeries(updatedSeries);
              seriesRef.current = updatedSeries;
              setSavedHint(true);
              setTimeout(() => setSavedHint(false), 1500);
              void recordMediaAsset({
                mediaType: "image",
                url: imageUrl,
                entityType: "character",
                entityName: latest.name || "未命名人物",
                source: "generated",
                seriesId: s.id,
                seriesTitle: s.title,
              });
            }
            return;
          }
          // 主图任务：读取最新状态做去重判断（避免闭包捕获过期数据；切页期间原任务可能已完成并写入新 imageUrl）
          const latest = charactersRef.current.find((c) => c.id === key);
          if (latest && latest.imageTaskId !== entry.jobId) {
            // taskId 已变化（被新的生成覆盖），不处理这次结果
            return;
          }
          const updated = charactersRef.current.map((c) => (c.id === key ? { ...c, imageUrl, imageTaskId: undefined, imageTaskProvider: undefined } : c));
          setCharacters(updated);
          const s = seriesRef.current;
          if (s) {
            const updatedSeries = { ...s, characterSettings: updated };
            await saveSeries(updatedSeries);
            seriesRef.current = updatedSeries;
            setSavedHint(true);
            setTimeout(() => setSavedHint(false), 1500);
            void recordMediaAsset({
              mediaType: "image",
              url: imageUrl,
              entityType: "character",
              entityName: latest?.name || "未命名人物",
              source: "profile-character",
              seriesId: s.id,
              seriesTitle: s.title,
            });
          }
        } finally {
          // 资产任务：该人物已无剩余待恢复任务时才清占位（本会话内新生成的任务已写入 assetImageTasks，可一并判断）；主图任务直接清
          if (key.includes("::")) {
            const charId = key.split("::")[0];
            const rest = charactersRef.current.find((c) => c.id === charId)?.assetImageTasks ?? [];
            if (rest.length === 0) {
              setGeneratingAssetIds((prev) => { const n = new Set(prev); n.delete(charId); return n; });
            }
          } else {
            setGeneratingImageIds((prev) => { const n = new Set(prev); n.delete(key); return n; });
          }
        }
      },
      onFailed: (key, error) => {
        // 仅真实失败才回调（取消/切页由 recoverImageTasks 静默，taskId 保留待下次恢复）
        if (key.includes("::")) {
          const [charId, jobId] = [key.split("::")[0], key.split("::")[1]];
          const name = charactersRef.current.find((c) => c.id === charId)?.name ?? "";
          setCharacters((prev) => prev.map((c) =>
            c.id === charId ? { ...c, assetImageTasks: (c.assetImageTasks ?? []).filter((t) => t.jobId !== jobId) } : c
          ));
          showError(`「${name}」人物资产图生成失败：${error}`);
          const rest = (charactersRef.current.find((c) => c.id === charId)?.assetImageTasks ?? []).filter((t) => t.jobId !== jobId);
          if (rest.length === 0) {
            setGeneratingAssetIds((prev) => { const n = new Set(prev); n.delete(charId); return n; });
          }
          return;
        }
        const name = charactersRef.current.find((c) => c.id === key)?.name ?? "";
        setCharacters((prev) => prev.map((c) => (c.id === key ? { ...c, imageTaskId: undefined } : c)));
        showError(`「${name}」图片生成失败：${error}`);
        setGeneratingImageIds((prev) => { const n = new Set(prev); n.delete(key); return n; });
      },
    }, ac.signal);

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady, imageConfigured, imageOptions]);

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
    setDetailTargetId(newChar.id);
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
      assetImages: [], assetImageTasks: undefined,
    };
    setCharacters((prev) => [...prev, newVersion]);
    setDetailTargetId(newVersion.id);
  }

  /** 将指定版本设为该角色的默认（最新）版本：清除同组其他版本的 isDefault，置目标为 true */
  function handleSetDefault(id: string) {
    const target = characters.find((c) => c.id === id);
    if (!target) return;
    const gid = target.characterId || target.id;
    setCharacters((prev) => prev.map((c) => {
      if ((c.characterId || c.id) !== gid) return c;
      return { ...c, isDefault: c.id === id };
    }));
  }

  async function handleDelete(id: string) {
    if (!await confirm({
      message: "确定删除该人物版本？",
      confirmText: "删除",
    })) return;
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    setDetailTargetId((prev) => (prev === id ? null : prev));
  }

  /** 打开图片生成弹框（先做必要校验） */
  async function openGenerateImageDialog(char: CharacterProfile) {
    if (!imageConfigured) {
      showError("未配置图片生成 API，请先在「设置」中配置");
      return;
    }
    const template = await getAssetTemplate("character", series?.styleSettings ?? null);
    setStyleTemplate(template);
    const refImage = await getAssetReferenceImage("character", series?.styleSettings ?? null);
    setTemplateReferenceImage(refImage ?? null);
    const prompt = char.appearance.trim() || char.name.trim();
    setGenInitialPrompt(prompt);
    setGenTargetId(char.id);
    setGenMode("main");
    setRefImages(char.referenceImages ?? []);
    setConfigOpen(true);
  }

  /** 打开人物资产图生成弹框（详情页「人物资产」tab）：自动带主图作参考图，提示词留空（可从预设库添加） */
  async function openGenerateAssetImageDialog(char: CharacterProfile) {
    if (!imageConfigured) {
      showError("未配置图片生成 API，请先在「设置」中配置");
      return;
    }
    const template = await getAssetTemplate("character", series?.styleSettings ?? null);
    setStyleTemplate(template);
    const refImage = await getAssetReferenceImage("character", series?.styleSettings ?? null);
    setTemplateReferenceImage(refImage ?? null);
    // 提示词保留为空，不拼接模板；用户可通过弹框「添加提示词」从预设库获取或自行输入
    setGenInitialPrompt("");
    setGenTargetId(char.id);
    setGenMode("asset");
    setRefImages(char.imageUrl ? [char.imageUrl] : []);
    setConfigOpen(true);
  }

  /** 构建随机外貌生成的提示词（含外貌本身，便于在简短外貌基础上扩展） */
  function buildAppearancePrompt(char: CharacterProfile): string {
    const lines: string[] = [];
    if (char.name.trim()) lines.push(`姓名：${char.name.trim()}`);
    if (char.genderAge.trim()) lines.push(`性别年龄：${char.genderAge.trim()}`);
    if (char.role.trim()) lines.push(`角色定位：${char.role.trim()}`);
    if (char.appearance.trim()) lines.push(`外貌：${char.appearance.trim()}`);
    if (char.personality.trim()) lines.push(`性格：${char.personality.trim()}`);
    if (char.background.trim()) lines.push(`背景故事：${char.background.trim()}`);
    if (char.relationships.trim()) lines.push(`人物关系：${char.relationships.trim()}`);
    return lines.join("\n");
  }

  /** 打开随机外貌生成弹框（先做必要校验） */
  function openRandomAppearanceDialog(char: CharacterProfile) {
    if (!llmConfigured) {
      showError("未配置 LLM，请先在「设置」中配置大模型 API");
      return;
    }
    if (!char.genderAge.trim()) {
      showError("请先填写「性别年龄」后再随机生成外貌");
      return;
    }
    setAppearanceDialogInitialPrompt(buildAppearancePrompt(char));
    setAppearanceDialogTargetId(char.id);
    setAppearanceDialogOpen(true);
  }

  /** 应用随机生成的外貌结果到卡片 */
  function handleApplyAppearance(result: string) {
    if (!appearanceDialogTargetId) return;
    setCharacters((prev) => prev.map((c) => (c.id === appearanceDialogTargetId ? { ...c, appearance: result } : c)));
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
      const url = await uploadRefBase64(base64, `ref-char-${genTargetId ?? "asset"}-${Date.now()}`);
      urls.push(url);
      const targetName = characters.find((c) => c.id === genTargetId)?.name;
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

  /** 参考图变更：更新 refImages 状态；主图模式同步到人物设定 referenceImages（资产模式的参考图是临时生成输入，不落设定数据） */
  function handleRefImagesChange(newImages: string[]) {
    setRefImages(newImages);
    if (genTargetId && genMode === "main") {
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
      const result = await generateImage(prompt, config, images.length > 0 ? images : undefined, async (jobId) => {
        // 异步任务创建后立即持久化 jobId + imageTaskProvider（切页/刷新后可恢复轮询，按 provider 路由凭证）
        // 用 keepalive fetch 同步落库，避免 SPA 路由切换取消普通 fetch 导致 jobId 丢失
        const updated = charactersRef.current.map((c) => (c.id === char.id ? { ...c, imageTaskId: jobId, imageTaskProvider: config.provider } : c));
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
      }, abortRef.current?.signal, { cosPrefix: "ai-script/characters" });
      // imageUrl 已经服务端 COS 转存，无需再转存
      const imageUrl = result.imageUrl;

      const updated = charactersRef.current.map((c) => (c.id === char.id ? { ...c, imageUrl, imageTaskId: undefined } : c));
      setCharacters(updated);
      if (series) {
        const updatedSeries = { ...series, characterSettings: updated };
        await saveSeries(updatedSeries);
        seriesRef.current = updatedSeries;
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
        void recordMediaAsset({
          mediaType: "image",
          url: imageUrl,
          entityType: "character",
          entityName: char.name || "未命名人物",
          prompt,
          source: "profile-character",
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
        setCharacters((prev) => prev.map((c) => (c.id === char.id ? { ...c, imageTaskId: undefined } : c)));
        showError(`「${char.name}」图片生成失败：${(e as Error).message}`);
      }
    } finally {
      setGeneratingImageIds((prev) => { const n = new Set(prev); n.delete(char.id); return n; });
    }
  }

  /** 为人物生成资产图（提示词 + 可选参考图，由弹框确认传入）：追加到 assetImages，任务落 assetImageTasks 支持切页恢复 */
  async function handleGenerateAssetImage(
    char: CharacterProfile,
    params: { prompt: string; images: string[]; config: AssetImageConfig }
  ) {
    setGeneratingAssetIds((prev) => new Set(prev).add(char.id));
    let thisJobId: string | undefined;
    try {
      const { prompt, images, config } = params;
      const result = await generateImage(prompt, config, images.length > 0 ? images : undefined, async (jobId) => {
        thisJobId = jobId;
        // 异步任务创建后立即持久化任务条目（切页/刷新后可恢复轮询），keepalive fetch 同步落库防 SPA 路由切换丢失
        const updated = charactersRef.current.map((c) =>
          c.id === char.id
            ? { ...c, assetImageTasks: [...(c.assetImageTasks ?? []), { jobId, provider: config.provider }] }
            : c
        );
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
      }, abortRef.current?.signal, { cosPrefix: "ai-script/characters" });
      // imageUrl 已经服务端 COS 转存，无需再转存
      const imageUrl = result.imageUrl;

      const updated = charactersRef.current.map((c) =>
        c.id === char.id
          ? {
              ...c,
              assetImages: [...(c.assetImages ?? []), imageUrl],
              // 成功后仅移除本次任务条目（同一人物可能有多个并发任务）
              assetImageTasks: (c.assetImageTasks ?? []).filter((t) => t.jobId !== thisJobId),
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
        void recordMediaAsset({
          mediaType: "image",
          url: imageUrl,
          entityType: "character",
          entityName: char.name || "未命名人物",
          prompt,
          source: "generated",
          seriesId: series.id,
          seriesTitle: series.title,
        });
      }
    } catch (e) {
      // 切页/卸载导致轮询被取消时，保留 assetImageTasks 以便重新挂载后恢复；仅真实失败时清除并提示
      const isAborted = (e as Error)?.name === "AbortError" || (e as Error)?.message === "已取消";
      if (!isAborted) {
        setCharacters((prev) => prev.map((c) => {
          if (c.id !== char.id) return c;
          // 失败时无法得知具体 jobId，保守起见清空该人物全部资产任务（真实失败场景任务已终止）
          return { ...c, assetImageTasks: undefined };
        }));
        showError(`「${char.name}」人物资产图生成失败：${(e as Error).message}`);
      }
    } finally {
      const rest = charactersRef.current.find((c) => c.id === char.id)?.assetImageTasks ?? [];
      if (rest.length === 0) {
        setGeneratingAssetIds((prev) => { const n = new Set(prev); n.delete(char.id); return n; });
      }
    }
  }

  /** 上传本地图片追加为人物资产图（转 base64 后调用存储上传 API） */
  async function handleUploadAssetImage(char: CharacterProfile, file: File) {
    if (!(await isCosConfigured())) {
      showError("未配置对象存储（COS），无法上传图片，请先在「设置」中配置");
      return;
    }
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];
    if (!allowed.includes(file.type)) {
      showError(`不支持的图片格式：${file.type || "未知"}，仅支持 png/jpg/webp/gif/bmp`);
      return;
    }
    setUploadingAssetIds((prev) => new Set(prev).add(char.id));
    try {
      // 读取文件为 base64 data URL
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(file);
      });
      const { url } = await uploadBase64(base64, file.name);
      const updated = characters.map((c) => (c.id === char.id ? { ...c, assetImages: [...(c.assetImages ?? []), url] } : c));
      setCharacters(updated);
      if (series) {
        const updatedSeries = { ...series, characterSettings: updated };
        await saveSeries(updatedSeries);
        seriesRef.current = updatedSeries;
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
        void recordMediaAsset({
          mediaType: "image",
          url,
          entityType: "character",
          entityName: char.name || "未命名人物",
          source: "manual",
          seriesId: series.id,
          seriesTitle: series.title,
        });
      }
    } catch (e) {
      showError(`「${char.name}」资产图上传失败：${(e as Error).message}`);
    } finally {
      setUploadingAssetIds((prev) => { const n = new Set(prev); n.delete(char.id); return n; });
    }
  }

  /** 删除人物资产图（交给自动保存持久化） */
  function handleRemoveAssetImage(char: CharacterProfile, url: string) {
    setCharacters((prev) => prev.map((c) =>
      c.id === char.id ? { ...c, assetImages: (c.assetImages ?? []).filter((u) => u !== url) } : c
    ));
  }

  /** 上传本地图片作为人物形象图（转 base64 后调用存储上传 API） */
  async function handleUploadImage(char: CharacterProfile, file: File) {
    if (!(await isCosConfigured())) {
      showError("未配置对象存储（COS），无法上传图片，请先在「设置」中配置");
      return;
    }
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];
    if (!allowed.includes(file.type)) {
      showError(`不支持的图片格式：${file.type || "未知"}，仅支持 png/jpg/webp/gif/bmp`);
      return;
    }
    setUploadingImageIds((prev) => new Set(prev).add(char.id));
    try {
      // 读取文件为 base64 data URL
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(file);
      });
      const { url } = await uploadBase64(base64, file.name);
      const updated = characters.map((c) => (c.id === char.id ? { ...c, imageUrl: url } : c));
      setCharacters(updated);
      if (series) {
        const updatedSeries = { ...series, characterSettings: updated };
        await saveSeries(updatedSeries);
        seriesRef.current = updatedSeries;
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
        void recordMediaAsset({
          mediaType: "image",
          url,
          entityType: "character",
          entityName: char.name || "未命名人物",
          source: "profile-character",
          seriesId: series.id,
          seriesTitle: series.title,
        });
      }
    } catch (e) {
      showError(`「${char.name}」图片上传失败：${(e as Error).message}`);
    } finally {
      setUploadingImageIds((prev) => { const n = new Set(prev); n.delete(char.id); return n; });
    }
  }

  /** 打开音色生成弹框 */
  function handleGenerateVoice(char: CharacterProfile) {
    if (!audioConfigured) {
      showError("未配置音频生成 API，请先在「设置」中配置");
      return;
    }
    setVoiceTargetId(char.id);
    setVoiceDialogOpen(true);
  }

  /** 提交音色生成参数：立即关闭弹框，在卡片音色模块显示 loading，后台执行生成 */
  async function handleVoiceGenerate(params: VoiceGenParams) {
    const targetId = voiceTargetId;
    if (!targetId) return;
    setVoiceDialogOpen(false);
    setGeneratingVoiceIds((prev) => new Set(prev).add(targetId));
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
        const targetChar = updated.find((c) => c.id === targetId);
        void recordMediaAsset({
          mediaType: "audio",
          url: result.voiceUrl,
          entityType: "character",
          entityName: targetChar?.name || "未命名人物",
          prompt: result.voicePrompt,
          source: "profile-character",
          seriesId: series.id,
          seriesTitle: series.title,
        });
      }
    } catch (e) {
      showError(`音色生成失败：${(e as Error).message}`);
    } finally {
      setGeneratingVoiceIds((prev) => { const n = new Set(prev); n.delete(targetId); return n; });
    }
  }

  /** 从资产库选取音频作为人物音色 */
  function handleAddVoiceFromAsset(char: CharacterProfile) {
    setVoiceAssetTargetId(char.id);
    setVoiceAssetPickerOpen(true);
  }

  /** 上传本地音频文件作为人物音色 */
  async function handleUploadVoice(char: CharacterProfile, file: File) {
    if (!(await isCosConfigured())) {
      showError("未配置 COS 存储，请先在「设置」中配置腾讯云 COS");
      return;
    }
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
        void recordMediaAsset({
          mediaType: "audio",
          url,
          entityType: "character",
          entityName: char.name || "未命名人物",
          source: "manual",
          seriesId: series.id,
          seriesTitle: series.title,
        });
      }
    } catch (e) {
      showError(`「${char.name}」音频上传失败：${(e as Error).message}`);
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
  const detailTarget = characters.find((c) => c.id === detailTargetId) ?? null;

  return (
    <main className="mx-auto min-h-screen max-w-[1400px] px-4 py-8 sm:px-6">
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
        <div className="mb-4">
          <span className="text-xs text-slate-400">
            共 {groupCount} 个角色 · {validCount} 条记录
          </span>
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
            const latest = group.find((v) => v.isDefault) ?? group[0];
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
                      onSetDefault={group.length > 1 ? () => handleSetDefault(char.id) : undefined}
                      onOpenDetail={() => setDetailTargetId(char.id)}
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
        templateReferenceImage={templateReferenceImage ?? undefined}
        initialConfig={imageConfig}
        images={refImages}
        onImagesChange={handleRefImagesChange}
        onUploadFiles={handleUploadRefFiles}
        imageOptions={imageOptions}
        enablePresetPrompt
        defaultSeriesId={seriesId}
        loading={genTargetId
          ? (genMode === "asset" ? generatingAssetIds.has(genTargetId) : generatingImageIds.has(genTargetId))
          : false}
        onConfirm={(params) => {
          setImageConfig(params.config);
          setConfigOpen(false);
          const target = characters.find((c) => c.id === genTargetId);
          if (!target) return;
          if (genMode === "asset") void handleGenerateAssetImage(target, params);
          else void handleGenerateImage(target, params);
        }}
      />

      <VoiceGenerationDialog
        open={voiceDialogOpen}
        onClose={() => setVoiceDialogOpen(false)}
        onGenerate={handleVoiceGenerate}
        character={characters.find((c) => c.id === voiceTargetId)}
        audioModels={audioModels}
        storageConfigured={cosConfigured}
        defaultSeriesId={seriesId}
      />

      <AssetPicker
        open={voiceAssetPickerOpen}
        onClose={() => setVoiceAssetPickerOpen(false)}
        mediaType="audio"
        multiple={false}
        selectedUrls={[]}
        defaultSeriesId={seriesId}
        onConfirm={handleVoiceAssetConfirm}
      />

      <AppearanceGenerateDialog
        open={appearanceDialogOpen}
        onClose={() => { setAppearanceDialogOpen(false); setAppearanceDialogTargetId(null); }}
        onApply={handleApplyAppearance}
        initialPrompt={appearanceDialogInitialPrompt}
        entityType="character"
      />

      <CharacterDetailModal
        character={detailTarget}
        open={!!detailTarget}
        onClose={() => setDetailTargetId(null)}
        onUpdate={(field, value) => detailTarget && updateField(detailTarget.id, field, value)}
        onGenerateImage={() => detailTarget && openGenerateImageDialog(detailTarget)}
        isGenerating={detailTarget ? generatingImageIds.has(detailTarget.id) : false}
        onUploadImage={(file) => detailTarget && handleUploadImage(detailTarget, file)}
        isUploading={detailTarget ? uploadingImageIds.has(detailTarget.id) : false}
        onRandomAppearance={() => detailTarget && openRandomAppearanceDialog(detailTarget)}
        onGenerateVoice={() => detailTarget && handleGenerateVoice(detailTarget)}
        isGeneratingVoice={detailTarget ? generatingVoiceIds.has(detailTarget.id) : false}
        onAddVoiceFromAsset={() => detailTarget && handleAddVoiceFromAsset(detailTarget)}
        onUploadVoice={(file) => detailTarget && handleUploadVoice(detailTarget, file)}
        isUploadingVoice={detailTarget ? uploadingVoiceIds.has(detailTarget.id) : false}
        onRemoveVoice={() => detailTarget && handleRemoveVoice(detailTarget)}
        onGenerateAssetImage={() => detailTarget && openGenerateAssetImageDialog(detailTarget)}
        isGeneratingAsset={detailTarget ? generatingAssetIds.has(detailTarget.id) : false}
        onUploadAssetImage={(file) => detailTarget && handleUploadAssetImage(detailTarget, file)}
        isUploadingAsset={detailTarget ? uploadingAssetIds.has(detailTarget.id) : false}
        onRemoveAssetImage={(url) => detailTarget && handleRemoveAssetImage(detailTarget, url)}
      />
    </main>
  );
}
