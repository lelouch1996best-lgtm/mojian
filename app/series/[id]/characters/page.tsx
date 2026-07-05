"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Button from "@/components/ui/Button";
import { getSeries, saveSeries } from "@/lib/storage";
import { emptyCharacterProfile } from "@/lib/character-settings";
import { uuid } from "@/lib/utils";
import { generateImage, getImageSettings } from "@/lib/image-client";
import { getAssetTemplate } from "@/lib/style-settings";
import { getCosSettings, isCosConfigured } from "@/lib/cos-client";
import type { CharacterProfile, Series } from "@/lib/types";
import { CharacterCard } from "./CharacterCard";

export default function CharacterSettingsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const seriesId = params.id;

  const [series, setSeries] = useState<Series | null>(null);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set());
  const [uploadingImageIds, setUploadingImageIds] = useState<Set<string>>(new Set());
  const [imageConfigured, setImageConfigured] = useState(false);
  const [cosConfigured, setCosConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getImageSettings().then((s) => setImageConfigured(!!s?.apiKey));
    isCosConfigured().then(setCosConfigured);
  }, []);

  const refresh = useCallback(async () => {
    if (!seriesId) return;
    const s = await getSeries(seriesId);
    if (!s) { setNotFound(true); return; }
    setSeries(s);
    setCharacters((s.characterSettings ?? []).map((c) => ({ ...c })));
  }, [seriesId]);

  useEffect(() => { refresh(); }, [refresh]);

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
    setDirty(true);
  }

  function handleAdd() {
    const newChar: CharacterProfile = {
      ...emptyCharacterProfile(), id: uuid(), characterId: uuid(), version: 1, versionLabel: "v1",
    };
    setCharacters((prev) => [...prev, newChar]);
    setExpandedIds((prev) => new Set(prev).add(newChar.id));
    setDirty(true);
  }

  function handleAddVersion(charId: string) {
    const source = characters.find((c) => c.id === charId);
    if (!source) return;
    const sameGroup = characters.filter((c) => (c.characterId || c.id) === (source.characterId || source.id));
    const maxVersion = sameGroup.reduce((max, c) => Math.max(max, c.version ?? 1), 0);
    const newVersion: CharacterProfile = {
      ...source, id: uuid(), characterId: source.characterId || source.id,
      version: maxVersion + 1, versionLabel: `v${maxVersion + 1}`,
    };
    setCharacters((prev) => [...prev, newVersion]);
    setExpandedIds((prev) => new Set(prev).add(newVersion.id));
    setDirty(true);
  }

  function handleDelete(id: string) {
    if (!confirm("确定删除该人物版本？")) return;
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    setExpandedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setDirty(true);
  }

  /** 为人物生成图片（外貌描述 + 漫剧风格模板） */
  async function handleGenerateImage(char: CharacterProfile) {
    if (!char.appearance.trim()) {
      setError(`人物「${char.name}」还没有外貌描述，请先填写`);
      return;
    }
    if (!imageConfigured) {
      setError("未配置图片生成 API，请先在「设置」中配置");
      return;
    }
    setError(null);
    setGeneratingImageIds((prev) => new Set(prev).add(char.id));
    try {
      const template = await getAssetTemplate("character", series?.styleSettings ?? null);
      const finalPrompt = template
        ? `${char.appearance.trim()}，${template}`
        : char.appearance.trim();
      const result = await generateImage(finalPrompt);
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

      const updated = characters.map((c) => (c.id === char.id ? { ...c, imageUrl } : c));
      setCharacters(updated);
      // 自动保存到本地存储，避免刷新后丢失
      if (series) {
        await saveSeries({ ...series, characterSettings: updated });
        setSeries({ ...series, characterSettings: updated });
        setDirty(false);
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
      }
    } catch (e) {
      setError(`「${char.name}」图片生成失败：${(e as Error).message}`);
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
      // 自动保存到本地存储，避免刷新后丢失
      if (series) {
        await saveSeries({ ...series, characterSettings: updated });
        setSeries({ ...series, characterSettings: updated });
        setDirty(false);
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
      }
    } catch (e) {
      setError(`「${char.name}」图片上传失败：${(e as Error).message}`);
    } finally {
      setUploadingImageIds((prev) => { const n = new Set(prev); n.delete(char.id); return n; });
    }
  }

  async function handleSave() {
    if (!series) return;
    setSaving(true);
    const valid = characters.filter((c) => c.name.trim());
    const updated: Series = { ...series, characterSettings: valid };
    await saveSeries(updated);
    setSeries(updated);
    setCharacters(valid.map((c) => ({ ...c })));
    setDirty(false); setSaving(false);
    setSavedHint(true);
    setTimeout(() => setSavedHint(false), 1500);
  }

  function handleBack() {
    if (dirty && !confirm("有未保存的修改，确定离开？")) return;
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
          <Button size="sm" onClick={handleSave} loading={saving} disabled={!dirty}>保存</Button>
        </div>
      </header>

      <div className="mb-5 rounded-md bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">
        人物设定是整个故事宇宙中角色的档案。同一角色可以有多个版本（如剧情发展中外貌/性格变化）。系统在扩写和分镜生成时默认使用最新版本。也可以在内容扩写完成后，点击「提取人物设定」由 AI 自动提取。
      </div>

      {!imageConfigured && (
        <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          图片生成 API 尚未配置。请返回首页，打开右上角「设置」弹窗，点击底部「图片生成 API」配置。
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {characters.length > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            共 {groupCount} 个角色 · {validCount} 条记录
            {dirty && <span className="ml-2 text-amber-600">● 有未保存的修改</span>}
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
                      onGenerateImage={() => handleGenerateImage(char)}
                      isGenerating={generatingImageIds.has(char.id)}
                      onUploadImage={(file) => handleUploadImage(char, file)}
                      isUploading={uploadingImageIds.has(char.id)} />
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
    </main>
  );
}
