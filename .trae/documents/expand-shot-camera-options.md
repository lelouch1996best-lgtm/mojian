# 扩展镜头景别 / 运镜选项，并支持用户自定义输入

## 概述

当前分镜表的「景别」仅 5 项、「运镜」仅 6 项，且使用原生 `<select>` 只能选择、无法输入自定义值。本次改动：
1. 扩展景别 / 运镜的专业选项词库；
2. 将下拉选择改为「输入框 + 建议（datalist）」，用户既可从扩展词库中选择，也可自由输入自定义值；
3. 提取共享常量，让 UI 与 AI 分镜提示词共用同一词库来源，避免两处硬编码漂移。

## 现状分析（基于实际探索）

- 选项常量硬编码在 StoryboardRow.tsx:19-20：
  - `SHOT_TYPES = ["特写", "近景", "中景", "全景", "远景"]`
  - `CAMERA_MOVES = ["推", "拉", "摇", "移", "跟", "固定"]`
- 同样的基础词库在 prompts.ts:64-65 的 `storyboardMessages` system prompt 中**重复硬编码**，两处未共享来源。
- 景别 / 运镜列在 StoryboardTable.tsx 的 `COLUMNS` 中宽度均为 `90px`。
- UI 用原生 `<select>`（StoryboardRow.tsx:66-80 景别、115-129 运镜），**只能选、不能输入**。
- `Shot.shotType` / `Shot.cameraMovement` 为自由 `string`（lib/types.ts），天然支持任意自定义值，无需改类型。
- 代码库中**无任何现成 combobox / datalist 组件**，`lib/` 下有 `music-styles.ts`、`style-settings.ts` 等常量文件可作模式参考。

## 方案决策（已确定）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 交互方式 | 原生 `<input>` + `<datalist>` | 聚焦显示建议、可直接键入自定义值；最轻量，与现有单元格 `text-xs` 风格一致，无需引入新依赖 |
| 标注格式 | 纯中文 | 与现有数据格式完全一致，向后兼容已存在的分镜数据 |
| AI 词库 | 同步扩展并约束 | 提取共享常量，UI 与 prompts.ts 共用同一词库，AI 仍从扩展列表中选择（沿用现有约束式设计） |
| 常量归属 | 新建 `lib/shot-options.ts` | 遵循 `lib/*-settings.ts` / `music-styles.ts` 模式，集中管理 |

## 扩展后的词库（纯中文）

### 景别 SHOT_TYPES（8 项，由近到远）
```
["大特写", "特写", "近景", "中景", "中全景", "全景", "远景", "大远景"]
```

### 运镜 CAMERA_MOVES（15 项，含基础 / 高级 / 设备类）
```
["推", "拉", "横摇", "俯仰", "移", "跟", "升降", "环绕", "旋转", "甩镜头", "变焦", "手持", "斯坦尼康", "航拍", "固定"]
```

> 说明：原「摇」拆分为更专业的「横摇(Pan)/俯仰(Tilt)」；已存在分镜数据中的「摇」仍可在输入框中正常显示（自由文本），只是不再作为建议项。所有自定义/历史值均不受影响。

## 具体改动

### 1. 新建 `lib/shot-options.ts`（共享常量来源）
导出 `SHOT_TYPES` 与 `CAMERA_MOVES` 两个数组（内容如上）。供 UI 与 AI 提示词共同引用，消除双处硬编码。

### 2. 修改 `components/StoryboardRow.tsx`
- 删除局部常量 `SHOT_TYPES` / `CAMERA_MOVES`（第 19-20 行），改为 `import { SHOT_TYPES, CAMERA_MOVES } from "@/lib/shot-options";`。
- 将景别 `<select>`（第 66-80 行）替换为受控 `<input list="datalist-shot-type" ...>`，`value={shot.shotType}`，`onChange` 调 `onUpdate("shotType", e.target.value)`，`placeholder="选择或输入…"`，class 沿用原 select 样式（`w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs ...`）。
- 将运镜 `<select>`（第 115-129 行）同样替换为 `<input list="datalist-camera-move" ...>`，`value={shot.cameraMovement}`。
- `<datalist>` 元素**不在本组件内渲染**（避免每行重复 id），由父组件 StoryboardTable 统一渲染一次。

### 3. 修改 `components/StoryboardTable.tsx`
- 在表格渲染区域内**一次性**渲染两个 `<datalist>`：
  ```tsx
  <datalist id="datalist-shot-type">
    {SHOT_TYPES.map((t) => <option key={t} value={t} />)}
  </datalist>
  <datalist id="datalist-camera-move">
    {CAMERA_MOVES.map((t) => <option key={t} value={t} />)}
  </datalist>
  ```
  需 `import { SHOT_TYPES, CAMERA_MOVES } from "@/lib/shot-options";`。
- `COLUMNS` 中景别 / 运镜列宽由 `90px` 微调为 `100px`，以容纳更长选项（如「斯坦尼康」）与输入框内边距。
- 底部提示文案（第 303-305 行）「景别与运镜可下拉选择」改为「景别与运镜可选择或自行输入」。

### 4. 修改 `lib/prompts.ts`
- `import { SHOT_TYPES, CAMERA_MOVES } from "./shot-options";`。
- `storyboardMessages` 的 system prompt 第 64-65 行由硬编码改为引用常量：
  ```
  5. 景别从以下选择：${SHOT_TYPES.join("、")}
  6. 运镜从以下选择：${CAMERA_MOVES.join("、")}
  ```
- 返回格式示例（第 78 行）中的 `"shotType":"特写"`、`"cameraMovement":"推"` 仍属有效值，无需改动。

## 不在范围内
- 不改动 `Shot` 类型字段（已是自由 string）。
- 不持久化用户自定义值到全局词库（每次仅作用于当前单元格，符合最小改动）。
- 不引入第三方 combobox 库。
- 不改动视频生成链路（`video-client.ts` 的 `camera_fixed` 等与本需求无关）。

## 验证步骤
1. `npm run lint` 与 `npm run typecheck`（或项目实际命令）通过，无类型错误。
2. 启动开发服务器，进入分镜步骤：
   - 景别 / 运镜单元格为输入框，聚焦时弹出扩展后的建议列表；
   - 可从建议中选择，也可键入自定义值（如「过肩镜头」「航拍推进」）并正常保存；
   - 已有分镜数据中的历史值（如「摇」）仍正确显示在输入框中。
3. 重新生成 AI 分镜，确认 LLM 返回的 `shotType` / `cameraMovement` 落在扩展词库内。
4. 导出 JSON，确认景别 / 运镜列正常输出（含自定义值）。
5. 故事板图片提示词与视频提示词生成正常（景别 / 运镜字段正常拼接）。
