# 旧数据迁移/兼容代码 评估与清理计划

## 背景与结论前提

- 用户确认：**应用只自己/小团队在用，本地数据早已全部是新格式**，旧格式数据实际已不存在 → 删除标准可以激进。
- 交付物：本评估报告（含逐项"删/留"结论）+ **按报告结论直接删除所有判定为可删的代码**。
- 全库无 `dataVersion`/`schemaVersion` 版本标记（已 grep 确认），兼容策略是分散式的"读取时归一化 + 保存时兜底"。

## 删除判据

| 判据 | 处理 |
|---|---|
| A. 无调用点的死代码 | 删 |
| B. 明确注释为旧数据兼容，且字段在类型上是 **required**（新数据必有，回退永不触发） | 删 |
| C. 字段在类型上是 **optional**，回退是当前设计的一部分（惰性初始化/类型防御），新数据也可能缺 | **保留**（非旧数据迁移） |
| D. 启动时 DDL 迁移，且 CREATE TABLE 已含新列 | 删 |
| E. 服务端写库前的 `??` 输入防御 | 保留（非旧数据专属） |

## 逐项评估清单

### 一、判定可删（本次执行删除）

| # | 位置 | 代码 | 判据 |
|---|---|---|---|
| 1 | [utils.ts:L276-292](file:///Users/hehuajiu/Workbuddy/mojian/lib/utils.ts#L276-L292) | `normalizeEpisode()` 整函数 | A — 全库零调用点（localStorage 时代遗留） |
| 2 | [db.ts:L81-100](file:///Users/hehuajiu/Workbuddy/mojian/lib/db.ts#L81-L100) | 三段 `ALTER TABLE series ADD COLUMN` 迁移 | D — CREATE TABLE（L24-37）已含三列；自己的库已迁移 |
| 3 | [storage.ts:L5-47](file:///Users/hehuajiu/Workbuddy/mojian/lib/storage.ts#L5-L47) | `normalizeSeries` + `normalizeCharacterProfile/ObjectProfile/SceneProfile` | B — Series/Profile 字段在类型上均 required |
| 4 | [style-settings.ts:L47-54](file:///Users/hehuajiu/Workbuddy/mojian/lib/style-settings.ts#L47-L54) | `normalizeStyleSettings()`（裁剪历史字段） | B — 连同类型中的历史字段一起删 |
| 5 | [style-settings.ts:L86-101](file:///Users/hehuajiu/Workbuddy/mojian/lib/style-settings.ts#L86-L101) | `getStyleTemplates` 中旧 `"style"` setting 的 customPresets 迁移分支 | B — 已一次性迁移落库过 |
| 6 | [types.ts:L167-173](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts#L167-L173) | `StyleSettings.overrides` / `customPresets` 历史字段 | B — 注释明确"历史字段，不再使用" |
| 7 | [model-presets.ts:L894-898](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts#L894-L898) / [L930-934](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts#L930-L934) / [L966-970](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts#L966-L970) | `normalizeImageModelsMap` / `normalizeVideoModelsMap` / `normalizeAudioModelsMap`（flat 数组 → 按 provider 分组） | B — 旧 flat 格式已不存在 |
| 8 | [image-client.ts:L120-121](file:///Users/hehuajiu/Workbuddy/mojian/lib/image-client.ts#L120-L121)、[L141-143](file:///Users/hehuajiu/Workbuddy/mojian/lib/image-client.ts#L141-L143) | 缺 provider 默认 ark；`string → {apiKey}` 包装 | B |
| 9 | [video-client.ts:L61-62](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts#L61-L62)、[L97-99](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts#L97-L99) | 同上（视频设置） | B |
| 10 | [llm-client.ts:L82-84](file:///Users/hehuajiu/Workbuddy/mojian/lib/llm-client.ts#L82-L84) | `getProviderKeys` 的 `string → {apiKey}` 包装 | B |
| 11 | [audio-client.ts:L45](file:///Users/hehuajiu/Workbuddy/mojian/lib/audio-client.ts#L45)、[L69-70](file:///Users/hehuajiu/Workbuddy/mojian/lib/audio-client.ts#L69-L70) | 缺 provider 默认 mimo；`string → {apiKey}` 包装 | B |
| 12 | [character-settings.ts:L64-83](file:///Users/hehuajiu/Workbuddy/mojian/lib/character-settings.ts#L64-L83) / [scene-settings.ts:L46-65](file:///Users/hehuajiu/Workbuddy/mojian/lib/scene-settings.ts#L46-L65) / [object-settings.ts:L46-65](file:///Users/hehuajiu/Workbuddy/mojian/lib/object-settings.ts#L46-L65) | `characterId \|\| id`、`version ?? 1` 分组回退 | B — 类型 required |
| 13 | [VideoGeneration.tsx:L1607](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L1607) | `shot.videoStatus ?? "idle"` | B — `videoStatus` 类型 required（执行时先 grep 确认 `emptyShot` 有赋值） |

### 二、判定保留（非旧数据迁移，报告中说明理由）

| 位置 | 保留理由 |
|---|---|
| [VideoGeneration.tsx:L589-596](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L589-L596)、[L1611-1618](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L1611-L1618)、[episode/[id]/page.tsx:L379-388](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/[id]/page.tsx#L379-L388) | `videoConfig` 是 **optional 惰性设计**：`emptyShot()` 不创建它（已 grep 确认），所有新 shot 同样走 `?? DEFAULT_SHOT_VIDEO_CONFIG` 回退 + 首次编辑落库 |
| [video-client.ts:L129-144](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts#L129-L144) `resolveVideoCredentials` 的 provider 回退 | `videoTaskProvider` 类型 optional（无视频任务的 shot 永远没有它），`??` 是类型必需，不只是旧数据兼容 |
| [VideoGeneration.tsx:L138-141](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L138-L141) `getRefImgName` 回退"参考图N" | `referenceImageAssetNames` optional，新数据手动加 URL 时也可能缺名 |
| [episodes/route.ts:L74-85](file:///Users/hehuajiu/Workbuddy/mojian/app/api/data/episodes/route.ts#L74-L85)、[series/route.ts:L47-58](file:///Users/hehuajiu/Workbuddy/mojian/app/api/data/series/route.ts#L47-L58) 保存时 `??` 兜底 | 服务端写库输入防御，非旧数据专属（判据 E） |
| [model-presets.ts:L573-575](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts#L573-L575) 忽略 DB 残留能力值 | "代码注册表为权威"是长期设计，防未来再发能力矩阵更新 |
| [video-client.ts:L64-72](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts#L64-L72) 复用图片 Key | 功能特性，非迁移 |
| [style-settings.ts:L573-575 附近的注释](file:///Users/hehuajiu/Workbuddy/mojian/lib/style-settings.ts) 等 | 删除代码时同步更新失效注释 |

## 具体修改方案

### 1. `lib/utils.ts`
- 删除 `normalizeEpisode()` 整函数（L276-292）。

### 2. `lib/db.ts`
- 删除 L81-100 三段 `try/catch ALTER TABLE` 迁移块（CREATE TABLE 已含三列）。

### 3. `lib/storage.ts`
- 删除 `normalizeSeries` 及三个 `normalizeXxxProfile` 函数（L5-47）。
- `listSeries()` 改为 `return (await apiClient.listSeries()).sort((a, b) => a.order - b.order);`
- `getSeries()` 改为直接 `return await apiClient.getSeries(id);`
- 移除 `normalizeStyleSettings` import。

### 4. `lib/style-settings.ts`
- 删除 `normalizeStyleSettings()`。
- `getStyleTemplates()` 的 `templates.length === 0` 分支简化为：用 `DEFAULT_PRESETS` 初始化并落库（删掉 legacy `"style"` 读取逻辑）。
- 更新 `getStyleTemplates` 的 docstring（去掉"旧版 style setting 迁移"描述）。

### 5. `lib/types.ts`
- `StyleSettings` 删除 `overrides` 和 `customPresets` 两个历史字段（先 grep 全库确认无残留引用；预计引用仅在 style-settings.ts / storage.ts / style-settings/page.tsx，随本次一并清理）。

### 6. `lib/model-presets.ts`
- 删除三个 `normalize*ModelsMap` 函数；其调用点（get/save 共 6 处）改为：
  ```typescript
  const all = (await apiClient.getSetting("models_image")) as Record<string, ModelEntry[]> | null ?? {};
  ```

### 7. `lib/image-client.ts`
- `getImageSettings`：删 `if (!s.provider)` 分支，直接 `return s;`
- `getImageProviderKeys`：删 string 分支，简化为 `return (raw ?? {}) as ProviderCache;`（或等价的直接 cast）

### 8. `lib/video-client.ts`
- `getVideoSettings`：删 `if (!s.provider)` 分支，直接 `return s;`
- `getVideoProviderKeys`：同 image-client 简化。
- 保留 `resolveVideoCredentials` 不动（见保留清单）。

### 9. `lib/llm-client.ts`
- `getProviderKeys`（L76-90）：删 string 包装分支，直接 cast。

### 10. `lib/audio-client.ts`
- `getAudioSettings`（L41-48）：删缺 provider 默认 mimo 分支。
- `getAudioProviderKeys`（L63-76）：删 string 包装分支。

### 11. `lib/character-settings.ts` / `scene-settings.ts` / `object-settings.ts`
- `getLatestVersions` 系列函数中：`ch.characterId || ch.id` → `ch.characterId`；`(b.version ?? 1) - (a.version ?? 1)` → `b.version - a.version`；删除对应"兼容旧数据"注释。

### 12. `components/VideoGeneration.tsx`
- L1607 `shot.videoStatus ?? "idle"` → `shot.videoStatus`（先 grep 确认 `emptyShot()`/`toShot()` 均显式设置 `videoStatus`）。
- L589-596 / L1611-1618 的 `videoConfig` 回退**保留**（惰性设计）。

### 13. `app/series/[id]/style-settings/page.tsx`
- 移除 `normalizeStyleSettings` 调用（L40 附近），直接用 `series.styleSettings`（执行时先读该文件确认用法）。

## 执行顺序

1. 执行前验证 grep：`overrides`、`customPresets` 全库引用点；`emptyShot`/`toShot` 是否设置 `videoStatus`；`normalizeStyleSettings` 全部调用点；`normalizeEpisode` 再次确认零调用。
2. 按上面 1→13 顺序修改（types.ts 历史字段最后删，避免中间态类型报错干扰判断——或先行删除再逐个修引用亦可，执行时以 tsc 报错为导向）。
3. 全库 grep 确认被删符号（`normalizeEpisode`、`normalizeSeries`、`normalizeStyleSettings`、`normalizeImageModelsMap` 等）零残留。
4. 运行 `npm run build` 验证类型检查与构建通过（package.json 无 lint/typecheck 脚本，build 含 TS 检查）。
5. 最终回复中给出"删/留"评估总结表。

## 假设与决策记录

- **假设**：用户本地 SQLite 库（`data/mojian-dev.db` 或 Electron 用户数据目录）的 series 表已含三个 settings 列、settings 表中 `models_*`/`*_provider_keys`/`style-templates` 均已是新格式。依据：用户确认"数据早已是最新格式"。
- **决策**：optional 字段的回退（videoConfig / videoTaskProvider / referenceImageAssetNames）一律保留——删除它们改变的是当前设计语义，而非清理旧数据兼容。
- **决策**：API 路由的写库 `??` 兜底保留——属于服务端输入校验。
- **风险**：若某台设备上的库意外仍是旧格式，删除后读取会按新格式解析（JSON 缺字段处为 `undefined`），UI 可能出现空值；用户已确认此情况不存在，风险接受。
- 不删除 `extractShots`（LLM 输出格式兼容）、`prompts.ts`"兼容旧逻辑"（逻辑路径，非数据迁移）、electron 激活相关的格式兼容——均不属于"存储数据迁移"。

## 验证

- `npm run build` 通过（含 TypeScript 类型检查）。
- `grep` 无被删符号残留引用。
- 手动冒烟（可选）：`npm run dev` 打开系列列表页 + 剧集页，确认数据正常展示。
