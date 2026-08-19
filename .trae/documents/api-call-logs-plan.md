# 任务日志（第三方 API 调用日志）实现计划

## Summary

新增一个全新的「任务日志」功能，用于记录每次调用第三方服务商生成图片/视频时**实际发给上游的请求**（upstreamBody）及其响应、状态、耗时。入口放在首页右上角，名为「任务日志」，点击进入独立页面 `/logs`，支持按类型（图片/视频）、供应商、状态分类筛选与分页。

该功能直接呼应此前排查的痛点：前端控制台看到的 `ImageProxyRequest` 与服务端发给第三方的 `upstreamBody` 并不一致，因此日志记录的是后者，便于直接对照第三方报错排查。

## 已确认的决策

| 维度 | 决策 |
|---|---|
| 入口形态 | 独立页面 `/logs`（类似设置页/资产库页） |
| 记录哪份参数 | 服务端实际发给上游的 `upstreamBody`（非前端代理请求体） |
| 记录内容 | 请求参数 + 上游响应 + 状态 + 耗时 |
| 调用范围 | 仅「生成类」调用（图片 `/api/image`、视频 `/api/video/create`），不记录 query/cancel 轮询 |
| 状态语义 | 本次提交调用的成败（`success`/`failed`），耗时 = 本次 fetch 耗时；不追踪任务最终结果（那是 `image_tasks` 的职责） |
| 数据保留 | 手动清空 + 自动清理 7 天前（复用 image_tasks 清理模式） |
| 安全 | upstreamBody 本身不含 apiKey（apiKey 在 header），天然不记录密钥；但参考图 base64 data URI 需截断防膨胀 |

## Current State Analysis

- **存储层**：SQLite（`better-sqlite3`），`data/mojian-dev.db`，单例 `getDb()` 在 [lib/db.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/db.ts)。建表集中在 `db.exec()` 块（L23-149），增量迁移用 `PRAGMA table_info`（L151-159）。现有 9 张表，无任何日志/调用记录表。
- **数据路由模式**：`app/api/data/*` 统一为 `validateAuth` + `getDb()` + `rowToXxx` + UPSERT/INSERT/DELETE。参考 [app/api/data/media-assets/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/data/media-assets/route.ts)（GET/POST/DELETE 三件套）。
- **前端封装**：[lib/api-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/api-client.ts) 的 `apiClient` 对象，`request<T>(path, options)` 自动带 `Authorization: Bearer ${NEXT_PUBLIC_STORAGE_TOKEN}`。
- **图片调用链**：[app/api/image/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/image/route.ts) 接收 `ImageProxyRequest`，按 provider 重新构造 `upstreamBody` 发给上游。两分支：APIMart（L41-110，`upstreamBody` L42-51，fetch L55-62，响应 `apimartRaw` L83，错误 `errText` L69）；非 APIMart（L112-167，`upstreamBody` L123-155，fetch L163-167，响应 `rawText` L189，错误 `errText` L174）。
- **视频调用链**：[app/api/video/create/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/video/create/route.ts) 纯透传前端构造的 `payload`。两分支：APIMart（L28-77，`ap` L29，fetch L39-46，响应 `data` L67，错误 `errText` L53）；ark（L79-128，`body.payload`，fetch L93-100，响应 `data` L121，错误 `errText` L107）。
- **首页右上角**：[app/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/page.tsx) L95-145 是 `<div className="flex items-center gap-2">` 的 ghost Button 组（资产库/预设库/风格模板/设置）。
- **UI 库**：自研 `components/ui`（Button/Modal/Select/Spinner/ConfirmDialog），暖色墨间系 token。筛选模式：FilterPill 胶囊 + Select 下拉，参考 [components/AssetLibrary.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx) L419-454。
- **自动清理参考**：[lib/image-task-center.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/image-task-center.ts) `ensureRunning`（L159-175）有 60s 节流 + 清理 7 天前终态记录（L165-167），单例挂 `globalThis`（L292-299）。

## Proposed Changes

### 1. 新建数据表 — `lib/db.ts`

在 `db.exec()` 块末尾（L148 `idx_image_tasks_created_at` 索引之后、反引号闭合之前）追加：

