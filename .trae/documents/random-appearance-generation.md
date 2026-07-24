# 卡片外貌/外观「随机生成」功能实现计划

## 一、Summary（概要）

在人物设定、场景设定、物品设定三种卡片的「外貌/外观」字段右上角新增「随机生成」按钮。点击后：
1. 校验必填字段（人物：性别年龄；物品/场景：分类），缺失则弹错误提示框且不打开生成弹框；
2. 打开弹框，将卡片上**所有已填字段**（名字、分类、功能用途、**含外貌本身**等）按结构化格式填入「提示词」输入框，可二次编辑——若用户已写了简短外貌，LLM 会据此扩展丰富；
3. 点击「生成」调用 LLM 流式输出到「生成结果」输入框（可二次编辑），点击「应用」将结果写回卡片外貌字段。

## 二、Current State Analysis（现状分析）

- 三种卡片组件结构高度同构：[CharacterCard.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/CharacterCard.tsx)、[ObjectCard.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/objects/ObjectCard.tsx)、[SceneCard.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/scenes/SceneCard.tsx)，均用内部 `Field` 组件包装字段（label + hint + children），外貌字段是一个 `textarea`。
- `Field` 组件当前仅接受 `label`/`hint`/`children`，label 行右侧只有 hint 文本，没有扩展位。
- LLM 调用统一入口 [llm-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/llm-client.ts)：`streamLLM(messages, { signal, temperature })` 流式生成；`getSettings()` 读取 LLM 配置。
- 提示词函数集中在 [prompts.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/prompts.ts)，已有 `regenerateAssetMessages`（资产重新生成外观）可作为模式参考。
- 现有弹框基础设施：[Modal.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ui/Modal.tsx) 提供遮罩/标题/ESC/滚动锁；[VoiceGenerationDialog.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VoiceGenerationDialog.tsx) 是基于 Modal 的表单弹框范例。
- 三个设定 page（[characters/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/page.tsx)、objects/page.tsx、scenes/page.tsx）结构对称：已有 `imageConfigured`/`audioConfigured` 配置检测模式、`showError`（useErrorDialog）错误提示模式、`ImageGenerationDialog` 弹框状态管理模式（`configOpen`/`genTargetId`/`genInitialPrompt`）。
- 数据类型见 [types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts)：`CharacterProfile`(name/role/genderAge/appearance/personality/background/relationships)、`ObjectProfile`(name/category/appearance/purpose/origin)、`SceneProfile`(name/category/appearance/lightingMood/origin)。

## 三、Proposed Changes（变更方案）

### 1. 新增 `components/AppearanceGenerateDialog.tsx`（新文件）

轻量级弹框，基于 `Modal` 组件，复用 `Button`。

**Props：**
```ts
interface AppearanceGenerateDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (result: string) => void;     // 应用结果写回卡片
  initialPrompt: string;                  // 从卡片字段提取的结构化提示词
  entityType: "character" | "object" | "scene";
}
```

**内部状态：** `prompt`（提示词，init=initialPrompt）、`result`（生成结果，流式累积）、`generating`、`error`、`AbortController`。

**UI 结构（使用 Modal）：**
- title: `✨ 随机生成{外貌|外观}`
- 内容区：
  - 「提示词（可编辑）」label + textarea（rows=6，disabled 时灰底）
  - 「生成结果」label（generating 时附「生成中…」）+ textarea（rows=6，placeholder 引导，可编辑）
  - 错误文本（红色）
- footer 按钮区（右对齐）：
  - `取消`（ghost，disabled=!generating）
  - `生成{外貌|外观}` / `重新生成`（secondary，disabled=!prompt.trim() || generating）⇄ 生成中显示 `停止生成`（secondary，onClick=abort）
  - `应用`（primary，disabled=!result.trim() || generating）

