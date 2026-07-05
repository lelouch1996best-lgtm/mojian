# 物品设定功能实现计划

## 需求概述

参考"人物设定"新增一个"物品设定"功能：

1. **物品设定页面**：独立管理物品档案（含多版本），可在页面内新增/编辑/删除物品，生成/上传物品图片。
2. **资产准备提取**：在资产准备（Step3）中，对 `type==="object"` 的普通资产卡片提供"提取到物品设定"按钮；提取后该卡片转化为"物品资产卡片"（`ObjectAssetCard`），可关联/选择物品设定中的版本并复用图片，无需重新生成。

设计决策（已与用户确认）：
- **字段**：标准版 —— 名称、分类（武器/道具/载具等）、外观描述、功能用途、来源背景、图片。
- **版本管理**：需要（仿人物，同一物品可有多版本）。
- **提取交互**：单卡片提取按钮。

## 当前状态分析（基于探索）

- 人物设定架构：`CharacterProfile`（[lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts#L25-L49)）→ `Series.characterSettings`（[types.ts#L62](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts#L62)）→ [lib/character-settings.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/character-settings.ts)（empty/getLatestVersions/toText）→ [人物设定页面](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/page.tsx) + [CharacterCard](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/CharacterCard.tsx)。
- 导航入口在 [app/series/[id]/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/page.tsx#L146-L181) header（世界设定/人物设定/漫剧风格三个按钮）。
- 资产准备 [AssetPreparation.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx)：人物资产通过 `characterVersionsByName`（[L127-L141](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L127)）按 name 匹配，匹配后用 [CharacterAssetCard](file:///Users/hehuajiu/Workbuddy/mojian/components/CharacterAssetCard.tsx) 渲染；批量生图在 [handleGenerateAllImages](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L260) 跳过已关联人物资产。
- 数据流：[app/episode/[id]/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/[id]/page.tsx) 第 29 行 `seriesCharacterSettings` state、第 85 行从 `seriesData.characterSettings` 加载、第 420 行传入 AssetPreparation。
- 风格模板 `getAssetTemplate("object", ...)` 已存在（[style-settings.ts#L132-L133](file:///Users/hehuajiu/Workbuddy/mojian/lib/style-settings.ts#L132)），物品图片生成可直接复用。
- `normalizeSeries`（[storage.ts#L10-L19](file:///Users/hehuajiu/Workbuddy/mojian/lib/storage.ts#L10)）已对 characterSettings 做兼容补全，需同样处理 objectSettings。

## 实现方案

### 第一部分：数据层

#### 1.1 `lib/types.ts`
新增 `ObjectProfile` 接口（仿 `CharacterProfile`）：
```ts
export interface ObjectProfile {
  id: string;
  /** 物品组 ID（同一物品的多个版本共享此 ID） */
  objectId: string;
  version: number;
  versionLabel: string;
  name: string;
  /** 分类（武器/道具/载具等） */
  category: string;
  /** 外观描述 */
  appearance: string;
  /** 功能用途 */
  purpose: string;
  /** 来源背景 */
  origin: string;
  /** 物品形象图 URL */
  imageUrl?: string;
}
```
在 `Series` 接口新增字段：`objectSettings: ObjectProfile[];`（注释：物品设定 —— 每系列独立，跨集共享）。

#### 1.2 `lib/storage.ts`
- `normalizeSeries` 中新增：`objectSettings: (s.objectSettings ?? []).map(normalizeObjectProfile)`。
- 新增 `normalizeObjectProfile(o)`（仿 `normalizeCharacterProfile`，补全 `objectId`（回退 `id`）、`version`（默认 1）、`versionLabel`（默认 `""`））。

#### 1.3 新建 `lib/object-settings.ts`
仿 [lib/character-settings.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/character-settings.ts)，导出纯函数（**不**做全局 localStorage/server 存储，物品设定仅系列级）：
- `emptyObjectProfile()`：返回空白物品档案。
- `getLatestObjectVersions(o: ObjectProfile[]): ObjectProfile[]`：按 `objectId` 分组取最新版本（仿 `getLatestVersions`）。
- `objectSettingsToText(o): string`：生成 LLM 上下文文本（`【物品1：xxx】\n分类：...\n外观：...\n功能：...\n来源：...`），供后续扩展使用。
- `hasObjectSettings(o): boolean`。

### 第二部分：物品设定页面

#### 2.1 新建 `app/series/[id]/objects/page.tsx`
完整复制 [app/series/[id]/characters/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/page.tsx) 并做字段替换：
- `CharacterProfile` → `ObjectProfile`，`characters` state → `objects`，`characterSettings` → `objectSettings`。
- 分组键 `characterId` → `objectId`。
- `emptyCharacterProfile()` → `emptyObjectProfile()`。
- 图片生成模板：`getAssetTemplate("character", ...)` → `getAssetTemplate("object", ...)`，COS 转存 prefix `"ai-script/characters"` → `"ai-script/objects"`。
- 引用 `ObjectCard` 组件。
- 说明文案改为物品设定相关描述。
- 保留：版本管理、分组渲染、保存机制（`saveSeries({...series, objectSettings})`）、图片生成/上传后自动保存（仿人物页面最近修复）。

#### 2.2 新建 `app/series/[id]/objects/ObjectCard.tsx`
复制 [CharacterCard.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/CharacterCard.tsx) 并替换字段：
- 展开详情字段：`role`→`category`（分类）、`appearance`→`appearance`（外观，保留）、`personality`→`purpose`（功能用途）、`background`→`origin`（来源背景）；删除 `genderAge`、`relationships` 两个 Field。
- 版本 badge、删除按钮、重新生成按钮、上传按钮、ImageLightbox 放大预览均保留。
- props 与 CharacterCard 同构（`onUpdate` 的 field 类型为 `keyof ObjectProfile`）。

### 第三部分：导航入口

#### 3.1 `app/series/[id]/page.tsx`
在 header 导航组（[L146-L181](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/page.tsx#L146)）的"人物设定"按钮后新增"物品设定"按钮，跳转 `/series/${id}/objects`。图标用一个物品/方块类 SVG。

### 第四部分：资产准备集成

#### 4.1 新建 `components/ObjectAssetCard.tsx`
复制 [CharacterAssetCard.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/CharacterAssetCard.tsx) 并替换：
- props `versions: ObjectProfile[]`。
- 版本选择器、图片放大、选中态反查（按 `asset.imageUrl` 反查）、刷新恢复逻辑均保留。
- 选择版本时同步到 asset：`imageUrl`、`imagePrompt = appearance`、`description = "外观：xxx；功能：yyy"`（仿人物的"性格；外貌"拼接）、`status`。
- 描述区显示：分类、外观、功能用途、来源背景（只读，来自物品设定）。
- badge 文案"人物"→"物品"。

#### 4.2 `components/AssetPreparation.tsx`
**新增 props**：
```ts
objectSettings?: ObjectProfile[] | null;
onSaveObjectSettings?: (objects: ObjectProfile[]) => void;
```

**新增 `objectVersionsByName` memo**：仿 `characterVersionsByName`（[L127-L141](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L127)），按物品姓名索引所有版本（升序）。

**渲染逻辑**（[L477-L499](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L477) 附近）：在 `episode.assets.map` 中增加 object 分支：
- `type==="object"` 且匹配到 `objectVersionsByName` → 渲染 `ObjectAssetCard`。
- `type==="object"` 未匹配 → 渲染普通 `AssetCard`，并传入新的 `onExtractObject` 回调。

**AssetCard 扩展**：新增可选 prop `onExtractObject?: () => void`；当 `asset.type === "object"` 且存在该回调时，在卡片操作区显示"提取到物品设定"按钮。

**新增 `handleExtractObject(asset)`**：
```ts
function handleExtractObject(asset: Asset) {
  if (!onSaveObjectSettings) return;
  const newObj: ObjectProfile = {
    id: uuid(),
    objectId: uuid(),
    version: 1,
    versionLabel: "v1",
    name: asset.name.trim(),
    category: "",
    appearance: asset.imagePrompt.trim(),
    purpose: asset.description.trim(),
    origin: "",
    imageUrl: asset.imageUrl || "",
  };
  onSaveObjectSettings([...(objectSettings ?? []), newObj]);
}
```
提取后 `objectSettings` 更新 → 该 object 资产按 name 匹配到版本 → 自动转为 `ObjectAssetCard`。

**`handleGenerateAllImages` 跳过已关联物品**（[L265-L272](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L265) 附近）：仿人物跳过逻辑，`type==="object"` 且匹配到 objectVersions 的也跳过批量生图。

**`handleGenerateAll` 一键生成保留图片**（[L162-L166](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPreparation.tsx#L162) 附近）：仿 `charImageByName`，新增 `objectImageByName`，按 name 匹配物品已有 `imageUrl`，避免一键重新生成时丢失物品图片。

#### 4.3 `app/episode/[id]/page.tsx`
- 第 29 行附近新增 state：`const [seriesObjectSettings, setSeriesObjectSettings] = useState<ObjectProfile[]>([]);`。
- 第 85 行附近新增加载：`setSeriesObjectSettings(seriesData?.objectSettings ?? []);`。
- 第 414-421 行 `<AssetPreparation>` 传入 `objectSettings={seriesObjectSettings}` 和 `onSaveObjectSettings={handleSaveObjectSettings}`。
- 新增 `handleSaveObjectSettings(objects)`：合并到 series 并 `saveSeries({...series, objectSettings: objects})`，更新 `seriesObjectSettings` state（参考人物提取的保存模式，需读取最新 series 再合并，避免覆盖其他字段）。

## 假设与决策

1. **物品设定仅系列级**：不实现全局 localStorage/server 物品设定（人物有全局回退属历史遗留，物品无需）。物品不注入 LLM 扩写/分镜上下文（用户未要求），`objectSettingsToText` 预留给未来扩展。
2. **提取映射**：`asset.imagePrompt → appearance`、`asset.description → purpose`、`asset.imageUrl → imageUrl`；`category`、`origin` 留空由用户在物品设定页补充。
3. **不自动预填物品**：与人物"进入 Step3 自动预填"不同，物品仅支持用户手动提取（符合"把普通卡片提取到物品设定"的表述）。
4. **ObjectAssetCard 与 CharacterAssetCard 分离**：字段不同，分别维护，接受少量重复以换取清晰。
5. **数据兼容**：旧 Series 无 `objectSettings` 字段时，`normalizeSeries` 补全为 `[]`，不影响已有数据。

## 验证步骤

1. `npx tsc --noEmit` 通过，无类型错误。
2. 系列详情页出现"物品设定"按钮，点击进入物品设定页面。
3. 物品设定页面：新增物品、新建版本、编辑字段、删除、保存后刷新不丢失。
4. 物品图片：生成、上传、点击放大预览、生成/上传后自动保存。
5. 资产准备：`type=object` 的普通卡片显示"提取到物品设定"按钮；点击后卡片转为物品资产卡片，可切换版本、复用图片。
6. 批量生成图片时跳过已关联物品设定的物品资产。
7. 一键生成资产信息时，已关联物品的图片不丢失。
