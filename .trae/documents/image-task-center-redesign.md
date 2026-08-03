# 图片生成任务轮询重设计方案：服务端任务中心

## 一、Summary（概要）

将图片生成异步任务的轮询职责从**浏览器端**迁移到**服务端常驻 Node 进程**（Electron 内嵌 Next.js），新建 `image_tasks` 表 + 服务端任务中心（进程内轮询器），任务提交后由服务端负责轮询上游、容错重试、超时管理、COS 转存；前端只负责提交任务和订阅本地任务状态。刷新、切页、关闭页面、重启应用均不再丢任务；7 处重复的前端轮询/恢复逻辑收敛为一套统一实现。

**用户已确认的决策**：
- 架构方向：服务端任务中心
- COS 转存：服务端拿到结果立即转存

## 二、Current State Analysis（现状分析）

### 当前流程
1. 浏览器端 `generateImage()` → `POST /api/image`（asyncMode）→ 拿 jobId → `onJobCreated` 回调把 `imageTaskId` 写入业务实体并落盘 → 浏览器端 `pollImageTask` while 循环每 3 秒查一次（上限 5 分钟）
2. 切页/刷新 → AbortController abort → 轮询停止，`imageTaskId` 保留在 DB
3. 重新进页面 → 各页面的恢复 effect 对带 `imageTaskId` 的实体调 `resumeImageGeneration` 续投轮询
4. 完成后前端写回 `imageUrl`、清 `imageTaskId`、**前端转存 COS**、`recordMediaAsset` 入账

### 丢任务的根因（已逐条核实代码）

| # | 根因 | 位置 | 后果 |
|---|------|------|------|
| 1 | 任何 HTTP 错误（502/429/本地服务重启）被映射为 `failed`，调用方清除 `imageTaskId` | `lib/image-client.ts:344-351` | 上游仍在跑的任务变孤儿，图片永久丢失 |
| 2 | 5 分钟硬超时即视为终态失败，清 taskId | `lib/image-client.ts:405` | 排队久的大图任务无人认领 |
| 3 | 恢复 effect 的 run-once 守卫在数据未加载完时被空数组消耗 | `app/series/[id]/characters/page.tsx:157-161`（objects/scenes 同构） | 本次会话不恢复任何任务 |
| 4 | React 18 StrictMode 双挂载：渲染期创建的 AbortController 被 abort 后复用 | `characters/page.tsx:118-123` 等 | dev 下轮询永远立即"已取消" |
| 5 | 卸载兜底落盘 keepalive fetch 静默吞错（+64KB 上限） | `lib/use-unload-persist.ts:27-35` | taskId 没落库 |
| 6 | 同一套"创建-轮询-恢复-写回-转存"逻辑在 **7 个文件**各自重复实现 | AssetPreparation / VideoGeneration / characters / objects / scenes / style-templates / image-client | 修了一处其他处变体仍在——"改了很多遍还出问题"的结构性原因 |

### 关键背景事实
- 项目为 Electron 31 + 内嵌常驻 Next.js 14.2.35（Node 进程常驻，非 serverless），服务端可做进程内轮询器
- DB 为 better-sqlite3 单例（`lib/db.ts`），API 路由与任务中心同进程，可直接 `getDb()`
- COS 配置存 settings 表 key=`"cos"`（`CosSettings`），服务端可读；转存核心逻辑在 `app/api/cos/transfer/route.ts`，需抽成共享函数
- 上游查询的状态归一化逻辑在 `app/api/image/query/route.ts`（APIMart `GET /tasks/{id}` / 方舟 `GET /images/async-generations/{id}`），需抽成共享函数供任务中心复用
- 不存在 instrumentation.ts；不依赖启动钩子，采用 lazy-init 恢复

## 三、Proposed Changes（方案详述）

### 总体架构

