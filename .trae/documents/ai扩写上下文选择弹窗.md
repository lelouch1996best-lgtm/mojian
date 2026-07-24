# AI 扩写上下文选择弹窗 — 优化计划

## 一、需求总结

现状：点击「AI 扩写」后直接流式生成，世界设定 + 人物设定 + 前序剧集（自动关联、3000 字截断）被隐式带入 prompt，用户无感知、无控制。

优化目标：点击「AI 扩写」后先弹出上下文选择弹窗，让用户显式选择本次扩写要携带的上下文：

1. **世界设定**：有内容时显示，整体一个复选框，默认勾选，可取消
2. **人物 / 物品 / 场景设定**：按「名称在第一步原文中出现」自动匹配，匹配到的默认勾选并标记「原文提及」；未匹配的不勾选但可手动勾选；也可取消任何已勾选项
3. **前序剧集**：取消自动关联，列出当前集之前所有已有扩写内容的剧集（复选框），默认全不勾，由用户自行勾选；勾选的集仍按约 3000 字上限截断
4. **空状态**：若上述三类上下文全都无可选项，跳过弹窗直接扩写（保持现有体验）

## 二、现状分析（基于代码探索）

| 环节 | 位置 | 现状 |
|---|---|---|
| 扩写按钮与点击逻辑 | [ContentExpansion.tsx:L74-L101](file:///Users/hehuajiu/Workbuddy/mojian/components/ContentExpansion.tsx#L74-L101) | `handleExpand` 直接调 `streamLLM(expansionMessages(...))` 流式生成 |
| prompt 组装 | [prompts.ts:L16-L35](file:///Users/hehuajiu/Workbuddy/mojian/lib/prompts.ts#L16-L35) | `expansionMessages(content, worldText, characterText, previousEpisodesContext)`，设定拼入 system message；**物品/场景设定未接入** |
| 物品/场景序列化 | [object-settings.ts:L23](file:///Users/hehuajiu/Workbuddy/mojian/lib/object-settings.ts#L23)、[scene-settings.ts:L23](file:///Users/hehuajiu/Workbuddy/mojian/lib/scene-settings.ts#L23) | `objectSettingsToText` / `sceneSettingsToText` 已定义但**无调用点**，本次接入 |
| 前序剧集计算 | [page.tsx:L140-L164](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/[id]/page.tsx#L140-L164) | 自动拼接前序所有有扩写内容的集 + 3000 字逆序截断，产出 `previousContext` 字符串传入组件 |
| 设定数据 | [types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts) | 系列级内嵌于 `Series`；人物/世界设定有全局回退（`getWorldSettings` / `getCharacterSettings`）；物品/场景只有系列级 |
| 最新版本去重 | `getLatestVersions` / `getLatestObjectVersions` / `getLatestSceneVersions` | 三个 lib 均有现成的「按 ID 分组取 version 最大」函数，直接复用 |
| 弹窗组件 | [Modal.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ui/Modal.tsx) | 通用 Modal（open/onClose/title/footer/width），**注意：实现是 `if (!open) return null`，组件始终挂载、state 不会因关闭而重置** |

### 探索中发现的顺带修复点

[page.tsx:L152](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/[id]/page.tsx#L152) 用**过滤后数组的下标**标注「第 N 集」，若中间某集无扩写内容被过滤，集数标注会错位。新方案传递真实集序（在 `allEpisodes` 中的位置 + 1），顺带修正。

## 三、已确认的决策（来自用户）

| 问题 | 决策 |
|---|---|
| 世界设定勾选粒度 | 整体一个复选框（背景/主题/风格全带或全不带） |
| 设定匹配逻辑 | 按名称匹配（`originalContent.includes(name)`），匹配到的默认勾选，未匹配可手动勾选 |
| 剧集列表与默认状态 | 只列出当前集之前、已有扩写内容的集；默认全不勾；勾选后仍按 3000 字截断 |
| 无可选上下文时 | 跳过弹窗直接扩写 |

### 补充假设（实现时按此执行，如有异议可提出）

1. 世界设定复选框**默认勾选**（用户构想中「可以取消勾选」隐含默认勾选）
2. 勾选状态**不跨次记忆**：每次打开弹窗按默认规则重新初始化
3. 多版本设定（人物/物品/场景）在列表中只展示**最新版本**，匹配和序列化均基于最新版本
4. 用户可取消所有勾选（等同无上下文扩写），允许确认

## 四、改动清单

### 1. [lib/prompts.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/prompts.ts) — prompt 支持物品/场景设定

- 新增两个前缀模板（仿照现有 `worldContext` / `characterContext`）：

```ts
/** 物品设定前缀模板 */
function objectContext(text: string): string {
  if (!text?.trim()) return "";
  return `\n\n【物品设定 —— 请保持以下物品的外观、功能、来源设定一致性】\n${text.trim()}\n`;
}

/** 场景设定前缀模板 */
function sceneContext(text: string): string {
  if (!text?.trim()) return "";
  return `\n\n【场景设定 —— 请保持以下场景的环境、氛围设定一致性】\n${text.trim()}\n`;
}
```

- 修改 `expansionMessages` 签名，在 `characterText` 后插入 `objectText`、`sceneText` 参数（该函数全库仅 ContentExpansion.tsx 一处调用，可安全改签名）：

```ts
export function expansionMessages(
  content: string,
  worldText = "",
  characterText = "",
  objectText = "",
  sceneText = "",
  previousEpisodesContext = "",
): LLMMessage[] {
  // system content 中拼接顺序：${ctx}${charCtx}${objCtx}${sceneCtx}${prevCtx}
}
```

### 2. [lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts) — 新增前序剧集上下文类型

```ts
/** AI 扩写可选的前序剧集上下文（由剧集页计算，供扩写弹窗勾选） */
export interface PreviousEpisodeContext {
  id: string;
  /** 在系列中的真实集序（从 1 开始） */
  orderIndex: number;
  title: string;
  /** 该集的扩写内容（已 trim，保证非空） */
  content: string;
}
```

### 3. 新建 [components/ExpansionContextModal.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ExpansionContextModal.tsx) — 上下文选择弹窗

复用 [Modal.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ui/Modal.tsx)（模式 A），参考 [CharacterConflictModal.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/CharacterConflictModal.tsx) 的 footer 按钮布局。

**Props：**

```ts
interface ExpansionContextModalProps {
  open: boolean;
  /** 用于名称匹配的原文快照（打开弹窗时传入） */
  originalContent: string;
  /** 世界设定是否可用（有内容才显示该区块） */
  worldAvailable: boolean;
  characters: CharacterProfile[];   // 已按最新版本去重
  objects: ObjectProfile[];         // 已按最新版本去重
  scenes: SceneProfile[];           // 已按最新版本去重
  previousEpisodes: PreviousEpisodeContext[];
  onConfirm: (selection: ExpansionContextSelection) => void;
  onClose: () => void;
}

export interface ExpansionContextSelection {
  includeWorld: boolean;
  characterIds: string[];  // 选中的条目 id（最新版本条目的 id）
  objectIds: string[];
  sceneIds: string[];
  episodeIds: string[];
}
```

**内部状态与初始化：**

- `includeWorld`、`characterIds`、`objectIds`、`sceneIds`、`episodeIds` 五个 `useState`
- **关键**：因 Modal `if (!open) return null` 不卸载组件，必须用 `useEffect(() => { if (open) { 初始化 } }, [open])` 在每次打开时重置勾选状态：
  - `includeWorld = worldAvailable`
  - 设定条目：`originalContent.includes(item.name.trim())`（name 非空才参与）→ 匹配到的进入默认勾选集合
  - `episodeIds = []`（默认全不勾）

**UI 结构（各区块在无条目时不渲染）：**

- 标题：「AI 扩写上下文」，`width="max-w-xl"`
- 区块一 · 世界设定：单个复选框「世界设定（故事背景 / 核心主题 / 写作风格）」
- 区块二 · 关联设定：人物 / 物品 / 场景分三组小标题（组为空则不显示该组），每行一个复选框显示名称（人物可附角色定位、物品/场景可附分类，作为次要灰色文字）；被名称匹配命中的条目在名称旁显示「原文提及」小徽章（ emerald 色系，贴合现有 notice 风格），让用户明确感知自动勾选的依据
- 区块三 · 前文剧集：每行复选框显示「第 {orderIndex} 集 · {title}」；下方灰色小字提示「勾选的剧集将按约 3000 字上限带入」
- footer：`取消`（secondary，onClose）+ `开始扩写`（primary，onConfirm）

复选框样式：原生 `<input type="checkbox">` + Tailwind（`accent-brand-600` 或现有表单控件风格，参考项目其他表单）。

### 4. [components/ContentExpansion.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ContentExpansion.tsx) — 接入弹窗与新数据流

**Props 变更：**

```ts
// 删除：previousContext?: string;
// 新增：
previousEpisodes?: PreviousEpisodeContext[];
objectSettings?: ObjectProfile[] | null;
sceneSettings?: SceneProfile[] | null;
```

**全局回退改造（人物设定）：**

- 现状：`globalCharacterText` state 存的是序列化后的文本，无法用于弹窗条目展示和匹配
- 改为：`const [globalCharacters, setGlobalCharacters] = useState<CharacterProfile[]>([])`，useEffect 中 `getCharacterSettings().then(setGlobalCharacters)`
- 生效人物列表：`const effectiveCharacters = characterSettings ?? globalCharacters`（系列级优先，与现有语义一致）
- 世界设定回退保持不变（`globalWorldText`，只需布尔可用性 + 文本）

**`handleExpand` 改造为两段：**

```ts
function handleExpand() {
  if (!originalContent.trim()) { setError("请先输入故事内容"); return; }
  setError(null);
  // 计算可选项
  const chars = getLatestVersions(effectiveCharacters).filter(c => c.name.trim());
  const objs = getLatestObjectVersions(objectSettings ?? []).filter(o => o.name.trim());
  const scns = getLatestSceneVersions(sceneSettings ?? []).filter(s => s.name.trim());
  const hasOptions = !!worldText.trim() || chars.length > 0 || objs.length > 0
    || scns.length > 0 || (previousEpisodes?.length ?? 0) > 0;
  if (!hasOptions) {
    runExpand({ includeWorld: false, characterIds: [], objectIds: [], sceneIds: [], episodeIds: [] });
    return;  // 空状态：跳过弹窗直接扩写
  }
  setModalOpen(true);  // 匹配用的原文直接用当前 originalContent
}
```

**抽出实际扩写函数**（原 `handleExpand` 的流式主体，按勾选结果组装上下文）：

```ts
async function runExpand(sel: ExpansionContextSelection) {
  setModalOpen(false);
  setExpanding(true);
  onExpandedChange("");
  const controller = new AbortController();
  abortRef.current = controller;
  try {
    const world = sel.includeWorld ? worldText : "";
    const chars = getLatestVersions(effectiveCharacters).filter(c => sel.characterIds.includes(c.id));
    const objs  = getLatestObjectVersions(objectSettings ?? []).filter(o => sel.objectIds.includes(o.id));
    const scns  = getLatestSceneVersions(sceneSettings ?? []).filter(s => sel.sceneIds.includes(s.id));
    const prevCtx = buildPreviousContext(
      (previousEpisodes ?? []).filter(e => sel.episodeIds.includes(e.id))
    );
    let acc = "";
    for await (const chunk of streamLLM(
      expansionMessages(
        originalContent, world,
        characterSettingsToText(chars),   // 传入已筛选数组即可只序列化选中项
        objectSettingsToText(objs),       // （toText 内部的去重对已去重列表幂等）
        sceneSettingsToText(scns),
        prevCtx,
      ),
      { signal: controller.signal, temperature: 0.8 },
    )) {
      acc += chunk;
      onExpandedChange(acc);
    }
  } catch (e) { /* 同现有错误处理 */ }
  finally { /* 同现有 */ }
}
```

**3000 字截断逻辑迁移**（从 page.tsx 移入本组件，私有函数，策略不变：按集序排列后从最近一集逆序累加，超出即停；兜底取最近一集末尾 3000 字）：

```ts
function buildPreviousContext(eps: PreviousEpisodeContext[]): string {
  const sorted = [...eps].sort((a, b) => a.orderIndex - b.orderIndex);
  const blocks = sorted.map(e => `【第${e.orderIndex}集】\n${e.content}`);
  // ... 与现有 page.tsx L153-L163 相同的逆序截断逻辑
}
```

**渲染**：在组件 JSX 末尾挂载 `<ExpansionContextModal>`，传入当前 `originalContent`、`worldAvailable={!!worldText.trim()}`、三个去重后的设定列表、`previousEpisodes ?? []`、`onConfirm={runExpand}`、`onClose={() => setModalOpen(false)}`。

新增 import：`Modal` 相关类型、`objectSettingsToText` / `getLatestObjectVersions`、`sceneSettingsToText` / `getLatestSceneVersions`、`getLatestVersions`（character-settings 已有此函数，注意与现有 `characterSettingsToText` 区分导入）、新类型。

### 5. [app/episode/[id]/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/[id]/page.tsx) — 简化数据计算

- 删除 `previousContext` state 及 L151-L163 的拼接/截断逻辑
- 改为存结构化列表（顺带修正集序错位问题）：

```ts
const [previousEpisodes, setPreviousEpisodes] = useState<PreviousEpisodeContext[]>([]);
// useEffect 加载中：
const prevEps: PreviousEpisodeContext[] = allEpisodes
  .map((e, i) => ({ e, orderIndex: i + 1 }))
  .filter(({ e, orderIndex }) => orderIndex - 1 < currentIdx && e.expandedContent.trim())
  .map(({ e, orderIndex }) => ({
    id: e.id,
    orderIndex,
    title: e.title,
    content: e.expandedContent.trim(),
  }));
setPreviousEpisodes(prevEps);
```

- JSX 中 `ContentExpansion` 的 props：`previousContext={previousContext}` 替换为 `previousEpisodes={previousEpisodes}`，并新增 `objectSettings={seriesObjectSettings}`、`sceneSettings={seriesSceneSettings}`（这两个 state 已存在，L61-L62）

## 五、数据流（改造后）

```
点击「AI 扩写」
  └─ handleExpand：计算可选项
       ├─ 无可选项 → runExpand(全空) → 直接流式扩写（现状体验）
       └─ 有可选项 → ExpansionContextModal
            ├─ 取消 → 关闭，无动作
            └─ 开始扩写 → onConfirm(selection)
                 └─ runExpand(selection)：
                      worldText（勾选才带）
                      + characterSettingsToText(选中人物)
                      + objectSettingsToText(选中物品)   ← 新接入
                      + sceneSettingsToText(选中场景)    ← 新接入
                      + buildPreviousContext(选中剧集，3000 字截断)
                      → expansionMessages → streamLLM → onExpandedChange → 防抖落库
```

## 六、边界情况

| 场景 | 行为 |
|---|---|
| 第一集 / 前序集均无扩写内容 | 剧集区块不显示 |
| 系列无设定且全局无设定 | 对应区块不显示；全部为空则跳过弹窗 |
| 设定名称为空 | 该条目已被 filter 排除，不参与展示和匹配 |
| 名称匹配大小写 | 直接 `includes` 区分大小写（中文为主，与现有 `@标签` 子串匹配风格一致） |
| 弹窗打开期间 | 原文输入框禁用状态不变（弹窗为模态，用户无法编辑原文，匹配快照无过期问题） |
| 全部取消勾选后确认 | 允许，等同无上下文扩写 |
| 扩写中再次点击 | `expanding` 时按钮 loading 禁用，与现状一致 |
| 全局人物设定异步加载未完成时点击 | 以当前已加载 state 为准（页面加载后 useEffect 早已完成，实际无影响） |

## 七、验证步骤

1. `npm run build`（next build 含 TypeScript 检查；项目无独立 lint/test 脚本）
2. 手动验证（`npm run dev`）：
   - 系列有世界设定 + 人物/物品/场景设定 + 前序集有扩写内容：点击「AI 扩写」弹窗出现，世界设定默认勾选，原文中提及的设定默认勾选且有「原文提及」标记，剧集默认全不勾
   - 取消/改选后确认，扩写结果符合所选上下文（可在 `app/api/llm/route.ts` 或网络面板查看实际发出的 system prompt）
   - 无任何设定且为第一集：点击后直接扩写，无弹窗
   - 勾选多集：prompt 中前文剧情 ≤ 约 3000 字，且优先保留最近的集
   - 弹窗「取消」：关闭且不触发任何请求
   - 集数标注：前序某集无扩写内容时，列出的集序仍为其真实集序（验证顺带修复点）
