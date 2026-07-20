# 视频生成任务在刷新/切页后恢复

## Summary

生成视频是异步任务（1-5 分钟），目前轮询循环存活在 `VideoGeneration` 组件闭包内，刷新页面或切换步骤后轮询被销毁，而 `videoStatus: "running"` + `videoTaskId` 已持久化到 SQLite，却没有任何代码在重新进入时恢复轮询——导致镜头卡片永久卡在"生成中"、生成按钮被禁用、结果视频 URL 永远取不回。

本方案在 `VideoGeneration` 挂载时扫描未完成的视频任务并恢复轮询，同时为轮询加入 `AbortController` 取消机制，使切换步骤时干净地终止轮询、再次进入时无重复地恢复。

**范围（已与用户确认）**：仅做视频任务恢复。图片生成保持现状（同步调用、无 taskId，刷新后回退为"未生成"可手动重生成，不改）。

---

## Current State Analysis

- 视频生成流程：[VideoGeneration.tsx#L253-L371](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L253-L371) `generateVideo()` → `createVideoTask()` 拿到 `taskId` → `pollVideoTask()` 每 10s 轮询、超时 10min。
- `videoStatus` / `videoTaskId` / `videoUrl` 通过 [EpisodePage](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/%5Bid%5D/page.tsx#L60-L78) 的防抖（400ms）保存 + [beforeunload 兜底](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/%5Bid%5D/page.tsx#L81-L97) 持久化到 SQLite。**taskId 已被持久化**。
- `pollVideoTask` 定义于 [lib/video-client.ts#L278-L294](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts#L278-L294)，是纯 `while`+`setTimeout`，**无取消机制**。
- `videoGeneratingIds`（本地 `Set`，控制 spinner）不持久化，刷新即丢。
- **核心缺口**：没有任何 `useEffect` 在挂载时扫描 `videoStatus === "queued"|"running"` 且有 `videoTaskId` 的镜头并恢复轮询。
- 切换步骤（Step4↔Step3）只是 `currentStep` 条件渲染，`VideoGeneration` 卸载会杀死闭包内的轮询；但因 `EpisodePage` 不卸载，孤儿轮询其实仍在后台跑（闭包未销毁），这与"恢复"叠加会产生重复轮询——需用 abort 解决。

---

## Proposed Changes

### 1. `lib/video-client.ts` — 为轮询加入可取消能力

**`queryVideoTask(taskId, signal?)`** ([L243](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts#L243))
- 新增可选参数 `signal?: AbortSignal`，传入 `fetch("/api/video/query", { ..., signal })`。
- 被取消时 `fetch` 抛 `AbortError`，向上抛出（由调用方捕获）。

**`pollVideoTask(taskId, onUpdate, intervalMs, timeoutMs, signal?)`** ([L278](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts#L278-L294))
- 新增可选参数 `signal?: AbortSignal`。
- 循环顶部、`onUpdate` 之后、等待前各检查 `signal?.aborted`，若已取消则 `return { status: "expired", error: "已取消" }`。
- 等待 `setTimeout` 处用 `signal?.addEventListener("abort", ...)` 提前 `clearTimeout` 并 resolve，避免卸载后仍空等一个间隔。
- `signal` 为 `undefined` 时行为与原来完全一致（向后兼容）。

### 2. `components/VideoGeneration.tsx` — 恢复轮询 + 卸载取消

**(a) 组件级 AbortController**
- 新增 `const abortRef = useRef<AbortController | null>(null)`。
- 新增 `useEffect`：挂载时 `abortRef.current = new AbortController()`，清理函数 `return () => abortRef.current?.abort()`。卸载（切步骤/路由离开/刷新）即取消所有进行中的轮询。

**(b) 抽取共享的轮询+收尾函数 `pollAndFinalize`**
- 从 `generateVideo` 的轮询段（[L338-L360](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L338-L360)）抽取：
  ```ts
  async function pollAndFinalize(shot: Shot, taskId: string, signal: AbortSignal, opts?: { silent?: boolean })
  ```
- 逻辑：`try { const final = await pollVideoTask(taskId, onUpdate, 10000, 10*60*1000, signal); if (signal.aborted) return; succeeded→onUpdateShot(videoUrl)+onUpdateVideoStatus(succeeded)+transferVideoToCos；否则 onUpdateVideoStatus(expired|failed)，非 silent 时 setError } catch { if (signal.aborted) return; onUpdateVideoStatus(failed)，非 silent 时 setError }`。
- `onUpdate` 回调仅在中转状态 `queued|running` 时更新状态（与现有一致）。
- **被 abort 时直接 return，不改动 `videoStatus`**（任务上游仍在跑，保留 `running` 供下次恢复）。

**(c) `generateVideo` 改用 `pollAndFinalize`**
- 将内联的 `pollVideoTask` + 成功/失败分支替换为 `await pollAndFinalize(shot, createResult.taskId, abortRef.current!.signal)`。
- `generateVideo` 的 `try/catch/finally` 保留：`catch` 只负责 `createVideoTask`/构造 content 阶段的错误（`pollAndFinalize` 内部已自行捕获轮询错误，不会再向上抛）；`finally` 仍从 `videoGeneratingIds` 删除。

**(d) 挂载时恢复未完成任务（核心）**
- 新增 `const didResumeRef = useRef(false)`。
- 新增 `useEffect`（依赖 `videoConfigured`，配合 `eslint-disable` 兼容 exhaustive-deps，参照 [L185](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx#L185) 既有写法）：
  ```ts
  useEffect(() => {
    if (didResumeRef.current) return;
    if (!videoConfigured || !abortRef.current) return; // 等到确认视频 API 已配置
    didResumeRef.current = true;
    const signal = abortRef.current.signal;
    for (const shot of episode.shots) {
      if (shot.videoStatus === "queued" || shot.videoStatus === "running") {
        if (shot.videoTaskId) {
          setVideoGeneratingIds(prev => new Set(prev).add(shot.id));
          pollAndFinalize(shot, shot.videoTaskId, signal, { silent: true })
            .finally(() => setVideoGeneratingIds(prev => { const n = new Set(prev); n.delete(shot.id); return n; }));
        } else {
          onUpdateVideoStatus(shot.id, "idle"); // 任务从未创建/taskId 丢失 → 重置为未生成，允许重新生成
        }
      }
    }
  }, [videoConfigured]);
  ```
- `silent: true`：后台恢复不弹错误横幅，仅靠状态徽章反馈（用户未主动触发，避免打扰）。
- 并发恢复多个镜头是安全的（查询为轻量状态轮询，各自独立自终止）。

---

## 边界情况处理

| 场景 | 行为 |
|---|---|
| 刷新时正在轮询 | taskId 已持久化 → 重新挂载 → resume 轮询 → 成功则存 `videoUrl`+转存 COS；失败/超时则更新状态 |
| 切换 Step4→Step3→Step4 | 卸载 abort 旧轮询 → 重新挂载 resume（无重复轮询） |
| 离开剧集路由再返回 | `EpisodePage` 重挂载 → `VideoGeneration` 重挂载 → resume |
| 上游任务在离开期间已完成 | resume 首次查询即返回 `succeeded` → 立即存 URL |
| `queued`/`running` 但无 `videoTaskId`（刷新发生在设状态与建任务之间） | 重置为 `idle`，允许重新生成 |
| taskId 失效/上游已过期 | 查询报错或返回 `failed`/`expired` → 设为 `failed`/`expired`，按钮恢复可点 |
| 视频 API 未配置 | `videoConfigured` 为 false，resume 不执行（也无法查询），保留原状 |
| COS 未配置 | `transferVideoToCos` 内部已早返回，保留 Seedance 原始 URL（24h）—— 既有行为不变 |

---

## Assumptions & Decisions

1. **仅视频恢复**：用户确认图片保持现状，不动。
2. **恢复逻辑置于 `VideoGeneration` 组件内**（用户选定）：用户进入第四步时恢复；若刷新时停留在其他步骤，恢复会延迟到再次进入第四步——但任务不会丢失（上游仍在跑，taskId 已持久化）。
3. **采用 AbortController 卸载取消**：非用户显式选择，但为实现"无重复轮询"的必要工程措施（切步骤会触发卸载→重挂载，不加 abort 会产生孤儿+resume 重复轮询）。
4. **被 abort 时不改 `videoStatus`**：保留 `running`，交由下次挂载 resume；避免误判为失败。
5. **无 `videoTaskId` 的残留 `queued`/`running` 重置为 `idle`**（而非 `failed`）：该状态等同于"未生成"，按钮恢复可用，无失败心理负担。
6. **resume 静默**：不弹错误横幅；状态徽章足以反馈。
7. **不改 `beforeunload`/防抖保存**：taskId 已能可靠持久化（同步 `setEpisode` 批量写入 + 400ms 防抖 + beforeunload 兜底）。
8. **不动 `cancelVideo`**：手动取消不中断轮询是既有行为，超出本次范围。

---

## 验证步骤

1. **类型检查**：`npx tsc --noEmit`（项目无独立 lint/typecheck 脚本，`tsc` 走 tsconfig；亦可用 `npm run build` 做完整类型+构建检查）。
2. **手动测试**（`npm run dev` 或 `npm run electron:dev`）：
   - 生成一个镜头视频，**轮询中刷新页面** → 重新进入第四步，卡片应自动恢复"生成中"并最终显示视频（验证成功路径 + COS 转存）。
   - 生成视频，**切换到第三步再切回第四步** → 无重复轮询、无报错、恢复正常（验证 abort+resume）。
   - 生成视频后等上游成功，**再刷新** → 进入第四步应几乎立即显示已完成视频。
   - 构造无 taskId 的 `running` 残留（如手动改库）→ 进入第四步应重置为"未生成"，按钮可用。
   - taskId 失效场景 → 进入第四步应显示"失败"，可重新生成。
3. **回归**：正常生成视频（不刷新）全流程仍正常；批量生成视频仍顺序执行。