**核心逻辑：**
- `handleGenerate`：调用 `streamLLM(generateAppearanceMessages(prompt.trim(), entityType), { signal, temperature: 0.8 })`，逐 chunk 累积到 `result`；AbortError 静默，其他错误写入 `error`。
- `handleStop`：`abortRef.current?.abort()`。
- `handleApply`：`onApply(result.trim())`（父组件负责关闭弹框）。
- 打开时（`open` 由 false→true）通过 useEffect 重置 prompt=initialPrompt、result=""、error=null、generating=false。
- ESC/遮罩点击：generating 时禁止关闭（避免丢失流），非 generating 时调用 onClose。

### 2. 修改 `lib/prompts.ts`（新增提示词函数）

在文件末尾新增：
```ts
// 卡片外貌/外观随机生成：根据卡片其他字段信息，生成外貌/外观描述（流式）
export function generateAppearanceMessages(
  info: string,
  type: "character" | "object" | "scene"
): LLMMessage[] {
  const typeLabel = type === "character" ? "人物" : type === "scene" ? "场景" : "物品";
  const fieldLabel = type === "character" ? "外貌" : "外观";
  const detailHint =
    type === "character"
      ? "面部特征、发型、体型、服饰、配饰等"
      : type === "object"
      ? "形状、材质、颜色、尺寸、细节等"
      : "环境布局、建筑/自然元素、光影氛围等";
  return [
    {
      role: "system",
      content: `你是一位 AI 视频制作的资产设计专家。请根据以下${typeLabel}信息，生成一段详细且具画面感的${fieldLabel}描述，包括${detailHint}。如果信息中已包含简短的${fieldLabel}描述，请在此基础上扩展丰富细节；如果未包含，请发挥创意生成。描述应生动具体、富有细节，适合用于图片生成参考。只返回${fieldLabel}描述文本本身，不要任何额外说明、前缀或 markdown 格式。`,
    },
    {
      role: "user",
      content: `以下是该${typeLabel}的信息：\n\n${info}\n\n请根据以上信息生成详细的${fieldLabel}描述。`,
    },
  ];
}
```
（参考现有 `regenerateAssetMessages` 的结构，去掉剧本背景依赖；system prompt 显式说明「若信息含简短外貌/外观则在此基础上扩展，否则发挥创意生成」，适配「含外貌字段」的提示词。）

### 3. 修改三个卡片组件（CharacterCard / ObjectCard / SceneCard）

**3.1 扩展内部 `Field` 组件**（三处改法一致）：新增可选 `action?: React.ReactNode`，渲染在 label 行右侧（hint 之前）：
```tsx
function Field({ label, hint, action, children }: { label: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-xs font-semibold text-black">{label}</label>
        <div className="flex items-center gap-1.5">
          {action}
          {hint && <span className="text-xs text-slate-400">{hint}</span>}
        </div>
      </div>
      {children}
    </div>
  );
}
```

**3.2 在外貌字段的 `Field` 传入 `action` 随机生成按钮**：
- CharacterCard：`<Field label="🎨 外貌" hint="..." action={<RandomButton onClick={onRandomAppearance} label="随机生成" />}>`
- ObjectCard：`<Field label="🎨 外观" hint="..." action={<RandomButton ... />}>`
- SceneCard：`<Field label="🎨 外观描述" hint="..." action={<RandomButton ... />}>`

按钮样式（统一，brand 配色，小尺寸适配 label 行）：
```tsx
<button onClick={onRandomAppearance} title="随机生成外貌"
  className="flex items-center gap-0.5 rounded border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-xs text-brand-600 transition-colors hover:border-brand-300 hover:bg-brand-100">
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
    {/* 骰子/火花图标 */}
    <path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
  </svg>
  随机生成
</button>
```
（按钮文案：人物用「随机生成」，物品/场景也用「随机生成」；title 区分外貌/外观。）

**3.3 新增 props**：
- CharacterCard：`onRandomAppearance: () => void`
- ObjectCard：`onRandomAppearance: () => void`
- SceneCard：`onRandomAppearance: () => void`

