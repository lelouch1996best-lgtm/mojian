# 视频生成 API「查看价格」功能

## 概述

在视频生成 API 设置页的供应商选择区域新增「查看价格」按钮，点击后弹出当前选中供应商的价格表编辑弹框。弹框内可手动维护（增删改）每个模型各分辨率的每秒单价，支持「一键获取」（用户输入价格页 URL，服务端抓取网页正文后交 LLM 解析自动回填，**供应商级**粒度），以及「重置为内置默认价格」。价格数据持久化到服务端 setting，`estimateVideoCost` 优先使用用户保存的价格。

## 当前状态分析

### 相关文件与代码位置
- **供应商选择 UI**：[app/settings/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx#L1630-L1748) 第 1630-1748 行「视频生成 API」fieldset，供应商按钮网格在 1657-1678 行。`vidSettings.provider` 持有当前供应商（172 行），`videoModels` 持有当前供应商模型列表（179 行）
- **现有价格表**：[lib/video-pricing.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-pricing.ts) — `VIDEO_PRICE_TABLE`（硬编码默认表）+ `estimateVideoCost()`（已用于确认弹框）
- **设置持久化**：`/api/settings/[key]/route.ts`（GET/PUT，upsert 到 SQLite `settings` 表）；前端 `apiClient.getSetting/saveSetting`（[lib/api-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/api-client.ts#L62-L68) 第 62-68 行）
- **LLM 客户端**：[lib/llm-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/llm-client.ts) — `callLLM(messages, { responseFormat, signal })`（172-188 行），支持 `responseFormat: "json_object"`
- **Modal 组件**：[components/ui/Modal.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ui/Modal.tsx)（已导入 settings/page.tsx 第 7 行）
- **可编辑表参考模式**：`ModelManagerPanel`（[app/settings/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx#L2232-L2472) 第 2232-2472 行）— 列表+展开子编辑器+添加表单+底部操作按钮
- **依赖**：项目**无** cheerio/jsdom，URL 抓取用原生 `fetch` + 正则去标签

### 关键约束
- `ark-plan` 套餐制、`custom` 自定义端点：价格编辑弹框对这两个 provider 显示提示而非编辑表
- 分辨率 key 大小写不一致（如 `"720p"` vs `"720P"`），编辑表需按模型 `videoCapability.resolutions` 实际值展示
- LLM 需支持联网才能获取 URL — 但本方案是**服务端抓取网页正文**再交 LLM 解析，不依赖 LLM 自身联网能力（兼容所有 LLM）

## 设计决策

1. **数据存储粒度**：按 provider 完整保存（用户编辑/获取后保存该 provider 整个价格表到 `video_prices` setting）
2. **读取优先级**：`video_prices` setting 中有该 provider 数据 → 用用户数据；否则用 `VIDEO_PRICE_TABLE` 默认
3. **一键获取粒度**：供应商级（用户输入 1 个 URL，LLM 解析后回填该供应商所有模型价格）
4. **URL 抓取**：服务端 `fetch` HTML → 正则去 `<script>/<style>` 标签 → 截断 20000 字符 → 交 `callLLM`（`responseFormat: "json_object"`）解析
5. **重置默认**：删除 `video_prices` setting 中该 provider 的数据，回退到 `VIDEO_PRICE_TABLE`
6. **不引入新依赖**：用原生 fetch + 正则，不装 cheerio

## 实施步骤

### 步骤 1：扩展 `lib/video-pricing.ts`（数据层）

新增用户价格表的读写与合并函数，并改造 `estimateVideoCost` 优先使用用户数据。

```typescript
// 新增 setting key 常量
export const VIDEO_PRICES_SETTING_KEY = "video_prices";

// 用户价格表类型：provider → model(value) → entry（与 VIDEO_PRICE_TABLE 相同结构）
export type UserVideoPriceTable = Partial<Record<VideoGenSettings["provider"], Record<string, VideoPriceEntry>>>;

/** 读取某 provider 的用户价格表（未保存则返回 undefined） */
export async function getUserVideoPriceTable(
  provider: VideoGenSettings["provider"]
): Promise<Record<string, VideoPriceEntry> | undefined>;

/** 保存某 provider 的价格表（与现有 setting 合并后保存） */
export async function saveUserVideoPriceTable(
  provider: VideoGenSettings["provider"],
  table: Record<string, VideoPriceEntry>
): Promise<void>;

/** 删除某 provider 的用户价格表（回退到默认） */
export async function resetUserVideoPriceTable(
  provider: VideoGenSettings["provider"]
): Promise<void>;
```

改造 `estimateVideoCost`：新增重载或新增参数 `userTable?`，优先查用户表。由于 `estimateVideoCost` 在 VideoGeneration.tsx 的确认弹框中同步调用（非 async），改为**组件层预先 load 用户价格表**后传入函数，保持同步签名：

```typescript
// 新增同步版本，接收用户表
export function estimateVideoCostWith(
  provider: string | undefined,
  model: string,
  resolution: VideoResolution,
  durationSeconds: number,
  userTable?: Record<string, VideoPriceEntry>  // 当前 provider 的用户价格表
): VideoCostEstimate;
```

`estimateVideoCost` 保留作为默认实现（用 `VIDEO_PRICE_TABLE`），确认弹框改为调用 `estimateVideoCostWith` 并传入预加载的用户表。

### 步骤 2：新建 `app/api/fetch-url/route.ts`（URL 抓取 + LLM 解析）

```
POST /api/fetch-url
Body: { url: string, provider: string, models: Array<{value, label, resolutions: string[]}> }
Response: { prices: Record<modelValue, Partial<Record<resolution, number>>> }
```

流程：
1. 校验 url（必须是 http/https）
2. `fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) })`
3. `text()` 取 HTML
4. 正则清洗：`html.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()`
5. 截断到 20000 字符
6. 构造 LLM prompt（见下），调 `callLLM(messages, { responseFormat: "json_object" })`
7. `JSON.parse` 结果，校验结构，返回

**LLM Prompt**：
```
你是价格信息提取助手。从以下网页内容中提取视频生成模型的价格，换算为每秒单价（元/秒）。

供应商：{providerLabel}
该供应商的模型及支持分辨率：
- doubao-seedance-2.0 (Seedance 2.0)：480p/720p/1080p/4k
- grok-imagine-1.5-video-apimart (Grok Imagine 1.5)：480p/720p
- ...

输出 JSON，key 为模型 value，value 为 { 分辨率: 每秒单价 }：
{"doubao-seedance-2.0": {"480p": 0.77, "720p": 1.65}, ...}

规则：
- 美元价按 1 USD = 7 CNY 换算
- 按条计费（如 5秒=¥4.95）换算为每秒单价（4.95/5=0.99）
- 未找到价格的模型/分辨率不要包含
- 只输出 JSON

网页内容（来自 {url}）：
{content}
```

### 步骤 3：在 `app/settings/page.tsx` 新增价格编辑弹框组件

在 `ModelManagerPanel` 附近（约 2472 行后）新增 `PriceTableModal` 组件，沿用 `ModelManagerPanel` 的列表+展开+添加+底部按钮模式：

**Props**：
```typescript
interface PriceTableModalProps {
  open: boolean;
  onClose: () => void;
  provider: VideoGenSettings["provider"];
  models: ModelEntry[];  // 当前 provider 的模型列表
}
```

**内部结构**：
- **状态**：`priceTable`（`Record<modelValue, VideoPriceEntry>`，从 `getUserVideoPriceTable` 加载，无则用 `VIDEO_PRICE_TABLE[provider]`）、`fetching`（一键获取中）、`fetchUrl`（URL 输入）、`showFetchInput`（是否显示 URL 输入区）、`saving`、`dirty`
- **特殊 provider 处理**：`ark-plan` 显示"套餐制，按 AFP 积分计费，无需配置价格"；`custom` 显示"自定义 API 端点，价格未知"；其他显示编辑表
- **列表区**：遍历 `models`，每个模型一行（折叠态显示 model.label + 价格摘要），展开后显示该模型 `videoCapability.resolutions` 对应的 perSecond 输入框
- **添加自定义模型价格**：两个 input（model value + label）+ 添加按钮
- **一键获取区**：URL 输入框 + 「获取」按钮（fetching 时显示 Spinner 并禁用）。获取成功后用 LLM 返回的价格覆盖 `priceTable`（仅更新匹配到的模型，保留未匹配的手动值），用户可再编辑后保存
- **底部按钮**：「重置为默认」（`useConfirm` 二次确认 → `resetUserVideoPriceTable` → 重新加载 `VIDEO_PRICE_TABLE[provider]`）+「保存」（`saveUserVideoPriceTable` → 提示成功 → onClose）

### 步骤 4：在供应商选择区添加「查看价格」入口

修改 [app/settings/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx#L1678) 第 1678 行（供应商按钮网格 `</div>` 后），新增一行：

```tsx
<div className="mt-2 flex justify-end">
  <Button variant="ghost" size="sm" onClick={() => setPriceModalOpen(true)}>
    查看价格
  </Button>
</div>
<PriceTableModal
  open={priceModalOpen}
  onClose={() => setPriceModalOpen(false)}
  provider={vidSettings.provider}
  models={videoModels}
/>
```

新增状态 `const [priceModalOpen, setPriceModalOpen] = useState(false);`

### 步骤 5：确认弹框使用用户价格表

修改 [VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx) 中确认弹框的费用显示：
- 组件加载时（或 provider/model 变化时）调用 `getUserVideoPriceTable(config.provider)` 加载用户价格表到 state
- `estimateVideoCost(...)` 改为 `estimateVideoCostWith(..., userPriceTable)`

## 涉及文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `lib/video-pricing.ts` | **修改** | 新增 `getUserVideoPriceTable`/`saveUserVideoPriceTable`/`resetUserVideoPriceTable` + `estimateVideoCostWith` |
| `app/api/fetch-url/route.ts` | **新建** | 服务端 fetch URL + LLM 解析价格 |
| `app/settings/page.tsx` | **修改** | 新增 `PriceTableModal` 组件 + 供应商区「查看价格」按钮 + state |
| `components/VideoGeneration.tsx` | **修改** | 确认弹框改用 `estimateVideoCostWith` + 预加载用户价格表 |

## 假设与决策

- **不引入 cheerio**：正则去标签 + 截断后交 LLM，LLM 有一定 HTML 噪声容忍度。若解析效果差，后续可加 cheerio
- **URL 抓取超时 15 秒**：避免长时阻塞
- **LLM 上下文**：网页正文截断 20000 字符，配合模型列表 prompt 约 2.2 万 token，主流 LLM 可承载
- **美元换算**：固定 1 USD = 7 CNY，LLM prompt 中明确指示
- **获取后不自动保存**：LLM 返回的价格先填入编辑表，用户确认/修改后点「保存」才持久化
- **分辨率 key 保留原样**：编辑表按模型 `videoCapability.resolutions` 实际值（如 `"720P"`）作为 key，与价格表对齐
- **PriceTableModal 加载时机**：Modal 打开时加载用户价格表，避免每次 provider 切换都请求

## 验证

1. **TypeScript 编译**：`npx tsc --noEmit` 无错误
2. **功能验证**：
   - 设置页选择 APIMart → 点「查看价格」→ 弹框显示 APIMart 的 6 个模型及各分辨率价格
   - 手动修改某模型价格 → 保存 → 生成视频确认弹框的费用显示用新价格
   - 点「一键获取」→ 输入 `https://apib.ai/zh/pricing`（或备用 `https://www.apipod.ai/pricing`）→ 获取成功后编辑表回填 → 检查价格合理性 → 保存
   - 点「重置为默认」→ 确认 → 编辑表恢复为 `VIDEO_PRICE_TABLE` 内置值
   - 选 ark-plan → 弹框显示"套餐制"提示，无编辑表
   - 选 custom → 弹框显示"价格未知"提示
3. **异常验证**：
   - 输入无效 URL → 提示错误
   - URL 抓取超时 → 提示"抓取超时"
   - LLM 返回非 JSON → 提示"解析失败"