```
前端（7 处调用方）                     服务端（常驻 Node 进程）
┌─────────────────┐   提交           ┌──────────────────────────┐
│ generateImage() │ ───────────────> │ POST /api/image          │
└─────────────────┘                  │  └─ 异步分支拿到 jobId 后 │
        │ jobId                      │     registerTask() 写表   │
        v                            └──────────┬───────────────┘
┌─────────────────┐                             v
│ waitImageTask() │   每3s 查本地      ┌──────────────────────────┐
│ (订阅，可取消)   │ ───────────────> │ image_tasks 表 (SQLite)   │
└─────────────────┘ <───────────────  │  ↑ 状态机                 │
        │ done(imageUrl)              └──────────┬───────────────┘
        v 写回业务实体                            │ 进程内轮询器
   (COS URL，无需再转存)             ┌────────────v───────────────┐
                                     │ TaskCenter:                │
                                     │  - 每任务独立循环 3s 间隔   │
                                     │  - 瞬态失败计数(≥10才终态)  │
                                     │  - 硬超时 30min → expired  │
                                     │  - done → 立即转存 COS     │
                                     │  - ensureRunning() 恢复    │
                                     └──────────────────────────┘
```

### 变更清单

#### 1. `lib/db.ts` — 新建 `image_tasks` 表

在现有建表 SQL 中追加：

```sql
CREATE TABLE IF NOT EXISTS image_tasks (
  job_id       TEXT PRIMARY KEY,          -- 上游任务 ID
  provider     TEXT NOT NULL,             -- ark / ark-plan / apimart / custom
  api_key      TEXT NOT NULL DEFAULT '',  -- 凭证快照（保证重启后恢复轮询凭证一致；与 settings 表明文存 key 同级安全）
  base_url     TEXT NOT NULL DEFAULT '',
  model        TEXT NOT NULL DEFAULT '',
  cos_prefix   TEXT NOT NULL DEFAULT 'ai-script/assets',
  status       TEXT NOT NULL,             -- pending / running / done / failed / expired
  image_url    TEXT,                      -- 最终结果 URL（COS 转存成功则为 COS URL，否则上游原始 URL）
  upstream_url TEXT,                      -- 上游原始 URL（调试/补转存用）
  error        TEXT,
  fail_count   INTEGER NOT NULL DEFAULT 0, -- 连续查询失败计数
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_image_tasks_status ON image_tasks(status);
CREATE INDEX IF NOT EXISTS idx_image_tasks_created_at ON image_tasks(created_at);
```

`CREATE TABLE IF NOT EXISTS` 对存量 DB 自动生效，无需迁移脚本。

#### 2. 新增 `lib/image-upstream.ts` — 服务端共享的上游查询逻辑（server-only）

从 `app/api/image/query/route.ts` 抽出两家上游的查询+状态归一化逻辑为纯函数：

```typescript
export interface UpstreamQueryResult {
  status: ImageTaskStatus;       // pending / running / done / failed
  imageUrl?: string;
  error?: string;
  transient?: boolean;           // true = 瞬态错误（网络异常/5xx/429/非JSON），不应计入终态
}
export async function queryUpstreamImageTask(
  provider: ImageGenSettings["provider"],
  creds: { apiKey: string; baseURL: string },
  jobId: string
): Promise<UpstreamQueryResult>
```

- APIMart：`GET {base}/tasks/{jobId}?language=zh`，状态映射沿用现有规则（completed→done / processing→running / pending,submitted→pending）；**区分终态与瞬态**：上游明确 `failed/cancelled` → 终态 failed；HTTP 错误、网络异常、非 JSON → `transient: true`
- 方舟：`GET {base}/images/async-generations/{jobId}`，映射规则同上（done/succeeded/success→done 等）
- **修正现状缺陷**：未知状态不再一律归 failed，归 transient（继续轮询）

`app/api/image/query/route.ts` 改造为薄壳：校验参数 → 调 `queryUpstreamImageTask` → 按 `transient` 决定返回 HTTP 502 还是 200+状态体。保持对外响应格式不变（`testImageConnection` 仍在用）。

#### 3. 新增 `lib/cos-transfer.ts` — 服务端 COS 转存核心（server-only）

从 `app/api/cos/transfer/route.ts` 抽出核心逻辑：

```typescript
export async function transferToCos(
  settings: CosSettings,
  sourceUrl: string,
  prefix: string
): Promise<{ url: string; key: string }>
```

（下载源 URL → 猜扩展名 → cos-nodejs-sdk-v5 putObject → buildCosPublicUrl，逻辑原样搬迁）。另加：

