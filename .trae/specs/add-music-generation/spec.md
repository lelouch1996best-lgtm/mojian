# 音乐生成功能 Spec

## Why

企划（系列）目前只能管理剧集（视频分镜），缺少配乐能力。用户需要在企划内直接生成音乐：接入 APIMart 的 Suno 模型，提供灵感 / 自定义 / 二次创作三种生成模式，并将产物转存 COS、沉淀到企划资产库（媒体类型为音乐）。

## What Changes

- **API 设置**：设置页新增「音乐生成 API」区块，供应商 APIMart（模型 suno）+ 自定义，结构与「音频生成 API」一致（供应商按钮组 / Base URL / API Key / 模型管理）。
- **音乐面板入口**：系列详情页内容区左上角新增「剧集 / 音乐」切换；音乐面板与剧集面板同构（卡片网格 + 虚线「新建音乐」卡片），支持新建、删除、进入编辑。
- **音乐编辑页**：新路由 `/music/[id]`，三种模式：
  1. **灵感模式**（`custom=false`）：仅填提示词 + 是否纯音乐 + 版本选择；
  2. **自定义模式**（`custom=true`）：歌词/标题/风格标签/负面标签/纯音乐/人声性别/权重参数全部可控，风格标签内置市面常见音乐风格分类词库供快速点选，支持「AI 生成歌词」；
  3. **二次创作模式**（coverSong）：从资产库选择音乐或粘贴公网音频地址作为源，设置目标风格等参数后翻唱生成。
- **数据层**：新增 `musics` 表与 `/api/data/musics` 路由；新增 `/api/music/create`（generate / cover / upload / lyrics 四动作）与 `/api/music/query`（任务轮询）代理路由。
- **资产库**：生成的音乐转存 COS 后写入资产库，`mediaType` 新增 `"music"`；资产库与资产选择器（AssetPicker）支持音乐类型筛选与播放。

## Impact

- Affected specs: 设置（API 供应商管理）、系列详情（剧集面板）、资产库（媒体类型）
- Affected code:
  - 类型/数据：`lib/types.ts`、`lib/db.ts`、`lib/api-client.ts`、`lib/storage.ts`、`app/api/data/musics/route.ts`（新）、`app/api/data/musics/[id]/route.ts`（新）
  - 设置：`lib/music-client.ts`（新）、`lib/model-presets.ts`、`app/settings/page.tsx`
  - 生成链路：`app/api/music/create/route.ts`（新）、`app/api/music/query/route.ts`（新）
  - UI：`app/series/[id]/page.tsx`、`components/MusicList.tsx`（新）、`app/music/[id]/page.tsx`（新）、`lib/music-styles.ts`（新）
  - 资产库：`app/api/data/media-assets/route.ts`、`components/AssetLibrary.tsx`、`components/AssetPicker.tsx`

## ADDED Requirements

### Requirement: 音乐生成 API 设置

系统 SHALL 在设置页提供「音乐生成 API」区块，位于「音频生成 API」之后、「存储（COS）」之前，交互结构与音频区块一致：供应商按钮组（APIMart / 自定义）、Base URL、API Key、模型管理（复用 ModelManagerPanel，无能力编辑器）。APIMart 预设 baseURL 为 `https://api.apimart.ai/v1`，内置模型仅 `suno`（默认）。配置经 `apiClient` 存入服务端 settings（key: `music` / `music_provider_keys` / `models_music`），切换供应商时缓存各自 apiKey/baseURL。

#### Scenario: 配置 APIMart 音乐供应商

- **WHEN** 用户在设置页「音乐生成 API」区块选择 APIMart 并填写 API Key
- **THEN** 配置自动保存到服务端（防抖落库），区块徽标显示「已配置」，音乐编辑页可发起生成

#### Scenario: 未配置时发起生成

- **WHEN** 用户未配置音乐 API（无 apiKey）即在音乐编辑页点击「生成音乐」
- **THEN** 提示「请先在设置页配置音乐生成 API」，不发起请求

### Requirement: 系列页「剧集 / 音乐」切换与音乐面板

系统 SHALL 在系列详情页内容区左上角提供「剧集 / 音乐」分段切换（默认剧集）。切换到音乐时展示音乐面板：与剧集面板同构的卡片网格，含虚线「新建音乐」卡片；每张音乐卡片展示封面（无封面用音符占位）、标题、模式徽标（灵感/自定义/二创）、状态（生成中/失败/完成）、时长与首个音轨的内联播放器，并提供「进入编辑」与删除（需确认）。

