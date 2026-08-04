# API Key 批量填充功能 实施计划

## 摘要

在 API 设置页（`app/settings/page.tsx`）顶部新增一个「API Key 批量管理」折叠区域。用户输入一个 API Key 后点击「一键填充所有供应商」按钮，经二次确认后，将该 Key 覆盖填充到下方 5 个分类（对话 / 图片 / 视频 / 音频 / 音乐）下**所有供应商**的 `apiKey` 字段，并同步更新各自的 `*_provider_keys` 缓存落盘，确保切换供应商后仍生效。

---

## 当前状态分析

### 现有架构（基于探索）

- 设置页 `app/settings/page.tsx`（2487 行）为单文件客户端组件，含 6 个 `fieldset` 折叠区域：LLM、图片、视频、音频、音乐、COS。顶部为 header（第 958-979 行），内容容器从第 981 行 `<div className="space-y-4">` 开始，首个区域为 LLM（第 982 行起）。
- 每类 API 各自维护：
  - 一份当前配置（LLM 用独立 state `provider/baseURL/apiKey/model`；图片/视频/音频/音乐 用 `xxxSettings` 对象 + `updateXxx`/`setXxxSettings`）。
  - 一份 `ProviderCache`（`providerKeys` / `imgProviderKeys` / `videoProviderKeys` / `audioProviderKeys` / `musicProviderKeys`），存各 provider 的 `{apiKey, baseURL, model}`。
  - 一个 `persistXxx` 防抖函数（第 848-906 行），由 state 变化触发自动保存到 `settings` 表主键 + `*_provider_keys` 缓存。
- 缓存落盘函数：`saveProviderKey` / `saveImageProviderKey` / `saveVideoProviderKey` / `saveAudioProviderKey` / `saveMusicProviderKey`，签名均为 `(provider, {apiKey, baseURL, model?})`。
- 供应商清单常量：`PROVIDER_PRESETS`、`IMAGE_PROVIDER_PRESETS`、`VIDEO_PROVIDER_PRESETS`、`AUDIO_PROVIDER_PRESETS`、`MUSIC_PROVIDER_PRESETS`（含 `custom` 兜底项）。
- 已有「初始化默认配置」按钮（如 `handleInitLLMProvider` 第 394-418 行）展示了「弹确认框 + 批量 set 多个字段 + 调用多个 save 函数 + 更新缓存」的完整范式，可直接参考。
- 鉴权/存储：SQLite `settings` 表（key-value，JSON 字符串），通过 `lib/api-client.ts` 的 `saveSetting` 读写，请求带 `Authorization: Bearer` 头。
- 无 localStorage、无外部配置文件；无现成批量填充功能。

### state 命名确认（grep 结果）

| 分类 | 当前配置 state | 缓存 state | 缓存保存函数 |
|---|---|---|---|
| LLM | `provider`/`baseURL`/`apiKey`/`model` + 各自 setter | `providerKeys`/`setProviderKeys` | `saveProviderKey` |
| 图片 | `imgSettings`/`setImgSettings` + `updateImg` | `imgProviderKeys`（需在实施时确认 setter 名，预期 `setImgProviderKeys`） | `saveImageProviderKey` |
| 视频 | `vidSettings`/`setVidSettings` | `videoProviderKeys`/`setVideoProviderKeys` | `saveVideoProviderKey` |
| 音频 | `audSettings`/`setAudSettings` | `audioProviderKeys`/`setAudioProviderKeys` | `saveAudioProviderKey` |
| 音乐 | `musSettings`/`setMusSettings` | `musicProviderKeys`/`setMusicProviderKeys` | `saveMusicProviderKey` |

> 注：图片缓存 setter 在 grep 中未直接出现，实施时需以 `imgProviderKeys` 的 `useState` 定义处（约第 125 行附近）确认；若命名不同需同步调整。

---

## 提议变更

### 仅修改一个文件：`c:\code\mojian\app\settings\page.tsx`

#### 变更 1：新增 state（约第 176 行 `musicModels` 定义之后）

```tsx
const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
const [bulkApiKey, setBulkApiKey] = useState("");
const [bulkBusy, setBulkBusy] = useState(false);
```

#### 变更 2：新增 handler `handleBulkFillApiKeys`

位置：放在 `handleInitMusicProvider`（约第 766-785 行）之后、`persistLlm`（第 848 行）之前的函数定义区。

逻辑：
1. 校验 `bulkApiKey.trim()` 非空，否则 `return`。
2. 调用 `await confirm({ message: "确定将此 API Key 覆盖填充到下方所有分类的全部供应商吗？此操作会覆盖每个供应商现有的 API Key，不可撤销。", confirmText: "覆盖填充" })`，取消则 `return`。
3. `setBulkBusy(true)`，包 `try/finally`。
4. **LLM**：
   - `setApiKey(bulkApiKey)` —— 触发 `persistLlm` 防抖自动保存主配置。
   - 遍历 `Object.keys(PROVIDER_PRESETS)`，对每个 `p`：取 `providerKeys[p]` 缓存，`baseURL` 缺省回退 `p !== "custom" ? PROVIDER_PRESETS[p].baseURL : ""`，`model` 同理回退 `PROVIDER_PRESETS[p].model`；构造 entry `{apiKey: bulkApiKey, baseURL, model}`；`await saveProviderKey(p, entry)`；写入 `newLlmKeys[p] = entry`。
   - `setProviderKeys(newLlmKeys)`。
