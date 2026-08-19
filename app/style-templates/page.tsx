"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  createEmptyTemplate,
  getStyleTemplates,
  isBuiltinPreset,
  saveStyleTemplates,
} from "@/lib/style-settings";
import {
  DEFAULT_SYSTEM_PROMPTS,
  SYSTEM_PROMPT_META,
  SYSTEM_PROMPT_GROUP_ORDER,
  getCustomPrompts,
  saveCustomPrompts,
  resetSystemPrompt,
  resetAllSystemPrompts,
  isCustomized,
  SYSTEM_PROMPTS_KEY,
} from "@/lib/system-prompts";
import { debounce, AUTOSAVE_DEBOUNCE_MS } from "@/lib/utils";
import {
  generateImage,
  getImageSettings,
  DEFAULT_ASSET_IMAGE_CONFIG,
  getDefaultAssetImageConfig,
  getAllConfiguredImageModels,
  isPollingSupported,
} from "@/lib/image-client";
import { recoverImageTasks, type ImageTaskRecoveryEntry } from "@/lib/image-task-recovery";
import { isCosConfigured, uploadRefFile } from "@/lib/cos-client";
import { ImageGenerationDialog, type ImageGenerationParams } from "@/components/ImageGenerationDialog";
import type { ModelOption } from "@/lib/model-presets";
import type { AssetImageConfig, StylePreset, SystemPromptKey } from "@/lib/types";

/** 风格模板中支持参考图的字段（故事板不接入） */
type ReferenceImageFieldKey =
  | "characterReferenceImage"
  | "sceneReferenceImage"
  | "objectReferenceImage";

/** 参考图字段 -> 对应的任务 ID / 供应商字段 */
const REF_TASK_ID_FIELD: Record<ReferenceImageFieldKey, keyof StylePreset> = {
  characterReferenceImage: "characterRefImageTaskId",
  sceneReferenceImage: "sceneRefImageTaskId",
  objectReferenceImage: "objectRefImageTaskId",
};
const REF_TASK_PROVIDER_FIELD: Record<ReferenceImageFieldKey, keyof StylePreset> = {
  characterReferenceImage: "characterRefImageTaskProvider",
  sceneReferenceImage: "sceneRefImageTaskProvider",
  objectReferenceImage: "objectRefImageTaskProvider",
};

