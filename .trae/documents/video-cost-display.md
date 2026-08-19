# 视频生成费用显示功能

## 概述

在视频生成参数确认弹框中，根据用户选择的**供应商 + 模型 + 分辨率 + 时长**，实时计算并显示预估费用。价格数据来源于各供应商官方刊例价（已通过网络搜索确认），维护在独立的价格表文件中。

## 当前状态分析

### 代码库现状
- **确认弹框**：[VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L3838-L3974) 第 3838-3974 行，Modal 标题"镜头 N · 视频生成参数"，包含分辨率选择器(3863-3870)、宽高比(3871-3878)、时长输入(3879-3903)、各种 checkbox(3906-3972)
- **关键变量**（组件作用域内可用）：`config`(ShotVideoConfig，含 provider/model/resolution/duration/mode)、`cap`(VideoModelCapability)、`effectiveDuration`(实际秒数，已解析 -1 自动)
- **价格/费用数据**：**不存在**，需从零创建

### 供应商与定价模式

| 供应商 key | 显示名 | 计费模式 | 说明 |
|---|---|---|---|
| `ark` | 火山方舟 | 按量计费（元/百万token） | 可换算为每秒单价 |
| `ark-plan` | 火山引擎 Agent Plan | **套餐订阅制**（AFP 积分） | 无法按条计价，显示套餐提示 |
| `apimart` | APIMart(API易) | 按量计费（元/条） | 可换算为每秒单价 |
| `custom` | 自定义 | **未知** | 用户自有端点，无法估价 |

### 已确认的定价数据（来源于网络搜索）

**ark / apimart 通用**（Seedance 系列每秒单价，元/秒，文生视频/图生视频基准）：

| 模型 value | 480p | 720p | 1080p | 4k | 来源 |
|---|---|---|---|---|---|
| `doubao-seedance-2-0-260128` / `doubao-seedance-2.0` | 0.46 | 0.99 | 2.48 | — | 火山方舟刊例 46/51元/百万token |
| `doubao-seedance-2-0-fast-260128` / `doubao-seedance-2.0-fast` | 0.37 | 0.80 | — | — | AFP系数比 0.80×标准版 |
| `doubao-seedance-2-0-mini-260615` / `doubao-seedance-2.0-mini` | 0.23 | 0.50 | — | — | AFP系数比 0.50×标准版 |
| `doubao-seedance-1-5-pro-251215` | 待搜索 | 待搜索 | 待搜索 | — | 实施时搜索补充 |
| `doubao-seedance-1-0-pro-250528` | 待搜索 | 待搜索 | 待搜索 | — | 实施时搜索补充 |
| `doubao-seedance-1-0-pro-fast-251015` | 待搜索 | 待搜索 | 待搜索 | — | 实施时搜索补充 |
| `grok-imagine-1.5-video-apimart` | 待搜索 | 待搜索 | — | — | 实施时搜索 APIMart |
| `MiniMax-H3` | — | — | — | 待搜索(2K) | 实施时搜索 APIMart |
| `wan2.7` | — | 待搜索 | 待搜索 | — | 实施时搜索 APIMart |

> **注**：ark-plan 下所有模型均为套餐制，不按量计费。

## 设计决策

1. **计价维度**：供应商 + 模型 + 分辨率 + 时长。分辨率已纳入（弹框中已有选择器，且 720p vs 1080p 差 2-3 倍）。
2. **ark-plan**：显示"套餐制（AFP 积分计费）"，不显示具体金额。
3. **custom**：显示"自定义端点，价格未知"。
4. **价格表存储**：新建独立文件 `lib/video-pricing.ts`，与模型定义解耦，便于单独维护。
5. **时长=-1（自动）**：显示"时长为自动模式，费用待定"。
6. **未找到价格的模型/分辨率**：显示"价格待补充"。
7. **输入模式差异**（文生 vs 含参考视频）：ark 的 token 单价因输入是否含视频而不同（46 vs 28 元），但含视频时 token 用量也增加，难以预估。当前版本使用文生/图生基准价（不含视频输入），并在 note 中提示"含参考视频时费用可能不同"。

## 实施步骤

### 步骤 1：搜索补充缺失定价（实施时进行）