### 4. 修改三个设定 page（characters/objects/scenes page.tsx）

每个 page 改法对称，以 characters 为例：

**4.1 新增 import：**
```ts
import { getSettings as getLlmSettings } from "@/lib/llm-client";
import { AppearanceGenerateDialog } from "@/components/AppearanceGenerateDialog";
```

**4.2 新增状态：**
```ts
const [llmConfigured, setLlmConfigured] = useState(false);
const [appearanceDialogOpen, setAppearanceDialogOpen] = useState(false);
const [appearanceDialogTargetId, setAppearanceDialogTargetId] = useState<string | null>(null);
const [appearanceDialogInitialPrompt, setAppearanceDialogInitialPrompt] = useState("");
```

**4.3 新增 LLM 配置检测**（在现有 useEffect 内追加，与 imageConfigured 并列）：
```ts
getLlmSettings().then(s => setLlmConfigured(!!s?.apiKey));
```

**4.4 新增「提取卡片字段->结构化提示词」内联辅助函数**（characters 版，**含外貌字段**）：
```ts
function buildAppearancePrompt(char: CharacterProfile): string {
  const lines: string[] = [];
  if (char.name.trim()) lines.push(`姓名：${char.name.trim()}`);
  if (char.genderAge.trim()) lines.push(`性别年龄：${char.genderAge.trim()}`);
  if (char.role.trim()) lines.push(`角色定位：${char.role.trim()}`);
  if (char.appearance.trim()) lines.push(`外貌：${char.appearance.trim()}`);
  if (char.personality.trim()) lines.push(`性格：${char.personality.trim()}`);
  if (char.background.trim()) lines.push(`背景故事：${char.background.trim()}`);
  if (char.relationships.trim()) lines.push(`人物关系：${char.relationships.trim()}`);
  return lines.join("\n");
}
```
- objects 版字段：名称/分类/**外观**/功能用途/来源背景
- scenes 版字段：名称/分类/**外观描述**/光影氛围/来源背景

> 说明：外貌字段纳入提示词，便于用户已写的简短外貌被 LLM 扩展丰富；用户也可在弹框提示词输入框中删除该行以获得纯随机结果。

**4.5 新增打开弹框 + 校验函数**（characters 版）：
```ts
function openRandomAppearanceDialog(char: CharacterProfile) {
  if (!llmConfigured) {
    showError("未配置 LLM，请先在「设置」中配置大模型 API");
    return;
  }
  if (!char.genderAge.trim()) {
    showError("请先填写「性别年龄」后再随机生成外貌");
    return;
  }
  setAppearanceDialogInitialPrompt(buildAppearancePrompt(char));
  setAppearanceDialogTargetId(char.id);
  setAppearanceDialogOpen(true);
}

function handleApplyAppearance(result: string) {
  if (!appearanceDialogTargetId) return;
  setCharacters(prev => prev.map(c => c.id === appearanceDialogTargetId ? { ...c, appearance: result } : c));
  setAppearanceDialogOpen(false);
  setAppearanceDialogTargetId(null);
}
```
- objects 版校验：`if (!obj.category.trim()) showError("请先填写「分类」后再随机生成外观")`
- scenes 版校验：`if (!scene.category.trim()) showError("请先填写「分类」后再随机生成外观")`

**4.6 给卡片传入 `onRandomAppearance`**（在 CharacterCard 渲染处）：
```tsx
<CharacterCard ... onRandomAppearance={() => openRandomAppearanceDialog(char)} />
```

**4.7 渲染弹框**（与 ImageGenerationDialog 并列，在 main 末尾）：
```tsx
<AppearanceGenerateDialog
  open={appearanceDialogOpen}
  onClose={() => { setAppearanceDialogOpen(false); setAppearanceDialogTargetId(null); }}
  onApply={handleApplyAppearance}
  initialPrompt={appearanceDialogInitialPrompt}
  entityType="character"
/>
```
- objects page: `entityType="object"`
- scenes page: `entityType="scene"`

