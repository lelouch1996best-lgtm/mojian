# 新增截取视频尾帧为截屏资产

## Summary

在第四步「视频生成」卡片的视频预览区，紧邻「下载视频」按钮新增「截取尾帧」按钮。点击后，前端使用 HTML5 `<video>` + `<canvas>` 截取当前镜头视频的末尾帧，上传至 COS，并以新的资产类型 **截屏（screenshot）** 保存到当前剧集的资产列表中。资产库同步增加「截屏」实体类型筛选。

## Current State Analysis

- **视频预览与下载按钮**：`components/VideoGeneration.tsx` 的 `VideoCard` 组件中，`isVideoReady` 分支渲染 `<video>` 与「下载视频」链接（第 1243–1267 行）。红色框目标位置即在该区域。
- **资产类型定义**：`lib/types.ts` 第 188 行定义 `AssetType = "character" | "scene" | "object"`，`AssetLibraryItem.entityType` 也不包含截图类型。
- **资产库聚合**：`app/api/data/assets/route.ts` 从 `series` / `episodes` 表聚合资产，仅展示 `status === "ready"` 且 `imageUrl` 非空的 `episode.assets` 项。
- **资产库前端筛选**：`components/AssetLibrary.tsx` 使用 `EntityTypeFilter` 与 `ENTITY_TYPE_OPTIONS` 控制类型筛选，并依赖 `lib/utils.ts` 的 `ASSET_TYPE_LABELS` 显示中文标签。
- **COS 上传能力**：`lib/cos-client.ts` 已提供 `uploadRefBase64(base64, nameHint)`，可将 base64 PNG 上传并返回公网 URL。
- **Episode 持久化**：`app/episode/[id]/page.tsx` 通过 `update(mut)` 修改 episode 状态，并防抖调用 `saveEpisode(ep)` 落库。

## Proposed Changes

### 1. `lib/types.ts`

- 扩展 `AssetType` 定义：
  ```ts
  export type AssetType = "character" | "scene" | "object" | "screenshot";
  ```
- 扩展 `AssetLibraryItem.entityType` 定义：
  ```ts
  entityType: "character" | "scene" | "object" | "shot" | "screenshot";
  ```

### 2. `lib/utils.ts`

- `ASSET_TYPE_LABELS` 增加截屏中文标签：
  ```ts
  export const ASSET_TYPE_LABELS: Record<string, string> = {
    character: "人物",
    scene: "场景",
    object: "物品",
    screenshot: "截屏",
  };
  ```
- `normalizeAssetType` 兼容 `screenshot` 及中文 `"截屏"`：
  ```ts
  if (t === "screenshot" || t === "截屏") return "screenshot";
  ```

### 3. `app/api/data/assets/route.ts`

- 在聚合 `episode.assets` 时，将 `type === "screenshot"` 的资产透传为 `entityType: "screenshot"`：
  ```ts
  entityType: a.type === "scene" ? "scene" : a.type === "object" ? "object" : a.type === "screenshot" ? "screenshot" : "character",
  ```

### 4. `components/AssetLibrary.tsx`

- `EntityTypeFilter` 扩展为 `"all" | "character" | "scene" | "object" | "screenshot"`。
- `ENTITY_TYPE_OPTIONS` 新增 `{ value: "screenshot", label: "截屏" }`。
- `entityTypeLabel` 已回退到 `ASSET_TYPE_LABELS`，无需额外改动即可显示「截屏」。

### 5. `components/VideoGeneration.tsx`

#### 新增状态

- `capturingIds: Set<string>`：记录正在截取尾帧的镜头 ID，用于按钮 loading。
- `savedIds: Set<string>`：记录刚刚保存成功的镜头 ID，用于按钮短暂显示「已保存到资产库」。

#### 新增 `captureLastFrame` 函数（在 `VideoGeneration` 组件内）