5. **图片**：
   - `setImgSettings((prev) => ({ ...prev, apiKey: bulkApiKey }))` —— 触发 `persistImg`。
   - 遍历 `IMAGE_PROVIDER_PRESETS`，同样合并缓存/预设（注意图片预设结构含 `baseURL`/`model`），调用 `saveImageProviderKey(p, {apiKey: bulkApiKey, baseURL, model})`。
   - `setImgProviderKeys(newImgKeys)`（以实际 setter 名为准）。
6. **视频 / 音频 / 音乐**：与图片同理，分别遍历 `VIDEO_PROVIDER_PRESETS` / `AUDIO_PROVIDER_PRESETS` / `MUSIC_PROVIDER_PRESETS`，调用对应 `saveXxxProviderKey`，更新 `setVideoProviderKeys` / `setAudioProviderKeys` / `setMusicProviderKeys`。视频/音频/音乐的缓存 entry 只需 `{apiKey, baseURL}`（参考第 549/643/720 行现有写法，不含 model）。
7. `showSavedHint()`（复用现有已保存提示）。
8. `finally: setBulkBusy(false)`。

> 关键点：只覆盖 `apiKey`，`baseURL`/`model` 保留各供应商缓存或预设值，避免破坏现有配置。`custom` 供应商也纳入填充（其预设 baseURL/model 为空，按缓存回退）。

#### 变更 3：新增 UI 折叠区域

位置：第 981 行 `<div className="space-y-4">` 之后、第 982 行 LLM 区域 `fieldset` 之前。

结构完全参考现有 fieldset 折叠模式（如 LLM 区域第 983-1004 行的 legend + 折叠箭头 + 标题 + 状态徽章），样式保持一致：

```tsx
{/* ========= API Key 批量管理 ========= */}
<fieldset className={`rounded-xl border transition-colors ${bulkPanelOpen ? "border-brand-200" : "border-slate-200"}`}>
  <legend className="px-2">
    <button
      onClick={() => setBulkPanelOpen(!bulkPanelOpen)}
      className="flex items-center gap-1.5 text-sm font-semibold transition-colors"
      style={{ color: bulkPanelOpen ? "#D97706" : "#57534E" }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        className={`transition-transform ${bulkPanelOpen ? "rotate-90" : ""}`}>
        <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      API Key 批量管理
    </button>
  </legend>

  {bulkPanelOpen && (
    <div className="space-y-3 p-4">
      <p className="text-xs text-slate-500">
        在此输入一个 API Key，点击下方按钮可将它覆盖填充到所有分类（对话 / 图片 / 视频 / 音频 / 音乐）的全部供应商。各供应商的 baseURL 与模型配置不会被改动。
      </p>
      <Field label="统一 API Key">
        <input
          type="password"
          value={bulkApiKey}
          onChange={(e) => setBulkApiKey(e.target.value)}
          placeholder="输入要批量填充的 API Key..."
          className="input"
          autoComplete="off"
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={handleBulkFillApiKeys}
          disabled={bulkBusy || !bulkApiKey.trim()}
        >
          {bulkBusy ? "填充中…" : "一键填充所有供应商"}
        </Button>
      </div>
    </div>
  )}
</fieldset>
```

复用现有 `Field` 组件（页面内已定义）与 `Button`（已 import）。

---

## 假设与决策

1. **填充范围**：所有 5 个分类的所有供应商（含 `custom`）。用户跳过了范围澄清问题，采用最直接的「一键全填」语义。
2. **前缀校验**：不校验，直接填充（用户跳过该问题，默认最简行为）。不同供应商 key 前缀不同（如 `sk-`/`ark-`/`tp-`），统一填充同一 key 在跨供应商场景下通常无意义，但这是用户显式选择的操作，由用户自行负责。
3. **确认机制**：二次确认弹框（覆盖操作有破坏性，参考「初始化默认配置」均有确认框的惯例）。
4. **保存机制**：复用现有 `persistXxx` 防抖自动保存（仅修改当前 provider 的 state 即可触发），同时主动调用 `saveXxxProviderKey` 落盘所有 provider 的缓存，确保切换供应商后立即生效。
5. **UI 位置**：顶部新增独立折叠区域，置于 LLM 区域之前，作为「全局工具」语义最清晰。
6. **不改动后端**：复用现有 `app/api/settings/[key]/route.ts` PUT 接口与 `saveXxxProviderKey` 客户端封装，无需新增 API 路由。
7. **不动 `image_tasks` 表**：该表存的 `api_key` 是任务创建时的快照，仅影响已创建的历史任务轮询，不在本次批量填充范围内。

---

## 验证步骤

1. `npm run dev` 启动开发服务器，打开设置页。
2. 展开新「API Key 批量管理」区域，输入任意测试 Key（如 `sk-test-bulk-123`），点击「一键填充所有供应商」。
3. 确认弹框出现 → 点「覆盖填充」。
4. 逐一展开下方 5 个分类，检查：
   - 当前选中供应商的 API Key 输入框值已变为 `sk-test-bulk-123`。
   - 切换到该分类下其他供应商，API Key 也已是 `sk-test-bulk-123`（验证缓存落盘）。
   - baseURL 与模型字段保持原值未被改动。
5. 刷新页面，重新进入设置页，确认所有供应商的 API Key 仍为 `sk-test-bulk-123`（验证持久化）。
6. 浏览器 DevTools Network：确认触发了对 `/settings/llm`、`/settings/image`、`/settings/video`、`/settings/audio`、`/settings/music` 及各 `*_provider_keys` 的 PUT 请求。
7. 空输入时按钮 disabled，无法点击。
8. 点确认框「取消」不执行任何修改。
9. 回归测试：手动修改单个供应商的 Key 后等待自动保存，刷新后该供应商 Key 为新值，其他供应商仍为批量值。
