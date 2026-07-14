# 资产卡片重构计划：移除 AssetCard，统一使用类型卡片

## Summary

移除通用的 `AssetCard` 组件，改为始终根据 `asset.type` 渲染对应的 `CharacterAssetCard` / `ObjectAssetCard` / `SceneAssetCard`。这三个卡片组件需要同时支持「未提取」和「已提取」两种状态：

- **未提取**（无同名设定）：外貌字段可编辑，有生成图片按钮和提取按钮
- **已提取**（有同名设定）：外貌字段只读，有版本选择器和跳转到设定页面的按钮

## Current State Analysis

### 当前卡片选择逻辑（AssetPreparation.tsx L750-L821）
```
asset.type === "character" && 有同名人物设定 → CharacterAssetCard（只读）
asset.type === "object" && 有同名物品设定 → ObjectAssetCard（只读）
asset.type === "scene" && 有同名场景设定 → SceneAssetCard（只读）
都不匹配 → AssetCard（可编辑描述+图片提示词+生成图片+提取按钮）
```

### AssetCard（待移除）功能
- 图片区：生成中/上传中/图片展示/占位
- 内容区：`@名称` + 类型选择器 + `📝 描述`（可编辑）+ `🎨 图片提示词`（可编辑）
- 按钮区：生成图片、上传、提取到人物/物品/场景设定、删除
- 状态徽章

### 三个类型卡片（当前）功能
- 图片区：图片展示 + 版本 badge + 删除按钮
- 内容区：`@名称` + 类型 badge + 版本选择器 + 各自的只读字段
- **缺少**：生成图片、上传、提取、跳转功能

### Asset 数据结构（lib/types.ts L170-L180）
```typescript
interface Asset {
  id: string;
  name: string;
  type: AssetType;
  description: string;    // 资产描述
  imagePrompt: string;    // 图片生成提示词
  imageUrl: string;
  status: AssetStatus;
  imageConfig?: AssetImageConfig;
}
```

### 提取函数（AssetPreparation.tsx L239-L292）
- `handleExtractCharacter`：`asset.description` → `appearance`，创建 v1 CharacterProfile
- `handleExtractObject`：`asset.description` → `appearance`，创建 v1 ObjectProfile
- `handleExtractScene`：`asset.description` → `appearance`，创建 v1 SceneProfile

### 导航
- `episode.seriesId` 可获取系列 ID
- 设定页面路径：`/series/${seriesId}/characters`、`/series/${seriesId}/objects`、`/series/${seriesId}/scenes`
- 项目使用 `next/navigation` 的 `useRouter`

## Proposed Changes

### 设计决策（合理默认值）
1. **图片提示词**：未提取时直接用外貌文本（`asset.description`）作为图片生成提示词，移除 `imagePrompt` 的 UI 展示。内部同步 `description` → `imagePrompt` 以保持数据兼容。
2. **跳转方式**：用 `window.open(url, "_blank")` 在新标签页打开设定页面，用户不丢失当前编辑进度。
3. **版本选择器**：已提取后保留版本选择器。

### 1. CharacterAssetCard.tsx — 重构

**新增 Props：**
```typescript
interface CharacterAssetCardProps {
  asset: Asset;
  versions: CharacterProfile[];           // 空数组 = 未提取
  onUpdate: (field: keyof Asset, value: string) => void;
  onDelete?: () => void;
  // 未提取时需要的 props：
  isGenerating?: boolean;
  onGenerateImage?: () => void;
  onExtract?: () => void;                 // 提取到人物设定
  seriesId?: string;                       // 用于跳转
}
```

**「未提取」状态（versions 为空）：**
- 图片区：`isGenerating` 时显示 Spinner，否则显示图片或占位
- 内容区：`@名称` + "人物" badge（不可切换类型）
- `🎨 外貌`：可编辑 EditableCell，绑定 `asset.description`，带 AiOptimizeButton
- 按钮区：生成图片按钮、提取到人物设定按钮、删除按钮

**「已提取」状态（versions 非空）：**
- 图片区：图片展示 + 版本 badge + 删除按钮
- 内容区：`@名称` + "人物" badge + 版本选择器
- `🎨 外貌`：只读文本（来自选中版本的 `appearance`）
- 按钮区：`前往人物设定` 按钮（`window.open("/series/${seriesId}/characters", "_blank")`）

**关键变更：**
- 移除 `💭 性格` 字段（用户要求只保留外貌）
- 根据 `versions.length > 0` 判断状态切换 UI

### 2. ObjectAssetCard.tsx — 重构（同构）

**新增 Props：** 同 CharacterAssetCard 模式

**未提取状态：**
- `🎨 外观`：可编辑，绑定 `asset.description`
- 按钮：生成图片、提取到物品设定、删除

**已提取状态：**
- `🎨 外观`：只读（来自选中版本 `appearance`）
- 按钮：`前往物品设定`（`/series/${seriesId}/objects`）
- 移除：`📦 分类`、`⚙️ 功能用途`、`📖 来源背景`（只保留外观）

