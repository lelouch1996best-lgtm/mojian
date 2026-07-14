# 视频卡片输入素材区按生成模式动态重构

## 摘要

重构 `VideoCard`（`components/VideoGeneration.tsx`）的模块布局与输入素材区，使其根据「模型能力矩阵 + 当前生成模式」动态展示：

1. **视频参数与视频提示词模块互换位置**（参数在前、提示词在后）。
2. **首帧/首尾帧图片上传、参考视频/参考音频上传从「视频参数」折叠面板移出**，放到关联资产下方的独立「输入素材」区块。
3. **关联资产区块按模式动态显示**：多模态参考模式显示参考图；首帧/首尾帧模式隐藏资产并提示「首帧或首尾帧模式不可与多模态混用」；文生视频模式整区隐藏。
4. **文生视频模式下输入素材区为空**（什么也不显示）。
5. **切换模式时仅隐藏不适用的素材、保留数据**（不自动清空）。

仅改动 `components/VideoGeneration.tsx` 一个文件，不涉及类型/API/逻辑层。

---

## 当前状态分析（基于探索）

### 当前 VideoCard 纵向布局
1. 卡片头 L716-743
2. 视频预览区 L746-777
3. 画面描述 L779-785
4. 关联资产（参考图）L787-835 — **始终显示**，内容随 `relatedAssets` 变化
5. 视频提示词 L837-867
6. 视频参数（可折叠）L869-1149 — 内含模型/模式/分辨率等参数，**以及**按 mode 的上传区块 L1034-1146
7. 操作 L1151-1173

### 现有问题
- 首帧/首尾帧/参考视频/参考音频上传都埋在「视频参数」折叠面板最底部（L1034-1146），必须展开面板且选中对应模式才能看到，发现性差。
- 关联资产在所有模式都显示，但首帧/首尾帧模式并不使用多模态参考资产，容易误以为资产会被用作参考图。
- 文生视频模式仍显示关联资产，但实际不需要任何素材。

### 模型能力矩阵（`lib/model-presets.ts` `VIDEO_MODEL_CAPABILITIES` L247-332）
| 模型 | 支持的 modes |
|---|---|
| 2.0 / 2.0 fast / 2.0 mini | text2video, first-frame, first-last-frame, multimodal-ref |
| 1.5 pro / 1.0 pro | text2video, first-frame, first-last-frame |
| 1.0 pro fast | text2video, first-frame |

模式下拉框已按 `cap.modes` 过滤（L900-907），因此输入素材区**只需对 `config.mode` 反应**即可自然遵循模型能力矩阵，无需额外判断模型字段。

---

## 目标布局（重构后）

VideoCard 从上到下：

1. 卡片头
2. 视频预览区
3. 画面描述
4. **关联资产区块**（按模式动态）
5. **输入素材区块**（按模式动态，模式专属上传）
6. **视频参数**（纯参数，无上传）← 与提示词互换，现在在前
7. **视频提示词** ← 现在在后
8. 操作

### 区块 4 · 关联资产区块（按模式）

| mode | 表现 |
|---|---|
| `multimodal-ref` | 显示现有「🔗 关联资产（参考图）」资产网格（L787-835 内容原样保留） |
| `first-frame` / `first-last-frame` | 隐藏资产网格，显示提示：`⚠ 首帧或首尾帧模式不可与多模态混用`（amber 小字） |
| `text2video` | 整块不渲染 |

### 区块 5 · 输入素材区块（按模式，位于关联资产下方）

| mode | 内容 |
|---|---|
| `multimodal-ref` | 参考图素材（asset:// chips + 添加素材ID）+ 参考视频（上传/素材ID，0/3）+ 参考音频（上传/素材ID，0/3）+ asset:// 内联输入框 |
| `first-frame` | 首帧图片上传（`FrameImageUpload`） |
| `first-last-frame` | 首帧图片 + 尾帧图片（2 列 grid） |
| `text2video` | 不渲染 |

### 区块 6 · 视频参数（精简）

移除原 L1034-1146 的按 mode 上传区块，仅保留：
- 摘要条（模型名 + 模式徽章 + 分辨率/时长，L871-887）
- 模型/生成模式/分辨率/宽高比/时长 grid（L891-949）
- 水印/有声/风格模板复选框（L951-981）
- 高级参数：种子/固定镜头/返回尾帧/联网/优先级/样片（L983-1032）

---

## 具体改动（文件：`components/VideoGeneration.tsx`）

### 改动 1 · 关联资产区块改为按模式条件渲染
位置：L787-835（`🔗 关联资产` 整块）

用 `config.mode` 分支包裹：
- `multimodal-ref`：渲染现有资产网格（L788-835 内容不变）
- `first-frame` / `first-last-frame`：渲染提示
  ```tsx
  <div>
    <label className="mb-1.5 block text-xs font-semibold text-black">🔗 关联资产（参考图）</label>
    <p className="text-xs text-amber-600">⚠ 首帧或首尾帧模式不可与多模态混用</p>
  </div>
  ```
