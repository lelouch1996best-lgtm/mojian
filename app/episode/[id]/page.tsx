"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Stepper from "@/components/Stepper";
import ContentExpansion from "@/components/ContentExpansion";
import StoryboardTable from "@/components/StoryboardTable";
import AssetPreparation from "@/components/AssetPreparation";
import VideoGeneration from "@/components/VideoGeneration";
import Button from "@/components/ui/Button";
import CharacterConflictModal, {
  type CharacterConflictItem,
  type ConflictAction,
} from "@/components/CharacterConflictModal";
import { getEpisode, saveEpisode, getEpisodesBySeries, getSeries, saveSeries } from "@/lib/storage";
import { getSettings, PROVIDER_PRESETS } from "@/lib/llm-client";
import { getStyleTemplates } from "@/lib/style-settings";
import { emptyShot, debounce, removeTagPrefix, AUTOSAVE_DEBOUNCE_MS } from "@/lib/utils";
import { useUnloadPersist } from "@/lib/use-unload-persist";
import { getLatestVersions } from "@/lib/character-settings";
import { getLatestObjectVersions } from "@/lib/object-settings";
import { getLatestSceneVersions } from "@/lib/scene-settings";
import type { Asset, Episode, Shot, ShotVideoConfig, VideoStatus, StyleSettings, WorldSettings, CharacterProfile, ObjectProfile, SceneProfile, PreviousEpisodeContext } from "@/lib/types";
import { DEFAULT_SHOT_VIDEO_CONFIG, getDefaultShotVideoConfig } from "@/lib/model-presets";
import type { ReactNode } from "react";

function HoverMenu({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <div className="group relative flex items-center">
      {trigger}
      <div className="absolute right-0 top-full z-50 hidden min-w-[8rem] pt-1 group-hover:block">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {children}
        </div>
      </div>
    </div>
  );
}

function MenuItem({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
    >
      {children}
    </button>
  );
}

