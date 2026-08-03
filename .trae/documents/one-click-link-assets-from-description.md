# 一键关联画面描述 @资产 到参考图

## 需求摘要

在 Step4 视频生成卡片的「参考图」区域新增一个「一键关联」按钮：

- 在「参考图（N）· 关联资产自动作为参考图」标题行右侧增加一个按钮，点击后根据当前镜头画面描述里的 `@名称` 标签，把匹配到的资产关联到该镜头（已关联的跳过）。
- **移除** 当前在「参考图」列表为空时显示的「画面描述中无 @标签，未关联任何资产」空状态提示。

## 当前状态分析

相关文件与逻辑：

- `components/VideoGeneration.tsx`：Step4 视频生成卡片主组件，负责渲染参考图区域、管理镜头视频配置。
- `lib/types.ts`：
  - `Shot.relatedAssetIds: string[]` 存储镜头关联的资产 ID。
  - `Shot.visualDescription: string` 存储画面描述文本。
  - `Asset` 包含 `id`、`name`、`imageUrl` 等字段。
- `lib/utils.ts`：提供 `extractTags(text)` 从文本中提取 `@名称` 标签（按出现顺序、不去重）。
- `app/episode/[id]/page.tsx`：提供 `handleLinkAsset(shotId, assetId)` 用于把资产 ID 加入 `Shot.relatedAssetIds`（已做去重）。

当前行为：

- 进入 Step4 时，`VideoGeneration.tsx` 通过 `useEffect` + `didAutoLink` ref 自动执行一次关联：遍历所有镜头，提取画面描述中的 @标签，按名称（小写）匹配 `episode.assets`，把匹配到的资产 ID 写入 `relatedAssetIds`（第 329-346 行）。
- 参考图区域标题位于第 2617-2620 行，空状态提示位于第 2623-2627 行：
  ```tsx
  {relatedAssets.length === 0 && (
    <span className="text-[11px] text-slate-400">
      画面描述中无 @标签，未关联任何资产
    </span>
  )}
  ```
- 关联资产列表 `relatedAssets` 由 `getRelatedAssets(shot)` 从 `shot.relatedAssetIds` 计算得出（第 535-544 行）。

## 方案设计

### 1. 新增「一键关联」按钮

在参考图标题行 `参考图（N）· 关联资产自动作为参考图` 的右侧添加一个按钮。

按钮行为：

- 点击时，对当前镜头执行：
  1. 调用 `extractTags(shot.visualDescription)` 提取所有 @标签名。
  2. 遍历标签名，使用已有的 `assetIdByName` Map（小写名称 -> 资产 ID）查找匹配资产。
  3. 若资产存在且未在 `shot.relatedAssetIds` 中，则调用 `onLinkAsset(shot.id, assetId)`。
- 按钮文案：**一键关联**
- 按钮样式：沿用现有小尺寸按钮风格，例如 `rounded px-1.5 py-1 text-[11px] text-brand-600 hover:bg-brand-50`（参考 `components/AssetLibrary.tsx:606` 的轻量按钮风格），避免与标题争夺视觉权重。
- 禁用状态：当画面描述中没有任何 @标签，或者所有 @标签对应的资产都已关联时，按钮置灰禁用并显示为 `text-slate-400`。

### 2. 复用现有自动关联逻辑

为了避免重复实现，建议把当前 `useEffect` 中的关联逻辑抽取为一个局部函数 `linkMentionedAssets(shot: Shot)`，供：

- 进入 Step4 时的 `useEffect` 自动调用（保留现有自动关联行为）。
- 「一键关联」按钮点击时手动调用。

抽取位置：`components/VideoGeneration.tsx` 中 `assetIdByName` 定义之后、`useEffect` 之前。

伪代码：

```tsx
function linkMentionedAssets(shot: Shot) {
  const tagNames = extractTags(shot.visualDescription);
  for (const tagName of tagNames) {
    const assetId = assetIdByName.get(tagName.toLowerCase());
    if (assetId && !shot.relatedAssetIds?.includes(assetId)) {
      onLinkAsset(shot.id, assetId);
    }
  }
}
```

原 `useEffect` 简化为：