#### Scenario: 新建音乐

- **WHEN** 用户在音乐面板点击「新建音乐」
- **THEN** 系统创建一条 `mode=inspiration`、`status=idle` 的音乐记录（关联当前系列）并跳转 `/music/[id]` 编辑页

#### Scenario: 删除音乐

- **WHEN** 用户在音乐卡片上点击删除并确认
- **THEN** 该音乐记录被删除；资产库中已入库的音乐媒体记录保留（与剧集删除行为一致）

### Requirement: 音乐数据层

系统 SHALL 提供 `musics` 表（better-sqlite3，随 `getDb()` 初始化建表）与 `/api/data/musics` REST 路由（GET 按 seriesId 查询、POST upsert、`[id]` DELETE），字段含：`id, series_id, title, mode, status, error, params(JSON), source(JSON), suno_task_id, tracks(JSON), created_at, updated_at`。前端经 `apiClient` + `lib/storage.ts` 包装函数读写。`Music` 类型定义于 `lib/types.ts`：`mode: "inspiration" | "custom" | "remix"`，`status: "idle" | "pending" | "completed" | "failed"`，`tracks: MusicTrack[]`（每轨含 audioIndex/title/audioUrl/coverUrl/duration/lyrics/tags，URL 为 COS 持久地址）。

#### Scenario: 音乐记录随系列查询

- **WHEN** 前端调用 `GET /api/data/musics?seriesId=xxx`
- **THEN** 返回该系列全部音乐记录（按创建时间升序），JSON 字段完成反序列化

### Requirement: 音乐生成代理路由

系统 SHALL 提供两个代理路由（`runtime = "nodejs"`，仅 POST，Bearer 透传 apiKey，上游错误提取 `error.message` 友好返回）：

- `POST /api/music/create`：按 `action` 映射上游端点——`generate` → `POST {base}/music/generations`；`cover` → `POST {base}/music/generations/coverSong`；`upload` → `POST {base}/music/generations/uploadTask`；`lyrics` → `POST {base}/music/generations/lyrics`。统一返回 `{ taskId }`（取自响应 `data[0].task_id`）。
- `POST /api/music/query`：转发 `GET {base}/music/tasks/{taskId}`，归一化返回 `{ status: "pending" | "completed" | "failed", progress, music: [{ audioId, title, duration, lyrics, tags, audioUrl, imageUrl, videoUrl }], lyrics?, error? }`（`submitted` 归一为 `pending`；lyrics 类任务从 `data.result` 容忍解析歌词文本）。

#### Scenario: 提交生成任务

- **WHEN** 前端 POST `/api/music/create`（action=generate，payload 含 model/custom/version/prompt 等）
- **THEN** 路由转发上游并返回 `{ taskId }`；上游未返回 task_id 时返回 502

#### Scenario: 轮询任务完成

- **WHEN** 前端 POST `/api/music/query` 且上游任务 completed
- **THEN** 返回 `status=completed` 与 `music[]` 音轨数组（含 audioUrl/imageUrl 等）

### Requirement: 灵感模式生成

音乐编辑页 SHALL 提供灵感模式（`custom=false`）：仅包含提示词（必填）、是否纯音乐（instrumental 开关）、版本选择（v3.5 / v4 / v4.5 / v4.5+ / v4.5-all / v5 / v5.5，必填，默认 v5）；人声性别（可选）两种模式均可用。提交后按 `lib/music-client.ts` 的轮询辅助（3–5s 间隔，约 10 分钟超时）等待结果。

#### Scenario: 灵感模式成功生成

- **WHEN** 用户填写提示词、选择版本后点击「生成音乐」
- **THEN** 提交上游（`custom=false`），UI 显示生成中状态；完成后音轨入库（见「生成结果入库」），编辑页展示音轨卡片（封面/标题/时长/播放器/歌词）

#### Scenario: 生成失败

- **WHEN** 上游任务 failed
- **THEN** 音乐记录 `status=failed`，编辑页展示 `data.error.message` 失败原因，允许修改参数后重新生成

### Requirement: 自定义模式生成

