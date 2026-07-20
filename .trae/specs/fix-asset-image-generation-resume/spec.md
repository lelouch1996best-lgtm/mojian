# 修复 Step3 资产图片生成切页恢复 Spec

## Why
Step3（人物/物品/场景设定）中生成图片后，切换到其他页面再切回来时：
- loading 占位丢失（`generatingImageIds` 是 React state，卸载即丢，且无立即恢复机制）
- 没有轮询查图片（恢复 effect 的 `.catch()` 在切页卸载 abort 时把 `imageTaskId` 清空 + 置 `status="failed"`，切回来后无 taskId 可恢复）
- `generateImageForAsset` 未传 AbortSignal，切页后孤儿轮询与恢复轮询竞态

该问题与已修复的故事板生成恢复（VideoGeneration）根因完全一致，需把同样的修复模式应用到 `AssetPreparation.tsx`。

## What Changes
- `components/AssetPreparation.tsx`：
  - 新增组件级 `abortRef`（同步初始化的 AbortController，卸载时 abort），用于取消所有进行中的图片生成轮询
  - 新增 `episodeRef`（始终指向最新 episode），供恢复轮询的异步回调读取最新资产状态做去重/已完成判断
  - 新增「立即恢复 loading 占位」effect：挂载后不等 `imageConfigured`/`imageModels` 异步加载，立即根据 `imageTaskId` 且 `status==="pending"` 的资产恢复 `generatingImageIds`
  - `generateImageForAsset`：向 `generateImage` 传入 `abortRef.current.signal`；catch 中区分 abort（保留 `imageTaskId` 供恢复）与真实失败（清 `imageTaskId` + 置 `failed` + 报错）
  - 重写恢复轮询 effect：run-once 守卫；跳过已完成（已有 `imageUrl`）的资产并清理其残留 `imageTaskId`；使用 `abortRef.current.signal`；catch 中区分 abort（保留 `imageTaskId`）与真实失败（清 `imageTaskId` + 置 `failed`）；COS 转存内联并使用 `isCosConfigured()` 避免 `cosConfigured` 状态闭包过期
  - 移除旧的 `pollAbortRef`、`resumedRef`（被 `abortRef` + run-once 守卫取代）

## Impact
- Affected code: `components/AssetPreparation.tsx`
- 复用已有能力：`lib/image-client.ts` 的 `generateImage(signal)` / `resumeImageGeneration(signal)` / `isPollingSupported`（上一轮故事板修复时已加 signal 支持，无需改动）
- 不影响 Step4 故事板生成恢复（已修复）
- 不改变资产生图的正常（不切页）流程与持久化结构（`Asset.imageTaskId` / `Asset.status` / `Asset.imageUrl` 字段不变）

## ADDED Requirements

### Requirement: 资产图片生成切页恢复
Step3 资产（人物/物品/场景）图片生成过程中，用户切换到其他步骤/页面再切回 Step3 时，系统 SHALL 恢复 loading 占位并继续轮询未完成的图片任务，生成完成后写入 `imageUrl`、置 `status="ready"`、清 `imageTaskId` 并转存 COS。

#### Scenario: 切页后切回，loading 占位立即恢复
- **WHEN** 用户在 Step3 对某资产生成图片（`imageTaskId` 已持久化、`status="pending"`），切换到 Step2/Step4 后再切回 Step3
- **THEN** 组件重新挂载后立即（不等图片 API 配置异步加载）显示该资产的 loading 占位

#### Scenario: 切页后切回，恢复轮询直至完成
- **WHEN** 用户切回 Step3 且图片 API 配置加载完成
- **THEN** 对有 `imageTaskId` 且 `status==="pending"` 且尚未有 `imageUrl` 的资产恢复轮询；轮询成功后写入 `imageUrl`、置 `status="ready"`、清 `imageTaskId` 并转存 COS

#### Scenario: 切页卸载时保留 imageTaskId
- **WHEN** 用户在轮询期间切换页面导致组件卸载
- **THEN** 轮询被取消（abort），但 `imageTaskId` 被保留（不置 `failed`、不清 `imageTaskId`），以便重新挂载后恢复

#### Scenario: 真实失败时清理
- **WHEN** 轮询因 API 错误/超时失败（非 abort）
- **THEN** 置 `status="failed"`、清 `imageTaskId` 并提示错误

#### Scenario: 切页期间已完成则不重复处理
- **WHEN** 切页期间轮询已完成并写入 `imageUrl`，切回后恢复 effect 发现该资产已有 `imageUrl`
- **THEN** 清理残留 `imageTaskId` 并移除 loading 占位，不重复轮询/不重复转存

## MODIFIED Requirements

### Requirement: 单个资产生成图片（generateImageForAsset）
`generateImageForAsset` SHALL 向 `generateImage` 传入组件级 AbortSignal，使切页卸载时取消轮询；catch 中 SHALL 区分 abort（保留 `imageTaskId`）与真实失败（清 `imageTaskId` + 置 `failed` + 报错）。其余行为（`onJobCreated` 持久化 jobId、成功后写 `imageUrl`/`ready`/清 `imageTaskId`、转存 COS）不变。
