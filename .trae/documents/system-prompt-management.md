# 系统提示词管理 实施计划

## 概要

在现有「提示词管理」页面（`/style-templates`）新增 Tab「LLM 系统提示词」，允许用户查看并编辑 `lib/prompts.ts` 中所有 LLM 系统提示词，支持单项恢复默认与全部恢复默认。编辑后全局生效（与现有图片提示词模板的"全局"定位一致）。

---

## 现状分析

### 1. LLM 系统提示词现状
- 全部硬编码在 `lib/prompts.ts` 的 16 个函数里，用户无法修改。
- 13 个函数有实际调用方；2 个（`finalPromptMessages` L85、`storyboardImagePromptMessages` L407）为死代码无调用方，本次不纳入。
- 4 个函数的 system prompt 含**动态插值**（需用占位符机制处理）：
  - `expansionMessages` (L48)：末尾拼接 `${ctx}${charCtx}${objCtx}${scnCtx}${prevCtx}`
  - `storyboardMessages` (L64-65)：含 `${SHOT_TYPES.join("、")}` `${CAMERA_MOVES.join("、")}`
  - `videoPromptMessages` (L373)：含 `${cameraMoveGuide}`（运镜映射表）
  - `singleRowTaggingMessages` (L204)：末尾拼接 `${existingHint}${knownHint}`
- 其余 9 个函数的 system prompt 为纯静态文本。

### 2. 现有「提示词管理」页
- 路径 `/app/style-templates/page.tsx`（811 行），管理 `StylePreset`（图片提示词模板 + 参考图），不含 LLM 系统提示词。
- 自动保存：防抖 1500ms（`lib/utils.ts:157` `AUTOSAVE_DEBOUNCE_MS`）+ beforeunload 兜底。
- 无 Tab 切换，无"高级选项"折叠区，无"恢复默认"按钮。

### 3. 持久化模式（参考 `lib/style-settings.ts`）
- 存储：通用 settings 表（`lib/db.ts:71`），key-value，value 存 JSON。
- API：`GET/PUT /api/settings/{key}`（`app/api/settings/[key]/route.ts`）。
- 客户端：`apiClient.getSetting/saveSetting`（`lib/api-client.ts:62-68`）。
- 最佳参考 `lib/style-settings.ts`：模块级缓存 + 异步/同步双版本 + 内置默认+用户自定义合并 + `isBuiltinPreset` 判定。

### 4. "恢复默认"先例
- `app/settings/page.tsx:2453-2469`：顶部按钮 + confirm 弹窗刷新内置列表。
- `app/settings/page.tsx:2392-2410`：单条目右侧小按钮 + confirm 初始化参数。
- `lib/model-presets.ts:990-1005`：`mergeWithBuiltIn` 合并代码最新内置 + 用户自添加。

---

## 提议改动

### 改动 1：`lib/types.ts` — 新增类型（~15 行）

在 `StylePreset` 接口附近新增：

```ts
/** LLM 系统提示词的 key 枚举（对应 lib/prompts.ts 中 13 个活跃函数） */
export type SystemPromptKey =
  | "expansion"          // 内容扩写
  | "storyboard"         // 分镜生成
  | "videoPrompt"        // 视频提示词生成
  | "tagging"            // 批量智能标注
  | "singleRowTagging"   // 单行智能标注
  | "asset"              // 批量资产生成
  | "regenerateAsset"    // 单资产外貌重生
  | "optimizeText"       // 通用文本润色
  | "optimizeVideo"      // 视频提示词优化
  | "generateFirstFrame" // 首帧画面提示词
  | "smartShot"          // 智能添加单镜头
  | "generateAppearance" // 随机外貌生成
  | "extractCharacter";  // 提取人物设定

/** 用户自定义系统提示词映射（key → 自定义文本；未出现的 key 回退默认） */
export type SystemPromptMap = Partial<Record<SystemPromptKey, string>>;
```

### 改动 2：`lib/system-prompts.ts` — 新建核心 lib（~180 行，照搬 style-settings.ts 模式）

**职责**：定义默认值、UI 元数据、读写函数、占位符替换工具。

