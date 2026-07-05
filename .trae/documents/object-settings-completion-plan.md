# 物品设定功能 —— 收尾实现计划

## 背景

参考人物设定新增"物品设定"功能。设计决策已确认：标准版字段（名称/分类/外观/功能用途/来源背景/图片）、需要版本管理、单卡片提取按钮。

**重要**：本功能大部分已在上一轮实现，本计划仅覆盖**剩余未完成部分**。

## 当前状态分析（基于 Phase 1 探索）

### 已完成（存在于磁盘，无需重做）
1. [lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts) — `ObjectProfile` 接口 + `Series.objectSettings` 字段 ✓
2. [lib/storage.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/storage.ts#L15) — `normalizeObjectProfile` + `normalizeSeries` objectSettings 兼容 ✓
3. [lib/object-settings.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/object-settings.ts) — `emptyObjectProfile`/`getLatestObjectVersions`/`objectSettingsToText`/`hasObjectSettings` ✓
4. [app/series/[id]/objects/ObjectCard.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/objects/ObjectCard.tsx) — 物品版本卡片 ✓
5. [app/series/[id]/objects/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/objects/page.tsx) — 物品设定页面 ✓
6. [app/series/[id]/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/page.tsx#L167) — "物品设定"导航按钮 ✓
7. [components/ObjectAssetCard.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ObjectAssetCard.tsx) — 物品资产卡片组件 ✓
8. [components/AssetPreparation.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx) — **部分完成**：
   - import ObjectAssetCard（[L10](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L10)）、ObjectProfile 类型、getLatestObjectVersions ✓
   - props `objectSettings`/`onSaveObjectSettings` ✓
   - `objectVersionsByName` memo ✓
   - `handleExtractObject(asset)` 函数（[L167](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L167)）✓
   - `handleGenerateAll` 保留物品图片（objectImageByName）✓
   - `handleGenerateAllImages` 跳过已关联物品 ✓

### 未完成（本计划要做的）
1. **AssetPreparation 渲染循环未接入 object 分支**：[L537-L563](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L537) 当前只判断 character → CharacterAssetCard，其余全走 AssetCard。需增加 object 分支：匹配到 objectVersionsByName → ObjectAssetCard；未匹配 → AssetCard（带提取按钮）。
2. **AssetCard 未加"提取到物品设定"按钮**：AssetCard 组件（[L636+](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L636)）无 `onExtractObject` prop，物品类型卡片无提取入口。
3. **app/episode/[id]/page.tsx 未接入物品设定数据流**：无 `seriesObjectSettings` state、未传入 AssetPreparation、无保存回调。
4. **未做类型检查**。

## 实现方案（剩余步骤）

### 步骤 1：AssetPreparation 渲染循环增加 object 分支
**文件**：`components/AssetPreparation.tsx`（[L537-L563](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L537)）

在 `episode.assets.map` 中，character 分支之后、AssetCard 兜底之前，增加 object 分支：
```tsx
// 物品资产若匹配到物品设定版本，则用物品资产卡片
const objVersions =
  asset.type === "object" ? objectVersionsByName.get(asset.name.trim()) : undefined;
if (objVersions && objVersions.length > 0) {
  return (
    <ObjectAssetCard
      key={asset.id}
      asset={asset}
      versions={objVersions}
      onUpdate={(field, value) => onUpdateAsset(asset.id, field, value)}
    />
  );
}
```
兜底的 AssetCard 调用增加 `onExtractObject`（仅对未匹配的 object 资产有意义）：
```tsx
return (
  <AssetCard
    key={asset.id}
    asset={asset}
    ...
    onExtractObject={
      asset.type === "object" && onSaveObjectSettings
        ? () => handleExtractObject(asset)
        : undefined
    }
  />
);
```

### 步骤 2：AssetCard 增加"提取到物品设定"按钮
**文件**：`components/AssetPreparation.tsx` AssetCard 组件（[L636+](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L636)）

- props 增加 `onExtractObject?: () => void`。
- 在操作按钮区（与"生成图片"/"上传"同行），当 `onExtractObject` 存在时显示一个"提取到物品设定"按钮（variant ghost、size sm）。
- 点击调用 `onExtractObject`。

### 步骤 3：app/episode/[id]/page.tsx 接入物品设定数据流
**文件**：`app/episode/[id]/page.tsx`

- 第 29 行附近新增 state：`const [seriesObjectSettings, setSeriesObjectSettings] = useState<ObjectProfile[]>([]);`，并 import `ObjectProfile` 类型。
- 第 85 行附近新增加载：`setSeriesObjectSettings(seriesData?.objectSettings ?? []);`。
- 第 414-421 行 `<AssetPreparation>` 传入 `objectSettings={seriesObjectSettings}` 和 `onSaveObjectSettings={handleSaveObjectSettings}`。
- 新增 `handleSaveObjectSettings(objects: ObjectProfile[])`：读取最新 series（避免覆盖其他字段），合并 objectSettings 后 `saveSeries`，并更新 state。
  ```ts
  async function handleSaveObjectSettings(objects: ObjectProfile[]) {
    const s = seriesData ?? (await getSeries(episode?.seriesId ?? ""));
    if (!s) return;
    const updated = { ...s, objectSettings: objects };
    await saveSeries(updated);
    setSeriesData(updated);
    setSeriesObjectSettings(objects);
  }
  ```
  （需确认 episode 页面持有 seriesData 的变量名，读取时核实。）

### 步骤 4：类型检查
`npx tsc --noEmit` 通过，无错误。

## 假设与决策
- 不重做已完成部分，仅补齐渲染循环、提取按钮、episode 页面数据流。
- 提取按钮仅对 `type==="object"` 且未关联物品设定的资产显示。
- 提取映射：`asset.imagePrompt → appearance`、`asset.description → purpose`、`asset.imageUrl → imageUrl`（已在 handleExtractObject 中实现）。

## 验证步骤
1. `npx tsc --noEmit` 通过。
2. 资产准备中 `type=object` 未匹配物品设定的卡片显示"提取到物品设定"按钮；点击后卡片转为物品资产卡片（ObjectAssetCard），可切换版本、复用图片。
3. 已关联物品设定的物品资产不参与"批量生成图片"。
4. 一键生成资产信息时已关联物品的图片不丢失。
5. 物品设定页面（/series/{id}/objects）CRUD、版本、图片生成/上传正常（上一轮已完成，仅回归验证）。
