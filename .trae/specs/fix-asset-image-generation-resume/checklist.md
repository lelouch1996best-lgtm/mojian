# Checklist

- [x] `AssetPreparation.tsx` 存在组件级 `abortRef`（同步初始化），卸载时 `abort()` 取消所有轮询
- [x] `AssetPreparation.tsx` 存在 `episodeRef`，每渲染同步指向最新 `episode`
- [x] 旧的 `pollAbortRef`、`resumedRef` 已移除
- [x] 存在「立即恢复 loading 占位」effect：挂载后立即根据 `imageTaskId && status==="pending"` 恢复 `generatingImageIds`，不等 `imageConfigured`/`imageModels` 异步加载
- [x] `generateImageForAsset` 调用 `generateImage` 时传入了 `abortRef.current?.signal`
- [x] `generateImageForAsset` 的 catch 区分 abort（保留 `imageTaskId`/不置 `failed`）与真实失败（置 `failed` + 清 `imageTaskId` + 报错）
- [x] 恢复轮询 effect 有 run-once 守卫，依赖 `[imageConfigured, imageModels]`
- [x] 恢复轮询 effect 跳过已有 `imageUrl` 的资产，并清理其残留 `imageTaskId` 与占位
- [x] 恢复轮询 effect 使用 `abortRef.current?.signal` 调用 `resumeImageGeneration`
- [x] 恢复轮询 effect 的 `.then` 写入 `imageUrl`/`status="ready"`/清 `imageTaskId` 并内联 COS 转存（用 `isCosConfigured()` 而非 `cosConfigured` 状态）；并用 `episodeRef` 做去重判断
- [x] 恢复轮询 effect 的 `.catch` 区分 abort（保留 `imageTaskId`）与真实失败（置 `failed` + 清 `imageTaskId`）
- [x] 恢复轮询 effect 的 `.finally` 从 `generatingImageIds` 移除该资产 id
- [x] `npx tsc --noEmit` 通过，无类型错误
- [x] 正常（不切页）生图流程未受影响：生成->写 imageUrl->ready->清 taskId->转存 COS
