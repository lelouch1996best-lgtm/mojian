# 在内容扩写与镜头弹框中支持 @ 选择剧集设定

## 1. 需求摘要

在内容扩写的第一步（`originalContent`）和扩写结果（`expandedContent`）输入框，以及智能添加镜头弹框（`SmartAddShotDialog`）中，支持用户输入 `@` 并从本剧集（系列）的设定中选择：**人物、物品、场景、世界设定**。选择后在文本中插入 `@设定名称` 引用。

## 2. 当前状态分析

| 模块 | 当前实现 | 差距 |
|---|---|---|
| `components/ContentExpansion.tsx` | `originalContent` / `expandedContent` 使用 `Textarea` 组件，仅支持纯文本 | 不支持 `@` 触发设定选择 |
| `components/SmartAddShotDialog.tsx` | 描述框使用原生 `<textarea>` | 不支持 `@` 触发设定选择 |
| `components/EditableCell.tsx` | 已支持 `atMentionOptions`，但设计为「点击后进入编辑态」 | 交互模式不适合一直可编辑的大文本框 |
| `components/StoryboardTable.tsx` / `StoryboardRow.tsx` | 已使用 `EditableCell` 的 `@` 功能标注资产标签 | 选项来自当前已标注标签，与「引用剧集设定」场景不同 |
| `app/episode/[id]/page.tsx` | 已加载 `worldSettings` / `characterSettings` / `objectSettings` / `sceneSettings` 并传入 `ContentExpansion` | 未将这些设定传入 `StoryboardTable`，导致 `SmartAddShotDialog` 无法获取 |

## 3. 实现方案

### 3.1 新建通用组件 `AtMentionTextarea`

- **路径**：`components/AtMentionTextarea.tsx`
- **能力**：
  - 基于 `<textarea>` + 固定定位下拉菜单实现 `@` 提及补全
  - Props 与现有 `Textarea` 类似，额外接收 `options: AtMentionOption[]`
  - 支持键盘上下选择、Enter/Tab 确认、Esc 关闭
  - 选中后在光标处插入 `@value `（末尾带空格，便于继续输入）
  - 监听祖先容器滚动，下拉菜单位置实时跟随
- **实现方式**：复用 `EditableCell.tsx` 中已验证的 `@` 触发、过滤、定位、键盘交互逻辑，但保持组件独立，不携带「点击编辑/显示态切换」逻辑。

```ts
export interface AtMentionOption {
  label: string;
  value: string;
}

interface AtMentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  options: AtMentionOption[];
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
}
```

### 3.2 改造 `ContentExpansion.tsx`

- 用 `AtMentionTextarea` 替换 `originalContent` 和 `expandedContent` 的 `Textarea`。
- 根据已有 props 中的系列设定构建 `atMentionOptions`：
  - **人物**：使用 `getLatestVersions(effectiveCharacters)`，选项 `label` 为 `[人物] 角色名`
  - **物品**：使用 `getLatestObjectVersions(objectSettings ?? [])`，选项 `label` 为 `[物品] 物品名`
  - **场景**：使用 `getLatestSceneVersions(sceneSettings ?? [])`，选项 `label` 为 `[场景] 场景名`
  - **世界设定**：若 `worldText.trim()` 存在，提供一项 `label` 为 `[世界] 世界设定`，`value` 为 `世界设定`
- 保持现有 `ExpansionContextModal` 流程不变；`@` 引用仅作为用户输入层面的快捷引用。

### 3.3 改造 `SmartAddShotDialog.tsx`

- 用 `AtMentionTextarea` 替换描述框的原生 `<textarea>`。
- 新增 props 接收系列设定：

```ts
interface SmartAddShotDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (shot: Shot) => void;
  title?: string;
  worldSettings?: WorldSettings | null;
  characterSettings?: CharacterProfile[] | null;
  objectSettings?: ObjectProfile[] | null;
  sceneSettings?: SceneProfile[] | null;
}
```

- 在弹框内部使用与 `ContentExpansion` 相同的逻辑构建 `atMentionOptions`。

### 3.4 将设定数据下传至 `StoryboardTable`

- `app/episode/[id]/page.tsx`：把 `seriesWorldSettings` / `seriesCharacterSettings` / `seriesObjectSettings` / `seriesSceneSettings` 通过 props 传给 `StoryboardTable`。
- `components/StoryboardTable.tsx`：新增对应 props，并在渲染 `SmartAddShotDialog` 时传入。

### 3.5 可选增强：@ 引用自动进入 LLM 上下文

- 复用 `lib/utils.ts` 中已有的 `extractTags` 解析输入文本中的 `@标签`。
- 在 `runExpand` 中，将解析出的标签与当前最新版本的人物/物品/场景/世界设定名称匹配，自动把对应设定的文本追加到 `expansionMessages` 的上下文。
- 该增强不破坏 `ExpansionContextModal` 的显式选择流程，仅作为隐式补充；若用户已通过弹窗勾选，则以弹窗选择为准，避免重复。

## 4. 假设与决策

- **「生成分镜弹框」的所指**：当前代码中「生成分镜」按钮直接生成，没有弹框；用户提到的弹框应指现有的 `SmartAddShotDialog`（智能添加镜头 / 智能添加行弹框）。
- **插入格式**：选择后在文本中插入 `@设定名称`，与现有 `@标签` 格式保持一致。
- **可选设定范围**：人物、物品、场景、世界设定。不包含风格设定，因为 `StyleSettings` 仅存储 `selectedStyleId`，需要额外查询预设名称；不包含前序剧集，因为用户明确说「各种设定」。
- **展示样式**：输入框保持纯文本编辑体验，不强制渲染高亮标签，避免大段文本编辑时性能与交互问题。
- **世界设定名称**：使用固定值 `世界设定` 作为 `@` 引用名称。

## 5. 验证步骤

1. 打开剧集创作页，在「第一步 · 输入故事内容」文本框中输入 `@`，应出现本剧集的人物、物品、场景、世界设定选项。
2. 选择某角色后，文本中正确插入 `@角色名`。
3. 「扩写结果」文本框同样支持 `@` 选择并插入。
4. 进入分镜表，点击「智能添加行」，弹框中的描述框支持 `@` 选择本剧集设定。
5. 验证不影响 `StoryboardRow` 中 `EditableCell` 的现有 `@` 资产标注功能。
6. 运行项目 lint / typecheck 命令（如 `npm run lint`、`npm run typecheck`），确保无新增错误。