```ts
async function captureLastFrame(shot: Shot, index: number) {
  if (!(await isCosConfigured())) {
    setError("请先配置 COS 存储，再截取尾帧");
    return;
  }
  setCapturingIds((prev) => new Set(prev).add(shot.id));
  setError(null);

  try {
    const base64 = await extractVideoLastFrame(shot.videoUrl);
    const name = `${episode.title || "未命名剧集"}-镜头${index + 1}-尾帧`;
    const url = await uploadRefBase64(base64, `screenshot-${shot.id}`);

    const asset: Asset = {
      ...emptyAsset(name, "screenshot"),
      imageUrl: url,
      status: "ready",
      description: `视频尾帧截图：${shot.visualDescription || ""}`.trim(),
      imagePrompt: `视频尾帧截图：${shot.visualDescription || ""}`.trim(),
    };

    onAddScreenshot(asset);
    setSavedIds((prev) => new Set(prev).add(shot.id));
    setTimeout(() => {
      setSavedIds((prev) => {
        const next = new Set(prev);
        next.delete(shot.id);
        return next;
      });
    }, 2000);
  } catch (e) {
    setError(`截取尾帧失败：${(e as Error).message}`);
  } finally {
    setCapturingIds((prev) => {
      const next = new Set(prev);
      next.delete(shot.id);
      return next;
    });
  }
}
```

#### 新增 `extractVideoLastFrame` 辅助函数

```ts
function extractVideoLastFrame(videoUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      if (!video.duration || !isFinite(video.duration)) {
        reject(new Error("无法获取视频时长"));
        return;
      }
      // 规避精确结尾可能出现的黑帧
      video.currentTime = Math.max(0, video.duration - 0.1);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1920;
        canvas.height = video.videoHeight || 1080;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("创建 canvas 失败"));
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png");
        resolve(dataUrl);
      } catch (err) {
        reject(err);
      }
    };

    video.onerror = () => reject(new Error("视频加载失败"));
  });
}
```

#### `VideoCard` 组件改动

- Props 增加 `onCaptureScreenshot: () => void` 与 `isCapturing: boolean`、`isSaved: boolean`。
- 在「下载视频」按钮右侧新增「截取尾帧」按钮，风格保持一致：
  - `isCapturing` 为 true 时显示 loading 图标与「截取中…」。
  - `isSaved` 为 true 时显示「已保存到资产库」。
  - 否则显示截屏图标与「截取尾帧」。

#### 调用处改动

- 渲染 `VideoCard` 时传入：
  ```ts
  onCaptureScreenshot={() => captureLastFrame(shot, i + 1)}
  isCapturing={capturingIds.has(shot.id)}
  isSaved={savedIds.has(shot.id)}
  ```

### 6. `app/episode/[id]/page.tsx`

- 新增处理函数：
  ```ts
  function handleAddScreenshot(asset: Asset) {
    update((ep) => ({ ...ep, assets: [...ep.assets, asset] }));
  }
  ```
- 将 `onAddScreenshot={handleAddScreenshot}` 作为 prop 传给 `<VideoGeneration />`。

### 7. `components/VideoGeneration.tsx` Props 扩展

- `VideoGenerationProps` 增加：
  ```ts
  onAddScreenshot: (asset: Asset) => void;
  ```

## Assumptions & Decisions

- **截屏位置**：seek 到 `duration - 0.1s`，避免某些解码器在精确结尾返回黑帧。
- **输出格式**：固定 PNG，与现有图片资产保持一致。
- **命名格式**：`{episode.title || "未命名剧集"}-镜头{index + 1}-尾帧`。
- **持久化位置**：作为 `episode.assets` 数组的一项保存，走现有 `saveEpisode` 防抖逻辑，无需新增 API。
- **关联关系**：截屏资产不自动关联到当前镜头，用户可在资产库中浏览使用。
- **错误提示**：复用组件内现有的 `setError` 错误横幅。
- **成功反馈**：按钮本身短暂显示「已保存到资产库」，2 秒后恢复，不引入额外 toast 组件。

## Verification Steps

1. 进入某剧集第四步，生成或上传一个视频后，视频下方出现「截取尾帧」按钮，与「下载视频」并排。
2. 点击「截取尾帧」：
   - 按钮先变为「截取中…」。
   - 完成后短暂显示「已保存到资产库」，随后恢复。
3. 进入「资产库」页面：
   - 类型筛选中出现「截屏」选项。
   - 选择「截屏」后能看到刚保存的图片，卡片标签显示「截屏」。
4. 未配置 COS 时点击「截取尾帧」，顶部错误横幅提示需要先配置 COS。
5. 运行项目类型检查与 lint（如 `npm run typecheck`、`npm run lint`），确保无新增错误。