```sql
CREATE TABLE IF NOT EXISTS api_call_logs (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,            -- 'image' | 'video'
  provider      TEXT NOT NULL,            -- 'ark' | 'ark-plan' | 'apimart' | 'custom'
  model         TEXT NOT NULL DEFAULT '',
  upstream_url  TEXT NOT NULL DEFAULT '', -- 实际发给上游的完整 URL
  request_body  TEXT NOT NULL DEFAULT '', -- upstreamBody 的 JSON 字符串（base64 已脱敏）
  response_body TEXT NOT NULL DEFAULT '', -- 上游响应 JSON 或错误文本片段
  status        TEXT NOT NULL,            -- 'success' | 'failed'
  error         TEXT,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_call_logs_type ON api_call_logs(type);
CREATE INDEX IF NOT EXISTS idx_api_call_logs_provider ON api_call_logs(provider);
CREATE INDEX IF NOT EXISTS idx_api_call_logs_status ON api_call_logs(status);
CREATE INDEX IF NOT EXISTS idx_api_call_logs_created_at ON api_call_logs(created_at DESC);
```

无需增量迁移（新表）。

### 2. 日志写入模块 — 新建 `lib/api-call-logger.ts`

服务端专用，直接读写 DB（不经 HTTP）。

```typescript
import { getDb } from "@/lib/db";

export interface ApiCallLogInput {
  type: "image" | "video";
  provider: string;
  model: string;
  upstreamUrl: string;
  requestBody: unknown;      // upstreamBody 对象，内部序列化
  responseBody: string;      // 上游响应文本（已截断）
  status: "success" | "failed";
  error?: string;
  durationMs: number;
}

/** 把对象中所有 data: URI（base64 参考图等）截断，防止日志膨胀 */
function sanitizeBody(obj: unknown): string {
  const seen = new WeakSet();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string" && v.startsWith("data:") && v.length > 128) {
      return `${v.slice(0, 64)}…<truncated, len=${v.length}>`;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(obj));
}

/** 写入一条调用日志。失败仅 warn，不阻断主流程 */
export function logApiCall(input: ApiCallLogInput): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO api_call_logs
        (id, type, provider, model, upstream_url, request_body, response_body, status, error, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      input.type,
      input.provider,
      input.model,
      input.upstreamUrl,
      sanitizeBody(input.requestBody),
      input.responseBody.slice(0, 4000),
      input.status,
      input.error ?? null,
      input.durationMs,
      Date.now()
    );
  } catch (e) {
    console.warn("[api-call-logger] 写入失败", e);
  }
}

const g = globalThis as { __apiLogCleanAt?: number };
/** 节流清理 7 天前日志（60s 内只执行一次） */
export function maybeCleanOldApiCallLogs(days = 7): void {
  const now = Date.now();
  if (g.__apiLogCleanAt && now - g.__apiLogCleanAt < 60_000) return;
  g.__apiLogCleanAt = now;
  try {
    getDb().prepare("DELETE FROM api_call_logs WHERE created_at < ?").run(now - days * 86400_000);
  } catch { /* ignore */ }
}
```

### 3. 类型定义 — `lib/types.ts`

新增（放在 `ImageTaskRecord` 附近）：

```typescript
/** 第三方 API 调用日志记录（api_call_logs 表） */
export interface ApiCallLog {
  id: string;
  type: "image" | "video";
  provider: string;
  model: string;
  upstreamUrl: string;
  requestBody: string;   // JSON 字符串（base64 已脱敏）
  responseBody: string;  // JSON 字符串或错误片段
  status: "success" | "failed";
  error?: string;
  durationMs: number;
  createdAt: number;
}

export interface ApiCallLogListResponse {
  items: ApiCallLog[];
  total: number;
}
```

### 4. 数据路由 — 新建 `app/api/data/api-logs/route.ts`

复用 media-assets 路由模式。