```ts
import { apiClient } from "./api-client";
import type { SystemPromptKey, SystemPromptMap } from "./types";
import { SHOT_TYPES, CAMERA_MOVES } from "./shot-options";

export const SYSTEM_PROMPTS_KEY = "custom_prompts";

/** 默认系统提示词（从 lib/prompts.ts 现有硬编码文本抽出，动态插值改为 {占位符}） */
export const DEFAULT_SYSTEM_PROMPTS: Record<SystemPromptKey, string> = {
  expansion: `你是一位专业的视频剧本编剧助手。...{worldContext}{characterContext}{objectContext}{sceneContext}{previousEpisodesContext}`,
  storyboard: `你是一位专业的视频分镜师。...景别从以下选择：{shotTypes}\n5. 运镜从以下选择：{cameraMoves}...`,
  videoPrompt: `你是一位 Seedance 2.0 视频生成模型提示词专家。...${"{cameraMoveGuide}"}...`,
  singleRowTagging: `...${"{existingTagsHint}"}${"{knownTagsHint}"}...`,
  // ... 其余 9 个纯静态，原样复制
  tagging: `你是一位视频分镜分析师。...`,
  asset: `...`,
  regenerateAsset: `...`,
  optimizeText: `...`,
  optimizeVideo: `...`,
  generateFirstFrame: `...`,
  smartShot: `...`,
  generateAppearance: `...`,
  extractCharacter: `...`,
};

/** UI 元数据：分组、标签、描述、占位符说明 */
export interface SystemPromptMeta {
  group: "第一步·故事" | "第二步·分镜" | "第三步·资产" | "第四步·视频" | "通用";
  label: string;
  description: string;
  /** 该 prompt 含哪些占位符，供 UI 显示 hint（空数组表示纯静态无占位符） */
  placeholders?: { token: string; meaning: string }[];
}

export const SYSTEM_PROMPT_META: Record<SystemPromptKey, SystemPromptMeta> = {
  expansion: {
    group: "第一步·故事", label: "内容扩写", description: "Step1 扩写故事内容时的系统提示词",
    placeholders: [
      { token: "{worldContext}", meaning: "世界设定（自动拼接，可为空）" },
      { token: "{characterContext}", meaning: "人物设定（自动拼接，可为空）" },
      { token: "{objectContext}", meaning: "物品设定（自动拼接，可为空）" },
      { token: "{sceneContext}", meaning: "场景设定（自动拼接，可为空）" },
      { token: "{previousEpisodesContext}", meaning: "前几集剧情（自动拼接，可为空）" },
    ],
  },
  storyboard: {
    group: "第二步·分镜", label: "分镜生成", description: "Step2 将剧本拆分为镜头的系统提示词",
    placeholders: [
      { token: "{shotTypes}", meaning: "可选景别列表（自动注入）" },
      { token: "{cameraMoves}", meaning: "可选运镜列表（自动注入）" },
    ],
  },
  videoPrompt: {
    group: "第四步·视频", label: "视频提示词生成", description: "VideoCard 生成视频提示词的系统提示词",
    placeholders: [{ token: "{cameraMoveGuide}", meaning: "运镜映射指南（自动注入）" }],
  },
  singleRowTagging: {
    group: "第二步·分镜", label: "单行智能标注", description: "单镜头补充标注的系统提示词",
    placeholders: [
      { token: "{existingTagsHint}", meaning: "已有标签提示（自动拼接，可为空）" },
      { token: "{knownTagsHint}", meaning: "全局已知标签提示（自动拼接，可为空）" },
    ],
  },
  // ... 其余 9 项 placeholders 为空数组
  // ...
};

// —— 读写函数（照搬 style-settings.ts 的缓存+异步/同步双版本模式）——
let _cache: SystemPromptMap | null = null;

export async function getCustomPrompts(): Promise<SystemPromptMap> {
  if (_cache) return _cache;
  try {
    _cache = await apiClient.getSetting<SystemPromptMap>(SYSTEM_PROMPTS_KEY) ?? {};
    return _cache;
  } catch { return {}; }
}

export function getCustomPromptsSync(): SystemPromptMap {
  return _cache ?? {};
}

export async function saveCustomPrompts(map: SystemPromptMap): Promise<void> {
  _cache = map;
  await apiClient.saveSetting(SYSTEM_PROMPTS_KEY, map);
}

/** 取某 key 的有效系统提示词（优先用户自定义，回退默认） */
export function getSystemPromptSync(key: SystemPromptKey): string {
  return getCustomPromptsSync()[key] ?? DEFAULT_SYSTEM_PROMPTS[key];
}

/** 占位符替换：把 {token} 替换为实际值 */
export function applyPlaceholders(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template;
  for (const [token, value] of Object.entries(vars)) {
    result = result.split(token).join(value);
  }
  return result;
}

/** 单项恢复默认 */
export async function resetSystemPrompt(key: SystemPromptKey): Promise<void> {
  const map = { ...getCustomPromptsSync() };
  delete map[key];
  await saveCustomPrompts(map);
}

/** 全部恢复默认 */
export async function resetAllSystemPrompts(): Promise<void> {
  await saveCustomPrompts({});
}

/** 判断某 key 是否已被自定义（用于 UI 显示"已修改"标记） */
export function isCustomized(key: SystemPromptKey): boolean {
  return key in getCustomPromptsSync();
}
```