```tsx
useEffect(() => {
  if (didAutoLink.current) return;
  if (episode.assets.length === 0 || episode.shots.length === 0) return;
  didAutoLink.current = true;
  for (const shot of episode.shots) {
    linkMentionedAssets(shot);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [episode.assets.length, episode.shots.length, assetIdByName, onLinkAsset]);
```

按钮点击直接调用 `linkMentionedAssets(shot)`。

### 3. 按钮可点击性判断

在渲染按钮时计算：

```tsx
const mentionedAssetIds = useMemo(() => {
  const ids: string[] = [];
  for (const tagName of extractTags(shot.visualDescription)) {
    const assetId = assetIdByName.get(tagName.toLowerCase());
    if (assetId && !ids.includes(assetId)) ids.push(assetId);
  }
  return ids;
}, [shot.visualDescription, assetIdByName]);

const canLink = mentionedAssetIds.some((id) => !shot.relatedAssetIds?.includes(id));
```

由于该计算已在 `VideoCard` 子组件内部，可直接基于当前 `shot` 计算；需要在 `VideoCard` 中额外传入 `assetIdByName` 或通过父组件传入无参回调 `onLinkMentionedAssets`。

实现方式：在父组件定义 `const linkMentionedAssets = useCallback((shot: Shot) => { ... }, [assetIdByName, onLinkAsset]);`，给 `VideoCard` 新增 prop `onLinkMentionedAssets: () => void`，渲染时传入 `onLinkMentionedAssets={() => linkMentionedAssets(shot)}`。`VideoCard` 内部仅负责展示按钮与点击回调，不直接依赖 `assetIdByName`。

## 具体改动文件

### `components/VideoGeneration.tsx`

1. **新增 `linkMentionedAssets` 函数**（第 328 行 `useEffect` 之前）：
   - 输入：`shot: Shot`
   - 行为：提取 @标签 -> 按名匹配资产 -> 未关联则调用 `onLinkAsset`

2. **简化自动关联 `useEffect`**（第 329-346 行）：
   - 将循环体替换为 `linkMentionedAssets(shot)`

3. **给 `VideoCard` 新增 `onLinkMentionedAssets` prop**：
   - 类型：`(shot: Shot) => void` 或 `() => void`；父组件传入已绑定当前 shot 的回调。

4. **修改参考图标题行**（第 2617-2620 行）：
   - 在右侧添加「一键关联」按钮
   - 按钮 `onClick={() => onLinkMentionedAssets()}`
   - 根据 `canLink` 控制禁用状态与颜色

5. **删除空状态提示**（第 2623-2627 行）：
   - 移除整个 `{relatedAssets.length === 0 && (...)}` 条件渲染块

## 假设与决策

- **保留自动关联**：进入 Step4 时仍会首次自动关联，「一键关联」按钮用于用户在 Step4 内修改画面描述后手动补关联。
- **关联目标是 `relatedAssetIds`**：按钮把资产加入镜头的关联资产列表，关联资产已自动作为参考图展示，无需再写入 `referenceImageAssetUrls`。
- **匹配规则与现有逻辑一致**：按 @标签名的小写匹配资产 `name` 的小写，使用现有 `assetIdByName` Map。
- **按钮位置**：放在参考图标题行右侧，与截图中红色框 2 的位置一致。
- **按钮文案**：使用「一键关联」，简洁明确。
- **移除空状态提示**：用户后续确认无需保留该文案，因此已移除。

## 验证步骤

1. 打开某一 Episode 的 Step4 视频生成页面。
2. 确认画面描述中无 @标签时，参考图区域不再显示「画面描述中无 @标签，未关联任何资产」。
3. 在画面描述中输入 `@韩立 @南宫婉` 等已存在资产的名称。
4. 点击「一键关联」按钮，对应资产缩略图应出现在参考图列表中。
5. 再次点击「一键关联」按钮，不应重复添加，也不应报错。
6. 删除画面描述中的某个 @标签，解除对应资产关联后，重新点击「一键关联」，应重新关联。
7. 运行 `npm run lint` 和 `npm run typecheck`（或项目已有命令）确保无类型/语法错误。