- **GET** `/api/data/api-logs?type=image&provider=apimart&status=failed&limit=50&offset=0`
  - `validateAuth` + `getDb()`
  - 先调 `maybeCleanOldApiCallLogs()` 顺手清理
  - 动态拼接 `WHERE`（type/provider/status 可选），`ORDER BY created_at DESC LIMIT ? OFFSET ?`
  - 同时 `SELECT COUNT(*)` 返回 total
  - `rowToApiCallLog` 蛇形→驼峰映射
  - 返回 `ApiCallLogListResponse`
- **DELETE** `/api/data/api-logs`
  - body 带 `ids` → 按 ids 批量删除（复用 media-assets 的占位符模式）
  - body 无 `ids` 或 `ids=[]` → 清空全部（`DELETE FROM api_call_logs`）
  - 返回 `{ ok: true, deleted: n }`

### 5. 前端封装 — `lib/api-client.ts`

在 `apiClient` 对象中追加（参照 `listMediaAssets`）：

```typescript
listApiLogs: (params: { type?: string; provider?: string; status?: string; limit?: number; offset?: number }) => {
  const q = new URLSearchParams();
  if (params.type) q.set("type", params.type);
  if (params.provider) q.set("provider", params.provider);
  if (params.status) q.set("status", params.status);
  q.set("limit", String(params.limit ?? 50));
  q.set("offset", String(params.offset ?? 0));
  return request<ApiCallLogListResponse>(`/data/api-logs?${q}`);
},
clearApiLogs: (ids?: string[]) =>
  request<{ ok: boolean; deleted: number }>("/data/api-logs", {
    method: "DELETE",
    body: JSON.stringify(ids && ids.length ? { ids } : {}),
  }),
```

### 6. 埋点：图片 — `app/api/image/route.ts`

在两个分支的 fetch 调用前后埋点。每个分支在 `fetch` 前 `const t0 = Date.now()`，在**所有 return 之前**调用 `logApiCall`。

**APIMart 分支**（L41-110）：
- fetch 前：`const t0 = Date.now();`
- `upstreamUrl = \`${base}/images/generations\``
- 成功（拿到 taskId 后）：`logApiCall({ type:"image", provider:"apimart", model:body.model, upstreamUrl, requestBody:upstreamBody, responseBody:apimartRaw, status:"success", durationMs:Date.now()-t0 })`
- `!apimartRes.ok`：`status:"failed", error:friendly, responseBody:errText`
- catch 网络异常：`status:"failed", error:msg, responseBody:""`

**非 APIMart 分支**（L112-167）：
- 同理，`upstreamUrl = \`${base}/images/generations\``，`requestBody:upstreamBody`
- 成功（同步模式返回 imageUrl / 异步模式返回 jobId）时记 `success`，`responseBody:rawText`
- 失败分支记 `failed`

> 为减少重复，可在文件顶部定义一个本地 `const finish = (t0, extra) => logApiCall({...})` 闭包，但直接调用亦可。注意：日志写入不得影响原有 return 流程，`logApiCall` 内部已 try/catch。

### 7. 埋点：视频 — `app/api/video/create/route.ts`

**APIMart 分支**（L28-77）：
- fetch 前 `const t0 = Date.now()`，`upstreamUrl = url`（L36）
- `requestBody: ap`（L29）
- 成功：`responseBody: JSON.stringify(data)`, `status:"success"`
- 失败：`responseBody: errText`, `status:"failed"`, `error:friendly`

**ark 分支**（L79-128）：
- `requestBody: body.payload`
- `upstreamUrl = url`（L88）
- 成功：`responseBody: JSON.stringify(data)`, `status:"success"`
- 失败：`responseBody: errText`, `status:"failed"`

### 8. 自动清理挂载 — `lib/image-task-center.ts`

在 `ensureRunning`（L159-175）清理 image_tasks 终态之后，追加一行 `maybeCleanOldApiCallLogs(7)`（从 `lib/api-call-logger` 导入），复用其 60s 节流。视频路由不经过 task center，但日志页 GET 也会触发清理，双保险。

### 9. 日志页面 — 新建 `app/logs/page.tsx`

`"use client"` 页面，参考 [app/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/page.tsx) 的 `<main max-w-6xl>` 布局与 [components/AssetLibrary.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx) 的筛选栏。

