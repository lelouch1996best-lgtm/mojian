# AI 优化按钮 - 实施计划

## 概述

在描述性文本输入框中增加「AI 优化」按钮，点击后调用 LLM 对已填写的文本进行润色优化，流式替换。

**排除范围**：
- 配置性页面（`/settings`、`/series/[id]/world-settings`、`/series/[id]/characters`、`/series/[id]/objects`、`/series/[id]/scenes`、`/series/[id]/style-settings`）
- 分镜表格（`StoryboardTable` 中的 EditableCell）
- 简单名称输入框（系列/剧集标题、资产名称等单行输入）

**覆盖范围**：
- Step1 内容扩写页：故事输入框、扩写结果框（`ContentExpansion.tsx`）
- Step3 资产准备页：资产描述框、图片提示词框（`AssetPreparation.tsx`）
- Step4 视频生成页：视频提示词框（`VideoGeneration.tsx`）

## 当前状态分析

### 现有模式
项目已有成熟的 LLM 调用模式：
- `streamLLM(messages, options)` - 流式调用，yield 文本片段（用于扩写）
- `callLLM(messages, options)` - 非流式调用（用于分镜生成等 JSON 场景）
- 流式模式：`ContentExpansion.handleExpand()` 是参考模板 —— 创建 AbortController，for await 循环累积文本，实时更新状态

### 文本输入组件
- `<Textarea>` (`components/ui/Textarea.tsx`) - 用于 ContentExpansion
- `<EditableCell>` (`components/EditableCell.tsx`) - 用于 AssetPreparation 和 VideoGeneration
- 两种组件结构不同，需要不同的集成方式

## 实施方案

### 第一步：新增提示词函数（`lib/prompts.ts`）

新增 `optimizeTextMessages(content: string, context?: string): LLMMessage[]` 函数，生成文本润色优化的提示词。

- System prompt: "你是一位专业的文字编辑。请润色优化以下文本，修正语法错误，优化表达流畅度和文采，使其更生动自然。保持原意不变，不要添加新的情节或信息。直接输出润色后的文本，不要任何额外说明。"
- User message: 原始文本内容
- 可选 context 参数：当在特定场景下（如视频提示词），可传入上下文提示

### 第二步：创建「AI 优化」按钮组件（`components/ui/AiOptimizeButton.tsx`）

创建一个内联的优化按钮组件，封装：
- 按钮 UI：`ghost` 风格小按钮 + Sparkle 图标
- 点击后调用 `streamLLM(optimizeTextMessages(text))` 流式优化
- 通过 `onOptimized(text: string)` 回调返回结果
- 支持 loading 状态（显示 Spinner）
- 支持 AbortController 取消

```tsx
interface AiOptimizeButtonProps {
  text: string;
  onOptimized: (optimizedText: string) => void;
  disabled?: boolean;
  className?: string;
}
```

### 第三步：在 ContentExpansion.tsx 集成

为两个 Textarea 各添加一个「AI 优化」按钮：

1. **故事输入框**（~L189）：在 Textarea 右侧或下方添加按钮
2. **扩写结果框**（~L215）：在 Textarea 右侧或下方添加按钮

放置位置：在 `mt-2 flex items-center gap-2` 按钮组中，添加一个 `AiOptimizeButton`。

两个按钮都会直接修改对应的父组件状态（通过 `onOriginalChange` / `onExpandedChange`）。

具体改动：
- 导入 `AiOptimizeButton`
- 在故事输入框的按钮组中，在「AI 扩写」按钮旁边添加 `AiOptimizeButton`
- 在扩写结果框的按钮组中，在「提取人物设定」按钮旁边添加 `AiOptimizeButton`

### 第四步：在 AssetPreparation.tsx 集成

在 `AssetCard` 组件（~L973）中，为两个 EditableCell 添加「AI 优化」按钮：

1. **资产描述** (`asset.description`) - 文本区域
2. **图片提示词** (`asset.imagePrompt`) - 文本区域

由于 EditableCell 是行内编辑组件（点击进入编辑态，失焦提交），优化按钮需要：
- 放置在 EditableCell 旁边
- 如果 EditableCell 不在编辑态，先进入编辑态再优化
- 优化结果通过 EditableCell 的 `onChange` 回调写入

实现方式：
- 在 EditableCell 外部（label 行右侧）放置 AiOptimizeButton
- 需要让 EditableCell 支持外部触发编辑 + 外部设置值

**但实际上 EditableCell 不支持外部控制编辑态**，这带来一个问题。有两个解决思路：

**方案 A（推荐）**：将 EditableCell 的 `value` 和 `onChange` 作为入参传给 AiOptimizeButton，优化按钮负责：
  1. 调用 LLM 获取优化文本
  2. 通过 `onChange` 回写结果（EditableCell 通过 `useEffect` 监听 `value` 变化更新 `draft`）

**方案 B**：扩展 EditableCell，增加 `optimizable` prop，内部集成优化按钮。

选择方案 A，因为侵入性最小，不改变 EditableCell 的现有行为。

### 第五步：在 VideoGeneration.tsx 集成

在 `VideoCard` 组件（~L569）中，为视频提示词 EditableCell（~L798）添加优化按钮：

- 视频提示词 (`shot.finalPrompt`) - EditableCell（multiline）
- 按钮放置在 EditableCell 右侧或 label 行右侧

### 第六步：验证

- 在各页面的描述性输入框中确认「AI 优化」按钮可见
- 点击按钮确认能正常调用 LLM 流式返回结果
- 确认优化结果被正确替换到输入框中
- 确认配置页面、分镜表格、名称输入框中没有出现按钮
- TypeScript 编译无错误

## 涉及文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `lib/prompts.ts` | 新增函数 | `optimizeTextMessages()` |
| `components/ui/AiOptimizeButton.tsx` | 新建文件 | AI 优化按钮组件 |
| `components/ContentExpansion.tsx` | 修改 | 两处 Textarea 添加优化按钮 |
| `components/AssetPreparation.tsx` | 修改 | AssetCard 中两处 EditableCell 添加优化按钮 |
| `components/VideoGeneration.tsx` | 修改 | VideoCard 中一处 EditableCell 添加优化按钮 |

## 关键设计决策

1. **流式 vs 非流式**：选择流式（`streamLLM`），与现有扩写功能体验一致 —— 用户可以看到文本逐字优化，并可以随时停止
2. **按钮位置**：放在输入框下方的按钮组中（与现有「AI 扩写」等按钮同行），保持视觉一致性
3. **EditableCell 集成**：利用 EditableCell 现有的 `useEffect` 监听 `value` 变化来更新 `draft`，优化结果通过 `onChange` 回写即可自动显示
