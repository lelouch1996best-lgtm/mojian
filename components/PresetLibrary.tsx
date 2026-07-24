"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ImageLightbox from "@/components/ImageLightbox";
import Spinner from "@/components/ui/Spinner";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { apiClient } from "@/lib/api-client";
import { formatTime } from "@/lib/utils";
import { isCosConfigured, uploadRefFile } from "@/lib/cos-client";
import type { PresetItem, PresetTag, PresetType } from "@/lib/types";

type TypeFilter = "all" | PresetType;

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
  { value: "text", label: "文本" },
];

const PRESET_TYPE_LABELS: Record<PresetType, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  text: "文本",
};

const ADD_TYPE_OPTIONS: { value: PresetType; label: string }[] = [
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
  { value: "text", label: "文本" },
];

function typeAccept(t: PresetType): string {
  if (t === "image") return "image/*";
  if (t === "video") return "video/*";
  return "audio/*";
}

export default function PresetLibrary() {
  const router = useRouter();
  const confirm = useConfirm();
  const [items, setItems] = useState<PresetItem[]>([]);
  const [tags, setTags] = useState<PresetTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [nameSearch, setNameSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [videoPreview, setVideoPreview] = useState<PresetItem | null>(null);
  const [textPreview, setTextPreview] = useState<PresetItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [editTarget, setEditTarget] = useState<PresetItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);

  const refreshPresets = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiClient.listPresets();
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshTags = useCallback(async () => {
    try {
      const list = await apiClient.listPresetTags();
      setTags(list);
    } catch {
      setTags([]);
    }
  }, []);

  useEffect(() => {
    refreshPresets();
    refreshTags();
  }, [refreshPresets, refreshTags]);

  // 视频预览：ESC 关闭 + 禁止滚动
  useEffect(() => {
    if (!videoPreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVideoPreview(null);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [videoPreview]);

  useEffect(() => {
    if (!textPreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTextPreview(null);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [textPreview]);

  const filtered = useMemo(() => {
    const kw = nameSearch.trim().toLowerCase();
    return items.filter((item) => {
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (kw && !item.name.toLowerCase().includes(kw)) return false;
      if (tagFilter.length > 0) {
        const set = new Set(item.tags);
        for (const t of tagFilter) {
          if (!set.has(t)) return false;
        }
      }
      return true;
    });
  }, [items, typeFilter, nameSearch, tagFilter]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected(new Set(filtered.map((i) => i.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function deletePresets(ids: string[], names: string[]) {
    const message =
      ids.length <= 3
        ? `将删除以下 ${ids.length} 个预设，此操作不可撤销：\n${names.map((n) => `• ${n}`).join("\n")}`
        : `将删除 ${ids.length} 个预设，此操作不可撤销。`;
    if (!(await confirm({ title: "确认删除", message, confirmText: "删除" }))) return;
    try {
      await apiClient.deletePresets(ids);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      await refreshPresets();
    } catch (e) {
      alert("删除失败：" + (e as Error).message);
    }
  }

  function requestDeleteSingle(item: PresetItem) {
    deletePresets([item.id], [item.name]);
  }

  function requestDeleteSelected() {
    const targets = filtered.filter((i) => selected.has(i.id));
    if (targets.length === 0) return;
    deletePresets(
      targets.map((i) => i.id),
      targets.map((i) => i.name)
    );
  }

  async function handleCreateTag(name: string): Promise<PresetTag | null> {
    try {
      const res = await apiClient.savePresetTag(name);
      await refreshTags();
      return res.tag;
    } catch (e) {
      alert("创建标签失败：" + (e as Error).message);
      return null;
    }
  }

  async function handleDeleteTags(ids: string[]) {
    try {
      await apiClient.deletePresetTags(ids);
      await refreshTags();
      await refreshPresets();
    } catch (e) {
      alert("删除标签失败：" + (e as Error).message);
    }
  }

  return (
    <div>
      {/* 顶部 header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          onClick={() => router.back()}
          className="text-slate-400 hover:text-slate-600"
          title="返回"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-slate-800">预设库</h1>

        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <button
            onClick={() => setTagManagerOpen(true)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
          >
            管理标签
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          >
            + 添加预设
          </button>
          <button
            onClick={() => { setSelectMode(!selectMode); clearSelection(); }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
              selectMode ? "bg-slate-800 text-white hover:bg-slate-900" : "bg-brand-100 text-brand-700 hover:bg-brand-200"
            }`}
          >
            {selectMode ? "退出多选" : "多选"}
          </button>
          {selectMode && (
            <>
              <span className="text-slate-500">已选 {selected.size} 项</span>
              <button onClick={selectAllVisible} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">全选</button>
              <button onClick={clearSelection} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">清空</button>
              <button
                onClick={requestDeleteSelected}
                disabled={selected.size === 0}
                className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                删除选中
              </button>
            </>
          )}
          {!selectMode && <span className="text-slate-400">共 {filtered.length} 项</span>}
        </div>
      </div>

      {/* 过滤栏 */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-sm font-medium text-slate-500">类型</span>
          {TYPE_OPTIONS.map((opt) => (
            <FilterPill key={opt.value} active={typeFilter === opt.value} onClick={() => setTypeFilter(opt.value)}>
              {opt.label}
            </FilterPill>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-500">名称</span>
          <input
            type="text"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            placeholder="搜索名称"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>

        {tags.length > 0 && (
          <div className="flex w-full items-center gap-1.5">
            <span className="mr-1 shrink-0 text-sm font-medium text-slate-500">标签</span>
            <div className="flex max-h-24 flex-1 flex-wrap gap-1.5 overflow-y-auto">
              <FilterPill active={tagFilter.length === 0} onClick={() => setTagFilter([])}>
                全部
              </FilterPill>
              {tags.map((t) => (
                <FilterPill
                  key={t.id}
                  active={tagFilter.includes(t.name)}
                  onClick={() =>
                    setTagFilter((prev) =>
                      prev.includes(t.name) ? prev.filter((x) => x !== t.name) : [...prev, t.name]
                    )
                  }
                >
                  {t.name}
                </FilterPill>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 内容区 */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
          <Spinner size={18} />
          <span>加载中…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="py-20 text-center text-slate-400">暂无预设，点击「添加预设」创建</div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-slate-400">没有匹配的预设，试试调整筛选条件</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((item) => (
            <PresetCard
              key={item.id}
              item={item}
              selectMode={selectMode}
              selected={selected.has(item.id)}
              onToggleSelect={() => toggleSelect(item.id)}
              onEdit={() => setEditTarget(item)}
              onDelete={() => requestDeleteSingle(item)}
              onPreviewVideo={() => setVideoPreview(item)}
              onPreviewText={() => setTextPreview(item)}
            />
          ))}
        </div>
      )}

      {/* 视频预览模态 */}
      {videoPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm" onClick={() => setVideoPreview(null)}>
          <button
            onClick={() => setVideoPreview(null)}
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
            aria-label="关闭"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <video
            src={videoPreview.url}
            controls
            autoPlay
            className="max-h-[85vh] max-w-[90vw] rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* 文本预览模态 */}
      {textPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setTextPreview(null)}>
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">{textPreview.name}</h3>
              <button onClick={() => setTextPreview(null)} className="text-slate-400 hover:text-slate-600" aria-label="关闭">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <pre className="flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              {textPreview.content}
            </pre>
          </div>
        </div>
      )}

      {/* 添加 / 编辑弹窗 */}
      {addOpen && (
        <PresetEditDialog
          tags={tags}
          initial={null}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); refreshPresets(); }}
          onCreateTag={handleCreateTag}
        />
      )}
      {editTarget && (
        <PresetEditDialog
          tags={tags}
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); refreshPresets(); }}
          onCreateTag={handleCreateTag}
        />
      )}

      {/* 标签管理弹窗 */}
      {tagManagerOpen && (
        <TagManagerDialog
          tags={tags}
          onClose={() => setTagManagerOpen(false)}
          onCreate={handleCreateTag}
          onDelete={handleDeleteTags}
        />
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-brand-600 text-warm-50" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      {children}
    </button>
  );
}

function PresetCard({
  item,
  selectMode,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
  onPreviewVideo,
  onPreviewText,
}: {
  item: PresetItem;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPreviewVideo: () => void;
  onPreviewText: () => void;
}) {
  const isVideo = item.type === "video";
  const isAudio = item.type === "audio";
  const isText = item.type === "text";

  const thumbnail = (
    <div className="group relative aspect-square w-full overflow-hidden bg-slate-100">
      {isVideo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <video muted preload="metadata" src={item.url} className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </>
      ) : isAudio ? (
        <div className="flex h-full w-full items-center justify-center bg-slate-50 p-3">
          <audio controls src={item.url} className="w-full" />
        </div>
      ) : isText ? (
        <div className="flex h-full w-full items-center justify-center bg-amber-50 p-3 text-center">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-amber-400">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M14 2v6h6M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
      )}

      {selectMode ? (
        <div
          className={`absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 backdrop-blur-sm ${
            selected ? "border-brand-500 bg-brand-500 text-white" : "border-white bg-black/30 text-transparent"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      ) : (
        <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {PRESET_TYPE_LABELS[item.type]}
        </span>
      )}

      {!selectMode && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="flex h-7 w-7 items-center justify-center rounded bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
            aria-label="编辑"
            title="编辑"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="flex h-7 w-7 items-center justify-center rounded bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-red-500"
            aria-label="删除"
            title="删除"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      onClick={selectMode ? onToggleSelect : undefined}
      className={`group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-all hover:shadow-md ${
        selectMode ? (selected ? "border-brand-500 ring-2 ring-brand-500/30" : "border-slate-200 hover:border-brand-300") : "border-slate-200 hover:border-brand-300"
      }`}
    >
      {selectMode ? (
        thumbnail
      ) : isVideo ? (
        <div onClick={onPreviewVideo} title="点击播放">{thumbnail}</div>
      ) : isText ? (
        <div onClick={onPreviewText} title="点击查看内容">{thumbnail}</div>
      ) : isAudio ? (
        thumbnail
      ) : (
        <ImageLightbox src={item.url} alt={item.name}>{thumbnail}</ImageLightbox>
      )}

      <div className="flex flex-col gap-1 p-3">
        <span className="line-clamp-1 text-sm font-semibold text-slate-800">{item.name}</span>
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.slice(0, 4).map((t) => (
              <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                {t}
              </span>
            ))}
            {item.tags.length > 4 && (
              <span className="text-[10px] text-slate-400">+{item.tags.length - 4}</span>
            )}
          </div>
        )}
        <div className="text-[11px] text-slate-300">{formatTime(item.createdAt)}</div>
      </div>
    </div>
  );
}

/** 添加 / 编辑预设弹窗 */
function PresetEditDialog({
  tags,
  initial,
  onClose,
  onSaved,
  onCreateTag,
}: {
  tags: PresetTag[];
  initial: PresetItem | null;
  onClose: () => void;
  onSaved: () => void;
  onCreateTag: (name: string) => Promise<PresetTag | null>;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<PresetType>(initial?.type ?? "image");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [selectedTags, setSelectedTags] = useState<string[]>(initial?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [mediaMode, setMediaMode] = useState<"upload" | "url">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cosReady, setCosReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    isCosConfigured().then(setCosReady);
  }, []);

  async function handleFileChange(f: File | null) {
    setFile(f);
    if (!f) {
      setUrl("");
      return;
    }
    if (!cosReady) {
      setError("请先配置存储方式后再上传文件");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const uploaded = await uploadRefFile(f, name.trim() || `preset-${type}-${Date.now()}`);
      setUrl(uploaded);
    } catch (e) {
      setError("文件上传失败：" + (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    if (!name.trim()) {
      setError("请填写名称");
      return;
    }
    if (type === "text") {
      if (!content.trim()) {
        setError("请填写文本内容");
        return;
      }
    } else {
      if (!url) {
        setError(mediaMode === "url" ? "请填写资源 URL" : "请上传文件");
        return;
      }
      if (mediaMode === "url" && !/^https?:\/\//i.test(url)) {
        setError("URL 需以 http(s):// 开头");
        return;
      }
    }

    const now = Date.now();

    setSubmitting(true);
    try {
      // 保存前将标签输入框中尚未生成标签的剩余内容作为一个标签
      const finalTags = [...selectedTags];
      const pending = tagInput.trim();
      if (pending && !finalTags.includes(pending)) {
        const exists = tags.some((x) => x.name === pending);
        if (!exists) {
          const created = await onCreateTag(pending);
          if (!created) return; // 失败提示已在 onCreateTag 内给出
        }
        finalTags.push(pending);
      }

      const item: PresetItem = {
        id: initial?.id ?? crypto.randomUUID(),
        name: name.trim(),
        type,
        url: type === "text" ? "" : url,
        content: type === "text" ? content : "",
        tags: finalTags,
        createdAt: initial?.createdAt ?? now,
        updatedAt: now,
      };

      await apiClient.savePreset(item);
      onSaved();
    } catch (e) {
      setError("保存失败：" + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const isMedia = type !== "text";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting && !uploading) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-base font-semibold text-slate-800">{isEdit ? "编辑预设" : "添加预设"}</h3>

        <div className="space-y-4">
          {/* 类型 */}
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-sm text-slate-500">类型</span>
            <div className="flex gap-1.5">
              {ADD_TYPE_OPTIONS.map((opt) => (
                <FilterPill
                  key={opt.value}
                  active={type === opt.value}
                  onClick={() => !isEdit && setType(opt.value)}
                  disabled={isEdit}
                >
                  {opt.label}
                </FilterPill>
              ))}
            </div>
          </div>

          {/* 名称 */}
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-sm text-slate-500">名称</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="预设名称"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>

          {/* 媒体上传 / 文本编辑 */}
          {isMedia ? (
            <div className="flex items-start gap-2">
              <span className="mt-1.5 w-16 shrink-0 text-sm text-slate-500">文件</span>
              <div className="flex-1 space-y-2">
                {/* 来源方式 */}
                <div className="flex items-center gap-1.5">
                  <FilterPill
                    active={mediaMode === "upload"}
                    onClick={() => setMediaMode("upload")}
                  >
                    上传本地文件
                  </FilterPill>
                  <FilterPill
                    active={mediaMode === "url"}
                    onClick={() => setMediaMode("url")}
                  >
                    粘贴 URL
                  </FilterPill>
                </div>

                {mediaMode === "upload" ? (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={typeAccept(type)}
                      disabled={!cosReady || uploading}
                      onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                      className="hidden"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!cosReady || uploading}
                        className="rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-40"
                      >
                        {uploading ? "上传中…" : isEdit && url ? "重新上传" : "选择文件"}
                      </button>
                      {uploading && <Spinner size={14} />}
                      {file ? (
                        <span className="truncate text-sm text-slate-600">{file.name}</span>
                      ) : isEdit && url ? (
                        <span className="truncate text-sm text-slate-400">已上传文件</span>
                      ) : (
                        <span className="text-sm text-slate-400">未选择文件</span>
                      )}
                    </div>
                    {!cosReady && <p className="text-xs text-amber-600">需先配置存储方式</p>}
                  </>
                ) : (
                  <div className="space-y-1">
                    <input
                      type="text"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="粘贴资源 URL（建议使用持久可访问的地址）"
                      className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                    />
                    <p className="text-xs text-slate-400">直接使用该 URL，不会上传到存储</p>
                  </div>
                )}
                {url && type === "image" && !uploading && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="预览" className="h-32 w-auto rounded-lg border border-slate-200 object-cover" />
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <span className="mt-1.5 w-16 shrink-0 text-sm text-slate-500">内容</span>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="输入文本内容（可随时修改）"
                rows={6}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          )}

          {/* 标签 */}
          <div className="flex items-start gap-2">
            <span className="mt-1.5 w-16 shrink-0 text-sm text-slate-500">标签</span>
            <div className="flex-1">
              <TagInput
                value={selectedTags}
                onChange={setSelectedTags}
                input={tagInput}
                onInputChange={setTagInput}
                allTags={tags}
                onCreateTag={onCreateTag}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting || uploading}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || uploading}
            className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
          >
            {submitting ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 标签输入组合框：可选已有标签或输入新标签（新标签即时持久化） */
function TagInput({
  value,
  onChange,
  input,
  onInputChange,
  allTags,
  onCreateTag,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  input: string;
  onInputChange: (v: string) => void;
  allTags: PresetTag[];
  onCreateTag: (name: string) => Promise<PresetTag | null>;
}) {
  const [showSuggest, setShowSuggest] = useState(false);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const suggestions = useMemo(() => {
    const kw = input.trim().toLowerCase();
    return allTags
      .filter((t) => !selectedSet.has(t.name))
      .filter((t) => !kw || t.name.toLowerCase().includes(kw))
      .slice(0, 20);
  }, [allTags, selectedSet, input]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggest(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function addTag(raw: string) {
    const t = raw.trim();
    if (!t || selectedSet.has(t)) {
      onInputChange("");
      return;
    }
    const exists = allTags.some((x) => x.name === t);
    if (!exists) {
      setCreating(true);
      const created = await onCreateTag(t);
      setCreating(false);
      if (!created) return;
    }
    onChange([...value, t]);
    onInputChange("");
  }

  function removeTag(t: string) {
    onChange(value.filter((x) => x !== t));
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/30">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
            {t}
            <button type="button" onClick={() => removeTag(t)} className="text-brand-400 hover:text-brand-700" aria-label={`移除 ${t}`}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          disabled={creating}
          onChange={(e) => { onInputChange(e.target.value); setShowSuggest(true); }}
          onFocus={() => setShowSuggest(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (input.trim()) addTag(input);
            } else if (e.key === "Backspace" && !input && value.length > 0) {
              removeTag(value[value.length - 1]);
            }
          }}
          placeholder={value.length === 0 ? "输入标签，Enter 添加（可选择已有或新建）" : ""}
          className="min-w-[120px] flex-1 bg-transparent text-sm text-slate-700 outline-none"
        />
        {creating && <Spinner size={12} />}
      </div>

      {showSuggest && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {suggestions.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { addTag(t.name); setShowSuggest(false); }}
              className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-brand-50 hover:text-brand-700"
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 标签管理弹窗：新增 / 删除标签（删除时服务端级联清理预设项） */
function TagManagerDialog({
  tags,
  onClose,
  onCreate,
  onDelete,
}: {
  tags: PresetTag[];
  onClose: () => void;
  onCreate: (name: string) => Promise<PresetTag | null>;
  onDelete: (ids: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const confirm = useConfirm();

  async function handleCreate() {
    const name = input.trim();
    if (!name) return;
    if (tags.some((t) => t.name === name)) {
      setInput("");
      return;
    }
    setCreating(true);
    const created = await onCreate(name);
    setCreating(false);
    if (created) setInput("");
  }

  async function handleDelete(id: string, name: string) {
    if (!(await confirm({ title: "确认删除", message: `确定删除标签「${name}」？将同时从所有使用了该标签的预设中移除。`, confirmText: "删除" }))) return;
    setDeletingId(id);
    onDelete([id]);
    setDeletingId(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">管理标签</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="关闭">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <input
            type="text"
            value={input}
            disabled={creating}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            placeholder="新标签名"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !input.trim()}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
          >
            添加
          </button>
        </div>

        {tags.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">暂无标签</p>
        ) : (
          <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto">
            {tags.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                {t.name}
                <button
                  type="button"
                  disabled={deletingId === t.id}
                  onClick={() => handleDelete(t.id, t.name)}
                  className="text-slate-400 hover:text-red-500 disabled:opacity-40"
                  aria-label={`删除 ${t.name}`}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
