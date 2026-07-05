# 场景设定功能实现计划

## 摘要

参考已实现的"物品设定"功能模式，新增"场景设定"功能。包含：独立的场景设定页面（CRUD + 版本管理 + 图片生成/上传）、资产准备中把 `type==="scene"` 的普通资产卡片提取为场景资产卡片（`SceneAssetCard`）、可关联/选择版本并复用图片。场景字段采用**场景特化字段**：名称 / 分类 / 外观描述 / 光影氛围 / 来源背景。

## 当前状态分析

物品设定已完整实现并修复持久化。核心模式：
- 数据层：`ObjectProfile` 类型 + `series.objectSettings` 字段 + SQLite `object_settings` 列 + API 路由 CRUD + `normalizeSeries` 兼容
- 页面层：`app/series/[id]/objects/page.tsx` + `ObjectCard.tsx`
- 资产层：`components/ObjectAssetCard.tsx` + `AssetPreparation` 中 object 分支 + `handleExtractObject`
- episode 数据流：`seriesObjectSettings` state + `handleSaveObjectSettings`
- 工具层：`lib/object-settings.ts`（emptyObjectProfile / getLatestObjectVersions / objectSettingsToText / hasObjectSettings）

场景资产类型 `"scene"` 已存在于 `AssetType`，`getAssetTemplate("scene", ...)` 已支持 `sceneTemplate`，`ASSET_TYPE_LABELS.scene="场景"` 已存在。资产准备中 scene 类型走普通 `AssetCard`，需新增提取能力。

## 拟定改动

完全照搬物品设定模式，对应关系：ObjectProfile→SceneProfile / objectId→sceneId / objectSettings→sceneSettings / object_settings→scene_settings / objects→scenes / ObjectCard→SceneCard / ObjectAssetCard→SceneAssetCard / handleExtractObject→handleExtractScene。

### 1. lib/types.ts — 新增 SceneProfile 接口 + Series 扩展

新增接口（字段用场景特化：appearance + lightingMood 替代 appearance + purpose）：
```typescript
export interface SceneProfile {
  id: string;
  sceneId: string;       // 场景组 ID（同一场景多版本共享）
  version: number;
  versionLabel: string;
  name: string;
  category: string;      // 分类：室内/室外/特定地点等
  appearance: string;    // 外观描述
  lightingMood: string;  // 光影氛围
  origin: string;        // 来源背景
  imageUrl?: string;
}
```
`Series` 接口新增 `sceneSettings: SceneProfile[]`（紧邻 objectSettings）。

### 2. lib/db.ts — 新增 scene_settings 列迁移

仿 object_settings 迁移，在 `getDb()` 末尾追加：
```typescript
try {
  db.prepare("SELECT scene_settings FROM series LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE series ADD COLUMN scene_settings TEXT NOT NULL DEFAULT '[]'");
}
```

### 3. lib/scene-settings.ts — 新建场景设定工具库

仿 lib/object-settings.ts，导出：
- `emptySceneProfile()`: 返回空白 SceneProfile（lightingMood:""）
- `getLatestSceneVersions(s)`: 按 sceneId 分组取 version 最大
- `sceneSettingsToText(s)`: 生成 LLM 上下文文本（含「场景N：名称」「分类」「外观」「光影」「来源」）
- `hasSceneSettings(s)`: 检查是否有有效条目

### 4. lib/storage.ts — normalizeSeries 扩展

- import 增加 `SceneProfile`
- `normalizeSeries` 新增 `sceneSettings: (s.sceneSettings ?? []).map(normalizeSceneProfile)`
- 新增 `normalizeSceneProfile(s)`: 补全 `sceneId = s.sceneId || s.id`、`version ?? 1`、`versionLabel ?? ""`

### 5. lib/utils.ts — emptySeries 补字段

`emptySeries` 返回对象新增 `sceneSettings: []`（避免 TS 报错）。

### 6. app/api/data/series/route.ts — POST + rowToSeries

- POST 的 INSERT/ON CONFLICT 增加 `scene_settings` 列与 `excluded.scene_settings`
- `.run(...)` 参数列表在 `objectSettings` 后插入 `JSON.stringify(body.sceneSettings ?? [])`
- `rowToSeries` 新增 `sceneSettings: safeParse(row.scene_settings, [])` 及 `scene_settings: undefined`

### 7. app/api/data/series/[id]/route.ts — GET 解析

GET 响应新增 `sceneSettings: safeParse(row.scene_settings, [])` 及 `scene_settings: undefined`。

### 8. app/api/migrate/route.ts — 迁移路由补字段

当前迁移 INSERT 缺 character_settings/object_settings/scene_settings（只插了 world/style）。补全 INSERT 列与参数，使 localStorage→server 迁移不丢设定数据（顺带修复 character/object 遗漏）。

### 9. app/series/[id]/scenes/page.tsx — 新建场景设定页面

仿 app/series/[id]/objects/page.tsx，关键替换：
- 类型 `ObjectProfile` → `SceneProfile`，state `objects` → `scenes`
- `emptyObjectProfile` → `emptySceneProfile`
- `getAssetTemplate("object", ...)` → `getAssetTemplate("scene", ...)`
- COS prefix `"ai-script/objects"` → `"ai-script/scenes"`
- import `SceneCard` from `./SceneCard`
- 标题"物品设定"→"场景设定"，说明文案改"场景设定是整个故事宇宙中场景的档案（室内、室外、特定地点等）..."
- 字段引用：`appearance`→`appearance`、`purpose`→`lightingMood`（生成图片时用 appearance；上传逻辑不变）

### 10. app/series/[id]/scenes/SceneCard.tsx — 新建场景版本卡片