export default function EpisodePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [episode, setEpisode] = useState<Episode | null>(null);
  const [seriesOrder, setSeriesOrder] = useState<number>(1);
  const [seriesTitle, setSeriesTitle] = useState<string>("");
  const [seriesStyleSettings, setSeriesStyleSettings] = useState<StyleSettings | null>(null);
  const [seriesWorldSettings, setSeriesWorldSettings] = useState<WorldSettings | null>(null);
  const [seriesCharacterSettings, setSeriesCharacterSettings] = useState<CharacterProfile[]>([]);
  const [seriesObjectSettings, setSeriesObjectSettings] = useState<ObjectProfile[]>([]);
  const [seriesSceneSettings, setSeriesSceneSettings] = useState<SceneProfile[]>([]);
  const [previousEpisodes, setPreviousEpisodes] = useState<PreviousEpisodeContext[]>([]);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  // 用户自定义的默认视频生成参数（videoConfig 惰性写入的合并基座；初始值为代码兜底，加载完成后覆盖）
  const [defaultVideoConfig, setDefaultVideoConfig] = useState<ShotVideoConfig>(DEFAULT_SHOT_VIDEO_CONFIG);
  const [titleEditing, setTitleEditing] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState(false);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflictItems, setConflictItems] = useState<CharacterConflictItem[]>([]);
  const conflictResolverRef = useRef<((items: CharacterConflictItem[]) => void) | null>(null);
  // 当前 LLM 供应商/模型（右下角展示，沿用设置页配置）
  const [llmProviderLabel, setLlmProviderLabel] = useState("");
  const [llmModelLabel, setLlmModelLabel] = useState("");

  const episodeRef = useRef<Episode | null>(null);
  episodeRef.current = episode;

  const persist = useCallback(
    debounce(async (ep: Episode) => {
      const result = await saveEpisode(ep);
      if (!result.ok) {
        setSaveError(result.error ?? "保存失败");
      } else {
        setSaveError(null);
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 1500);
      }
    }, AUTOSAVE_DEBOUNCE_MS),
    []
  );

  function update(mut: (ep: Episode) => Episode) {
    setEpisode((prev) => {
      if (!prev) return prev;
      const next = mut({ ...prev });
      next.updatedAt = Date.now();
      return next;
    });
  }

  // 立即落盘（绕过 1500ms 防抖）：用于 imageTaskId 等关键恢复字段。
  // setTimeout 推迟到渲染提交后读取 episodeRef，避免并发 setEpisode 闭包滞后读到旧值。
  // mutate 可选：基于 ref 快照构造补丁对象直接落库——组件已卸载（提交在飞时切页）
  // 时 setState 无效、ref 不再更新，此时 mutation 直写是 taskId 不丢的唯一保障。
  const persistNow = useCallback((mutate?: (ep: Episode) => Episode) => {
    setTimeout(() => {
      const ep = episodeRef.current;
      if (!ep) return;
      void saveEpisode(mutate ? mutate(ep) : ep);
    }, 0);
  }, []);

  // 监听 episode 变化，防抖保存（跳过首次加载，避免无意义回存）
  const skipPersistRef = useRef(true);
  useEffect(() => {
    if (!episode) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    persist(episode);
  }, [episode, persist]);

  // 卸载兜底落盘：刷新/关闭走 beforeunload，SPA 路由离开走组件卸载 cleanup，
  // 防止 1500ms 防抖未触发导致进行中的视频任务状态丢失。
  useUnloadPersist(() => episodeRef.current, "/api/data/episodes");

  // header 分界线：未滚动时与内容融为一体；滚动后加毛玻璃 + 底部分界线
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 加载当前 LLM 供应商/模型用于右下角展示
  useEffect(() => {
    getSettings().then((s) => {
      if (s) {
        setLlmProviderLabel(PROVIDER_PRESETS[s.provider]?.label ?? s.provider);
        setLlmModelLabel(s.model || "");
      }
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const prev = episodeRef.current;
      if (prev && prev.id !== id) {
        await saveEpisode(prev);
      }
      const ep = await getEpisode(id);
      if (!ep) {
        setNotFound(true);
        return;
      }
      setEpisode(ep);
      setCurrentStep(ep.step);
      // 用户自定义的默认视频生成参数
      getDefaultShotVideoConfig().then(setDefaultVideoConfig);

      // 计算前几集的扩写内容（同系列内），作为扩写时的上下文
      const seriesData = await getSeries(ep.seriesId);
      const allEpisodes = await getEpisodesBySeries(ep.seriesId);
      // 预加载全局风格模板缓存，保证 VideoGeneration 中 sync 函数能正确解析选中风格
      await getStyleTemplates();
      const currentIdx = seriesData?.episodeOrder.indexOf(ep.id) ?? -1;
      setSeriesOrder(currentIdx >= 0 ? currentIdx + 1 : 1);
      setSeriesTitle(seriesData?.title ?? "");
      setSeriesStyleSettings(seriesData?.styleSettings ?? null);
      setSeriesWorldSettings(seriesData?.worldSettings ?? null);
      setSeriesCharacterSettings(seriesData?.characterSettings ?? []);
    setSeriesObjectSettings(seriesData?.objectSettings ?? []);
    setSeriesSceneSettings(seriesData?.sceneSettings ?? []);
      // 前序已有扩写内容的剧集（保留真实集序），作为扩写弹窗的可勾选上下文
      const prevEps: PreviousEpisodeContext[] = allEpisodes
        .map((e, i) => ({ e, orderIndex: i + 1 }))
        .filter(({ e, orderIndex }) => orderIndex - 1 < currentIdx && e.expandedContent.trim())
        .map(({ e, orderIndex }) => ({
          id: e.id,
          orderIndex,
          title: e.title,
          content: e.expandedContent.trim(),
        }));
      setPreviousEpisodes(prevEps);
    })();
  }, [id]);

  // 设定图片同步：系列级人物/物品/场景设定的 imageUrl 更新后，按 名称+类型 同步到 episode.assets 对应资产。
  // 放在常驻的 page 层（early return 之前），无论用户在第三步还是第四步（甚至跳过第三步直进第四步）都生效，
  // 保证 VideoGeneration 读取的 episode.assets 图片与最新设定一致。
  useEffect(() => {
    if (!episode || episode.assets.length === 0) return;
    const latestImageByKey = new Map<string, string>();
    const versionImageUrlsByKey = new Map<string, Set<string>>();
    const addImageUrl = (name: string, type: string, imageUrl?: string) => {
      if (!imageUrl || !name.trim()) return;
      const key = `${name.trim().toLowerCase()}|${type}`;
      const set = versionImageUrlsByKey.get(key);
      if (set) set.add(imageUrl);
      else versionImageUrlsByKey.set(key, new Set([imageUrl]));
    };
    for (const c of getLatestVersions(seriesCharacterSettings)) {
      if (c.imageUrl && c.name.trim()) latestImageByKey.set(`${c.name.trim().toLowerCase()}|character`, c.imageUrl);
    }
    for (const o of getLatestObjectVersions(seriesObjectSettings)) {
      if (o.imageUrl && o.name.trim()) latestImageByKey.set(`${o.name.trim().toLowerCase()}|object`, o.imageUrl);
    }
    for (const s of getLatestSceneVersions(seriesSceneSettings)) {
      if (s.imageUrl && s.name.trim()) latestImageByKey.set(`${s.name.trim().toLowerCase()}|scene`, s.imageUrl);
    }
    for (const c of seriesCharacterSettings ?? []) addImageUrl(c.name, "character", c.imageUrl);
    for (const o of seriesObjectSettings ?? []) addImageUrl(o.name, "object", o.imageUrl);
    for (const s of seriesSceneSettings ?? []) addImageUrl(s.name, "scene", s.imageUrl);
    if (latestImageByKey.size === 0) return;
    const pending: { id: string; imageUrl: string }[] = [];
    for (const a of episode.assets) {
      if (a.type !== "character" && a.type !== "object" && a.type !== "scene") continue;
      // 跳过生成中资产：并发更新 episode 时本 effect 会反复重跑，
      // 若不跳过会把刚生成的新图覆盖回设定旧图，并强制改 status=ready 破坏轮询恢复。
      if (a.status === "pending" || a.imageTaskId) continue;
      const key = `${a.name.toLowerCase()}|${a.type}`;
      const latest = latestImageByKey.get(key);
      // 仅当资产当前图片不属于任何版本（旧图/自定义图）时才同步为最新版图片；
      // 若已绑定到某个具体版本图片，保留用户的版本选择，避免刷新后被回滚到最新版。
      if (latest && latest !== a.imageUrl && !versionImageUrlsByKey.get(key)?.has(a.imageUrl)) {
        pending.push({ id: a.id, imageUrl: latest });
      }
    }
    if (pending.length > 0) {
      update((ep) => ({
        ...ep,
        assets: ep.assets.map((a) => {
          const p = pending.find((x) => x.id === a.id);
          return p ? { ...a, imageUrl: p.imageUrl, status: "ready" as const } : a;
        }),
      }));
    }
  }, [seriesCharacterSettings, seriesObjectSettings, seriesSceneSettings, episode]);

  if (notFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-slate-500">
        <p>未找到该剧集</p>
        <Button onClick={() => router.push("/")}>返回首页</Button>
      </main>
    );
  }

  if (!episode) {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-400">
        加载中…
      </main>
    );
  }

  const step1Done = episode.expandedContent.trim().length > 0;
  const step2Done = episode.shots.length > 0;
  const step3Done = episode.assets.length > 0;

  // ---- Step1 handlers ----
  function handleShotsGenerated(shots: Shot[]) {
    update((ep) => ({ ...ep, shots, step: 2 }));
  }

  /** 提取人物设定后，合并到系列级。已存在同名人物时弹出 Modal 选择：覆盖最新版本/新建版本/跳过 */
  async function handleCharactersExtracted(characters: CharacterProfile[]): Promise<{ added: number; overwritten: number; total: number; skipped: number }> {
    if (!episode) return { added: 0, overwritten: 0, total: 0, skipped: 0 };
    const seriesData = await getSeries(episode.seriesId);
    if (!seriesData) return { added: 0, overwritten: 0, total: 0, skipped: 0 };
    const existingList = seriesData.characterSettings ?? [];
    // 按 name 分组已有人物
    const existingByName = new Map<string, CharacterProfile[]>();
    for (const c of existingList) {
      const arr = existingByName.get(c.name);
      if (arr) arr.push(c);
      else existingByName.set(c.name, [c]);
    }

    let merged = [...existingList];
    let added = 0;
    let overwritten = 0;
    let skipped = 0;

    // 收集冲突项
    const conflicts: CharacterConflictItem[] = [];
    const newCharacters: CharacterProfile[] = [];

    for (const incoming of characters) {
      const existing = existingByName.get(incoming.name);
      if (!existing || existing.length === 0) {
        // 新人物，直接添加
        newCharacters.push(incoming);
        existingByName.set(incoming.name, [incoming]);
        added++;
        continue;
      }
      // 已存在同名，收集到冲突列表（按 version 降序排列已有版本）
      const sorted = [...existing].sort((a, b) => (b.version ?? 1) - (a.version ?? 1));
      conflicts.push({
        incoming,
        existing: sorted,
        action: "overwrite",
      });
    }

    // 若有冲突，弹出 Modal 等待用户选择
    if (conflicts.length > 0) {
      setConflictItems(conflicts);
      setConflictModalOpen(true);
      const resolved = await new Promise<CharacterConflictItem[]>((resolve) => {
        conflictResolverRef.current = resolve;
      });

      // 按用户选择处理
      for (const item of resolved) {
        if (item.action === "skip") {
          skipped++;
          continue;
        }
        if (item.action === "overwrite") {
          // 找到最新版本，覆盖内容字段，保留 id/characterId/version/versionLabel/name/imageUrl
          const latest = item.existing[0];
          const overwrittenProfile: CharacterProfile = {
            ...latest,
            role: item.incoming.role,
            genderAge: item.incoming.genderAge,
            appearance: item.incoming.appearance,
            personality: item.incoming.personality,
            background: item.incoming.background,
            relationships: item.incoming.relationships,
          };
          merged = merged.map((c) => (c.id === latest.id ? overwrittenProfile : c));
          overwritten++;
        } else if (item.action === "newVersion") {
          // 新建版本：继承 characterId，version + 1
          const maxVersion = item.existing.reduce((max, c) => Math.max(max, c.version ?? 1), 0);
          const newVersion: CharacterProfile = {
            ...item.incoming,
            characterId: item.existing[0].characterId,
            version: maxVersion + 1,
            versionLabel: `v${maxVersion + 1}`,
          };
          merged.push(newVersion);
          added++;
        }
      }
    }

    // 合并新人物
    merged = [...merged, ...newCharacters];

    if (added > 0 || overwritten > 0) {
      await saveSeries({ ...seriesData, characterSettings: merged });
      setSeriesCharacterSettings(merged);
    }
    return { added, overwritten, total: merged.length, skipped };
  }

  /** 保存人物设定（资产准备中提取人物资产时调用） */
  async function handleSaveCharacterSettings(characters: CharacterProfile[]) {
    if (!episode) return;
    const seriesData = await getSeries(episode.seriesId);
    if (!seriesData) return;
    await saveSeries({ ...seriesData, characterSettings: characters });
    setSeriesCharacterSettings(characters);
  }

  /** 保存物品设定（资产准备中提取物品资产时调用） */
  async function handleSaveObjectSettings(objects: ObjectProfile[]) {
    if (!episode) return;
    const seriesData = await getSeries(episode.seriesId);
    if (!seriesData) return;
    await saveSeries({ ...seriesData, objectSettings: objects });
    setSeriesObjectSettings(objects);
  }

  /** 保存场景设定（资产准备中提取场景资产时调用） */
  async function handleSaveSceneSettings(scenes: SceneProfile[]) {
    if (!episode) return;
    const seriesData = await getSeries(episode.seriesId);
    if (!seriesData) return;
    await saveSeries({ ...seriesData, sceneSettings: scenes });
    setSeriesSceneSettings(scenes);
  }

  function handleConflictConfirm() {
    setConflictModalOpen(false);
    conflictResolverRef.current?.(conflictItems);
    conflictResolverRef.current = null;
  }

  function handleConflictCancel() {
    setConflictModalOpen(false);
    // 取消 = 全部视为跳过
    conflictResolverRef.current?.(conflictItems.map((c) => ({ ...c, action: "skip" as ConflictAction })));
    conflictResolverRef.current = null;
  }

  // ---- Step2 handlers ----
  /** 重新生成分镜：替换现有 shots（保留 assets，但新镜头的资产关联、@标注会重置） */
  function handleReplaceShots(shots: Shot[]) {
    update((ep) => ({ ...ep, shots }));
  }
  function handleUpdateShot(shotId: string, field: keyof Shot, value: string) {
    update((ep) => ({
      ...ep,
      shots: ep.shots.map((s) => (s.id === shotId ? { ...s, [field]: value } : s)),
    }));
  }
  function handleUpdateVideoStatus(shotId: string, status: VideoStatus, error?: string) {
    const isError = status === "failed" || status === "expired";
    update((ep) => ({
      ...ep,
      shots: ep.shots.map((s) =>
        s.id === shotId ? { ...s, videoStatus: status, videoError: isError ? error : undefined } : s
      ),
    }));
  }
  /** 卡片级视频配置增量更新（惰性写入：首次修改时落库 videoConfig） */
  function handleUpdateVideoConfig(shotId: string, patch: Partial<ShotVideoConfig>) {
    update((ep) => ({
      ...ep,
      shots: ep.shots.map((s) => {
        if (s.id !== shotId) return s;
        const base = s.videoConfig ?? defaultVideoConfig;
        return { ...s, videoConfig: { ...base, ...patch } };
      }),
    }));
  }
  function handleUpdateManyVisuals(
    updates: { id: string; visualDescription: string }[]
  ) {
    update((ep) => {
      const map = new Map(updates.map((u) => [u.id, u.visualDescription]));
      return {
        ...ep,
        shots: ep.shots.map((s) =>
          map.has(s.id) ? { ...s, visualDescription: map.get(s.id)! } : s
        ),
      };
    });
  }

  /** 从所有分镜画面描述中移除某标签的 @ 前缀（删除标注，保留名称） */
  function handleRemoveTag(tagName: string) {
    update((ep) => ({
      ...ep,
      shots: ep.shots.map((s) => ({
        ...s,
        visualDescription: removeTagPrefix(s.visualDescription, tagName),
      })),
    }));
  }
  function handleAddRow() {
    update((ep) => ({ ...ep, shots: [...ep.shots, emptyShot()] }));
  }
  function handleAddSmartShot(shot: Shot) {
    update((ep) => ({ ...ep, shots: [...ep.shots, shot] }));
  }
  function handleDeleteRow(shotId: string) {
    update((ep) => ({ ...ep, shots: ep.shots.filter((s) => s.id !== shotId) }));
  }
  function handleMoveRow(shotId: string, direction: "up" | "down") {
    update((ep) => {
      const idx = ep.shots.findIndex((s) => s.id === shotId);
      if (idx < 0) return ep;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= ep.shots.length) return ep;
      const shots = [...ep.shots];
      [shots[idx], shots[target]] = [shots[target], shots[idx]];
      return { ...ep, shots };
    });
  }

  // ---- Step3 handlers ----
  function handleUpdateAsset(assetId: string, field: keyof Asset, value: string) {
    update((ep) => ({
      ...ep,
      assets: ep.assets.map((a) =>
        a.id === assetId ? { ...a, [field]: value } : a
      ),
    }));
  }
  function handleReplaceAssets(assets: Asset[]) {
    update((ep) => ({ ...ep, assets }));
  }
  /** 删除资产（同时清理分镜中的关联引用） */
  function handleDeleteAsset(assetId: string) {
    update((ep) => ({
      ...ep,
      assets: ep.assets.filter((a) => a.id !== assetId),
      shots: ep.shots.map((s) => ({
        ...s,
        relatedAssetIds: (s.relatedAssetIds ?? []).filter((id) => id !== assetId),
      })),
    }));
  }

  // ---- Step4 handlers ----
  function handleLinkAsset(shotId: string, assetId: string) {
    update((ep) => ({
      ...ep,
      shots: ep.shots.map((s) =>
        s.id === shotId && !s.relatedAssetIds?.includes(assetId)
          ? { ...s, relatedAssetIds: [...(s.relatedAssetIds ?? []), assetId] }
          : s
      ),
    }));
  }
  function handleUnlinkAsset(shotId: string, assetId: string) {
    update((ep) => ({
      ...ep,
      shots: ep.shots.map((s) =>
        s.id === shotId
          ? { ...s, relatedAssetIds: (s.relatedAssetIds ?? []).filter((id) => id !== assetId) }
          : s
      ),
    }));
  }
  function handleAddScreenshot(asset: Asset) {
    update((ep) => ({ ...ep, assets: [...ep.assets, asset] }));
  }

  function gotoStep(step: 1 | 2 | 3 | 4) {
    setCurrentStep(step);
    update((ep) => ({ ...ep, step }));
  }

  return (
    <main className="mx-auto min-h-screen max-w-[1400px] px-4 pb-6 sm:px-6">
      <header
        className={[
          "sticky top-0 z-40 -mx-4 mb-5 px-4 pt-6 sm:-mx-6 sm:px-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3 transition-[background-color,backdrop-filter,border-color] duration-200",
          scrolled
            ? "border-b border-slate-200/70 bg-white/40 backdrop-blur-md"
            : "border-b border-transparent bg-transparent",
        ].join(" ")}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(episode.seriesId ? `/series/${episode.seriesId}` : "/")}
            className="text-slate-400 hover:text-slate-600"
            title="返回企划"
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
          {titleEditing ? (
            <input
              autoFocus
              value={episode.title}
              onChange={(e) =>
                update((ep) => ({ ...ep, title: e.target.value }))
              }
              onBlur={() => setTitleEditing(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setTitleEditing(false);
              }}
              className="rounded border border-brand-400 px-2 py-1 text-lg font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          ) : (
          <h1
            onClick={() => setTitleEditing(true)}
            className="cursor-text text-lg font-semibold text-slate-800"
            title="点击编辑标题"
          >
            {episode.title || "未命名剧集"}
            <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-xs font-normal text-brand-700">
              第{seriesOrder}集
            </span>
          </h1>
          )}
          <span className="text-xs text-slate-400">
            {savedHint ? "已保存 ✓" : saveError ? saveError : ""}
          </span>
        </div>
        <Stepper
          currentStep={currentStep}
          onStepClick={gotoStep}
          step1Done={step1Done}
          step2Done={step2Done}
          step3Done={step3Done}
        />
        <div className="flex items-center justify-end gap-1">
          <HoverMenu
            trigger={
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                title="全局"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </button>
            }
          >
            <MenuItem onClick={() => router.push("/settings")}>设置</MenuItem>
            <MenuItem onClick={() => router.push("/assets")}>资产库</MenuItem>
            <MenuItem onClick={() => router.push("/preset-library")}>预设库</MenuItem>
            <MenuItem onClick={() => router.push("/style-templates")}>风格模板</MenuItem>
          </HoverMenu>

          <HoverMenu
            trigger={
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                title="设定"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12.52 3.621a1 1 0 0 0-1.04 0L2.68 8.998c-.343.205-.558.578-.558.986v5.032c0 .408.215.781.558.986l8.8 5.377a1 1 0 0 0 1.04 0l8.8-5.377c.343-.205.558-.578.558-.986V9.984c0-.408-.215-.781-.558-.986l-8.8-5.377Z" />
                  <path d="M3 9h18" />
                  <path d="M12 21V9" />
                </svg>
              </button>
            }
          >
            <MenuItem onClick={() => router.push(`/series/${episode.seriesId}/world-settings`)}>世界设定</MenuItem>
            <MenuItem onClick={() => router.push(`/series/${episode.seriesId}/characters`)}>人物设定</MenuItem>
            <MenuItem onClick={() => router.push(`/series/${episode.seriesId}/objects`)}>物品设定</MenuItem>
            <MenuItem onClick={() => router.push(`/series/${episode.seriesId}/scenes`)}>场景设定</MenuItem>
            <MenuItem onClick={() => router.push(`/series/${episode.seriesId}/style-settings`)}>风格设定</MenuItem>
          </HoverMenu>
        </div>
      </header>

      {currentStep === 1 ? (
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <ContentExpansion
            originalContent={episode.originalContent}
            expandedContent={episode.expandedContent}
            previousEpisodes={previousEpisodes}
            worldSettings={seriesWorldSettings}
            characterSettings={seriesCharacterSettings}
            objectSettings={seriesObjectSettings}
            sceneSettings={seriesSceneSettings}
            onOriginalChange={(v) =>
              update((ep) => ({ ...ep, originalContent: v }))
            }
            onExpandedChange={(v) =>
              update((ep) => ({ ...ep, expandedContent: v }))
            }
            onShotsGenerated={handleShotsGenerated}
            onEnterStep2={() => gotoStep(2)}
            onCharactersExtracted={handleCharactersExtracted}
          />
        </div>
      ) : currentStep === 2 ? (
        <StoryboardTable
          episode={episode}
          onUpdateShot={handleUpdateShot}
          onUpdateManyVisuals={handleUpdateManyVisuals}
          onAddRow={handleAddRow}
          onAddSmartShot={handleAddSmartShot}
          onDeleteRow={handleDeleteRow}
          onMoveRow={handleMoveRow}
          onBackToStep1={() => gotoStep(1)}
          onEnterStep3={() => gotoStep(3)}
          onRemoveTag={handleRemoveTag}
          onReplaceShots={handleReplaceShots}
          worldSettings={seriesWorldSettings}
          characterSettings={seriesCharacterSettings}
          objectSettings={seriesObjectSettings}
          sceneSettings={seriesSceneSettings}
        />
      ) : currentStep === 3 ? (
        <div className="mx-auto max-w-6xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <AssetPreparation
            episode={episode}
            seriesTitle={seriesTitle}
            onUpdateAsset={handleUpdateAsset}
            onReplaceAssets={handleReplaceAssets}
            onPersistNow={persistNow}
            onBackToStep2={() => gotoStep(2)}
            seriesStyleSettings={seriesStyleSettings}
            characterSettings={seriesCharacterSettings}
            onSaveCharacterSettings={handleSaveCharacterSettings}
            objectSettings={seriesObjectSettings}
            onSaveObjectSettings={handleSaveObjectSettings}
            sceneSettings={seriesSceneSettings}
            onSaveSceneSettings={handleSaveSceneSettings}
            onRemoveTag={handleRemoveTag}
            onDeleteAsset={handleDeleteAsset}
          />
        </div>
      ) : (
        <VideoGeneration
          key={episode.id}
          episode={episode}
          seriesTitle={seriesTitle}
          onUpdateShot={handleUpdateShot}
          onUpdateVideoStatus={handleUpdateVideoStatus}
          onUpdateVideoConfig={handleUpdateVideoConfig}
          onBackToStep3={() => gotoStep(3)}
          onAddRow={handleAddRow}
          onAddSmartShot={handleAddSmartShot}
          onDeleteRow={handleDeleteRow}
          onMoveRow={handleMoveRow}
          onLinkAsset={handleLinkAsset}
          onUnlinkAsset={handleUnlinkAsset}
          onAddScreenshot={handleAddScreenshot}
          onPersistNow={persistNow}
          seriesStyleSettings={seriesStyleSettings}
          characterSettings={seriesCharacterSettings}
          worldSettings={seriesWorldSettings}
          objectSettings={seriesObjectSettings}
          sceneSettings={seriesSceneSettings}
        />
      )}

      <CharacterConflictModal
        open={conflictModalOpen}
        conflicts={conflictItems}
        onActionChange={(i, action) =>
          setConflictItems((prev) =>
            prev.map((c, idx) => (idx === i ? { ...c, action } : c))
          )
        }
        onConfirm={handleConflictConfirm}
        onCancel={handleConflictCancel}
      />

      {/* 右下角：当前对话 API 供应商/模型（沿用设置页配置，不可选择） */}
      {llmProviderLabel && (
        <div className="pointer-events-none fixed bottom-3 right-4 z-40">
          <span
            className="rounded bg-white/80 px-2 py-1 text-[11px] text-slate-500 shadow-sm backdrop-blur"
            title={`当前对话 API 供应商：${llmProviderLabel}${llmModelLabel ? ` · ${llmModelLabel}` : ""}`}
          >
            {llmProviderLabel}{llmModelLabel ? ` · ${llmModelLabel}` : ""}
          </span>
        </div>
      )}

    </main>
  );
}
