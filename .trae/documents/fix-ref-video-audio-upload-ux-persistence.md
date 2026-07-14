# 修复多模态参考视频/音频上传 UX 与持久化问题

## 摘要

用户反馈两个问题：
1. **上传方式不明显**：多模态模式下参考视频/音频的上传入口是 `variant="ghost"` 小按钮"参考视频（0/3）"，不像上传操作；上传后仅显示 `text-[11px]` 的微小 chip，难以察觉。
2. **上传后没有保存下来（刷新后消失）**：上传成功后 chip 出现（状态已更新），但刷新页面后数据丢失。

经全链路排查，持久化链路（浅合并 → setEpisode → debounced persist → saveEpisode → POST → SQLite JSON.stringify/parse）本身不丢字段。根因是：
- `persist(next)` 在 `setEpisode` updater 函数内部调用（React 反模式：reducer 内执行副作用），在 React 18 concurrent 渲染下可能不可靠。
- 400ms 防抖无 `beforeunload` 兜底：用户上传后 400ms 内刷新页面，防抖未触发，数据丢失。

## 当前状态分析

### 持久化流程（`app/episode/[id]/page.tsx`）

```tsx
// L46-58: persist 是 400ms 防抖函数
const persist = useCallback(
  debounce(async (ep: Episode) => {
    const result = await saveEpisode(ep);
    ...
  }, 400),
  []
);

// L60-68: update 在 setEpisode updater 内调用 persist（反模式）
function update(mut: (ep: Episode) => Episode) {
  setEpisode((prev) => {
    if (!prev) return prev;
    const next = mut({ ...prev });
    next.updatedAt = Date.now();
    persist(next);          // ← 副作用在 reducer 内
    return next;
  });
}
```

- 无 `beforeunload` / `visibilitychange` 兜底（grep 确认 `episodeRef` 仅定义未用于卸载保存）。
- `episodeRef.current = episode`（L43-44）已就绪，可直接用于卸载时保存。

### 上传 UI（`components/VideoGeneration.tsx`）

当前参考视频/音频上传（multimodal-ref 模式输入素材区内，L901-939）：
- 上传入口：`<Button size="sm" variant="ghost">参考视频（0/3）</Button>` — ghost 样式，无上传图标，像标签不像操作按钮。
- 上传后展示：`<span className="text-[11px]">视频1 ×</span>` — 极小 chip，无文件类型图标。
- `FrameImageUpload`（L526-582）已有更好的范式：虚线框上传区 + 缩略图预览 + "更换"/"×"按钮，但仅用于图片。

### 关键确认
- `Button` 组件 `disabled={disabled || loading}`（L40）：上传中按钮禁用，不存在并发上传的 stale closure 风险。
- `uploadRefFile`（cos-client.ts L53-82）所有失败路径均 `throw`，不会静默返回 undefined。
- `handleUpdateVideoConfig`（page.tsx L282-291）浅合并 `{ ...base, ...patch }` 正确，不丢字段。

---

## 改动方案

### 改动 1 · 持久化修复（`app/episode/[id]/page.tsx`）

**1a. 将 `persist` 从 `setEpisode` updater 移到 `useEffect`**

移除 `update()` 中的 `persist(next)` 调用，改为 `useEffect` 监听 `episode` 变化后触发防抖保存：

```tsx
// update 不再调用 persist
function update(mut: (ep: Episode) => Episode) {
  setEpisode((prev) => {
    if (!prev) return prev;
    const next = mut({ ...prev });
    next.updatedAt = Date.now();
    return next;
  });
}

// 新增：useEffect 监听 episode 变化，防抖保存（跳过首次加载）
const skipPersistRef = useRef(true);
useEffect(() => {
  if (!episode) return;
  if (skipPersistRef.current) { skipPersistRef.current = false; return; }
  persist(episode);
}, [episode, persist]);
```

**1b. 添加 `beforeunload` 兜底保存**