export default function StyleTemplatesPage() {
  const router = useRouter();
  const confirm = useConfirm();

  const [templates, setTemplates] = useState<StylePreset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedHint, setSavedHint] = useState(false);
  // Tab 切换：图片提示词模板（现有） / LLM 系统提示词（新）
  const [tab, setTab] = useState<"imageTemplates" | "systemPrompts">("imageTemplates");

  // 图片生成 / COS 配置（用于参考图的生成与上传）
  const [imageConfigured, setImageConfigured] = useState(false);
  const [cosConfigured, setCosConfigured] = useState(false);
  const [imageOptions, setImageOptions] = useState<ModelOption[]>([]);
  const [defaultImageConfig, setDefaultImageConfig] = useState<AssetImageConfig>(DEFAULT_ASSET_IMAGE_CONFIG);

  // 参考图生成弹框状态
  const [genField, setGenField] = useState<ReferenceImageFieldKey | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [genInitialPrompt, setGenInitialPrompt] = useState("");
  const [genConfig, setGenConfig] = useState<AssetImageConfig>(DEFAULT_ASSET_IMAGE_CONFIG);
  const [genImages, setGenImages] = useState<string[]>([]);
  const [generatingRef, setGeneratingRef] = useState(false);
  // 恢复轮询中（切页/刷新回来后）的模板字段集合 `${templateId}:${field}`，用于按钮 loading 占位
  const [resumingRefKeys, setResumingRefKeys] = useState<Set<string>>(new Set());
  // 参考图本地上传中的字段（用于按钮 loading）
  const [uploadingField, setUploadingField] = useState<ReferenceImageFieldKey | null>(null);

  // 组件级 AbortController：卸载（切路由/刷新）时取消所有进行中的生图轮询，避免孤儿轮询
  const abortRef = useRef<AbortController | null>(null);
  if (abortRef.current === null) abortRef.current = new AbortController();
  useEffect(() => {
    const ac = abortRef.current!;
    return () => ac.abort();
  }, []);

  const refresh = useCallback(async () => {
    const list = await getStyleTemplates();
    setTemplates(list);
    setSelectedId((prev) => prev && list.find((t) => t.id === prev) ? prev : (list[0]?.id ?? null));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 模板数据与图片配置就绪后，恢复未完成的参考图生图订阅（切页/刷新后任务不丢失）。
  // 服务端任务中心负责轮询上游/COS 转存/容错，前端仅订阅本地任务状态；
  // 切页/卸载仅取消前端等待（cleanup abort），任务在服务端继续，taskId 保留待下次恢复。
  const resumeRef = useRef(false);
  useEffect(() => {
    if (resumeRef.current) return;
    if (loading || !imageConfigured || imageOptions.length === 0) return;
    resumeRef.current = true;
    const ac = new AbortController();

    const REF_FIELDS: ReferenceImageFieldKey[] = [
      "characterReferenceImage",
      "sceneReferenceImage",
      "objectReferenceImage",
    ];
    const entries: ImageTaskRecoveryEntry[] = [];
    // key -> 恢复上下文（写回字段定位与去重判断用）；key 含模板 id，避免不同模板同名字段冲突
    const metaByKey = new Map<string, { templateId: string; field: ReferenceImageFieldKey; taskId: string }>();
    for (const tpl of templates) {
      for (const field of REF_FIELDS) {
        const taskId = tpl[REF_TASK_ID_FIELD[field]] as string | undefined;
        if (!taskId) continue;
        const provider = tpl[REF_TASK_PROVIDER_FIELD[field]] as ImageTaskRecoveryEntry["provider"];
        const model = imageOptions[0]?.entry.value ?? "";
        if (!isPollingSupported(model, provider)) continue;
        const key = `${tpl.id}:${field}`;
        entries.push({ key, jobId: taskId, provider });
        metaByKey.set(key, { templateId: tpl.id, field, taskId });
      }
    }
    if (entries.length > 0) {
      setResumingRefKeys((prev) => {
        const next = new Set(prev);
        entries.forEach((e) => next.add(e.key));
        return next;
      });
    }

    const clearResuming = (key: string) =>
      setResumingRefKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });

    recoverImageTasks(entries, {
      onDone: (key, imageUrl) => {
        const meta = metaByKey.get(key);
        if (!meta) return;
        const { templateId, field, taskId } = meta;
        // 去重：taskId 已被新一轮生成覆盖时放弃本次结果
        const latest = templatesRef.current.find((t) => t.id === templateId);
        if ((latest?.[REF_TASK_ID_FIELD[field]] as string | undefined) !== taskId) {
          clearResuming(key);
          return;
        }
        // imageUrl 已经服务端 COS 转存，直接写回（走防抖自动保存落库），无需前端再转存
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === templateId
              ? { ...t, [field]: imageUrl, [REF_TASK_ID_FIELD[field]]: undefined, [REF_TASK_PROVIDER_FIELD[field]]: undefined }
              : t
          )
        );
        clearResuming(key);
      },
      onFailed: (key, error) => {
        // 仅真实失败才回调：清除 taskId 并提示；取消（切页/卸载）不回调，taskId 保留待下次恢复
        const meta = metaByKey.get(key);
        if (!meta) return;
        const { templateId, field } = meta;
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === templateId
              ? { ...t, [REF_TASK_ID_FIELD[field]]: undefined, [REF_TASK_PROVIDER_FIELD[field]]: undefined }
              : t
          )
        );
        alert(`参考图生成失败：${error}`);
        clearResuming(key);
      },
    }, ac.signal);

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, imageConfigured, imageOptions]);

  // 初始化图片生成 / COS 配置（供参考图生成与上传使用）
  useEffect(() => {
    (async () => {
      const s = await getImageSettings();
      setImageConfigured(!!s?.apiKey);
      setImageOptions(await getAllConfiguredImageModels());
      const defaultCfg = await getDefaultAssetImageConfig();
      setDefaultImageConfig({ ...defaultCfg });
      setGenConfig({ ...defaultCfg });
    })();
    isCosConfigured().then(setCosConfigured);
  }, []);

  const templatesRef = useRef<StylePreset[]>(templates);
  templatesRef.current = templates;
  const skipPersistRef = useRef(true);

  const persist = useCallback(
    debounce(async (list: StylePreset[]) => {
      await saveStyleTemplates(list);
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 1500);
    }, AUTOSAVE_DEBOUNCE_MS),
    []
  );

  useEffect(() => {
    if (skipPersistRef.current) {
      if (!loading) skipPersistRef.current = false;
      return;
    }
    persist(templates);
  }, [templates, persist, loading]);

  // —— LLM 系统提示词 state + 自动保存 + beforeunload 兜底 ——
  const [customPrompts, setCustomPrompts] = useState<Record<SystemPromptKey, string>>(
    () => ({ ...DEFAULT_SYSTEM_PROMPTS })
  );
  const customPromptsLoadedRef = useRef(false);
  const customPromptsRef = useRef(customPrompts);
  customPromptsRef.current = customPrompts;
  const skipPromptPersistRef = useRef(true);

  useEffect(() => {
    (async () => {
      const map = await getCustomPrompts();
      // 合并：默认值 + 用户自定义覆盖
      setCustomPrompts({ ...DEFAULT_SYSTEM_PROMPTS, ...map });
      customPromptsLoadedRef.current = true;
    })();
  }, []);

  const persistPrompts = useCallback(
    debounce(async (map: Record<SystemPromptKey, string>) => {
      // 只保存与默认值不同的项，减少存储体积
      const diff: Partial<Record<SystemPromptKey, string>> = {};
      (Object.keys(map) as SystemPromptKey[]).forEach((k) => {
        if (map[k] !== DEFAULT_SYSTEM_PROMPTS[k]) diff[k] = map[k];
      });
      await saveCustomPrompts(diff);
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 1500);
    }, AUTOSAVE_DEBOUNCE_MS),
    []
  );

  useEffect(() => {
    if (skipPromptPersistRef.current) {
      if (customPromptsLoadedRef.current) skipPromptPersistRef.current = false;
      return;
    }
    persistPrompts(customPrompts);
  }, [customPrompts, persistPrompts]);

  function updatePrompt(key: SystemPromptKey, value: string) {
    setCustomPrompts((prev) => ({ ...prev, [key]: value }));
  }

  async function handleResetPrompt(key: SystemPromptKey) {
    if (!(await confirm({
      message: `确定将「${SYSTEM_PROMPT_META[key].label}」恢复为默认提示词吗？你的修改将丢失。`,
      confirmText: "恢复默认",
    }))) return;
    setCustomPrompts((prev) => ({ ...prev, [key]: DEFAULT_SYSTEM_PROMPTS[key] }));
    await resetSystemPrompt(key);
    setSavedHint(true);
    setTimeout(() => setSavedHint(false), 1500);
  }

  async function handleResetAllPrompts() {
    if (!(await confirm({
      message: "确定将所有 LLM 系统提示词恢复为默认值吗？所有自定义修改将丢失。",
      confirmText: "全部恢复默认",
    }))) return;
    setCustomPrompts({ ...DEFAULT_SYSTEM_PROMPTS });
    await resetAllSystemPrompts();
    setSavedHint(true);
    setTimeout(() => setSavedHint(false), 1500);
  }

  useEffect(() => {
    const handler = () => {
      // 图片提示词模板兜底落盘
      const list = templatesRef.current;
      if (list.length > 0) {
        fetch("/api/settings/style-templates", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_STORAGE_TOKEN ?? ""}`,
          },
          body: JSON.stringify({ value: list }),
          keepalive: true,
        });
      }
      // LLM 系统提示词兜底落盘（只存与默认值不同的项）
      const promptsMap = customPromptsRef.current;
      const diff: Partial<Record<SystemPromptKey, string>> = {};
      (Object.keys(promptsMap) as SystemPromptKey[]).forEach((k) => {
        if (promptsMap[k] !== DEFAULT_SYSTEM_PROMPTS[k]) diff[k] = promptsMap[k];
      });
      if (Object.keys(diff).length > 0) {
        fetch(`/api/settings/${SYSTEM_PROMPTS_KEY}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_STORAGE_TOKEN ?? ""}`,
          },
          body: JSON.stringify({ value: diff }),
          keepalive: true,
        });
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const editingTemplate = useMemo<StylePreset | null>(() => {
    if (!selectedId) return null;
    return templates.find((t) => t.id === selectedId) ?? null;
  }, [templates, selectedId]);

  function selectTemplate(id: string) {
    setSelectedId(id);
  }

  function updateField(field: keyof Omit<StylePreset, "id">, value: string) {
    if (!selectedId) return;
    setTemplates((prev) =>
      prev.map((t) => (t.id === selectedId ? { ...t, [field]: value } : t))
    );
  }

  /** 上传本地文件作为风格参考图（经 COS 落盘） */
  async function handleUploadRefFile(field: ReferenceImageFieldKey, file: File) {
    if (!(await isCosConfigured())) {
      alert("未配置 COS 存储，无法上传。请先在「存储设置」中配置。");
      return;
    }
    setUploadingField(field);
    try {
      const url = await uploadRefFile(file, `style-ref-${field}-${Date.now()}`);
      updateField(field, url);
    } catch (e) {
      alert(`参考图上传失败：${(e as Error).message}`);
    } finally {
      setUploadingField(null);
    }
  }

  /** 打开参考图生成弹框（初始提示词取对应文字模板） */
  function openRefGenerateDialog(field: ReferenceImageFieldKey) {
    if (!imageConfigured) {
      alert("未配置图片生成 API，请先在「图片 API 设置」中配置。");
      return;
    }
    if (!editingTemplate) return;
    const initialPrompt =
      field === "characterReferenceImage"
        ? editingTemplate.characterTemplate
        : field === "sceneReferenceImage"
          ? editingTemplate.sceneTemplate
          : editingTemplate.objectTemplate;
    setGenField(field);
    setGenInitialPrompt(initialPrompt);
    setGenConfig({ ...defaultImageConfig });
    setGenImages([]);
    setGenOpen(true);
  }

  /** 生成弹框确认：生图（任务完成后服务端已转存 COS）-> 写入模板字段（taskId 落盘，切页/刷新后可恢复订阅） */
  async function handleRefGenerateConfirm(params: ImageGenerationParams) {
    if (!genField) return;
    const field = genField;
    const templateId = selectedId;
    setGenConfig(params.config);
    setGeneratingRef(true);
    try {
      const result = await generateImage(
        params.prompt,
        params.config,
        params.images.length > 0 ? params.images : undefined,
        (jobId) => {
          // 异步任务创建后立即持久化 jobId + provider
          if (templateId) {
            // 基于 ref 构造新数组并同步 ref，再 keepalive 直写落库——提交在飞时切页，
            // 组件卸载后 setState 无效，直写是 taskId 不丢的唯一保障
            const updated = templatesRef.current.map((t) =>
              t.id === templateId
                ? { ...t, [REF_TASK_ID_FIELD[field]]: jobId, [REF_TASK_PROVIDER_FIELD[field]]: params.config.provider }
                : t
            );
            templatesRef.current = updated;
            setTemplates(updated);
            fetch("/api/settings/style-templates", {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.NEXT_PUBLIC_STORAGE_TOKEN ?? ""}`,
              },
              body: JSON.stringify({ value: updated }),
              keepalive: true,
            });
          }
        },
        abortRef.current?.signal,
        { cosPrefix: "ai-script/style-ref" }
      );
      // 成功：imageUrl 已经服务端 COS 转存，一次性写入图片 URL 并清除任务标记
      if (templateId) {
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === templateId
              ? { ...t, [field]: result.imageUrl, [REF_TASK_ID_FIELD[field]]: undefined, [REF_TASK_PROVIDER_FIELD[field]]: undefined }
              : t
          )
        );
      } else {
        updateField(field, result.imageUrl);
      }
      setGenOpen(false);
    } catch (e) {
      // 切页/卸载导致轮询被取消时保留 taskId 以便重新挂载后恢复；真实失败时清除 taskId 并提示
      const isAborted = (e as Error)?.name === "AbortError" || (e as Error)?.message === "已取消";
      if (isAborted) return;
      if (templateId) {
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === templateId
              ? { ...t, [REF_TASK_ID_FIELD[field]]: undefined, [REF_TASK_PROVIDER_FIELD[field]]: undefined }
              : t
          )
        );
      }
      alert(`参考图生成失败：${(e as Error).message}`);
    } finally {
      setGeneratingRef(false);
    }
  }

  function handleAddTemplate() {
    const source = editingTemplate;
    const newTemplate = createEmptyTemplate(source);
    setTemplates((prev) => [...prev, newTemplate]);
    setSelectedId(newTemplate.id);
  }

  async function handleDeleteTemplate(id: string) {
    if (templates.length <= 1) {
      alert("至少需要保留一个提示词，无法删除。");
      return;
    }
    if (!await confirm({
      message: "确定删除该提示词？该操作不可恢复。",
      confirmText: "删除",
      variant: "danger",
    })) return;
    setTemplates((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (selectedId === id) {
        setSelectedId(next[0]?.id ?? null);
      }
      return next;
    });
  }

  function handleBack() {
    router.back();
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-400">
        加载中…
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="text-slate-400 hover:text-slate-600"
            title="返回"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">提示词管理</h1>
            <p className="text-xs text-slate-400">管理全局提示词，供各企划的提示词设定选择使用</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedHint && (
            <span className="text-xs text-emerald-600">已保存 ✓</span>
          )}
        </div>
      </header>

      {/* Tab 切换 */}
      <div className="mb-5 flex gap-1 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setTab("imageTemplates")}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "imageTemplates"
              ? "border-brand-500 text-brand-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          图片提示词模板
        </button>
        <button
          type="button"
          onClick={() => setTab("systemPrompts")}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "systemPrompts"
              ? "border-brand-500 text-brand-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          LLM 系统提示词
        </button>
      </div>

      {tab === "imageTemplates" && (
        <>
      {/* 说明条 */}
      <div className="mb-5 rounded-md bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">
        在此新增、编辑提示词。修改后自动保存，并应用于所有企划的提示词设定。各企划的「提示词设定」页仅可选择此处已存在的提示词，无法修改。
      </div>

      {/* 模板选择列表 */}
      <div className="mb-6">
        <label className="mb-3 block text-sm font-medium text-slate-700">提示词列表</label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {templates.map((tpl) => {
            const isSelected = selectedId === tpl.id;
            const isBuiltin = isBuiltinPreset(tpl.id);
            return (
              <div
                key={tpl.id}
                className={`group relative rounded-lg border-2 px-4 py-3 text-left transition-all ${
                  isSelected
                    ? "border-brand-500 bg-brand-50/50 shadow-sm"
                    : "border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/30"
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectTemplate(tpl.id)}
                  className="block w-full pr-6 text-left"
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold ${isSelected ? "text-brand-800" : "text-slate-700"}`}>
                      {tpl.name}
                    </span>
                    {isSelected && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-brand-600">
                        <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{tpl.description}</p>
                  {isBuiltin && (
                    <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                      内置
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteTemplate(tpl.id)}
                  className="absolute right-1.5 top-1.5 rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                  title="删除该提示词"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            );
          })}
          {/* 新增模板按钮 */}
          <button
            type="button"
            onClick={handleAddTemplate}
            className="flex items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 bg-white/40 py-3 text-sm text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-500"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            新增提示词
          </button>
        </div>
      </div>

      {/* 模板编辑区 */}
      {editingTemplate && (
        <div className="space-y-4">
          <div className="border-t border-slate-200 pt-4">
            <span className="text-sm font-medium text-slate-700">
              提示词编辑 - {editingTemplate.name}
            </span>
          </div>

          <TemplateField label="名称">
            <input
              type="text"
              value={editingTemplate.name}
              onChange={(e) => updateField("name", e.target.value)}
              className="ss-input"
              placeholder="提示词名称"
            />
          </TemplateField>

          <TemplateField label="描述" hint="简短说明该提示词的特色">
            <input
              type="text"
              value={editingTemplate.description}
              onChange={(e) => updateField("description", e.target.value)}
              className="ss-input"
              placeholder="如：电影级写实，自然光影"
            />
          </TemplateField>

          <TemplateField label="人物图片提示词" hint="包含三视图要求，拼接到 LLM 生成的提示词末尾">
            <textarea
              value={editingTemplate.characterTemplate}
              onChange={(e) => updateField("characterTemplate", e.target.value)}
              className="ss-input resize-y"
              rows={4}
            />
            <ReferenceImageField
              label="人物参考图"
              imageUrl={editingTemplate.characterReferenceImage}
              imageConfigured={imageConfigured}
              cosConfigured={cosConfigured}
              uploading={uploadingField === "characterReferenceImage"}
              generating={
                (generatingRef && genField === "characterReferenceImage") ||
                resumingRefKeys.has(`${editingTemplate.id}:characterReferenceImage`)
              }
              onUploadFile={(f) => void handleUploadRefFile("characterReferenceImage", f)}
              onSetUrl={(url) => updateField("characterReferenceImage", url)}
              onGenerate={() => openRefGenerateDialog("characterReferenceImage")}
              onRemove={() => updateField("characterReferenceImage", "")}
            />
          </TemplateField>

          <TemplateField label="场景图片提示词">
            <textarea
              value={editingTemplate.sceneTemplate}
              onChange={(e) => updateField("sceneTemplate", e.target.value)}
              className="ss-input resize-y"
              rows={3}
            />
            <ReferenceImageField
              label="场景参考图"
              imageUrl={editingTemplate.sceneReferenceImage}
              imageConfigured={imageConfigured}
              cosConfigured={cosConfigured}
              uploading={uploadingField === "sceneReferenceImage"}
              generating={
                (generatingRef && genField === "sceneReferenceImage") ||
                resumingRefKeys.has(`${editingTemplate.id}:sceneReferenceImage`)
              }
              onUploadFile={(f) => void handleUploadRefFile("sceneReferenceImage", f)}
              onSetUrl={(url) => updateField("sceneReferenceImage", url)}
              onGenerate={() => openRefGenerateDialog("sceneReferenceImage")}
              onRemove={() => updateField("sceneReferenceImage", "")}
            />
          </TemplateField>

          <TemplateField label="物品图片提示词">
            <textarea
              value={editingTemplate.objectTemplate}
              onChange={(e) => updateField("objectTemplate", e.target.value)}
              className="ss-input resize-y"
              rows={3}
            />
            <ReferenceImageField
              label="物品参考图"
              imageUrl={editingTemplate.objectReferenceImage}
              imageConfigured={imageConfigured}
              cosConfigured={cosConfigured}
              uploading={uploadingField === "objectReferenceImage"}
              generating={
                (generatingRef && genField === "objectReferenceImage") ||
                resumingRefKeys.has(`${editingTemplate.id}:objectReferenceImage`)
              }
              onUploadFile={(f) => void handleUploadRefFile("objectReferenceImage", f)}
              onSetUrl={(url) => updateField("objectReferenceImage", url)}
              onGenerate={() => openRefGenerateDialog("objectReferenceImage")}
              onRemove={() => updateField("objectReferenceImage", "")}
            />
          </TemplateField>

          <TemplateField label="故事板图片提示词" hint="可用 {镜头信息} 占位符标记镜头信息插入位置；无占位符时镜头信息追加在末尾">
            <textarea
              value={editingTemplate.storyboardTemplate}
              onChange={(e) => updateField("storyboardTemplate", e.target.value)}
              className="ss-input resize-y"
              rows={6}
            />
          </TemplateField>
        </div>
      )}

      <ImageGenerationDialog
        open={genOpen}
        onClose={() => setGenOpen(false)}
        initialPrompt={genInitialPrompt}
        initialConfig={genConfig}
        images={genImages}
        onImagesChange={setGenImages}
        imageOptions={imageOptions}
        loading={generatingRef}
        title="生成参考图"
        confirmText="生成参考图"
        onConfirm={(params) => {
          void handleRefGenerateConfirm(params);
        }}
      />
        </>
      )}

      {/* LLM 系统提示词 Tab */}
      {tab === "systemPrompts" && (
        <div className="space-y-5">
          {/* 说明条 */}
          <div className="rounded-md bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">
            在此编辑各步骤调用 LLM 时使用的系统提示词。修改后自动保存，全局生效（应用于所有企划）。含 <code className="rounded bg-amber-100 px-1">{"{占位符}"}</code> 的提示词请保留占位符，否则动态内容无法注入。
          </div>

          {/* 全部恢复默认 */}
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={handleResetAllPrompts}>
              全部恢复默认
            </Button>
          </div>

          {/* 按分组渲染 */}
          {SYSTEM_PROMPT_GROUP_ORDER.map((group) => {
            const keys = (Object.keys(SYSTEM_PROMPT_META) as SystemPromptKey[]).filter(
              (k) => SYSTEM_PROMPT_META[k].group === group
            );
            if (keys.length === 0) return null;
            return (
              <section key={group}>
                <h3 className="mb-2 text-sm font-semibold text-slate-700">{group}</h3>
                <div className="space-y-4">
                  {keys.map((key) => {
                    const meta = SYSTEM_PROMPT_META[key];
                    const customized = isCustomized(key);
                    return (
                      <div key={key} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="mb-1.5 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-800">{meta.label}</span>
                            {customized && (
                              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
                                已修改
                              </span>
                            )}
                          </div>
                          {customized && (
                            <button
                              type="button"
                              onClick={() => handleResetPrompt(key)}
                              className="rounded-md px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                            >
                              恢复默认
                            </button>
                          )}
                        </div>
                        <p className="mb-1.5 text-xs text-slate-400">{meta.description}</p>
                        <textarea
                          value={customPrompts[key]}
                          onChange={(e) => updatePrompt(key, e.target.value)}
                          rows={Math.min(12, Math.max(6, Math.ceil(customPrompts[key].length / 60)))}
                          className="w-full rounded-md border border-slate-200 p-2 font-mono text-xs leading-relaxed text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                          spellCheck={false}
                        />
                        {meta.placeholders && meta.placeholders.length > 0 && (
                          <div className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                            <span className="font-medium">可用占位符：</span>
                            {meta.placeholders.map((p) => (
                              <span key={p.token} className="mr-2">
                                <code className="rounded bg-slate-100 px-1 text-slate-600">{p.token}</code>
                                <span className="ml-0.5">（{p.meaning}）</span>
                              </span>
                            ))}
                            <span className="text-amber-600">请保留这些占位符</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <style jsx>{`
        :global(.ss-input) {
          width: 100%;
          border-radius: 8px;
          border: 1px solid #D9D3C8;
          background: #fff;
          padding: 10px 14px;
          font-size: 13px;
          color: #44403C;
          line-height: 1.6;
        }
        :global(.ss-input:focus) {
          outline: none;
          border-color: #D97706;
          box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.2);
        }
        :global(.ss-input::placeholder) {
          color: #A8A29E;
        }
      `}</style>
    </main>
  );
}

function TemplateField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="text-sm font-medium text-slate-700">{label}</label>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** 风格模板参考图管理区域：支持上传 / 添加 URL / 生成图片 / 移除 */
function ReferenceImageField({
  label,
  imageUrl,
  imageConfigured,
  cosConfigured,
  uploading,
  generating,
  onUploadFile,
  onSetUrl,
  onGenerate,
  onRemove,
}: {
  label: string;
  imageUrl?: string;
  imageConfigured: boolean;
  cosConfigured: boolean;
  uploading: boolean;
  generating: boolean;
  onUploadFile: (file: File) => void;
  onSetUrl: (url: string) => void;
  onGenerate: () => void;
  onRemove: () => void;
}) {
  const [urlMode, setUrlMode] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const hasImage = !!imageUrl && imageUrl.trim() !== "";

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50/60 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        {hasImage && <span className="text-[10px] text-amber-600">已设为提示词参考</span>}
      </div>
      <div className="flex items-start gap-3">
        {hasImage ? (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-amber-300">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt={label} className="h-full w-full object-cover" />
            <span className="absolute left-0 top-0 rounded-br bg-amber-500 px-1 text-[9px] font-medium text-white">
              提示词参考
            </span>
          </div>
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 text-[10px] text-slate-400">
            无参考图
          </div>
        )}
        <div className="flex flex-1 flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || generating || !cosConfigured}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-600 disabled:opacity-50"
          >
            {uploading ? "上传中…" : hasImage ? "重新上传" : "上传图片"}
          </button>
          <button
            type="button"
            onClick={() => {
              setUrlMode(!urlMode);
              setUrlInput("");
            }}
            disabled={generating}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-600 disabled:opacity-50"
          >
            {hasImage ? "替换URL" : "添加URL"}
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={!imageConfigured || uploading || generating}
            className="rounded border border-brand-300 bg-white px-2 py-1 text-xs text-brand-600 transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50"
          >
            {generating ? "生成中…" : hasImage ? "重新生成" : "生成图片"}
          </button>
          {hasImage && (
            <button
              type="button"
              onClick={onRemove}
              disabled={uploading || generating}
              className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              移除
            </button>
          )}
        </div>
      </div>
      {urlMode && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="粘贴图片 URL（baseUrl）"
            className="ss-input flex-1"
          />
          <button
            type="button"
            onClick={() => {
              const u = urlInput.trim();
              if (u) {
                onSetUrl(u);
                setUrlMode(false);
                setUrlInput("");
              }
            }}
            className="rounded bg-brand-600 px-2.5 py-1 text-xs text-white transition-colors hover:bg-brand-700"
          >
            确认
          </button>
          <button
            type="button"
            onClick={() => {
              setUrlMode(false);
              setUrlInput("");
            }}
            className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-500"
          >
            取消
          </button>
        </div>
      )}
      {!cosConfigured && (
        <p className="mt-1.5 text-[11px] text-slate-400">
          未配置 COS 存储，上传与生成转存不可用；可使用「添加URL」直接填入图片地址。
        </p>
      )}
      {!imageConfigured && (
        <p className="mt-1 text-[11px] text-slate-400">未配置图片生成 API，「生成图片」不可用。</p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
