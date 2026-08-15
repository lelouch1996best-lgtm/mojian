# 编辑态高亮 @资产 — 实施计划

## 目标
让内容扩写、智能添加镜头、分镜表格、视频生成的画面描述输入框，在**编辑状态**下也能高亮显示 `@资产` 标签，与生成图片弹框（`ImageGenerationDialog`）的体验一致。

## 当前状态分析

### 参考实现（已可用，本次不改）
`components/ImageGenerationDialog.tsx` 用"透明 textarea + overlay 叠加层"技巧实现编辑态高亮：
- 私有函数 `buildMentionRegex`（L30-36）：按长度降序转义拼接，避免短名误匹配长名前缀
- 私有函数 `renderHighlightedText`（L49-71）：正则切分文本，`@名称` 包裹为 `<span className="rounded bg-amber-100 text-amber-700">`
- DOM 结构（L755-780）：`relative` 容器内 overlay（`pointer-events-none absolute inset-0`，渲染高亮文本）+ textarea（`text-transparent caret-slate-700 bg-transparent relative`）
- 滚动同步（L761、L770-773）：textarea `onScroll` 写 `scrollPos`，overlay 内层 `transform: translate(-left,-top)` 反向位移
- 滚动条 gutter 对齐（L351-365）：`ResizeObserver` 检测 `scrollHeight>clientHeight`，给 overlay 加 `[scrollbar-gutter:stable]`
- 字号/行高/padding 两层严格一致：`text-sm leading-6 px-3 py-2`

### 待改造组件（本次目标）
1. `components/AtMentionTextarea.tsx`（L67-89）：纯 textarea，`text-slate-800` 实色，无 overlay。
   - 使用方：`ContentExpansion.tsx`、`SmartAddShotDialog.tsx`
   - 已用 `useAtMention` Hook 处理 @ 下拉，保留
2. `components/EditableCell.tsx`（L142-167 multiline 编辑态）：纯 textarea，`text-slate-800` 实色，无 overlay；显示态（L200-205）才用 `TaggedText` 高亮。
   - 使用方：`StoryboardTable/StoryboardRow`、`VideoGeneration/VideoCard`
   - 已用 `useAtMention` Hook，保留
   - 单行 input 模式（L169-190）无 @ 标签，不改

### 关键约束
- 两层文字必须像素级对齐：字号、行高、字间距、padding、换行行为（`whitespace-pre-wrap break-words`）完全一致
- overlay 必须 `pointer-events-none`，所有交互由上层 textarea 接管
- textarea 文字 `text-transparent` + `caret-slate-700`（光标可见）+ `bg-transparent`
- 高亮正则按长度降序，避免 `@图片1` 被短名前缀误匹配
- 高亮颜色与 `TaggedText`（显示态，`bg-amber-50 text-amber-700`）保持视觉统一 → 统一用 `bg-amber-100 text-amber-700`（与图片弹框一致）

## 提议变更

### 1. 提取共享高亮工具到 `lib/utils.ts`
在现有 `lib/utils.ts`（已含 `extractTags`/`MENTION_BOUNDARY` 等标签函数）新增导出：
- `buildMentionRegex(values: string[]): RegExp | null` — 从 ImageGenerationDialog L30-36 原样搬移
- `renderMentionSpans(text: string, values: string[]): {text: string; highlighted: boolean}[]` — 返回切分片段数组（供 React 组件 map 渲染），避免在 utils 里写 JSX

**理由**：消除正则构造逻辑的潜在重复，图片弹框未来也可改用此工具（本次不动它，降低风险）。

### 2. 新建 `components/HighlightedTextarea.tsx`
纯展示型组件，封装 overlay 技术，不含 @ 下拉逻辑。

**Props**：
```ts
interface HighlightedTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  /** 需要 high­light 的 @ 标签名列表（不含 @ 前缀）。为空时退化为普通实色 textarea */
  highlightValues?: string[];
  /** 高亮 span 的 className，默认 "rounded bg-amber-100 text-amber-700" */
  highlightClassName?: string;
  forwardedRef?: React.Ref<HTMLTextAreaElement>;
  onScroll?: React.UIEventHandler<HTMLTextAreaElement>; // 透传给上层调用方（如需）
}
```

**内部实现**：
- 维护 `scrollPos {top,left}` state + `hasScrollbar` state
- `ResizeObserver` 检测滚动条（同 ImageGenerationDialog L351-365）
- 渲染：`relative` 容器 > overlay div（`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words`，padding/字号/行高与 textarea 一致，内层 `transform: translate(-left,-top)`，map `renderMentionSpans` 输出高亮 span）+ textarea（`text-transparent caret-slate-700 bg-transparent`，`onScroll` 更新 scrollPos）
- `highlightValues` 为空数组时：textarea 退化为 `text-slate-800` 实色，不渲染 overlay（兼容无标签场景）