- `text2video`：`return null`（不渲染）

### 改动 2 · 新增「输入素材」区块（关联资产下方、视频参数上方）
将原视频参数内的按 mode 上传 JSX（L1034-1146）整体迁移到此新区块，按 `config.mode` 分支：
- `multimodal-ref`：迁移 L1062-1146（参考图素材 / 参考视频 / 参考音频 + asset:// 内联输入框）。原 L1064-1066 的说明文字可保留或精简。
- `first-frame`：迁移 L1035-1043（`FrameImageUpload` 首帧）
- `first-last-frame`：迁移 L1044-1061（双栏 `FrameImageUpload` 首帧+尾帧）
- `text2video`：不渲染
- 建议加轻量标题 `🖼️ 输入素材`（仅当有内容时显示）

> 上传相关 handler（`handleUploadRef` L644-675、`handleAddAsset` L678-698）、状态（`uploadingKind` L631、`assetInputKind`/`assetInputValue` L633-634）、`FrameImageUpload` 组件（L526-582）均保持在 `VideoCard` 作用域，**仅 JSX 位置移动，不改逻辑**。

### 改动 3 · 视频参数模块移除上传区块
位置：L869-1149 的 `showVideoConfig` 展开内容
- 删除 L1034-1146（按 mode 的 first-frame / first-last-frame / multimodal-ref 上传 JSX）
- 保留 L888-1032（摘要条 + 参数 grid + 复选框 + 高级参数）
- 其余不变（折叠/展开逻辑 `showVideoConfig`、`changeModel`、`sanitizeConfig` 等不动）

### 改动 4 · 视频参数与视频提示词模块互换位置
- 当前顺序：视频提示词（L837-867）→ 视频参数（L869-1149）
- 目标顺序：视频参数 → 视频提示词
- 即把「视频参数」整块 JSX 移到「视频提示词」整块 JSX 之前
- 改动 2 的新「输入素材」区块位于「关联资产」与「视频参数」之间

---

## 不改动的部分
- `lib/types.ts`、`lib/model-presets.ts`、`lib/video-client.ts`：无变更
- 上传/COS/asset:// 逻辑：无变更
- `generateVideo` 的 mode 校验与素材派生（L287-314）：无变更（仍按 mode 读取对应字段，隐藏字段保留不读、不发送）
- 提示词生成（`videoPromptMessages`）、`replaceAssetTagsWithImageNos`：无变更
- 关联资产自动关联逻辑（L172-188）：无变更（text2video 下仍会自动关联资产用于提示词生成，仅 UI 隐藏）

---

## 假设与决策
1. **结构**：采用「分区块保留关联资产」——关联资产作为独立条件区块，输入素材作为其下方独立区块（用户已确认）。
2. **切换模式清理**：保留已上传素材仅隐藏，不自动清空（用户已确认）。切换回原模式仍可见。
3. **提示文案**：`⚠ 首帧或首尾帧模式不可与多模态混用`（修正笔误「首尾针」→「首尾帧」），仅 `first-frame` / `first-last-frame` 显示。
4. **text2video**：关联资产与输入素材区块均不渲染（完全空白）。
5. **能力矩阵驱动**：输入素材区仅对 `config.mode` 反应；mode 可选项已由 `cap.modes` 过滤，自然遵循模型能力。
6. **视频参数仍可折叠**：保留 `showVideoConfig` 折叠逻辑；精简后内容更短。
7. **输入素材区块不折叠**：有内容时始终展开（主输入区，提升发现性）。

---

## 范围外（不在本次改动）
- text2video 模式下 `replaceAssetTagsWithImageNos` 仍会把有图资产转成「图片N」（但该模式不发送图片，`图片N` 无对应素材）——属既有行为，本次不处理，可作后续优化项。
- 不新增/不删除任何配置字段；不改 API 层。

---

## 验证步骤
1. `npx tsc --noEmit` 通过，无 TS 错误（项目无独立 typecheck 脚本，用 tsc 直接检查）。
2. 浏览器手动验证各模式（默认 2.0 模型，支持全部 4 模式）：
   - `multimodal-ref`：关联资产网格显示 + 下方参考图素材/参考视频/参考音频可上传；视频参数面板内无上传项。
   - `first-frame`：关联资产隐藏显示提示 + 下方首帧图片上传；视频参数内无上传项。
   - `first-last-frame`：关联资产隐藏显示提示 + 下方首帧/尾帧上传。
   - `text2video`：关联资产与输入素材均空白。
3. 模块顺序：画面描述 → 关联资产/输入素材 → 视频参数 → 视频提示词 → 操作。
4. 切换模式后切回，原上传素材仍在（保留仅隐藏）。
5. 切换到不支持多模态的模型（如 1.0 Pro）：mode 下拉无 `multimodal-ref`，输入区不出现多模态内容；切到 1.0 Pro Fast：仅 `text2video`/`first-frame` 可选。
6. 实际生成视频：各模式上传必要素材后可正常提交（`generateVideo` 校验逻辑不变）。