仿 ObjectCard.tsx，字段替换：
- `object.category`→`scene.category`
- `object.appearance`→`scene.appearance`（外观描述）
- `object.purpose`→`scene.lightingMood`（光影氛围，placeholder 改"如：黄昏暖光、逆光剪影、冷色调月光..."）
- `object.origin`→`scene.origin`
- `object.imageUrl`→`scene.imageUrl`
- generateImage 仍基于 `appearance.trim()`（光影氛围拼入提示词可选，保持与物品一致只用 appearance）
- version badge / 删除 / 上传 / 重新生成逻辑不变

### 11. components/SceneAssetCard.tsx — 新建场景资产卡片

仿 ObjectAssetCard.tsx，关键替换：
- 类型 `ObjectProfile` → `SceneProfile`
- badge 文案"物品"→"场景"
- 版本选择器 label"物品版本"→"场景版本"
- 描述同步逻辑调整：展示 `category` / `appearance` / `lightingMood` / `origin`（替代 purpose）
- `handleSelectVersion` 同步到 asset：
  ```typescript
  const descParts = [];
  if (v.appearance.trim()) descParts.push(`外观：${v.appearance.trim()}`);
  if (v.lightingMood.trim()) descParts.push(`氛围：${v.lightingMood.trim()}`);
  onUpdate("description", descParts.join("；"));
  onUpdate("imagePrompt", v.appearance.trim());
  onUpdate("imageUrl", v.imageUrl ?? "");
  onUpdate("status", v.imageUrl ? "ready" : "pending");
  ```
- 底部"已关联物品设定"→"已关联场景设定"，"无图，请到物品设定补图"→"无图，请到场景设定补图"

### 12. components/AssetPreparation.tsx — 集成场景资产卡片 + 提取

- import `SceneAssetCard`、`SceneProfile`、`getLatestSceneVersions`
- props 新增 `sceneSettings?: SceneProfile[] | null` 与 `onSaveSceneSettings?: (scenes: SceneProfile[]) => void`
- 新增 `sceneVersionsByName` memo（仿 objectVersionsByName，按 name 索引升序）
- 新增 `handleExtractScene(asset)`（仿 handleExtractObject）：把 asset 的 imagePrompt→appearance、imageUrl 保留、生成 SceneProfile v1
- `handleGenerateAll` 新增 `sceneImageByName`（仿 objectImageByName），参与 imageUrl 匹配保留
- `handleGenerateAllImages` 跳过已关联场景设定的 scene 资产（仿 object 分支）
- 渲染循环新增 scene 分支（在 object 分支后）：
  ```tsx
  const sceneVersions = asset.type === "scene" ? sceneVersionsByName.get(asset.name.trim()) : undefined;
  if (sceneVersions && sceneVersions.length > 0) {
    return <SceneAssetCard key={asset.id} asset={asset} versions={sceneVersions} onUpdate={...} />;
  }
  ```
- AssetCard 新增 `onExtractScene?: () => void` prop 与"提取到场景设定"按钮；传入条件 `asset.type === "scene" && onSaveSceneSettings ? () => handleExtractScene(asset) : undefined`

### 13. app/episode/[id]/page.tsx — episode 数据流

- import `SceneProfile`
- 新增 `seriesSceneSettings` state（仿 seriesObjectSettings，line 30 附近）
- 加载时 `setSeriesSceneSettings(seriesData?.sceneSettings ?? [])`（line 87 后）
- 新增 `handleSaveSceneSettings(scenes)`（仿 handleSaveObjectSettings：getSeries→saveSeries→setSeriesSceneSettings）
- AssetPreparation 传入 `sceneSettings={seriesSceneSettings}` 与 `onSaveSceneSettings={handleSaveSceneSettings}`（line 432 附近）

### 14. app/series/[id]/page.tsx — 导航入口

在"物品设定"按钮后新增"场景设定"按钮，跳转 `/series/${id}/scenes`，图标用风景/地图类 svg。

## 假设与决策

- **字段决策**（用户确认）：场景特化字段 = 名称/分类/外观描述/光影氛围/来源背景。用 `lightingMood` 替代物品的 `purpose`，与 Shot.lightingMood 对应，对场景生图质量有实质帮助。
- **版本管理**：与物品设定一致，同一场景支持多版本（如"白天""夜晚""战火后"）。
- **提取方式**：与物品一致，单个 scene 资产卡片的"提取到场景设定"按钮，提取为 v1。
- **生图提示词**：场景生图基于 `appearance`（与物品基于 appearance 一致），不强制拼 lightingMood，保持模式统一。
- **迁移路由修复**：顺带补全 migrate 路由缺失的 character_settings/object_settings/scene_settings 列（属 bug 修复，避免迁移丢数据）。
- **不引入 LLM 上下文**：与物品设定一致，场景设定不自动注入扩写/分镜 prompt（保持范围最小）。

## 验证步骤

1. `npx tsc --noEmit` 类型检查通过（exit 0）
2. 重启 dev server，确认 `scene_settings` 列迁移执行（旧库自动 ALTER TABLE）
3. 进入系列详情页，确认导航出现"场景设定"按钮
4. 进入场景设定页：新增场景、填写字段、生成/上传图片、保存、刷新后数据持久化
5. 新建版本、删除版本、版本 badge 显示正确
6. 在 episode Step3 资产准备：scene 类型资产显示"提取到场景设定"按钮；点击提取后，刷新页面卡片变为 SceneAssetCard（版本选择器 + 复用图片）
7. 提取的场景在场景设定页面可见且持久化（重启 dev server 后仍在）
8. "一键生成资产信息"后，已关联场景设定的资产保留其 imageUrl；"批量生成图片"跳过已关联场景资产
