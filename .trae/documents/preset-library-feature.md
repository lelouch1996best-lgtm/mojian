# 预设库功能实现计划

## 概要

新增「预设库」功能：一个用户自管理的素材库，支持图片/视频/音频/文本四种类型（媒体类上传、文本类在线编辑），每条资源可命名、打标签，标签全局共享并可独立管理。预设库在视频生成步骤中作为输入素材/提示词的来源之一。

- 入口：首页 `/` 资产库旁 + 剧集页 `/episode/[id]` 全局下拉菜单
- 新表：`presets`（资源）+ `preset_tags`（标签）
- 集成：视频生成的参考图/参考视频/参考音频下拉新增「从预设库获取」，提示词「添加提示词」新增「从预设库获取」（仅文本）

---

## 当前状态分析（基于探索）

- 技术栈：Next.js 14 App Router + better-sqlite3（无 ORM，建表语句内联在 `lib/db.ts`）+ 腾讯云 COS + Tailwind。
- 数据层约定：`TEXT PRIMARY KEY`（客户端 `crypto.randomUUID()`）、时间戳 `INTEGER`（`Date.now()`）、复杂字段 JSON 序列化存 TEXT 列、`CREATE TABLE IF NOT EXISTS` 首次连接建表。
- API 约定：`app/api/data/*` REST 路由，统一 `validateAuth`/`authError` 鉴权，`Response.json` 返回；POST 多用 upsert（`INSERT ... ON CONFLICT(id) DO UPDATE`），DELETE 支持批量 `{ids}`。参考 [`media-assets/route.ts`](file:///Users/hehuajiu/Workbuddy/mojian/app/api/data/media-assets/route.ts)。
- 前端数据层：[`lib/api-client.ts`](file:///Users/hehuajiu/Workbuddy/mojian/lib/api-client.ts) 的 `apiClient` 统一封装 fetch + Bearer。
- 上传：[`lib/cos-client.ts`](file:///Users/hehuajiu/Workbuddy/mojian/lib/cos-client.ts) 的 `uploadRefFile(file, nameHint): Promise<string>` 返回 COS URL。
- 资产库参考实现：[`components/AssetLibrary.tsx`](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx)（管理页布局）+ [`components/AssetPicker.tsx`](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPicker.tsx)（Portal 可拖拽缩放选择弹窗）。
- 视频生成：[`components/VideoGeneration.tsx`](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx) 的 `VideoCard` 内：
  - `AddMediaDropdown`（L1334-1396）：hover 下拉，含「从本地上传/从资产库上传/使用故事板生成」。
  - `MediaUploadArea`（L1398-1538）：参考视频/音频卡片容器，内部用 `AddMediaDropdown`（L1497-1502）。
  - 参考图 `AddMediaDropdown`（L2330-2336）、参考视频 `MediaUploadArea`（L2346-2357）、参考音频 `MediaUploadArea`（L2368-2407）。
  - 「添加提示词」hover 下拉（L2615-2639）：含「添加镜头信息/关联音效/故事板」。
  - `pickerTarget` 状态 + `AssetPicker` 实例（L2693-2758），按 target 分发写入 `ShotVideoConfig` 各字段。
- 入口现状：首页 header 平铺按钮（[`app/page.tsx`](file:///Users/hehuajiu/Workbuddy/mojian/app/page.tsx) L95-138，含资产库/风格模板/设置）；剧集页「全局」`HoverMenu`（[`app/episode/[id]/page.tsx`](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/%5Bid%5D/page.tsx) L536-554，含设置/资产库/风格模板）。两处导航无共享组件，需分别改。

---

## 数据模型设计

在 [`lib/db.ts`](file:///Users/hehuajiu/Workbuddy/mojian/lib/db.ts) 的 `db.exec(...)` 中追加两张表：

```sql
CREATE TABLE IF NOT EXISTS presets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL,               -- image | video | audio | text
  url        TEXT NOT NULL DEFAULT '',    -- 媒体类型的 COS URL（text 为空）
  content    TEXT NOT NULL DEFAULT '',    -- 文本类型内容（媒体为空）
  tags       TEXT NOT NULL DEFAULT '[]',  -- JSON 数组，存标签名（全局共享）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_presets_created_at ON presets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_presets_type ON presets(type);

CREATE TABLE IF NOT EXISTS preset_tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
```

说明：
- 标签以「名称」存入 `presets.tags`（JSON 数组，去重化冗余，与 `media_assets` 存 `series_title` 文本同风格）。
- `preset_tags.name` 唯一约束，防止重复。
- 删除标签时由 API 级联清理 `presets.tags` 数组（见下）。

---

## 类型定义

在 [`lib/types.ts`](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts) 追加：

```ts
export type PresetType = "image" | "video" | "audio" | "text";

export interface PresetItem {
  id: string;
  name: string;
  type: PresetType;
  url: string;        // 媒体类型用
  content: string;    // 文本类型用
  tags: string[];     // 标签名数组
  createdAt: number;
  updatedAt: number;
}

export interface PresetTag {
  id: string;
  name: string;
  createdAt: number;
}

/** 预设库选择回传项 */
export interface PickedPresetItem {
  id: string;
  name: string;
  url?: string;      // 媒体类型
  content?: string;  // 文本类型
}
```

---

## API 设计

### `app/api/data/presets/route.ts`（新建）
- `GET`：`SELECT * FROM presets ORDER BY created_at DESC` → `map(rowToPreset)`。
- `POST`（upsert）：`INSERT INTO presets (...) VALUES (...) ON CONFLICT(id) DO UPDATE SET name=..., url=..., content=..., tags=..., updated_at=...`。校验 `type ∈ {image,video,audio,text}`；媒体类型要求 `url` 非空，文本类型要求 `content` 非空。`tags` 序列化为 JSON。返回 `{ ok, preset }`。
- `DELETE`（批量）：body `{ ids: string[] }` → `DELETE FROM presets WHERE id IN (...)`。

### `app/api/data/presets/[id]/route.ts`（新建）
- `GET`：单个。
- `DELETE`：单个。

### `app/api/data/preset-tags/route.ts`（新建）
- `GET`：`SELECT * FROM preset_tags ORDER BY created_at ASC`。
- `POST`：body `{ name }` → 去重 trim，`INSERT`（`name` UNIQUE，冲突返回 409 提示已存在）→ 返回 `{ ok, tag }`。
- `DELETE`（批量，含级联）：body `{ ids: string[] }`：
  1. `SELECT name FROM preset_tags WHERE id IN (...)` 取待删标签名集合 `names`。
  2. `DELETE FROM preset_tags WHERE id IN (...)`。
  3. 遍历所有 `presets` 行：解析 `tags` JSON，过滤掉 `names` 中存在的项，若变化则 `UPDATE presets SET tags=?, updated_at=? WHERE id=?`。

### `app/api/data/preset-tags/[id]/route.ts`（新建）
- `DELETE`（单个，含级联）：同上逻辑，单条。

`rowToPreset`/`rowToTag` 转换函数与 `rowToMediaAsset` 风格一致（snake_case → camelCase，`tags` 用 `JSON.parse`）。

---

## API Client

在 [`lib/api-client.ts`](file:///Users/hehuajiu/Workbuddy/mojian/lib/api-client.ts) 的 `apiClient` 追加：

```ts
// Preset Library
listPresets: () => request<PresetItem[]>("/data/presets"),
savePreset: (p: PresetItem) =>
  request<{ ok: boolean; preset: PresetItem }>("/data/presets", { method: "POST", body: JSON.stringify(p) }),
deletePresets: (ids: string[]) =>
  request<{ ok: boolean; deleted: number }>("/data/presets", { method: "DELETE", body: JSON.stringify({ ids }) }),
getPreset: (id: string) => request<PresetItem>(`/data/presets/${id}`),
deletePreset: (id: string) => request<void>(`/data/presets/${id}`, { method: "DELETE" }),

listPresetTags: () => request<PresetTag[]>("/data/preset-tags"),
savePresetTag: (name: string) =>
  request<{ ok: boolean; tag: PresetTag }>("/data/preset-tags", { method: "POST", body: JSON.stringify({ name }) }),
deletePresetTags: (ids: string[]) =>
  request<{ ok: boolean; deleted: number }>("/data/preset-tags", { method: "DELETE", body: JSON.stringify({ ids }) }),
deletePresetTag: (id: string) => request<void>(`/data/preset-tags/${id}`, { method: "DELETE" }),
```

---

## 前端：预设库管理页

### `app/preset-library/page.tsx`（新建）
极简包装页，参照 [`app/assets/page.tsx`](file:///Users/hehuajiu/Workbuddy/mojian/app/assets/page.tsx)：
```tsx
"use client";
import PresetLibrary from "@/components/PresetLibrary";
export default function PresetLibraryPage() {
  return <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6"><PresetLibrary /></main>;
}
```

### `components/PresetLibrary.tsx`（新建，参照 AssetLibrary 布局）
包含以下模块（均为该文件内组件）：

1. **Header**：返回按钮、标题「预设库」、`+ 添加预设` 按钮、`管理标签` 按钮、多选模式 + 批量删除。
2. **过滤栏**：
   - 类型筛选（全部/图片/视频/音频/文本，FilterPill 样式）。
   - 名称搜索框（大小写不敏感子串匹配 `name`）。
   - 标签筛选（多选下拉，选项来自 `listPresetTags()`；筛选语义为「包含所选全部标签」AND）。
3. **内容网格**：`PresetCard` 卡片，按类型渲染预览（图片 `<img>`+ImageLightbox、视频 `<video>`、音频 `<audio>`、文本显示内容摘要），hover 显示编辑/删除；多选模式下显示勾选角标。
4. **`PresetEditDialog`（添加/编辑弹窗）**：
   - 名称输入。
   - 类型选择（新建时可选 image/video/audio/text；编辑时类型锁定，因存储字段不同）。
   - 媒体类型：上传区（点击选文件 → `uploadRefFile(file, nameHint)` → 得 url → 预览）；编辑模式允许重新上传替换。
   - 文本类型：`<textarea>` 在线编辑内容（可后续修改）。
   - `TagInput` 标签输入（见下）。
   - 保存：校验名称非空、媒体有 url / 文本有 content → `savePreset`（upsert）。
5. **`TagInput`（标签输入组合框）**：
   - 输入框 + 下拉建议（来自当前标签列表，按输入前缀过滤）+ 已选标签 chips（可 × 移除）。
   - 支持输入新标签：Enter 添加；若该名称不在 `preset_tags`，立即 `savePresetTag` 持久化到标签列表（实现「创建后把标签放到标签列表」），再选中。
   - 与 `AssetPicker`/`EditableCell` 的下拉浮层交互风格一致。
6. **`TagManagerDialog`（标签管理弹窗）**：
   - 列出全部标签（`listPresetTags`），每项有删除按钮（确认后 `deletePresetTags([id])`，服务端级联清理预设项）。
   - 顶部新增输入 + 添加按钮（`savePresetTag`）。

数据刷新：添加/编辑/删除预设、增删标签后重新 `listPresets()` / `listPresetTags()`。

---

## 前端：入口点

### 首页 [`app/page.tsx`](file:///Users/hehuajiu/Workbuddy/mojian/app/page.tsx)（L95-138）
在「资产库」按钮后追加平铺 `Button`：
```tsx
<Button variant="ghost" size="md" onClick={() => router.push("/preset-library")}>预设库</Button>
```
（图标沿用现有 SVG 风格，可选。）

### 剧集页 [`app/episode/[id]/page.tsx`](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/%5Bid%5D/page.tsx)（L536-554 全局 HoverMenu）
在「资产库」`MenuItem` 后追加：
```tsx
<MenuItem onClick={() => router.push("/preset-library")}>预设库</MenuItem>
```

---

## 前端：视频生成集成

### `components/PresetPicker.tsx`（新建，参照 AssetPicker）
Portal 可拖拽缩放弹窗，props：
```ts
interface PresetPickerProps {
  open: boolean;
  onClose: () => void;
  type: PresetType;                 // image | video | audio | text
  multiple?: boolean;
  selectedUrls?: string[];          // 媒体类型去重用
  onConfirm: (items: PickedPresetItem[]) => void;
  max?: number;
}
```
- 数据 `apiClient.listPresets()` 过滤 `type`。
- 过滤栏：名称搜索 + 标签多选筛选。
- 卡片：媒体类型按 AssetPicker 风格预览（图/视频/音频）；文本类型显示名称 + 内容摘要，点击可展开预览。
- 确认回传 `PickedPresetItem[]`（媒体含 `url`，文本含 `content`）。

### `components/VideoGeneration.tsx` 改动

1. **`AddMediaDropdown`（L1334-1396）**：新增可选 prop `onPickPreset?: () => void`；在「从资产库上传」后渲染「从预设库获取」按钮（仅当传入时）。

2. **`MediaUploadArea`（L1398-1538）**：新增可选 prop `onPickPreset?: () => void`，透传给内部 `AddMediaDropdown`（L1497-1502）。

3. **`VideoCard` 状态**：新增
   ```ts
   const [presetPickerTarget, setPresetPickerTarget] =
     useState<"refImage" | "refVideo" | "refAudio" | "promptText" | null>(null);
   ```
   （与现有 `pickerTarget` 并列。）

4. **参考图**（L2330-2336）：`AddMediaDropdown` 增加 `onPickPreset={() => setPresetPickerTarget("refImage")}`。

5. **参考视频**（L2346-2357）：`MediaUploadArea` 增加 `onPickPreset={() => setPresetPickerTarget("refVideo")}`。

6. **参考音频**（L2368-2407）：`MediaUploadArea` 增加 `onPickPreset={() => setPresetPickerTarget("refAudio")}`。

7. **「添加提示词」下拉**（L2615-2639）：在「添加故事板」后追加「从预设库获取」按钮，`onClick={() => setPresetPickerTarget("promptText")}`。

8. **`PresetPicker` 实例**（与 `AssetPicker` 同级，L2693 附近）：
   ```tsx
   {presetPickerTarget && (
     <PresetPicker
       open={!!presetPickerTarget}
       onClose={() => setPresetPickerTarget(null)}
       type={presetPickerTarget === "refImage" ? "image" : presetPickerTarget === "refVideo" ? "video" : presetPickerTarget === "refAudio" ? "audio" : "text"}
       multiple={presetPickerTarget !== "promptText"}  // 文本可多选追加；媒体按现有上限
       max={presetPickerTarget === "refImage" ? 10 : presetPickerTarget === "refVideo" || presetPickerTarget === "refAudio" ? 3 : undefined}
       selectedUrls={/* 同 AssetPicker 的 selectedUrls 逻辑，按 target 取对应数组 */}
       onConfirm={(items) => {
         if (presetPickerTarget === "refImage") {
           // 同 AssetPicker refImage 分支：追加 urls 到 referenceImageAssetUrls，名称取 item.name
         } else if (presetPickerTarget === "refVideo") {
           // 追加 urls 到 referenceVideoUrls，slice(0,3)
         } else if (presetPickerTarget === "refAudio") {
           // 追加 urls 到 referenceAudioUrls，slice(0,3)
         } else if (presetPickerTarget === "promptText") {
           // 将 items 的 content 拼接追加到 shot.finalPrompt（非空时换行分隔），onUpdatePrompt
         }
         setPresetPickerTarget(null);
       }}
     />
   )}
   ```
   媒体分支逻辑直接复用现有 `AssetPicker` 的 `onConfirm` 写入模式（L2716-2755），保证与资产库来源行为一致。

---

## 假设与决策

1. **标签全局共享**：四种类型共用一套 `preset_tags`（已确认）。
2. **删除标签级联**：服务端从所有 `presets.tags` 移除该标签名（已确认）。
3. **标签存储**：独立 `preset_tags` 表 + REST CRUD（已确认）。
4. **标签以名称冗余存储**于 `presets.tags`（JSON 数组），与项目 `media_assets` 存文本标注的风格一致；暂不支持标签重命名（未要求）。
5. **新标签即时入列表**：`TagInput` 输入新标签时立即 `savePresetTag` 持久化，保证标签列表实时同步。
6. **类型创建后锁定**：编辑预设时类型不可改（存储字段 url/content 不同），但名称/标签/内容/媒体文件均可改。
7. **标签筛选语义**：多选时为「包含所选全部标签」（AND）。
8. **预设库媒体来源不回写 `media_assets` 账本**：仅作为输入素材使用其 URL，不额外登记（未要求，避免过度设计）。
9. **文本追加到提示词**：以换行分隔追加到 `shot.finalPrompt` 末尾。
10. **复用上传链路**：媒体上传走 `lib/cos-client.ts` 的 `uploadRefFile`，COS 未配置时报错提示（与资产库一致）。
11. **路由名**：`/preset-library`。

---

## 验证步骤

1. 启动 `npm run dev`，访问 `/preset-library`，确认建表无报错（`data/mojian-dev.db` 出现 `presets`/`preset_tags`）。
2. 添加四种类型预设：上传图片/视频/音频各一条（确认 COS 上传成功、预览正常），新增文本一条并编辑内容。
3. 标签：添加时选择已有标签 + 输入新标签，确认新标签进入标签列表；编辑预设修改名称/标签/文本内容；管理标签弹窗新增/删除标签，确认删除后预设项中对应标签被移除。
4. 过滤：按类型、名称、标签组合筛选，确认结果正确。
5. 入口：首页「预设库」按钮、剧集页「全局」菜单「预设库」均能跳转。
6. 视频生成（`/episode/[id]` Step4，multimodal-ref 模式）：
   - 参考图「从预设库获取」→ 仅显示图片预设 → 选中后写入参考图（琥珀卡片，名称正确）。
   - 参考视频「从预设库获取」→ 仅视频 → 写入参考视频，上限 3。
   - 参考音频「从预设库获取」→ 仅音频 → 写入参考音频，上限 3。
   - 「添加提示词」→「从预设库获取」→ 仅文本 → 选中后内容追加到提示词。
7. 类型检查与构建：`npx tsc --noEmit` 无报错；`npm run build` 通过。

---

## 文件清单

**新建：**
- `app/preset-library/page.tsx`
- `components/PresetLibrary.tsx`
- `components/PresetPicker.tsx`
- `app/api/data/presets/route.ts`
- `app/api/data/presets/[id]/route.ts`
- `app/api/data/preset-tags/route.ts`
- `app/api/data/preset-tags/[id]/route.ts`

**修改：**
- `lib/db.ts`（加 2 张表）
- `lib/types.ts`（加类型）
- `lib/api-client.ts`（加方法）
- `app/page.tsx`（加入口按钮）
- `app/episode/[id]/page.tsx`（加全局菜单项）
- `components/VideoGeneration.tsx`（AddMediaDropdown / MediaUploadArea / 添加提示词下拉 / PresetPicker 集成）