通过网络搜索补充以下模型的每秒单价：
- Seedance 1.5 Pro / 1.0 Pro / 1.0 Pro Fast（火山方舟旧模型）
- Grok Imagine 1.5、MiniMax-H3、wan2.7（APIMart 模型）

搜索关键词参考：`火山引擎 Seedance 1.0 Pro 价格`、`APIMart grok-imagine video 价格`、`APIMart MiniMax-H3 价格`、`APIMart wan2.7 价格`

### 步骤 2：创建价格表文件 `lib/video-pricing.ts`

```typescript
import type { VideoResolution, VideoGenSettings } from "./types";

/** 每秒单价条目 */
export interface VideoPriceRate {
  perSecond: number; // 元/秒
  source?: string;    // 数据来源备注
}

/** 价格表条目（三种类型） */
export type VideoPriceEntry =
  | { kind: "rate"; rates: Partial<Record<VideoResolution, VideoPriceRate>> }
  | { kind: "subscription"; label: string }
  | { kind: "unknown" };

/** 价格表：provider → model(value) → entry */
export const VIDEO_PRICE_TABLE: Record<VideoGenSettings["provider"], Record<string, VideoPriceEntry>> = {
  ark: {
    "doubao-seedance-2-0-260128": {
      kind: "rate",
      rates: {
        "480p": { perSecond: 0.46, source: "火山方舟刊例 46元/百万token" },
        "720p": { perSecond: 0.99, source: "火山方舟刊例 46元/百万token" },
        "1080p": { perSecond: 2.48, source: "火山方舟刊例 51元/百万token" },
      },
    },
    "doubao-seedance-2-0-fast-260128": {
      kind: "rate",
      rates: {
        "480p": { perSecond: 0.37, source: "AFP系数 0.80×标准版" },
        "720p": { perSecond: 0.80, source: "AFP系数 0.80×标准版" },
      },
    },
    "doubao-seedance-2-0-mini-260615": {
      kind: "rate",
      rates: {
        "480p": { perSecond: 0.23, source: "AFP系数 0.50×标准版" },
        "720p": { perSecond: 0.50, source: "AFP系数 0.50×标准版" },
      },
    },
    // 1.5 Pro / 1.0 Pro / 1.0 Pro Fast：步骤1搜索后填入
  },
  "ark-plan": {
    // 所有模型均为套餐制，用通配处理
    // estimateVideoCost 中对 ark-plan 统一返回 subscription
  },
  apimart: {
    "doubao-seedance-2.0": {
      kind: "rate",
      rates: {
        "720p": { perSecond: 0.99, source: "API易 720p 5秒=¥4.97" },
        "1080p": { perSecond: 2.48, source: "API易 1080p 5秒=¥12.39" },
      },
    },
    "doubao-seedance-2.0-fast": {
      kind: "rate",
      rates: {
        "720p": { perSecond: 0.80, source: "API易 fast 720p 5秒=¥4.00" },
      },
    },
    "doubao-seedance-2.0-mini": {
      kind: "rate",
      rates: {
        "720p": { perSecond: 0.50, source: "API易 mini 720p 5秒=¥2.50" },
      },
    },
    // grok-imagine / MiniMax-H3 / wan2.7：步骤1搜索后填入
  },
  custom: {}, // 全部 unknown
};

/** 费用估算结果 */
export interface VideoCostEstimate {
  amount: number | null;   // 预估总费用（元），null 表示无法计算
  perSecond: number | null; // 每秒单价（元）
  label: string;            // 显示文案
  breakdown?: string;       // 费用明细，如 "¥0.99/秒 × 5秒"
  note?: string;            // 补充说明
}

/** 估算视频生成费用 */
export function estimateVideoCost(
  provider: string | undefined,
  model: string,
  resolution: VideoResolution,
  durationSeconds: number
): VideoCostEstimate {
  // 1. ark-plan → 套餐制
  if (provider === "ark-plan") {
    return {
      amount: null,
      perSecond: null,
      label: "套餐制（AFP 积分计费）",
      note: "Agent Plan 套餐订阅，不按条计费",
    };
  }

  // 2. custom → 未知
  if (provider === "custom") {
    return {
      amount: null,
      perSecond: null,
      label: "价格未知",
      note: "自定义 API 端点，无法预估费用",
    };
  }

  // 3. 时长无效或自动
  if (durationSeconds <= 0 || !Number.isFinite(durationSeconds)) {
    return {
      amount: null,
      perSecond: null,
      label: "费用待定",
      note: durationSeconds === -1 ? "时长为自动模式，最终费用以实际生成为准" : "请设置有效时长",
    };
  }

  // 4. 查价格表
  const providerTable = VIDEO_PRICE_TABLE[provider as keyof typeof VIDEO_PRICE_TABLE];
  const entry = providerTable?.[model];

  if (!entry || entry.kind === "unknown") {
    return { amount: null, perSecond: null, label: "价格待补充", note: "该模型定价数据暂未收录" };
  }

  if (entry.kind === "subscription") {
    return { amount: null, perSecond: null, label: entry.label };
  }

  // kind === "rate"
  const rate = entry.rates[resolution];
  if (!rate) {
    return { amount: null, perSecond: null, label: "价格待补充", note: `该模型在 ${resolution} 分辨率下定价暂未收录` };
  }

  const amount = rate.perSecond * durationSeconds;
  return {
    amount,
    perSecond: rate.perSecond,
    label: `¥${amount.toFixed(2)}`,
    breakdown: `¥${rate.perSecond}/秒 × ${durationSeconds}秒`,
    note: "价格仅供参考，实际以 API 返回为准",
  };
}
```