**结构**：
```
<main max-w-7xl>
  <header flex justify-between>
    左：返回按钮 + 「任务日志」标题
    右：清空日志 Button(danger) — useConfirm 确认后调 clearApiLogs()
  </header>
  <筛选栏卡片>
    类型 FilterPill 组：全部 / 图片 / 视频
    供应商 Select：全部 / 火山方舟(ark) / 火山引擎Plan(ark-plan) / APIMart / 自定义(custom)
    状态 Select：全部 / 成功 / 失败
  </筛选栏>
  <列表>
    每行卡片：
      左：时间 | 类型徽标 | 供应商·模型 | upstreamUrl（截断）
      右：状态徽标（成功绿/失败红）| 耗时 ms
      点击展开：<pre> requestBody（JSON.parse 美化）+ responseBody + error </pre>
  </列表>
  <分页>：上一页 / 下一页 + 「共 N 条」
</main>
```

**交互**：
- 挂载 + 筛选变更 → `apiClient.listApiLogs(params)`，`limit=50`
- 分页：`offset` state，翻页时重新请求
- 清空：`useConfirm()` 二次确认 → `clearApiLogs()` → 刷新列表
- 展开行：本地 state 记录展开的 id 集合
- 加载态：`<Spinner>`

### 10. 首页入口 — `app/page.tsx`

在 L130-144「设置」按钮之后、`</div>`（L145）之前追加一个 ghost Button：

```tsx
<Button variant="ghost" size="md" onClick={() => router.push("/logs")}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-1">
    <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  任务日志
</Button>
```

## Assumptions & Decisions

1. **不记录 apiKey**：upstreamBody 不含 apiKey（在 header），`sanitizeBody` 仅截断 base64，密钥天然不落库。
2. **不关联业务实体**：日志不记录「为哪个人物/分镜生成」（create 请求体无此上下文）。如需关联，后续可让前端在 create 时附带 `seriesId/sceneId` 透传，本期不做。
3. **状态=提交成败**：不追踪任务最终生成结果（已由 `image_tasks` 表负责），日志聚焦「这次发给上游的调用是否成功、发了什么、回了什么」。
4. **responseBody 截断 4000 字符**：create 响应通常很小（jobId/taskId），但失败错误文本可能长，截断防膨胀。
5. **base64 脱敏**：参考图 data URI 截断到 64 字符 + 长度标注，避免单条日志几 MB。
6. **分页而非无限滚动**：与项目现有列表风格一致，简单可控。
7. **清理双触发**：image-task-center `ensureRunning` + 日志页 GET，均经 60s 节流，不会频繁删除。

## Verification Steps

1. **建表**：启动后访问任意页面触发 `getDb()`，用 SQLite 工具确认 `api_call_logs` 表与 4 个索引存在。
2. **图片成功日志**：生成一张图片 → 打开 `/logs` → 出现一条 `type=image` 记录，`status=success`，展开 `requestBody` 是 upstreamBody（字段名为 `response_format`/`image` 等下划线格式，验证记录的是上游格式而非前端代理格式），`responseBody` 含 jobId。
3. **图片失败日志**：在设置页填错 apiKey 后生成 → 出现 `status=failed` 记录，`error`/`responseBody` 含上游 401/403 报错。
4. **视频日志**：生成一个视频 → 出现 `type=video` 记录，`requestBody` 是 payload（ark 为 content[] 结构，apimart 为扁平结构）。
5. **base64 脱敏**：用带参考图（base64 data URI）的方式生图 → 检查 `requestBody` 中图片字段为 `<truncated, len=...>`，非原始 base64。
6. **筛选**：分别切换类型/供应商/状态 FilterPill 与 Select，列表正确过滤；分页上下页正常。
7. **清空**：点「清空日志」→ 二次确认 → 列表清空，DB 表清空。
8. **自动清理**：手动插入一条 `created_at` 为 8 天前的记录，访问日志页后确认被删除（60s 节流需注意）。
9. **主流程不受影响**：日志写入失败（如临时 DB 锁）时，图片/视频生成仍正常返回（`logApiCall` 已 try/catch）。
10. **类型检查**：`npm run typecheck`（或项目既有 lint/typecheck 命令）无报错。