**对齐要点**：textarea 与 overlay 必须共用同一组 className 片段（提取为常量 `TEXTAREA_LAYOUT_CLASS = "px-3 py-2 text-sm leading-6 tracking-normal break-words whitespace-pre-wrap"`），确保字号/行高/padding 一致。

### 3. 改造 `components/AtMentionTextarea.tsx`
- 内部把 `<textarea>` 替换为 `<HighlightedTextarea>`，传入 `highlightValues`（从 `options` 派生所有 `value`，加上调用方已有标签）
- `useAtMention` Hook 保留不变，`inputRef` 传给 HighlightedTextarea 的 forwardedRef
- `autoGrow` 逻辑保留（操作 textarea ref 的 height；overlay 是 `absolute inset-0`，会随 textarea 盒子尺寸自动填充）
- 删除现有 `<textarea>` 块（L69-78），替换为 `<HighlightedTextarea {...rest} />`
- 调用方（ContentExpansion、SmartAddShotDialog）**零改动**

### 4. 改造 `components/EditableCell.tsx`（multiline 编辑态）
- L143-167 的 multiline editing 分支：把裸 `<textarea>` 替换为 `<HighlightedTextarea>`
- `highlightValues` = `atMentionOptions?.map(o => o.value) ?? []`
- `useAtMention` Hook 保留，`inputRef` 传给 HighlightedTextarea
- `autoGrow`（L88-97）逻辑保留，操作同一个 textarea ref
- 单行 input 分支（L169-190）不动
- 显示态（L193-210）不动
- 调用方（StoryboardTable/Row、VideoGeneration/VideoCard）**零改动**

## 假设与决策
- **不重构 ImageGenerationDialog**：它已可用且耦合较深（内联 @ 下拉 + overlay + 参考图特有逻辑），本次只复用它验证过的技术模式，避免引入回归。共享 utils（第1步）为其未来迁移留口子。
- **高亮颜色统一为 `bg-amber-100 text-amber-700`**（与图片弹框一致），`TaggedText` 显示态仍用 `bg-amber-50`，两者略有差异可接受（编辑态需更醒目）。
- **`highlightValues` 来源**：直接从 `atMentionOptions` 的 `value` 数组取（即所有可选设定名）。文本中出现的、不在选项里的"新建标签"也需要高亮——由于 `useAtMention` 的 `allowCreateTag` 选中后会插入 `@名称`，该名称已在 `options` 中（作为 createOption），所以 options 的 value 集合已覆盖。若仍有遗漏，可额外从 `extractTags(value)` 补充——本次先按 options 取，验证后按需补充。
- **autoGrow 与 overlay 共存**：overlay 用 `absolute inset-0`，textarea 高度变化时 overlay 自动跟随，无需额外同步高度。仅滚动位置需同步（已在 HighlightedTextarea 内处理）。
- **不新增依赖**，纯 React + 浏览器 API（ResizeObserver 已被 ImageGenerationDialog 使用）。

## 验证步骤
1. `npx tsc --noEmit` 通过，无类型错误
2. 手动验证 ContentExpansion：输入 `@` 触发下拉，选中后输入框内 `@名称` 立即琥珀色高亮；继续输入普通文字为灰色；光标可正常定位/选区/删除
3. 手动验证 SmartAddShotDialog 同上
4. 手动验证 StoryboardTable 画面描述单元格：点击进入编辑态，已存在的 `@标签` 高亮；新输入 `@` 下拉选中后高亮；Ctrl+Enter 提交后显示态 TaggedText 高亮一致
5. 手动验证 VideoGeneration/VideoCard 画面描述同上
6. 滚动验证：长文本出现滚动条时，overlay 高亮文本与 textarea 滚动同步，无错位；无滚动条时右侧无多余空白
7. 回归验证 ImageGenerationDialog 不受影响（本次未改动该文件）

## 受影响文件清单
- 新增：`components/HighlightedTextarea.tsx`
- 修改：`lib/utils.ts`（新增 `buildMentionRegex` + `renderMentionSpans`）
- 修改：`components/AtMentionTextarea.tsx`（textarea → HighlightedTextarea）
- 修改：`components/EditableCell.tsx`（multiline 编辑态 textarea → HighlightedTextarea）
- 不改：`ImageGenerationDialog.tsx`、`ContentExpansion.tsx`、`SmartAddShotDialog.tsx`、`StoryboardTable.tsx`、`VideoGeneration.tsx`、`TaggedText.tsx`、`AtMentionDropdown.tsx`