### 步骤 3：在确认弹框中显示费用

修改 [VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx)，在确认弹框的参数区之后（第 3972 行 `</div>` 之后、3973 行 `</div>` 之前）插入费用预估区块：

```tsx
{/* 预估费用 */}
{(() => {
  const cost = estimateVideoCost(config.provider, config.model, config.resolution, effectiveDuration);
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-[11px] text-slate-500">预估费用</span>
      <div className="text-right">
        <span className={cost.amount !== null ? "text-sm font-medium text-slate-700" : "text-[11px] text-slate-400"}>
          {cost.label}
        </span>
        {cost.breakdown && (
          <span className="ml-1.5 text-[11px] text-slate-400">{cost.breakdown}</span>
        )}
        {cost.note && (
          <span className="ml-1.5 text-[10px] text-slate-400">· {cost.note}</span>
        )}
      </div>
    </div>
  );
})()}
```

需要在文件顶部添加 import：
```typescript
import { estimateVideoCost } from "@/lib/video-pricing";
```

### 步骤 4：验证

1. **TypeScript 编译**：`npx tsc --noEmit` 确认无类型错误
2. **功能验证**：
   - 选择 ark + Seedance 2.0 + 720p + 5秒 → 应显示"¥4.95"（0.99×5），明细"¥0.99/秒 × 5秒"
   - 选择 ark-plan + 任意模型 → 应显示"套餐制（AFP 积分计费）"
   - 选择 custom + 任意模型 → 应显示"价格未知"
   - 时长设为"自动"(-1) → 应显示"费用待定"，备注"时长为自动模式..."
   - 切换分辨率 → 费用应随之变化
   - 切换模型 → 费用应随之变化
   - 修改时长 → 费用应实时更新

## 假设与决策

- **价格精度**：每秒单价保留 2 位小数，总价保留 2 位小数
- **价格时效**：价格为搜索时的刊例价，可能随供应商调价而变化。note 中提示"以 API 返回为准"
- **输入模式**：当前使用文生/图生基准价（不含视频输入），ark 的含视频输入模式 token 单价更低但 token 用量更高，难以准确预估，仅在 note 中提示
- **ark-plan 统一处理**：不逐模型配置价格表，在 `estimateVideoCost` 函数中直接判断 provider === "ark-plan" 返回套餐制提示
- **custom 统一处理**：同理，直接返回"价格未知"
- **分辨率大小写**：`VideoResolution` 类型包含 `"480p"|"720p"|"1080p"|"4k"|"2K"|"720P"|"1080P"` 等多种格式（不同供应商大小写不同），价格表使用模型实际声明的 resolution 值作为 key

## 涉及文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `lib/video-pricing.ts` | **新建** | 价格表 + `estimateVideoCost` 函数 |
| `components/VideoGeneration.tsx` | **修改** | import + 弹框内插入费用显示区块（约 3972 行后） |
