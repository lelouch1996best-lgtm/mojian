# 计划：移除分镜时长强制约束 + 新增智能添加行/镜头

## 概述

三个相关改动：
1. **移除时长 10-15 秒强制约束**：分镜生成不再强制 10-15 秒，改为根据画面内容灵活适配（建议范围 3-20 秒）。
2. **分镜生成页面（Step2）新增「智能添加行」**：在弹窗中填写简短内容（AI 自动扩写），自动生成完整镜头的全部 7 个字段，追加到分镜表末尾。
3. **镜头生成页面（Step4）新增「智能添加镜头」**：功能与第 2 点完全一致，复用同一弹窗组件。

## 当前状态分析

- 应用为 Next.js App Router，四个步骤共用同一份 `episode.shots: Shot[]` 数据源，所有增删改通过 `app/episode/[id]/page.tsx` 的 handler 统一修改并触发防抖自动保存。
- **时长约束是提示词层面的软约束**，集中在 [lib/prompts.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/prompts.ts) 的 `storyboardMessages()`（第 55-83 行）：要求 2「每个镜头时长控制在 10-15 秒」、要求 3「为保证单镜头时长充足…串联多个子画面」、字段说明「duration：时长，取值范围 10-15 秒」、示例值 `"10-15秒"`。数据层 `Shot.duration` 为自由 string，无程序化校验。
- **「添加行」与「添加镜头」是同一个函数** `handleAddRow`（[app/episode/[id]/page.tsx 第 440-442 行](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/[id]/page.tsx#L440-L442)），调用 `emptyShot()` 追加全空 Shot。Step2 按钮在 [StoryboardTable.tsx 第 318-321 行](file:///Users/hehuajiu/Workbuddy/mojian/components/StoryboardTable.tsx#L318-L321)，Step4 按钮在空状态（[第 1289-1293 行](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L1289-L1293)）和非空状态（[第 1353-1358 行](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L1353-L1358)）。
- 已有成熟弹窗模式：[ui/Modal.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ui/Modal.tsx)（portal + 拖拽 + Esc 关闭）；[AppearanceGenerateDialog.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AppearanceGenerateDialog.tsx) 是「弹窗内部调用 LLM + 加载态 + abort + onApply 回调」的范例，可直接参照。
- LLM 调用 `callLLM(messages, { responseFormat, temperature, signal })`（[lib/llm-client.ts 第 165-181 行](file:///Users/hehuajiu/Workbuddy/mojian/lib/llm-client.ts#L165-L181)）支持 `json_object` 响应格式；解析可复用 `extractShots()` + `toShot()`（[lib/utils.ts 第 83-154 行](file:///Users/hehuajiu/Workbuddy/mojian/lib/utils.ts#L83-L154)）。
- 景别/运镜选项定义在 [lib/shot-options.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/shot-options.ts)（`SHOT_TYPES`、`CAMERA_MOVES`）。

## 拟定改动

### 改动 1：移除时长 10-15 秒强制约束

**文件 [lib/prompts.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/prompts.ts) — `storyboardMessages()`（第 55-83 行）**

重写 system content 的「要求」与「字段说明」：
- 删除原要求 2「每个镜头时长控制在 10-15 秒」。
- 删除原要求 3「为保证单镜头时长充足…串联多个子画面…使内容足以支撑 10-15 秒；不要把过短的单一动作单独拆成一个镜头」（该规则是为凑足 10-15 秒的变通手段，约束取消后不再需要）。`visualDescription` 字段说明保留「可串联多个连续子画面，按顺序描述」作为能力描述。
- 新增灵活时长要求：「时长根据画面内容复杂度灵活设定：简单动作可用较短时长（如 3-5 秒），复杂连贯动作可用较长时长（如 10-20 秒），通常在 3-20 秒之间，填入 duration 字段，如 "8秒" 或 "10-15秒"」。
- 字段说明 `duration` 改为「时长，根据内容灵活设定（通常 3-20 秒），如 "8秒"」。
- 示例 JSON 中 `"duration":"10-15秒"` 改为 `"duration":"8秒"`。
- 其余要求（景别/运镜选项、返回 JSON 格式）重新编号保持不变。

**文件 [lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts) 第 194 行**
- 注释 `// 时长（可编辑）- "10-15秒"` 改为 `// 时长（可编辑）- 如 "8秒"`。

**文件 [components/StoryboardRow.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/StoryboardRow.tsx) 第 35 行**
- `placeholder="10-15秒"` 改为 `placeholder="如 8秒"`。

**文件 [components/VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx) 第 2463 行**
- `placeholder="10-15秒"` 改为 `placeholder="如 8秒"`。

### 改动 2 & 3：新增智能添加行/镜头（共用实现）

#### 2.1 新增提示词函数 — [lib/prompts.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/prompts.ts)

在文件末尾新增 `smartShotMessages(content: string): LLMMessage[]`（标注为 `(j) 智能添加单个镜头`）：
- system 角色：要求 AI 根据用户提供的简短内容**扩写**为详细画面描述，并生成 **1 个**完整镜头的**全部 7 字段**；时长按内容灵活设定（通常 3-20 秒）；景别从 `SHOT_TYPES` 选、运镜从 `CAMERA_MOVES` 选；返回 `{"shots":[{...}]}` 格式 JSON（与 `storyboardMessages` 一致以便复用 `extractShots`）。
- user 角色：`请根据以下内容生成一个分镜镜头：\n\n${content}`。
- 字段说明与示例参照 `storyboardMessages`，示例 duration 用 `"8秒"`。

#### 2.2 新增弹窗组件 — `components/SmartAddShotDialog.tsx`（新文件）

参照 [AppearanceGenerateDialog.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AppearanceGenerateDialog.tsx) 模式，但改用非流式 `callLLM` + JSON 解析：
- Props：`{ open: boolean; onClose: () => void; onApply: (shot: Shot) => void; title?: string }`（`title` 默认 `"智能添加镜头"`，Step2 传 `"智能添加行"`）。
- 内部状态：`content`（textarea 输入）、`generating`、`error`，`abortRef`。
- 打开时重置 content/error/generating；卸载时 abort 进行中的请求。
- `handleGenerate`：trim content → `callLLM(smartShotMessages(content), { responseFormat: "json_object", temperature: 0.5, signal })` → `extractShots(raw)` → 若为空提示「未解析到有效镜头数据，请重试」→ 否则 `toShot(rawShots[0])` 生成 Shot → `onApply(shot)` → `onClose()`。
- 生成中禁止关闭/重复点击；catch 中过滤 AbortError，其余展示错误。
- UI：基于 `Modal`（width `max-w-xl`），内容区为一个 textarea（placeholder 示例「主角推开木门走进昏暗的房间，发现桌上放着一封旧信」）+ 提示文案；footer 为「取消」+「生成并添加」（生成中显示「生成中…」并禁用）。
- 导入：`Modal`、`Button`、`callLLM`、`smartShotMessages`、`extractShots`、`toShot`、`Shot` 类型。

#### 2.3 剧集页新增 handler 与 prop 透传 — [app/episode/[id]/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/[id]/page.tsx)

- 在 `handleAddRow`（第 440-442 行）下方新增：
  ```ts
  function handleAddSmartShot(shot: Shot) {
    update((ep) => ({ ...ep, shots: [...ep.shots, shot] }));
  }
  ```
  （`Shot` 类型已在文件中导入。）
- Step2 渲染（第 636-647 行）给 `StoryboardTable` 增加 prop `onAddSmartShot={handleAddSmartShot}`。
- Step4 渲染（第 669-687 行）给 `VideoGeneration` 增加 prop `onAddSmartShot={handleAddSmartShot}`。

#### 2.4 Step2 分镜表接入 — [components/StoryboardTable.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/StoryboardTable.tsx)

- Props 接口新增 `onAddSmartShot: (shot: Shot) => void;`（`Shot` 已导入），解构时加入。
- 新增状态 `const [smartAddOpen, setSmartAddOpen] = useState(false);`。
- 在「+ 添加行」按钮旁（第 318-321 行的 `flex items-center gap-2` 容器内）新增按钮：
  ```tsx
  <Button variant="secondary" size="sm" onClick={() => setSmartAddOpen(true)}>
    ✨ 智能添加行
  </Button>
  ```
- 在组件返回的根容器末尾渲染弹窗：
  ```tsx
  <SmartAddShotDialog
    open={smartAddOpen}
    onClose={() => setSmartAddOpen(false)}
    onApply={onAddSmartShot}
    title="智能添加行"
  />
  ```
- 新增 import：`import { SmartAddShotDialog } from "./SmartAddShotDialog";`。

#### 2.5 Step4 镜头页接入 — [components/VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx)

- Props 接口新增 `onAddSmartShot?: (shot: Shot) => void;`（`Shot` 已导入），解构时加入。
- 在主 `VideoGeneration` 组件内新增状态 `const [smartAddOpen, setSmartAddOpen] = useState(false);`。
- 空状态（第 1289-1293 行「+ 添加镜头」旁）与非空状态（第 1353-1358 行「+ 添加镜头」旁）各新增一个按钮：
  ```tsx
  {onAddSmartShot && (
    <Button variant="secondary" size="sm" onClick={() => setSmartAddOpen(true)}>
      ✨ 智能添加镜头
    </Button>
  )}
  ```
  （空状态处按钮加 `mt-4` 与现有按钮对齐；两处按钮放在与「+ 添加镜头」同一行的 `gap-2` 容器或相邻 div 中。）
- 在主组件返回根容器末尾（第 1362 行 `</div>` 之前）渲染一次弹窗：
  ```tsx
  <SmartAddShotDialog
    open={smartAddOpen}
    onClose={() => setSmartAddOpen(false)}
    onApply={(shot) => onAddSmartShot?.(shot)}
    title="智能添加镜头"
  />
  ```
- 新增 import：`import { SmartAddShotDialog } from "./SmartAddShotDialog";`。

## 假设与决策

1. **时长指引**：移除 10-15 秒硬约束后，提示词给出灵活建议范围 3-20 秒，由 AI 按内容复杂度适配，避免极端值（用户确认）。
2. **生成字段**：智能添加生成全部 7 个字段（时长/画面描述/景别/光影氛围/对白旁白/音效/运镜），得到即开即用的完整镜头（用户确认）。
3. **生成数量**：智能添加始终生成 1 个镜头（用户确认）。
4. **上下文参考**：智能添加不参考剧集已有的人物/场景/世界设定，仅根据弹窗输入内容生成（用户确认）。
5. **「可以扩写」交互**：用户在弹窗输入简短内容后，AI 一步完成「扩写 + 生成全部字段」，无需单独的扩写步骤（用户原文「自动帮我生成」）。
6. **按钮并存**：「智能添加行/镜头」为新增按钮，与原有「+ 添加行 / + 添加镜头」并存，不替换（用户原文「新增一个」）。
7. **插入位置**：智能添加的镜头追加到 `episode.shots` 末尾，与现有 `handleAddRow` 行为一致。
8. **弹窗复用**：Step2 与 Step4 共用同一个 `SmartAddShotDialog` 组件，仅 `title` 不同；弹窗内部自行完成 LLM 调用与解析，通过 `onApply(shot)` 回传结果，由剧集页 handler 追加。
9. **解析复用**：智能添加返回 `{"shots":[...]}` 格式，复用现有 `extractShots` + `toShot`，取首项作为生成结果。
10. **解析失败处理**：`extractShots` 返回空数组时，弹窗内展示错误提示并允许重试，不关闭弹窗、不写入数据。

## 验证步骤

1. **类型检查**：`npx tsc --noEmit`（项目无独立 lint 脚本），确认无类型错误。
2. **构建检查**：`npm run build` 确认 Next.js 构建通过。
3. **功能验证 — 时长约束移除**：
   - Step1 生成内容 → 进入 Step2，检查生成的分镜 duration 字段不再统一为「10-15秒」，出现如「8秒」「5-8秒」等按内容适配的值。
   - 检查 Step2/Step4 的时长单元格 placeholder 显示「如 8秒」。
4. **功能验证 — Step2 智能添加行**：
   - 点击「✨ 智能添加行」→ 弹窗打开 → 输入简短内容（如「主角推门进入房间发现一封信」）→ 点「生成并添加」→ 加载态 → 弹窗关闭，分镜表末尾新增一行，7 个字段均已填充，duration 为合理值。
   - 空内容时「生成并添加」禁用；生成中无法关闭弹窗。
   - 模拟解析失败（如断网）→ 弹窗显示错误提示，可重试。
5. **功能验证 — Step4 智能添加镜头**：
   - 在镜头页（有镜头/无镜头两种状态）点击「✨ 智能添加镜头」→ 同样流程 → 镜头卡片网格末尾新增一张已填充分镜信息的卡片。
6. **回归**：原有「+ 添加行 / + 添加镜头」仍正常追加空行；分镜重新生成、智能标注等已有功能不受影响。
