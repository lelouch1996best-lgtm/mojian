# Suno 歌手音色管理与音乐生成集成方案

## 摘要

基于 Suno 的 `createVoice` API，实现一个全局共享的「歌手音色」管理系统。用户可以通过**上传音频**或**TTS 生成再提取**两种方式创建可复用音色（Persona），并在音乐生成的自定义模式中选择已创建的音色来生成音乐。音色管理集成在现有资产库中。

---

## 当前状态分析

### 已有的音乐生成系统（Suno / APIMart）
- **类型** [types.ts:505-600](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts#L505-600)：`Music`、`MusicModeParams`（自定义模式已有 `personaId?` 字段）、`MusicCreateProxyRequest`（action: `"generate" | "inspo" | "lyrics"`）、`MusicQueryProxyResponse`（含 `status`、`progress`、`music[]`、`lyrics`、`rawResult`、`error`）
- **创建路由** [create/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/music/create/route.ts)：`ACTION_ENDPOINTS` 映射三种 action 到上游端点，纯透传 payload + 鉴权头
- **查询路由** [query/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/music/query/route.ts)：轮询 `GET /music/tasks/:task_id`，解析 status/progress/music[]/lyrics，已将 `result` 原样放入 `rawResult`
- **客户端** [music-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/music-client.ts)：`createMusicTask`、`queryMusicTask`、`pollMusicTask`（3-5s 间隔轮询直到完成/失败）、`generateLyrics`
- **音乐编辑页** [app/music/[id]/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/music/[id]/page.tsx)：三种模式 UI，自定义模式中 `personaId` 为**手动文本输入**（约 980-989 行）

### 已有的 TTS 音色系统（MiMo）
- **客户端** [audio-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/audio-client.ts)：`generateVoice(VoiceGenParams)` → 调用 MiMo TTS 生成音频 → `uploadBase64` 转存 COS → 返回 `VoiceGenResult`（含 `voiceUrl`）
- `voicedesign` 模式：传入 `voicePrompt`（音色描述）+ `sampleText`（目标文本）→ 生成 WAV 音频
- **路由** `/api/audio`：MiMo TTS 代理

### 已有的资产库
- **类型** [types.ts:728-780](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts#L728-780)：`MediaAsset`（`mediaType: "image" | "video" | "audio" | "music"`）、`AssetLibraryItem`、`MediaAssetInput`
- **页面** [app/assets/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/assets/page.tsx)：按 mediaType 过滤，含添加资产弹窗
- **组件** [components/AssetLibrary.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx)：资产卡片、音频播放器、添加/删除
- **数据库** [db.ts:77-95](file:///Users/hehuajiu/Workbuddy/mojian/lib/db.ts#L77-95)：`media_assets` 表

### Suno API 关键端点
| 端点 | 方法 | 入参 | 返回 |
|------|------|------|------|
| `/v1/music/generations/createVoice` | POST | `{ model, audio_url }` | task_id → 轮询得到音色信息（含 persona_id） |
| `/v1/music/generations` (custom=true) | POST | `{ ..., persona_id }` | task_id → 轮询得到音乐 |
| `/v1/music/tasks/:task_id` | GET | — | status/progress/result |

> **注意**：`createVoice` 不走 `task_id + audio_index`，直接给公开可访问的 `audio_url`（仅 MP3/WAV）。系统从音频中提取人声创建可复用音色。文档未明确返回结果中 persona_id 的字段名，需防御性解析。

---

## 方案设计

### 整体流程

```
创建音色（资产库内）：
  ┌─ 上传模式：上传音频文件 → COS → audio_url → createVoice → 轮询 → persona_id → 存储
  ├─ TTS模式：MiMo voicedesign 生成音频 → COS → audio_url → createVoice → 轮询 → persona_id → 存储
  └─ 链接模式：粘贴公开音频 URL → createVoice → 轮询 → persona_id → 存储

使用音色（音乐编辑页）：
  自定义模式 → 音色选择器（从已创建的音色列表选择）→ persona_id → 生成音乐
```

### 新增数据模型

在 [lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts) 新增 `VoicePersona` 接口：

```typescript
/** Suno 歌手音色（全局共享，不绑定企划） */
export interface VoicePersona {
  id: string;
  /** 用户自定义名称 */
  name: string;
  /** Suno 返回的 persona_id，用于音乐生成 */
  personaId: string;
  /** 创建方式 */
  sourceType: "upload" | "tts" | "url";
  /** 创建音色所用的源音频 URL（可播放预览） */
  sourceAudioUrl: string;
  /** TTS 模式的音色描述 */
  description?: string;
  /** 创建状态 */
  status: "idle" | "pending" | "completed" | "failed";
  /** 失败原因 */
  error?: string;
  /** Suno 任务 ID（用于断点轮询恢复） */
  sunoTaskId?: string;
  createdAt: number;
  updatedAt: number;
}
```

### 扩展类型定义

在 [lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts) 修改：

1. **`MusicCreateProxyRequest["action"]`** 增加 `"createVoice"`：
   ```typescript
   action: "generate" | "inspo" | "lyrics" | "createVoice";
   ```

2. **`MusicQueryProxyResponse`** 增加 `personaId?` 字段：
   ```typescript
   /** createVoice 任务完成后的 persona_id */
   personaId?: string;
   ```

3. **`MediaAsset["mediaType"]`** 和 **`AssetLibraryItem["mediaType"]`** 增加 `"voice"`：
   ```typescript
   mediaType: "image" | "video" | "audio" | "music" | "voice";
   ```

4. **`MediaAsset["entityType"]`** 增加 `"voicePersona"`，**`source`** 增加 `"voicePersona"`

---

## 具体修改文件清单

### 一、数据层

#### 1. [lib/db.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/db.ts) — 新增 voice_personas 表
在 `initDB()` 的建表序列中添加：
```sql
CREATE TABLE IF NOT EXISTS voice_personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  persona_id TEXT,
  source_type TEXT NOT NULL,
  source_audio_url TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  error TEXT,
  suno_task_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_personas_created_at ON voice_personas(created_at DESC);
```

#### 2. [lib/storage.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/storage.ts) — 新增音色存储函数
参照 `emptyMusic`/`saveMusic` 模式新增：
- `emptyVoicePersona(): VoicePersona`
- `getVoicePersonas(): Promise<VoicePersona[]>`（全局列表，按 createdAt 降序）
- `getVoicePersona(id): Promise<VoicePersona | null>`
- `saveVoicePersona(vp: VoicePersona): Promise<void>`（upsert）
- `deleteVoicePersona(id): Promise<void>`

#### 3. [lib/api-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/api-client.ts) — 新增音色 API 方法
参照现有 `listMediaAssets`/`recordMediaAsset` 模式：
- `listVoicePersonas(): Promise<VoicePersona[]>`
- `saveVoicePersonaAPI(vp): Promise<void>`
- `deleteVoicePersonaAPI(id): Promise<void>`

#### 4. 新建 [app/api/data/voice-personas/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/data/voice-personas/route.ts)
参照 [app/api/data/media-assets/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/data/media-assets/route.ts) 模式：
- `GET`：返回全部音色列表
- `POST`：upsert 单个音色
- `DELETE`：按 id 删除

---

### 二、Suno API 对接层

#### 5. [app/api/music/create/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/music/create/route.ts) — 新增 createVoice action
在 `ACTION_ENDPOINTS` 映射中增加：
```typescript
const ACTION_ENDPOINTS = {
  generate: "/music/generations",
  inspo: "/music/generations/inspo",
  lyrics: "/music/generations/lyrics",
  createVoice: "/music/generations/createVoice",  // 新增
};
```
> 透传逻辑无需改动，payload 由前端构造 `{ model: "suno", audio_url }`。

#### 6. [app/api/music/query/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/music/query/route.ts) — 解析 createVoice 结果
在 `status === "completed"` 分支中，`res = task?.result` 之后增加 persona_id 提取逻辑：
```typescript
// 防御性解析 createVoice 返回的 persona_id
const personaId = pickStr(res, ["persona_id", "voice_id", "id", "personaId"])
  ?? pickStr(task, ["persona_id", "voice_id"]);
if (personaId) result.personaId = personaId;
```
> 复用已有的 `pickStr` 辅助函数。`rawResult` 已包含完整结果，便于调试。

#### 7. [lib/music-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/music-client.ts) — 新增 createVoiceTask
```typescript
/** 提交 createVoice 任务，返回 task_id */
export async function createVoiceTask(audioUrl: string): Promise<string> {
  return createMusicTask("createVoice", { model: "suno", audio_url: audioUrl });
}
```
> `queryMusicTask`/`pollMusicTask` 无需修改，已支持通用轮询。完成后从 `result.personaId` 取值。

---

### 三、音色客户端

#### 8. 新建 [lib/voice-persona-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/voice-persona-client.ts)
整合 TTS 生成 + createVoice + 轮询 + 持久化的完整流程：

```typescript
/** 从音频 URL 创建音色：提交 createVoice → 轮询 → 返回 personaId */
export async function createVoiceFromAudio(
  audioUrl: string,
  opts: { onProgress?: (p: number) => void; signal?: AbortSignal }
): Promise<string>  // 返回 personaId

/** TTS 生成再提取：MiMo voicedesign → COS URL → createVoice → 轮询 → 返回 personaId */
export async function generateTtsAndCreateVoice(
  params: { model: string; voicePrompt: string; sampleText: string },
  opts: { onProgress?: (p: number) => void; signal?: AbortSignal }
): Promise<{ personaId: string; sourceAudioUrl: string }>
```

核心流程：
- **上传/链接模式**：直接 `createVoiceTask(audioUrl)` → `pollMusicTask` → 取 `result.personaId`
- **TTS 模式**：调用 `generateVoice()`（来自 audio-client.ts，含 voicedesign + COS 上传）→ 拿到 `voiceUrl` → `createVoiceTask(voiceUrl)` → `pollMusicTask` → 取 `result.personaId`
- 复用 `pollMusicTask` 的 `onProgress` 回调更新进度

---

### 四、UI 组件

#### 9. 新建 [components/VoicePersonaCreateDialog.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VoicePersonaCreateDialog.tsx)
音色创建弹窗，参照 [VoiceGenerationDialog.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VoiceGenerationDialog.tsx) 的交互模式：

**表单结构**：
- **模式切换**：上传文件 / TTS 生成 / 粘贴链接（三个 Tab 或单选）
- **名称输入**（必填）：音色名称
- **上传模式**：文件选择/拖拽，支持 MP3/WAV，复用 `uploadRefFile` 上传到 COS
- **TTS 模式**：
  - 音色描述输入（voicePrompt）
  - 样例文本输入（sampleText，限制 20 字）
  - 复用 `AudioGenSettings` 检查 MiMo 是否已配置；未配置时提示前往设置
- **链接模式**：URL 文本输入

**提交流程**：
1. 先创建 `status: "pending"` 的 VoicePersona 记录（含 sunoTaskId 占位）
2. 调用 `voice-persona-client.ts` 的对应函数
3. `onProgress` 更新 UI 进度条
4. 成功 → 更新记录 `status: "completed"`, `personaId` → 同时 `recordMediaAsset` 记录为 `mediaType: "voice"`
5. 失败 → 更新记录 `status: "failed"`, `error` → 显示错误信息，支持重试

#### 10. 新建 [components/VoicePersonaPicker.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VoicePersonaPicker.tsx)
音乐编辑页用的音色选择器，参照现有 AssetPicker 模式：
- 下拉列表展示所有 `status: "completed"` 的音色（名称 + 来源类型标签）
- 选择后回传 `personaId`
- 含「不使用音色」选项（清空 personaId）
- 含「管理音色」链接跳转资产库

#### 11. [components/AssetLibrary.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx) — 集成音色展示
- mediaType 过滤选项增加 `{ value: "voice", label: "歌手音色" }`
- 新增「创建歌手音色」按钮，打开 `VoicePersonaCreateDialog`
- 音色卡片展示：名称、来源类型徽章、源音频播放器、persona_id（可复制）、状态徽章、删除按钮
- 获取音色列表：调用 `listVoicePersonas()` 并映射为展示项

#### 12. [app/assets/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/assets/page.tsx) — 适配新类型
- 将 voice 类型纳入 mediaType 过滤选项
- 将「创建歌手音色」入口集成到页面顶部操作区

#### 13. [app/music/[id]/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/music/[id]/page.tsx) — 替换手动输入
- 将自定义模式中的 `personaId` 手动文本输入替换为 `<VoicePersonaPicker>` 组件
- 保留原 `personaId` 状态逻辑不变，仅替换输入方式

---

## 假设与决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 「生成音色」含义 | TTS（MiMo voicedesign）生成人声音频 → createVoice 提取 | 用户明确选择 |
| 音色管理范围 | 全局共享，不绑定企划 | 用户明确选择；音色可跨企划复用 |
| 管理入口 | 资产库 | 用户明确选择；资产库已是全局媒体管理中心 |
| createVoice vs persona 端点 | 仅用 createVoice | createVoice 直接接收 audio_url，适配上传/TTS 两种模式；persona 端点需已有歌曲 task_id，当前不需要 |
| persona_id 字段解析 | 防御性多字段尝试 | 文档未明确返回字段名，依次尝试 `persona_id`/`voice_id`/`id`/`personaId` |
| TTS 音频格式 | WAV | MiMo voicedesign 输出 WAV，createVoice 接受 MP3/WAV |
| 资产库 mediaType | 新增 `"voice"` | 与现有 `"audio"`（MiMo TTS 角色音色）区分 |
| 音色与 MediaAsset 双写 | 是 | 与 Music 一致：voice_personas 表存完整元数据，同时 recordMediaAsset 入账本供资产库展示 |
| 双 API 依赖 | 需 MiMo + APIMart 均配置 | TTS 模式依赖 MiMo，createVoice 依赖 APIMart；未配置时给出明确提示 |
| 断点恢复 | 通过 sunoTaskId 支持 | 若创建中途页面刷新，可从 pending 记录的 sunoTaskId 恢复轮询 |

---

## 验证步骤

### 1. 类型检查与构建
```bash
npm run typecheck
npm run build
```

### 2. 功能验证 — 上传模式
1. 进入资产库 → 点击「创建歌手音色」
2. 选择「上传文件」→ 上传一段 MP3/WAV 人声音频 → 填写名称 → 提交
3. 确认进度条更新 → 状态变为「已完成」→ 卡片显示 persona_id
4. 确认资产库「歌手音色」筛选下出现该音色

### 3. 功能验证 — TTS 模式
1. 确保设置中已配置 MiMo 音频 API
2. 选择「TTS 生成」→ 输入音色描述（如"温柔的女声"）+ 样例文本 → 提交
3. 确认先生成 TTS 音频 → 再提交 createVoice → 最终得到 persona_id
4. 确认源音频可播放预览

### 4. 功能验证 — 音乐生成集成
1. 进入音乐编辑页 → 选择「自定义模式」
2. 确认 personaId 输入已变为音色选择器
3. 选择已创建的音色 → 填写歌词/标题/风格 → 生成
4. 确认生成的音乐使用了所选音色的人声特征

### 5. 边界情况验证
- MiMo 未配置时，TTS 模式显示明确提示
- createVoice 失败时，记录状态为 failed 且显示错误信息
- 删除音色后，资产库和选择器中不再显示
- 模式切换（灵感/自定义/二创）时，选择器仅自定义模式可见

---

## 文件变更总览

| 操作 | 文件 |
|------|------|
| 新建 | `lib/voice-persona-client.ts` |
| 新建 | `app/api/data/voice-personas/route.ts` |
| 新建 | `components/VoicePersonaCreateDialog.tsx` |
| 新建 | `components/VoicePersonaPicker.tsx` |
| 修改 | `lib/types.ts`（新增 VoicePersona 类型 + 扩展联合类型） |
| 修改 | `lib/db.ts`（新增 voice_personas 表） |
| 修改 | `lib/storage.ts`（新增音色 CRUD 函数） |
| 修改 | `lib/api-client.ts`（新增音色 API 方法） |
| 修改 | `app/api/music/create/route.ts`（新增 createVoice action） |
| 修改 | `app/api/music/query/route.ts`（解析 persona_id） |
| 修改 | `lib/music-client.ts`（新增 createVoiceTask） |
| 修改 | `components/AssetLibrary.tsx`（集成音色展示与创建） |
| 修改 | `app/assets/page.tsx`（适配 voice 类型） |
| 修改 | `app/music/[id]/page.tsx`（personaId 改为选择器） |