**注意**：`DEFAULT_SYSTEM_PROMPTS` 的每个值需从 `lib/prompts.ts` 对应函数的 system content 原样复制，仅把 `${动态变量}` 改为 `{占位符}`。这是手工迁移工作，需逐个核对。

### 改动 3：`lib/prompts.ts` — 改造 13 个函数（每个函数 ~3 行改动）

每个函数把硬编码 system prompt 字符串替换为 `getSystemPromptSync(key)` + `applyPlaceholders`。

**示例 — `expansionMessages`（含占位符）**：
```ts
import { getSystemPromptSync, applyPlaceholders } from "./system-prompts";

export function expansionMessages(content, worldText, characterText, objectText, sceneText, previousEpisodesContext): LLMMessage[] {
  const ctx = worldContext(worldText);
  const charCtx = characterContext(characterText);
  // ... objCtx, scnCtx, prevCtx 同原逻辑
  const systemTemplate = getSystemPromptSync("expansion");
  const systemContent = applyPlaceholders(systemTemplate, {
    "{worldContext}": ctx,
    "{characterContext}": charCtx,
    "{objectContext}": objCtx,
    "{sceneContext}": scnCtx,
    "{previousEpisodesContext}": prevCtx,
  });
  return [
    { role: "system", content: systemContent },
    { role: "user", content: `请扩写以下内容：\n\n${content}` },
  ];
}
```

**示例 — `taggingMessages`（纯静态，无占位符）**：
```ts
export function taggingMessages(shots: Shot[]): LLMMessage[] {
  const list = shots.map((s, i) => `【镜头${i + 1}】${s.visualDescription}`).join("\n");
  const systemContent = getSystemPromptSync("tagging");
  return [
    { role: "system", content: systemContent },
    { role: "user", content: `请为以下镜头画面描述做实体标注：\n\n${list}` },
  ];
}
```

**需改造的 13 个函数清单**（行号为改造前位置）：
| 函数 | 行号 | 占位符 |
|------|------|--------|
| `expansionMessages` | L29-52 | 5 个上下文占位符 |
| `storyboardMessages` | L55-82 | `{shotTypes}` `{cameraMoves}` |
| `taggingMessages` | L126-167 | 无 |
| `singleRowTaggingMessages` | L172-224 | `{existingTagsHint}` `{knownTagsHint}` |
| `assetMessages` | L228-270 | 无 |
| `regenerateAssetMessages` | L273-312 | 无 |
| `videoPromptMessages` | L316-404 | `{cameraMoveGuide}` |
| `optimizeTextMessages` | L535-549 | 无 |
| `optimizeVideoPromptMessages` | L553-590 | 无 |
| `generateFirstFramePromptMessages` | L593-608 | 无 |
| `smartShotMessages` | L612-642 | 无 |
| `generateAppearanceMessages` | L645-674 | 无 |
| `extractCharacterMessages` | L678-706 | 无 |

**不改造**：`finalPromptMessages`（L85）、`storyboardImagePromptMessages`（L407）—— 死代码无调用方，保持原样。`wrapStoryboardTemplate`/`buildShotInfoBlock`/`buildShotInfoBlockForImage` 是纯字符串工具函数，无 system prompt，不改造。

### 改动 4：`app/style-templates/page.tsx` — 加 Tab + 系统提示词管理 UI

**4a. 顶部加 Tab 切换**（参考项目内常见 tab 模式）：
- 新增 state `tab: "imageTemplates" | "systemPrompts"`，默认 `"imageTemplates"`。
- Header 下方加两个 tab 按钮：「图片提示词模板」（现有内容）／「LLM 系统提示词」（新）。
- 现有的模板列表 + 编辑区用 `{tab === "imageTemplates" && (...)}` 包裹。

**4b. 新 Tab 内容**（`tab === "systemPrompts"` 时渲染）：
- 顶部说明条 + 「全部恢复默认」按钮（confirm 弹窗，参考 `app/settings/page.tsx:2455`）。
- 按 `SYSTEM_PROMPT_META` 的 group 分 5 组渲染，每组一个区块标题。
- 每个系统提示词一个卡片：
  - 标题（label）+ 描述（description）
  - 若 `isCustomized(key)` 显示"已修改"小徽标 + 右侧「恢复默认」小按钮（confirm）
  - textarea（rows=8~12，根据默认长度调整），值绑定到本地 state
  - 若有 `placeholders`，textarea 下方显示 hint："可用占位符：{xxx}（含义）、{yyy}（含义）…请保留这些占位符，否则动态内容无法注入。"