### 3. SceneAssetCard.tsx — 重构（同构）

**未提取状态：**
- `🎨 外观`：可编辑，绑定 `asset.description`
- 按钮：生成图片、提取到场景设定、删除

**已提取状态：**
- `🎨 外观`：只读（来自选中版本 `appearance`）
- 按钮：`前往场景设定`（`/series/${seriesId}/scenes`）
- 移除：`📦 分类`、`💡 光影氛围`、`📖 来源背景`（只保留外观）

### 4. AssetPreparation.tsx — 更新渲染逻辑

**渲染逻辑简化（L750-L821）：**
```typescript
{episode.assets.map((asset) => {
  const commonProps = {
    key: asset.id,
    asset,
    onUpdate: (field, value) => onUpdateAsset(asset.id, field, value),
    onDelete: onDeleteAsset ? () => onDeleteAsset(asset.id) : undefined,
    seriesId: episode.seriesId,
  };

  if (asset.type === "character") {
    const versions = characterVersionsByName.get(asset.name.trim()) ?? [];
    return (
      <CharacterAssetCard
        {...commonProps}
        versions={versions}
        isGenerating={generatingImageIds.has(asset.id)}
        onGenerateImage={() => openGenerateImageDialog(asset)}
        onExtract={onSaveCharacterSettings ? () => handleExtractCharacter(asset) : undefined}
      />
    );
  }
  if (asset.type === "object") {
    const versions = objectVersionsByName.get(asset.name.trim()) ?? [];
    return (
      <ObjectAssetCard
        {...commonProps}
        versions={versions}
        isGenerating={generatingImageIds.has(asset.id)}
        onGenerateImage={() => openGenerateImageDialog(asset)}
        onExtract={onSaveObjectSettings ? () => handleExtractObject(asset) : undefined}
      />
    );
  }
  // scene
  const versions = sceneVersionsByName.get(asset.name.trim()) ?? [];
  return (
    <SceneAssetCard
      {...commonProps}
      versions={versions}
      isGenerating={generatingImageIds.has(asset.id)}
      onGenerateImage={() => openGenerateImageDialog(asset)}
      onExtract={onSaveSceneSettings ? () => handleExtractScene(asset) : undefined}
    />
  );
})}
```

**移除 AssetCard 组件定义**（L974-L1183），约 210 行代码删除。

### 5. 图片生成时的提示词同步

在 `openGenerateImageDialog` 或 `handleGenerateImage` 中，确保生成图片前将 `asset.description` 同步到 `asset.imagePrompt`：
```typescript
// 生成图片前同步
if (asset.description.trim() && !asset.imagePrompt.trim()) {
  onUpdateAsset(asset.id, "imagePrompt", asset.description.trim());
}
```
这样既简化了 UI，又保持了 `imagePrompt` 字段的数据兼容性（Step4 视频提示词生成等下游功能不受影响）。

### 6. 类型选择器处理

当前 AssetCard 有类型 `<select>` 下拉框允许用户修改 `asset.type`。移除 AssetCard 后，类型在卡片上不再可切换。用户在「添加资产」时选择类型即可。若需修改类型，可删除重新添加。

## Assumptions & Decisions

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 图片提示词来源 | 用外貌文本（description）直接生图 | 用户要求只保留外貌字段，简化 UI |
| imagePrompt 字段 | 数据结构保留，生成时自动同步 | 向后兼容，不影响 Step4 视频生成 |
| 跳转方式 | 新标签页 `window.open` | 用户在编辑剧集，不应丢失进度 |
| 版本选择器 | 已提取后保留 | 已有功能，有实际价值 |
| 类型切换 | 移除卡片上的类型下拉 | 简化 UI，类型在添加时确定 |
| 各卡片额外字段 | 全部移除，只保留外观/外貌 | 用户明确要求"只保留外貌" |
| AiOptimizeButton | 未提取时保留在外貌字段旁 | 已有实现，提升体验 |

## Verification Steps

1. **TypeScript 类型检查**：`npx tsc --noEmit` 零错误
2. **未提取状态验证**：
   - 新建资产（无同名设定）→ 显示可编辑外貌 + 生成图片按钮 + 提取按钮
   - 编辑外貌文本 → `asset.description` 更新
   - 点击生成图片 → 用 `description` 作为提示词
   - 点击提取 → 创建设定，卡片切换为已提取状态
3. **已提取状态验证**：
   - 外貌只读，显示设定中的 appearance
   - 版本选择器可切换
   - 点击「前往人物设定」→ 新标签页打开 `/series/{id}/characters`
   - 在设定页面修改外貌 → 返回资产页面，卡片显示更新后的外貌
4. **三种类型全覆盖**：人物、物品、场景卡片行为一致
5. **批量生图功能**：`handleGenerateAllImages` 仍正确跳过已提取资产
6. **无回归**：删除资产、一键生成等功能正常
