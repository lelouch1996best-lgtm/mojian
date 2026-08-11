# 图片生成弹框 AI 优化 → 可复用「AI 动作下拉按钮」组件重构

## 概述

将 [ImageGenerationDialog.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx) 提示词标题栏右侧的 `AiOptimizeButton`（单一「AI 优化」按钮）替换为一个**可复用的下拉动作按钮组件** `AiActionsButton`。入口按钮外观保持「✨ AI 优化」ghost 小按钮样式（增加一个 ▼ 下拉箭头），hover 后浮现下拉菜单，菜单项可配置。图片生成弹框中配置两个动作：

1. **优化文本** —— 复用现有 `optimizeTextMessages`，流式替换当前提示词。
2. **生成首帧提示词** —— 新增 `generateFirstFramePromptMessages`，根据输入框内容生成「视频首帧静态画面提示词」，流式替换当前提示词。

组件以 `actions` 列表 prop 形式接收动作，便于以后在其他场景复用。本次仅改造图片生成弹框，**不改动** `AiOptimizeButton` 在其他页面（ContentExpansion / VideoGeneration / 各资产卡）的既有用法。

## 当前状态分析（基于实际代码）

- **被替换位置**：[ImageGenerationDialog.tsx L723](file:///Users/heuhajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx#L723)
  ```tsx
  <AiOptimizeButton text={prompt} onOptimized={setPrompt} />
  ```
  导入在 [L6](file:///Users/heuhajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx#L6)：`import AiOptimizeButton from "./ui/AiOptimizeButton";`。该文件内仅此一处使用 `AiOptimizeButton`。

- **现有按钮组件**：[AiOptimizeButton.tsx](file:///Users/heuhajiu/Workbuddy/mojian/components/ui/AiOptimizeButton.tsx)（99 行）
  - Props：`{ text, onOptimized, disabled?, className? }`
  - 逻辑：`streamLLM(optimizeTextMessages(text.trim()), { signal, temperature: 0.7 })` 流式累积，`onOptimized(acc)` 实时回写；`AbortController` 支持停止；运行时按钮变「停止优化」；错误显示在按钮下方。
  - Sparkle 图标为两段 `<path>`（strokeWidth 1.6），需原样迁移到新组件以保持入口样式不变。

- **优化提示词函数**：[prompts.ts L535-549](file:///Users/heuhajiu/Workbuddy/mojian/lib/prompts.ts#L535-L549) `optimizeTextMessages(content, context?)`，已支持可选 context（弹框当前未传 context，保持不变）。

- **LLM 调用**：[llm-client.ts](file:///Users/heuhajiu/Workbuddy/mojian/lib/llm-client.ts) `streamLLM(messages, { signal, temperature })` async generator，yield 文本片段。`LLMMessage` 类型定义在 [lib/types.ts L277](file:///Users/heuhajiu/Workbuddy/mojian/lib/types.ts#L277)：`{ role: "system"|"user"|"assistant"; content: string }`。

- **Button 组件**：[Button.tsx](file:///Users/heuhajiu/Workbuddy/mojian/components/ui/Button.tsx) 支持 `variant="ghost"` `size="sm"`；注意 `loading` prop 会同时禁用按钮，故停止按钮不使用 `loading`。

- **既有 hover 下拉范式**（参考，保持风格一致）：[ImageGenerationDialog.tsx L692-721](file:///Users/heuhajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx#L692-L721)「添加提示词」按钮使用 `group relative` + `absolute right-0 top-full z-50 hidden flex-col pt-1 group-hover:flex` + `pt-1` 桥接避免鼠标移出断开。

- **命名查重**：`components/ui/` 下仅存在 `AiOptimizeButton.tsx`，新名 `AiActionsButton` 无冲突。

- **校验命令**：`package.json` 未配置 `lint`/`typecheck` 脚本，亦未安装 ESLint；类型检查使用 `npx tsc --noEmit`。

## 方案决策（已与用户确认）

| 决策点 | 选择 |
|--------|------|
| 「生成首帧提示词」显示条件 | **组件动作可配置**：新组件接收 `actions` 列表 prop；图片生成弹框默认传入两个动作（优化文本 + 生成首帧提示词），弹框本身不感知上下文，无需把生成目标透传入弹框 |
| 结果写回方式 | **流式替换当前内容**（与「优化文本」一致，支持中途「停止」） |
| 首帧提示词设计目标 | **静态首帧画面提示词**：提取画面/景别/光影等静态视觉信息，强调构图、人物姿态与位置、场景布局、光影氛围；去除运镜/音效/对白/时长等动态与声音信息；保留 @ 资产标签 |
| 入口按钮样式 | **保持「✨ AI 优化」文案 + 新增 ▼ 下拉箭头**（与弹框内「添加提示词」按钮风格一致） |
| 旧组件处理 | `AiOptimizeButton` 保留不动，其他页面用法不变；本次仅替换图片生成弹框内的一处 |

## 实施变更

### 变更 1：新增提示词函数 — `lib/prompts.ts`

在 `optimizeTextMessages` 之后（约 [L549](file:///Users/heuhajiu/Workbuddy/mojian/lib/prompts.ts#L549) 后）新增：

```ts
// (i2) 根据输入内容生成视频首帧画面的图片提示词（AI 动作下拉使用），流式输出
export function generateFirstFramePromptMessages(content: string): LLMMessage[] {
  return [
    {
      role: "system",
      content: `你是一位专业的视频分镜与画面设计师。请根据用户提供的镜头信息或描述，生成一段用于生成「视频首帧图片」的画面提示词。

要求：
1. 从输入内容中提取画面描述、景别、光影氛围等静态视觉信息
2. 生成的提示词需强调静态画面要素：构图、人物姿态与位置、表情、场景布局、光影与氛围
3. 去除与静态图片无关的信息：运镜（推拉摇移等）、音效、对白旁白、时长等动态与声音信息
4. 输入内容中若包含 @标签（如 @韩立、@南宫婉），必须在结果中原样保留这些 @ 前缀，不得删除、改名或移动位置
5. 直接输出提示词文本，不要任何额外说明、前缀或 markdown 代码块`,
    },
    { role: "user", content },
  ];
}
```

### 变更 2：新建可复用组件 — `components/ui/AiActionsButton.tsx`

通用「AI 动作下拉按钮」：触发器为 ghost sm 按钮（Sparkle 图标 + 文案 + ▼），hover 弹出动作菜单；点击动作后用 `streamLLM` 流式输出并经 `onResult` 回写；运行中触发器变为「停止{label}」按钮，支持 `AbortController` 取消；空文本时禁用且不弹菜单。

```tsx
"use client";

import { useRef, useState } from "react";
import Button from "./Button";
import { streamLLM } from "@/lib/llm-client";
import type { LLMMessage } from "@/lib/types";

export interface AiAction {
  key: string;
  label: string;
  buildMessages: (text: string) => LLMMessage[];
  temperature?: number;
}

interface AiActionsButtonProps {
  text: string;
  onResult: (result: string) => void;
  actions: AiAction[];
  disabled?: boolean;
  className?: string;
  triggerLabel?: string;
}

export default function AiActionsButton({
  text,
  onResult,
  actions,
  disabled = false,
  className = "",
  triggerLabel = "AI 优化",
}: AiActionsButtonProps) {
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runningAction = actions.find((a) => a.key === runningKey) ?? null;
  const idleDisabled = disabled || !text.trim();

  async function runAction(action: AiAction) {
    if (!text.trim()) return;
    setError(null);
    setRunningKey(action.key);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let acc = "";
      for await (const chunk of streamLLM(action.buildMessages(text.trim()), {
        signal: controller.signal,
        temperature: action.temperature ?? 0.7,
      })) {
        acc += chunk;
        onResult(acc);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : `${action.label}失败，请重试`);
      }
    } finally {
      setRunningKey(null);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  return (
    <div className={`inline-flex flex-col items-start ${className}`}>
      {runningAction ? (
        <Button variant="ghost" size="sm" onClick={handleStop} title={`正在${runningAction.label}…`}>
          停止{runningAction.label}
        </Button>
      ) : (
        <div className="group relative">
          <Button
            variant="ghost"
            size="sm"
            disabled={idleDisabled}
            title="AI 文本工具"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="mr-0.5">
              <path
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M18.259 8.715L18 9.75l-.259-1.035a2.5 2.5 0 0 0-1.456-1.456L15.25 7l1.035-.259a2.5 2.5 0 0 0 1.456-1.456L18 4.25l.259 1.035a2.5 2.5 0 0 0 1.456 1.456L20.75 7l-1.035.259a2.5 2.5 0 0 0-1.456 1.456z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {triggerLabel}
            <svg className="ml-0.5 h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </Button>
          {!idleDisabled && (
            <div className="absolute right-0 top-full z-50 hidden flex-col pt-1 group-hover:flex">
              <div className="w-max min-w-[8rem] rounded-md border border-slate-100 bg-white py-1 shadow-lg">
                {actions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    onClick={() => runAction(action)}
                    className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-brand-50 hover:text-brand-700"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {error && (
        <span className="mt-0.5 max-w-[16rem] truncate text-xs text-red-500" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
```

设计要点：
- `actions` 为 prop，调用方可任意配置动作数量与顺序；`triggerLabel` 默认「AI 优化」便于复用时改文案。
- 同一时刻只允许运行一个动作：运行时触发器整体替换为「停止{label}」按钮，菜单不渲染，避免并发。
- `idleDisabled`（空文本或外部 disabled）时触发器禁用且不弹菜单（`{!idleDisabled && ...}`）。
- 错误信息展示与原 `AiOptimizeButton` 一致（按钮下方红色 truncate 文案）。
- 下拉结构、`pt-1` 桥接、菜单项 hover 配色（`hover:bg-brand-50 hover:text-brand-700`）与「添加提示词」按钮完全一致。

### 变更 3：改造 `components/ImageGenerationDialog.tsx`

1. **改导入**（[L6](file:///Users/heuhajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx#L6)）：
   - 删除：`import AiOptimizeButton from "./ui/AiOptimizeButton";`
   - 新增：`import AiActionsButton, { type AiAction } from "./ui/AiActionsButton";`
   - 新增：`import { optimizeTextMessages, generateFirstFramePromptMessages } from "@/lib/prompts";`

2. **新增模块级动作常量**（置于文件顶部已有 helper 函数之后，例如 [resolveMentions L41-45](file:///Users/heuhajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx#L41-L45) 之后、组件定义之前）：
   ```ts
   /** 提示词区的 AI 动作下拉配置（优化文本 / 生成首帧提示词） */
   const PROMPT_AI_ACTIONS: AiAction[] = [
     {
       key: "optimize",
       label: "优化文本",
       buildMessages: (text) => optimizeTextMessages(text),
       temperature: 0.7,
     },
     {
       key: "firstFrame",
       label: "生成首帧提示词",
       buildMessages: (text) => generateFirstFramePromptMessages(text),
       temperature: 0.7,
     },
   ];
   ```
   模块级定义保证引用稳定（`buildMessages` 在动作执行时才接收当前 `text`，不捕获组件状态）。

3. **替换使用处**（[L723](file:///Users/hehuajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx#L723)）：
   ```tsx
   // 旧
   <AiOptimizeButton text={prompt} onOptimized={setPrompt} />
   // 新
   <AiActionsButton text={prompt} onResult={setPrompt} actions={PROMPT_AI_ACTIONS} />
   ```

## 假设与决策

1. **作用域**：仅替换图片生成弹框内一处；`AiOptimizeButton` 文件与其他 6 处用法保持不变（符合「Do what has been asked」）。
2. **弹框不感知上下文**：用户选择「组件动作可配置」，故弹框始终展示两个动作，无需把 `imageGenTarget`/`firstFrame` 目标透传进弹框（不引入新 prop，改动最小）。
3. **流式替换**：两个动作均通过 `onResult(acc)` 实时覆盖 `prompt`，与原「AI 优化」行为一致；用户可点「停止{label}」中断。
4. **@ 标签保留**：`generateFirstFramePromptMessages` 的 system prompt 明确要求原样保留 @ 前缀，配合弹框 `keepMentionPrefix` 与后续 `replaceAssetTagsWithImageNos` 流程不冲突。
5. **temperature**：两个动作均用 0.7（与原优化一致），保留在动作配置中便于后续微调。
6. **无 lint 脚本**：项目未配置 ESLint，验证以 `npx tsc --noEmit` 类型检查为准。

## 验证步骤

1. **类型检查**：在项目根目录执行 `npx tsc --noEmit`，确认无类型错误（重点关注新组件 props、`AiAction` 类型、新 prompt 函数签名、弹框导入改动）。
2. **UI 冒烟（dev）**：`npm run dev` 后进入任一图片生成入口（如视频生成页 → 镜头卡 → 生成首帧图/参考图，或资产准备 → 生成图片）打开图片生成弹框：
   - 提示词为空时，「✨ AI 优化 ▼」按钮禁用、hover 不弹菜单。
   - 输入文本后，hover 按钮弹出菜单，含「优化文本」「生成首帧提示词」两项。
   - 点击「优化文本」：提示词流式被替换，按钮变「停止优化文本」，点击可中断。
   - 点击「生成首帧提示词」：基于当前输入流式生成首帧画面提示词，去除运镜/音效/时长等信息，@ 标签保留；运行中按钮变「停止生成首帧提示词」可中断。
   - 失败时按钮下方显示红色错误文案。
3. **回归**：确认 `AiOptimizeButton` 在内容扩写页、视频提示词框、各资产卡等处的「AI 优化」按钮行为不受影响（本次未改动这些文件）。
4. **构建**（可选）：`npm run build` 确认生产构建通过。

## 涉及文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `lib/prompts.ts` | 新增函数 | `generateFirstFramePromptMessages(content)` |
| `components/ui/AiActionsButton.tsx` | 新建文件 | 可复用 AI 动作下拉按钮组件 |
| `components/ImageGenerationDialog.tsx` | 修改 | 替换导入、新增动作常量、L723 替换为 `AiActionsButton` |
