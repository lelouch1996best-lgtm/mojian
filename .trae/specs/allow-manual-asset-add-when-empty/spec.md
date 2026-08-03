# 资产准备空状态支持手动添加资产 Spec

## Why
Step3（资产准备）中，当尚无任何人物/物品/场景资产时，页面只显示一个空状态占位，仅引导用户点击「一键生成资产信息」。「添加资产」卡片入口（含「新建资产 / 从设定选择」表单）只在已有资产时才出现在网格末尾，导致用户在空状态下无法手动添加资产，必须先执行一键生成才能看到添加入口。

## What Changes
- `components/AssetPreparation.tsx`：将资产卡片网格（含「添加资产」占位卡片）改为始终渲染，使空状态下也显示添加入口。
- 移除原有的全空状态独立占位提示（🖼️ 引导框）：空状态下不再显示任何空占位元素，仅渲染资产卡片网格（其中含「添加资产」卡片）。
- 不新增/不改动任何状态、handler 或数据结构：复用现有 `handleAddAsset` / `handleAddFromSettings` / `resetAddCard` / `availableSettings` / `showAddCard` 等逻辑。

## Impact
- Affected code: `components/AssetPreparation.tsx`（资产卡片区域 JSX 结构，约 L896-L1078）
- 复用现有能力：手动添加资产（新建/从设定选择）链路、`onReplaceAssets` 追加逻辑、设定版本匹配均不变
- 不影响已有资产的一键生成、从设定匹配添加、图片生成/上传、删除等流程
- 不改变 `Asset` 数据结构或持久化方式

## ADDED Requirements

### Requirement: 空状态下手动添加资产
当资产准备列表为空（无人物/物品/场景资产）时，系统 SHALL 渲染「添加资产」入口，使用户能够手动添加资产（新建资产或从已有设定选择），无需先执行「一键生成资产信息」。

#### Scenario: 空状态下显示添加资产入口
- **WHEN** 用户进入 Step3 且 `preparationAssets` 为空
- **THEN** 页面渲染资产卡片网格，网格中包含「添加资产」卡片按钮；不显示任何独立的空状态占位提示

#### Scenario: 空状态下新建资产
- **WHEN** 用户在空状态点击「添加资产」进入「新建资产」模式，填写名称与类型后确认
- **THEN** 新资产经 `onReplaceAssets` 追加到 `episode.assets`，资产卡片网格显示该资产

#### Scenario: 空状态下从设定选择添加
- **WHEN** 用户在空状态点击「添加资产」进入「从设定选择」模式，选择一个已有设定后确认
- **THEN** 该设定作为新资产追加到 `episode.assets`（含其外貌描述与已有图片），资产卡片网格显示该资产

#### Scenario: 空状态且无任何设定
- **WHEN** 用户在空状态选择「从设定选择」模式，但对应类型的人物/物品/场景设定均为空
- **THEN** 表单提示「暂无可选的…设定，或已全部添加」，不阻断「新建资产」模式，用户仍可切换回新建模式手动添加

#### Scenario: 非空状态行为不变
- **WHEN** 资产准备列表已有资产
- **THEN** 网格照常渲染所有资产卡片 + 末尾「添加资产」卡片，行为与样式与改动前一致

## MODIFIED Requirements

### Requirement: 资产卡片区域渲染
资产卡片区域 SHALL 始终渲染资产卡片网格（`grid` 容器 + `preparationAssets.map` + 「添加资产」占位卡片），不再以 `preparationAssets.length === 0` 作为是否渲染网格的分支条件。当 `preparationAssets` 为空时，SHALL NOT 渲染任何独立的空状态占位提示（即原先的 🖼️ 引导框）；网格中仅显示「添加资产」卡片。