```typescript
export function readCosSettingsFromDb(): CosSettings | null  // 直接 getDb() 读 settings 表 key="cos"
```

`app/api/cos/transfer/route.ts` 改为薄壳调用 `transferToCos`，对外行为不变。

#### 4. 新增 `lib/image-task-center.ts` — 服务端任务中心（server-only，方案核心）

单例挂在 `globalThis`（防 dev HMR 模块重建丢轮询循环）：

```typescript
const POLL_INTERVAL_MS = 3000;
const MAX_CONSECUTIVE_FAILURES = 10;        // 连续瞬态失败 ≥10 次（约30s）才标记 failed
const HARD_TIMEOUT_MS = 30 * 60 * 1000;     // 硬超时 30 分钟（自 created_at 起算）→ expired
const TERMINAL_RETENTION_MS = 7 * 24 * 3600 * 1000; // 终态任务保留 7 天（供前端补写回），ensureRunning 时顺手清理

class ImageTaskCenter {
  private running = new Map<string, { abort: AbortController }>();

  // 注册任务（幂等）：DB 无记录则 INSERT；内存无循环则启动轮询
  async registerTask(input: {
    jobId: string; provider: Provider; apiKey: string; baseURL: string;
    model?: string; cosPrefix?: string;
  }): Promise<ImageTaskRecord>

  // 批量查询（前端订阅用）
  getTasks(jobIds: string[]): ImageTaskRecord[]

  // 失败/过期任务手动重试：重置 status/fail_count，重启轮询
  async retryTask(jobId: string): Promise<ImageTaskRecord | null>

  // 惰性恢复：扫描 DB 中 status IN (pending,running) 但内存无循环的任务，重启轮询；
  // 顺手清理 7 天前的终态任务。每个相关 API 路由入口调用，内部 60s 节流。
  ensureRunning(): void

  private async pollLoop(jobId: string): Promise<void>
}
```

**pollLoop 核心逻辑**（每个任务独立 async 循环，整体 try/catch 兜底，任何未预期异常按瞬态失败计数，绝不静默退出）：

```
loop:
  1. 读 DB 任务记录；若已被外部置为终态（如 retry 竞态）→ 退出
  2. 超过硬超时 → UPDATE status=expired（保留记录，可 retry）→ 退出
  3. queryUpstreamImageTask()
     - done → 进入完成处理（见下）→ 退出
     - failed（上游明确终态）→ UPDATE status=failed + error → 退出
     - transient → fail_count++；fail_count ≥ 10 → UPDATE failed（error 记最后一次瞬态错误）→ 退出；否则 UPDATE fail_count，继续
     - pending/running → fail_count 清零，UPDATE status，继续
  4. sleep 3s（响应 abort）

完成处理：
  a. UPDATE upstream_url = 原始URL
  b. readCosSettingsFromDb()；已配置 → transferToCos(settings, url, record.cos_prefix)，最多 3 次指数退避重试
     - 成功 → image_url = COS URL
     - 最终失败 → image_url = 原始 URL，error 记 "COS 转存失败：..."（状态仍为 done；原始 URL 24h 内前端仍可补转存）
     - 未配置 → image_url = 原始 URL
  c. UPDATE status=done, image_url, completed_at
```

**进程重启恢复**：不引入 instrumentation hook。`ensureRunning()` 在 `GET/POST /api/image-tasks` 与 `POST /api/image` 入口调用（幂等 + 60s 节流），应用重启后首个相关请求即恢复所有中断任务的轮询；前端恢复路径（attach）也会主动触发注册。

#### 5. 新增 `app/api/image-tasks/route.ts` — 任务查询/注册路由

- `GET /api/image-tasks?ids=a,b,c` → `ensureRunning()` + `getTasks(ids)` → `{ tasks: ImageTaskRecord[] }`（不返回 api_key 字段，响应层脱敏）
- `POST /api/image-tasks`（attach 存量任务，幂等）→ body `{ jobId, provider, apiKey, baseURL, model?, cosPrefix? }` → `registerTask()` → `{ task }`

#### 6. 新增 `app/api/image-tasks/[jobId]/retry/route.ts` — 失败任务重试