```tsx
useEffect(() => {
  const handler = () => {
    const ep = episodeRef.current;
    if (!ep) return;
    fetch("/api/data/episodes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_STORAGE_TOKEN ?? ""}`,
      },
      body: JSON.stringify(ep),
      keepalive: true,
    });
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}, []);
```

> `keepalive: true` 确保请求在页面卸载后仍能完成。auth token 是 `NEXT_PUBLIC_` 前缀（客户端可见），可直接在 `beforeunload` 中使用。

### 改动 2 · 参考视频/音频上传 UX 改进（`components/VideoGeneration.tsx`）

**2a. 新增 `MediaUploadArea` 组件**

仿照 `FrameImageUpload` 的虚线框范式，为视频/音频创建统一上传组件：

```tsx
/** 参考视频/音频上传区（虚线框 + 已上传项卡片列表） */
function MediaUploadArea({
  label,         // "参考视频" | "参考音频"
  icon,          // "📹" | "🎵"
  items,         // string[] 已上传 URL 列表
  uploading,     // boolean
  max,           // 3
  onUpload,      // () => void  触发文件选择
  onRemove,      // (index) => void
  onAddAsset,    // () => void  打开 asset:// 素材ID 输入
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] text-slate-500">
        {label}（{items.length}/{max}）
      </span>
      {/* 已上传项：卡片列表 */}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((u, i) => (
            <div key={u} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
              <span>{icon}</span>
              <span>{u.startsWith("asset://") ? `素材${i + 1}` : `${i + 1}`}</span>
              <button onClick={() => onRemove(i)} className="text-slate-400 hover:text-red-500" title="移除">×</button>
            </div>
          ))}
        </div>
      )}
      {/* 虚线框上传区 */}
      {items.length < max && (
        <div className="flex items-center gap-2">
          <button
            onClick={onUpload}
            disabled={uploading}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2.5 text-xs text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-600 disabled:opacity-50"
          >
            {uploading ? (<><Spinner size={14} /> 上传中…</>) : (<>{icon} + 上传{label}</>)}
          </button>
          <Button size="sm" variant="ghost" onClick={onAddAsset} disabled={items.length >= max}>
            + 素材ID
          </Button>
        </div>
      )}
    </div>
  );
}
```

**2b. 替换 multimodal-ref 输入素材区中的参考视频/音频区块**

将当前 L901-939 的 ghost 按钮 + tiny chip 替换为 `MediaUploadArea`：

```tsx
{/* 参考视频 */}
<MediaUploadArea
  label="参考视频"
  icon="📹"
  items={config.referenceVideoUrls ?? []}
  uploading={uploadingKind === "video"}
  max={3}
  onUpload={() => handleUploadRef("video")}
  onRemove={(i) => onUpdateVideoConfig({ referenceVideoUrls: (config.referenceVideoUrls ?? []).filter((_, j) => j !== i) })}
  onAddAsset={() => { setAssetInputKind("video"); setAssetInputValue(""); }}
/>

{/* 参考音频 */}
<MediaUploadArea
  label="参考音频"
  icon="🎵"
  items={config.referenceAudioUrls ?? []}
  uploading={uploadingKind === "audio"}
  max={3}
  onUpload={() => handleUploadRef("audio")}
  onRemove={(i) => onUpdateVideoConfig({ referenceAudioUrls: (config.referenceAudioUrls ?? []).filter((_, j) => j !== i) })}
  onAddAsset={() => { setAssetInputKind("audio"); setAssetInputValue(""); }}
/>
```

参考图素材（`referenceImageAssetUrls`）保持原有 chip + "添加素材ID" 按钮不变（参考图主要来自关联资产，上传入口非主要需求）。

**2c. 保留 `asset://` 素材ID 内联输入框**

现有的 `assetInputKind` 内联输入逻辑（L941-959）保持不变，仍然由 `MediaUploadArea` 的 `onAddAsset` 触发显示。

---

## 不改动的部分

- `lib/cos-client.ts` `uploadRefFile`：上传逻辑无 bug，不改。
- `handleUploadRef`（L644-675）：Button 上传中禁用，无 stale closure 风险，不改。
- `handleUpdateVideoConfig`（page.tsx L282-291）：浅合并正确，不改。
- `saveEpisode` API 路由：序列化/反序列化链路完整，不改。
- `FrameImageUpload` 组件：首帧/尾帧图片上传已用虚线框范式，不改。
- 参考图素材区：保持现有 chip + 添加素材ID 按钮设计。

## 假设与决策

1. **持久化修复策略**：`useEffect` + `beforeunload` 双保险。`useEffect` 移除 reducer 内副作用的反模式；`beforeunload` 兜底防抖未触发的场景。两者均不改变 400ms 防抖延迟（避免频繁保存）。
2. **首次加载跳过保存**：`skipPersistRef` 确保 `getEpisode` 加载后不立即回存（避免无意义写入）。
3. **上传 UX**：采用虚线框上传区（用户确认），仿 `FrameImageUpload` 范式。已上传项用带图标的卡片（`📹`/`🎵` + 序号 + ×），比原 `text-[11px]` chip 更醒目。
4. **参考图素材不改**：参考图主要来自关联资产自动收集，上传入口非核心需求，保持现有设计。
5. **`beforeunload` 用 `fetch` + `keepalive`**：比 `navigator.sendBeacon` 更灵活（可设 headers），现代浏览器均支持。

## 验证步骤

1. `npx tsc --noEmit` 通过，无类型错误。
2. **持久化验证**：
   - 多模态模式上传一个参考视频 → chip/卡片出现 → 立即刷新页面 → 参考视频仍在（`beforeunload` 兜底）。
   - 上传后等待 1 秒再刷新 → 参考视频仍在（防抖已触发保存）。
   - 上传参考音频同理验证。
3. **UX 验证**：
   - 虚线框上传区清晰可见，"📹 + 上传参考视频"文案明确。
   - 上传后卡片显示 📹 图标 + 序号 + × 按钮，比原 chip 更醒目。
   - 上传中显示 spinner + "上传中…"，按钮禁用。
   - 达到 3 个后上传区隐藏，仅显示卡片列表。
   - "+ 素材ID"按钮可打开内联输入，添加 `asset://` 素材。
4. **回归验证**：
   - 首帧/首尾帧图片上传不受影响（仍用 `FrameImageUpload`）。
   - 其他配置变更（模型/模式/分辨率等）保存正常（`useEffect` 监听 episode 变化）。
   - 首次加载页面不会触发无意义保存（`skipPersistRef`）。