音乐编辑页 SHALL 提供自定义模式（`custom=true`）：歌词（prompt，`instrumental=false` 时必填）、标题、风格标签、负面标签、纯音乐开关、人声性别、版本，以及 style_weight / weirdness_constraint / audio_weight（0–1 滑杆，可选）。风格标签输入框旁 SHALL 提供分类风格词库面板（`lib/music-styles.ts`，覆盖市面常见音乐风格：流行/摇滚/电子/嘻哈/R&B/爵士/蓝调/乡村/民谣/古典/影视史诗/氛围/Lo-Fi/金属/朋克/雷鬼/拉丁/世界民族/国风古风/日韩/动漫游戏/放克迪斯科/实验等分类，每类若干英文标签），点击标签即追加到风格输入框（逗号分隔），再次点击移除。另 SHALL 提供「AI 生成歌词」按钮：以歌词主题调用 lyrics 动作并轮询，结果回填歌词输入框。

#### Scenario: 快速添加风格标签

- **WHEN** 用户在风格词库面板点击某个标签（如 `lo-fi`）
- **THEN** 该标签追加到风格输入框（已存在则不重复添加），再次点击移除

#### Scenario: AI 生成歌词回填

- **WHEN** 用户输入歌词主题并点击「AI 生成歌词」
- **THEN** 提交 lyrics 任务并轮询，完成后歌词文本回填到歌词输入框（可继续编辑）

### Requirement: 二次创作模式生成

音乐编辑页 SHALL 提供二次创作模式：先选择源音乐——「从资产库选择」（AssetPicker，`mediaType="music"`，单选）或「添加公网地址」（输入公开可访问的音频 URL）；再设置目标风格标签（必填）、标题/歌词/负面标签/人声性别/权重（可选）与版本，调用 coverSong（`custom=true`）。源解析规则：若所选资产对应当前系列某 `Music.tracks[]` 音轨（按 audioUrl 匹配）且存有 `sunoTaskId + audioIndex`，则直接作为源；否则先经 upload 动作（`audioFilePath=URL`）导入换取 `task_id`（`audio_index=1`）再翻唱。上传导入的已知限制（纯器乐音频可能解析失败）SHALL 在失败时向用户展示上游错误原因。

#### Scenario: 从资产库选择源音乐翻唱

- **WHEN** 用户从资产库选择一首本系列生成的音乐并填写目标风格后生成
- **THEN** 优先复用其 `sunoTaskId + audioIndex` 直接提交 coverSong；产物按「生成结果入库」流程入库

#### Scenario: 公网地址翻唱

- **WHEN** 用户粘贴公网音频 URL 并生成
- **THEN** 先经 upload 任务导入（轮询至 completed），再以返回的 `task_id`（audio_index=1）提交 coverSong；任一环节失败均展示原因

### Requirement: 生成结果入库

生成任务完成后，系统 SHALL 对 `music[]` 每个音轨：经 `transferAsset` 转存音频（prefix `ai-script/music`）与封面图到 COS；更新音乐记录（`status=completed`、`tracks`、`sunoTaskId`，记录标题为空时取首轨标题）；并对每个音轨调用 `recordMediaAsset` 写入资产库：`mediaType="music"`、`entityType="music"`、`entityName=音轨标题`、`prompt=风格标签或提示词`、`source="music"`、携带系列 ID/标题。编辑页加载时若 `status=pending` 且存在 `sunoTaskId`，SHALL 自动恢复轮询（刷新/切页不丢任务）。

#### Scenario: 双音轨入库

- **WHEN** 生成任务完成且返回 2 个音轨
- **THEN** 两条音轨均转存 COS 并各写一条资产库音乐记录，编辑页展示两张音轨卡片

#### Scenario: 刷新后恢复轮询

- **WHEN** 用户在生成中刷新编辑页
- **THEN** 页面加载后自动恢复轮询直至 completed/failed

### Requirement: 资产库支持音乐类型

`MediaAsset.mediaType` / `AssetLibraryItem` 相关 union、`/api/data/media-assets` 白名单 SHALL 新增 `"music"`（entityType 与 source 同步新增 `"music"`）。资产库筛选胶囊新增「音乐」（与全部/图片/视频/音色并列），音乐卡片内嵌 `<audio controls>` 播放器；AssetPicker 的 `mediaType` prop union 新增 `"music"`，选中音乐类型时同样以播放器渲染。

#### Scenario: 资产库查看音乐

- **WHEN** 用户打开资产库并点击「音乐」筛选
- **THEN** 仅展示音乐资产，卡片上可直接播放，角标显示「音乐」

## MODIFIED Requirements

### Requirement: 系列详情页内容区

原剧集列表区域改为「剧集 / 音乐」分段切换容器：默认展示剧集面板（行为不变），切换后展示音乐面板。头部导航（世界/人物/物品/场景/风格设定）不受影响。