- `POST` → `retryTask(jobId)` → `{ task }`；任务不存在返回 404

#### 7. 修改 `app/api/image/route.ts` — 提交即注册

两个异步分支（APIMart L85-95、方舟 asyncMode L190-203）拿到 jobId 后：

```typescript
await taskCenter.registerTask({
  jobId, provider: body.provider, apiKey: body.apiKey, baseURL: body.baseURL,
  model: body.model, cosPrefix: body.cosPrefix,
});
```

`ImageProxyRequest` 类型加可选 `cosPrefix` 字段。同步分支不动。

#### 8. 修改 `lib/image-client.ts` — 前端轮询改为订阅本地任务中心

新增：

```typescript
// 订阅本地任务状态直到终态。间隔 3s，上限 35min（大于服务端硬超时）。
// 本地 API 瞬态失败不计终态，下一轮继续；signal abort → 抛 "已取消"（任务在服务端继续跑，不丢）。
export async function waitImageTask(jobId: string, signal?: AbortSignal): Promise<ImageProxyResponse>

// 恢复订阅（刷新/切页后）：attach（幂等注册，凭证按 provider 解析快照传入）→ waitImageTask
export async function resumeImageGeneration(
  jobId: string, provider?: Provider, onUpdate?, signal?
): Promise<ImageProxyResponse>
```

改造 `generateImage()` 的 polling 分支（L280-305）：提交 → `onJobCreated`（保留，调用方照常落盘 taskId）→ `waitImageTask(jobId, signal)`。请求体加 `cosPrefix`（由 config 传入，默认 `ai-script/assets`）。

**关键行为修正**：`waitImageTask` 只有在服务端返回 `failed`/`expired` 时才抛真实错误；本地 fetch 失败、HTTP 错误一律下一轮重试——**瞬态错误永远不再导致调用方清 taskId**。

`pollImageTask`/`queryImageTask` 保留（仅 `testImageConnection` 使用）。

#### 9. 新增 `lib/image-task-recovery.ts` — 统一恢复函数（收敛 7 处重复骨架）

```typescript
export interface RecoveryEntry { key: string; jobId: string; provider?: ImageGenSettings["provider"] }
export function recoverImageTasks(
  entries: RecoveryEntry[],
  callbacks: {
    onDone: (key: string, imageUrl: string) => void | Promise<void>;  // 业务写回（不再需转存 COS）
    onFailed?: (key: string, error: string) => void;                  // 仅真实终态失败才回调
  },
  signal?: AbortSignal
): void
```

内部对每个 entry 调 `resumeImageGeneration`，catch 中统一分类：`"已取消"`/AbortError 静默（保留 taskId），其余回调 `onFailed`——各页面不再各自写这套判断。

#### 10. 修改 7 处调用方 — 删重复、修竞态、删前端转存

涉及文件：
- `components/AssetPreparation.tsx`
- `components/VideoGeneration.tsx`（注意 Shot 有 `imageTaskKind` 区分 storyboard/genImage，恢复时按 kind 走不同写回）
- `app/series/[id]/characters/page.tsx`
- `app/series/[id]/objects/page.tsx`
- `app/series/[id]/scenes/page.tsx`
- `app/style-templates/page.tsx`（6 个 taskId 字段，逐字段生成 entries）

每处统一做三类改造：

**a) 恢复 effect 换统一函数 + 修加载竞态**：
```typescript
useEffect(() => {
  if (loading || !dataReady) return;          // 数据加载完成才执行（修根因#3：不再用会被空数据消耗的 run-once ref）
  const ac = new AbortController();           // effect 内创建（修根因#4：StrictMode 安全）
  const entries = items.filter(i => i.imageTaskId).map(i => ({ key: i.id, jobId: i.imageTaskId!, provider: i.imageTaskProvider }));
  if (entries.length === 0) return;
  recoverImageTasks(entries, { onDone: 写回imageUrl并清taskId落库, onFailed: 清taskId并提示 }, ac.signal);
  return () => ac.abort();
}, [loading, dataReady]);                     // 故意不含 items：恢复只触发一轮，写回走各自 setState
```
注意：原来是"run-once + 卸载 abort"，改为"ready 触发 + cleanup abort"。若 items 加载后又有新任务（用户生成中切走再切回），由下一轮挂载的 effect 接管，taskId 在 DB 中不会漏。