**4.8（可选）LLM 未配置提示横幅**：参照现有 `!imageConfigured` 横幅，在 page 顶部条件渲染 `!llmConfigured` 提示。此为体验优化，非必须。

## 四、Assumptions & Decisions（假设与决策）

1. **结果去向**：采用「弹框内显示生成结果（可编辑）+ 应用按钮写回卡片」方案。理由：用户明确要求「以弹框形式」且「可二次编辑」，弹框内同时提供提示词编辑与结果编辑最贴合需求；流式结果先落在弹框结果框供预览/修改，再应用，避免直接覆盖卡片原外貌导致不可逆。
2. **是否参考现有外貌**：**包含**现有外貌字段（连同其他字段一起填入提示词）。理由：用户可能已写了简短外貌，LLM 可据此扩展丰富细节；system prompt 显式指引「含简短外貌则扩展、否则发挥创意」。用户若想要纯随机，可在弹框提示词框中手动删除外貌行。应用时新结果覆盖原外貌（触发自动保存）。
3. **LLM 调用方式**：流式 `streamLLM`，temperature=0.8 增强随机性；支持「停止生成」中断流。
4. **必填校验时机**：在打开弹框前校验，缺失则 `showError`（复用现有错误弹框）并阻断，符合「没填的话直接弹框提示」。
5. **LLM 配置检测**：复用 `getSettings()` 检测 apiKey，未配置时 showError 阻断，与 imageConfigured 模式一致。
6. **按钮位置**：放在外貌 `Field` 的 label 行右侧（hint 前），与 ObjectAssetCard 中「重新生成外观」按钮位置一致，符合「右上角」描述。
7. **弹框组件**：新建 `AppearanceGenerateDialog`，基于现有 `Modal`，不复用沉重的 `ImageGenerationDialog`（后者含 portal/拖拽/缩放/参考图/@提及，与本场景无关）。
8. **不修改数据类型**：外貌字段已存在（`appearance`），无需改 types.ts。
9. **写回方式**：`onApply` 调用 `onUpdate("appearance", result)` 等价路径（page 内 setCharacters 等），触发既有 500ms 防抖自动保存，无需额外保存逻辑。

## 五、Verification（验证步骤）

1. `npm run lint` 与 `npm run typecheck`（或 `npx tsc --noEmit`）无报错。
2. 手动验证（dev server）：
   - 人物卡片：不填性别年龄点「随机生成」→ 弹错误框；填齐后点「随机生成」→ 弹框提示词含姓名/性别年龄/角色定位/**外貌（若已填）**/性格/背景/关系 → 编辑提示词 → 点「生成」→ 结果流式出现 → 编辑结果 → 点「应用」→ 卡片外貌字段被填充、自动保存。
   - 验证「含简短外貌扩展」：先在人物外貌字段填「短发，黑衣」，再点「随机生成」-> 提示词含该行 -> 生成结果应在此基础上扩展更多细节（服饰配饰等），而非完全无关。
   - 物品卡片：不填分类点「随机生成」-> 弹错误框；填齐后流程同上（entityType=object，提示词含名称/分类/**外观**/功能用途/来源背景）。
   - 场景卡片：不填分类点「随机生成」-> 弹错误框；填齐后流程同上（entityType=scene，提示词含名称/分类/**外观描述**/光影氛围/来源背景）。
   - 生成中点「停止生成」→ 流中断、结果框保留已生成片段、可继续编辑/应用。
   - LLM 未配置时点「随机生成」→ 弹「未配置 LLM」错误框。
   - ESC / 遮罩点击：非生成中可关闭，生成中不关闭。
3. 回归：原「生成图片」弹框、音色生成、卡片字段编辑、自动保存、版本管理不受影响。
