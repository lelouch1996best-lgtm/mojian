# Tasks

- [x] Task 1: 在 `AssetPreparation.tsx` 新增组件级 `abortRef` 与 `episodeRef`
  - [x] SubTask 1.1: 新增 `abortRef`（同步初始化 `new AbortController()`，卸载时 `abort()`），取代旧的 `pollAbortRef`
  - [x] SubTask 1.2: 新增 `episodeRef`（`useRef(episode)`，每渲染同步赋值 `episodeRef.current = episode`），供恢复轮询异步回调读取最新资产状态
  - [x] SubTask 1.3: 移除旧的 `pollAbortRef`、`resumedRef` 声明

- [x] Task 2: 新增「立即恢复 loading 占位」effect
  - [x] SubTask 2.1: 新增 `didRestoreLoading` ref（run-once 守卫）
  - [x] SubTask 2.2: effect 依赖 `[episode.assets]`，首次运行时筛出 `imageTaskId && status === "pending"` 的资产 id，加入 `generatingImageIds`，使挂载后立即显示占位（不等 `imageConfigured`/`imageModels` 异步加载）

- [x] Task 3: 更新 `generateImageForAsset` 传入 signal 并做 abort 感知
  - [x] SubTask 3.1: 调用 `generateImage` 时传入 `abortRef.current?.signal` 作为第 6 个参数
  - [x] SubTask 3.2: catch 中判断 `isAborted`（`abortRef.current?.signal.aborted` 或 `AbortError` 或 `已取消`），abort 时不清 `imageTaskId`/不置 `failed`；真实失败时维持原行为（置 `failed` + 清 `imageTaskId` + `setError`）

- [x] Task 4: 重写恢复轮询 effect
  - [x] SubTask 4.1: 新增 `resumeRef`（run-once 守卫），依赖 `[imageConfigured, imageModels]`；移除旧 effect 体与 `return () => ac.abort()` cleanup（改由 `abortRef` 统一 abort）
  - [x] SubTask 4.2: 遍历 `episode.assets`，跳过非 `pending` / 无 `imageTaskId` 的资产；对已有 `imageUrl` 的资产清理残留 `imageTaskId` 并移除 `generatingImageIds` 占位后 continue
  - [x] SubTask 4.3: 对支持轮询的模型（`isPollingSupported`）调用 `resumeImageGeneration(asset.imageTaskId, undefined, abortRef.current?.signal)`
  - [x] SubTask 4.4: `.then` 中写 `imageUrl`/`status="ready"`/清 `imageTaskId`，并内联 COS 转存（使用 `isCosConfigured()` + `getCosSettings()` 避免 `cosConfigured` 状态闭包过期）；并用 `episodeRef` 做去重判断，避免覆盖已写入的 imageUrl
  - [x] SubTask 4.5: `.catch` 中判断 `isAborted`，abort 时保留 `imageTaskId`；真实失败时置 `failed` + 清 `imageTaskId`
  - [x] SubTask 4.6: `.finally` 中从 `generatingImageIds` 移除该资产 id

- [x] Task 5: 类型检查与回归验证
  - [x] SubTask 5.1: 运行 `npx tsc --noEmit` 确保无类型错误（exit 0，无输出）
  - [x] SubTask 5.2: 人工核对正常（不切页）生图流程未受影响：生成->写 imageUrl->ready->清 taskId->转存 COS（`generateImageForAsset` 成功路径与 `transferImageToCos` 未改动）

# Task Dependencies
- Task 2、Task 3、Task 4 均依赖 Task 1（`abortRef`/`episodeRef`）
- Task 5 依赖 Task 1–4 全部完成