**b) 生成路径**：`generateImage(..., onJobCreated 落盘回调, signal)` 调用签名基本不变（config 里补 `cosPrefix`，如 `ai-script/characters`）；完成回调中**删除 `isCosConfigured()/transferAsset` 转存块**（服务端已转存，返回即 COS URL），保留写 imageUrl、清 taskId、`recordMediaAsset`、落库。

**c) AbortController 创建位置**：全部从"渲染期同步初始化 ref"改为"effect 内创建 + cleanup abort"（characters/objects/scenes/AssetPreparation/VideoGeneration/style-templates 统一）。

#### 11. 修改 `lib/types.ts`

- `ImageProxyRequest` 加 `cosPrefix?: string`
- 新增 `ImageTaskRecord` 接口（与 image_tasks 表对应，API 响应不含 api_key）

### 不变的部分
- `imageTaskId` 仍作为业务实体字段落库（恢复索引），前端落盘链路（onJobCreated 立即落盘 + 防抖 + useUnloadPersist 兜底）原样保留
- `POST /api/image` 同步分支、`/api/image/query`（测试连接用）对外行为不变
- 不支持轮询的模型（同步生成）路径完全不动

## 四、Assumptions & Decisions（假设与决策）

1. **凭证快照存任务表**：本地桌面应用，settings 表本就明文存 apiKey，同级安全可接受；保证重启后恢复轮询时凭证与任务创建时一致（用户中途换 key 不影响进行中任务）。API 响应层脱敏不返回 api_key。
2. **硬超时 30 分钟**：远大于现状 5 分钟（APIMart 标注 estimated_time 60s，30min 覆盖极端排队）；超时 → `expired` 保留记录可手动 retry，不再自动清业务实体 taskId 之外的任何数据。
3. **连续瞬态失败 ≥10 次（约 30 秒）才终态**：覆盖网关抖动、限流、本地网络闪断；终态 failed 后业务侧才清 taskId。
4. **前端订阅用本地轮询而非 SSE**：3s 轮询本地 SQLite 开销可忽略，与现有代码风格一致，无连接管理复杂度。
5. **不做一次性存量数据迁移**：DB 中带 `imageTaskId` 的存量实体，由前端恢复路径 attach 自动接管（幂等）；attach 时用 `resolveImageCredentials(provider)` 解析当前凭证。
6. **无 instrumentation hook**：lazy-init `ensureRunning()` 足以覆盖重启恢复（首个相关请求触发），避免改动 next.config 的实验性开关。
7. **写回业务实体仍在前端**：服务端任务中心不直接改 series/episodes 的 JSON 列，避免与前端 1500ms 防抖保存产生写冲突；任务结果在任务表保留 7 天，前端任何时刻打开都能补写回，且 COS URL 永不过期。
8. **COS 转存失败不阻断 done**：记录 error + 存原始 URL（24h 有效），前端写回时保留补转存能力（现有 transferAsset 路径保留在 video/其他流程中不受影响）。

## 五、Verification（验证）

1. `npm run lint` 与 `npm run build` 通过（无类型错误）
2. 功能验证路径（开发环境 `npm run dev`）：
   - **正常完成**：人物设定页生成图片 → 任务表出现记录 → 约几十秒后 done 且 image_url 为 COS URL → 前端写回
   - **刷新不丢**：生成中刷新页面 → 重新进入后自动恢复订阅 → 完成写回（观察 image_tasks 表记录全程在服务端推进，与前端刷新无关）
   - **重启应用不丢**：生成中杀掉 dev server 重启 → 打开页面触发 attach/ensureRunning → 轮询恢复 → 完成
   - **瞬态容错**：轮询期间断网 10 秒再恢复 → 任务不标 failed，最终正常完成
   - **超时保留**：（可临时把 HARD_TIMEOUT_MS 调小验证）超时后 status=expired，taskId 保留，调 retry 接口可重新轮询
   - **StrictMode**：dev 下生成/恢复不再出现永久"已取消"
3. 回归：设置页测试连接（apimart/方舟）正常；同步模型生成不受影响