- 自动保存：textarea onChange 更新本地 state + 防抖 1500ms 调 `saveCustomPrompts`（复用现有 `persist` 模式 + `skipPersistRef` 避免初始化误存）。
- beforeunload 兜底：复用现有 line 213-229 的 keepalive fetch 模式，PUT `custom_prompts`。
- 初始化：`useEffect` 调 `getCustomPrompts()` 填充本地 state。

**4c. 新增子组件 `SystemPromptField`**（内联在页面文件或抽出到 `components/`）：
- Props: `promptKey: SystemPromptKey`, `value: string`, `onChange: (v: string) => void`, `onReset: () => void`, `customized: boolean`
- 渲染标题/描述/徽标/textarea/hint/恢复默认按钮

### 改动 5：入口无需新增
- 现有「提示词管理」入口（`app/page.tsx:112`、`app/episode/[id]/page.tsx:687`）已指向 `/style-templates`，Tab 切换后用户自然能看到新功能，无需新增导航。

---

## 假设与决策

1. **呈现方式**：Tab 切换（非折叠区）。理由：13 个文本框内容量大，折叠区会让页面过长；Tab 能清晰分离"图片提示词模板"与"LLM 系统提示词"两类异质内容。
2. **生效范围**：全局生效（非按企划）。理由：现有"提示词管理"页明确是全局的（说明条："管理全局提示词"）；LLM 系统提示词目前也是全局硬编码，改为全局可编辑最自然。
3. **开放范围**：13 个活跃函数全部开放。排除 2 个死代码（`finalPromptMessages`、`storyboardImagePromptMessages`）。
4. **占位符机制**：对含动态插值的 4 个函数，将 `${变量}` 改为 `{占位符}`，函数内用 `applyPlaceholders` 替换。UI 显示占位符 hint，提示用户保留。用 `split().join()` 替换避免正则转义问题（呼应项目 memory 中"正则特殊字符需转义"的教训）。
5. **存储 key**：`custom_prompts`（与现有 `style-templates` 命名风格一致，kebab-case/snake_case 混用，但 settings 表已有 `llm_provider_keys` 等 snake_case 先例，故用 `custom_prompts`）。
6. **自动保存**：复用现有 `lib/utils.ts` 的 `debounce` + `AUTOSAVE_DEBOUNCE_MS=1500`，与图片模板保存体验一致。
7. **"恢复默认"**：提供单项（每个卡片右侧小按钮）+ 全部（顶部按钮）两种，均带 confirm 弹窗。
8. **死代码处理**：`finalPromptMessages`、`storyboardImagePromptMessages` 不纳入管理，保持原样（不在 UI 显示，避免误导用户以为有生效效果）。

---

## 验证步骤

1. **TypeScript 编译**：`npx tsc --noEmit` 无错误。
2. **默认值一致性**：手工核对 `DEFAULT_SYSTEM_PROMPTS` 每个 key 的值与 `prompts.ts` 原硬编码文本完全一致（占位符替换后），避免迁移时手误。
3. **功能回归**（未自定义时行为不变）：
   - 第一步扩写 → 正常生成，内容与改造前一致
   - 第二步生成分镜 / 智能标注 → 正常
   - 第三步批量生成资产 / 重生外貌 → 正常
   - 第四步生成视频提示词 / AI 优化 → 正常
   - 智能添加镜头 / 随机外貌生成 / 提取人物 → 正常
4. **自定义生效**：在「LLM 系统提示词」Tab 修改某个 prompt（如在 `expansion` 末尾加"风格要幽默"）→ 保存 → 回到第一步扩写 → 验证输出确实受新提示词影响。
5. **占位符保留**：修改含占位符的 prompt（如 `storyboard`）后删除 `{shotTypes}` → 保存 → 生成分镜 → 验证景别列表未注入（预期行为，用户自担后果）；恢复默认后恢复正常。
6. **单项恢复默认**：修改某 prompt → 点「恢复默认」→ confirm → 验证文本回到默认值 + "已修改"徽标消失。
7. **全部恢复默认**：修改多个 → 点顶部「全部恢复默认」→ confirm → 验证所有 prompt 回到默认。
8. **持久化**：编辑后刷新页面 → 验证自定义内容仍存在（从 DB 读取）。
9. **beforeunload 兜底**：编辑后立即切路由 → 验证未保存内容已通过 keepalive fetch 落盘。
10. **Tab 切换不丢数据**：在「LLM 系统提示词」Tab 编辑 → 切到「图片提示词模板」→ 切回 → 验证编辑内容保留（本地 state 未重置）。
