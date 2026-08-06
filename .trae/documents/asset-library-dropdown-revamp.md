# 资产库下拉按钮改造计划

## 概述

将资产库顶部「+ 添加资产」和「+ 创建歌手音色」两个独立按钮合并为一个下拉折叠按钮,内含 5 个媒体入口(图片/视频/音频/音乐/歌手音色)。同时统一"音色"文案为"音频",修复人物设定页面上传音频的分类。

## 当前状态分析

### 按钮区(AssetLibrary.tsx 第 288-345 行)
- `+ 创建歌手音色` → 打开 VoicePersonaCreateDialog
- `+ 添加资产` → 打开 AddAssetDialog(内部可选 mediaType: image/video/audio)
- `多选` → 切换多选模式

### AddAssetDialog(第 886-1268 行)
- 内部有 mediaType 选择器(FilterPill 三选一: 图片/视频/音频)
- 不支持 music 类型
- mode 三选一: upload / url / generate(generate 仅对 image 有效)
- entityType 选择器: 6 项(人物/物品/场景/截屏/故事板/生成),不含 music/other/voicePersona
- source 固定 "manual"

### 人物设定页面(characters/page.tsx 第 528-564 行)
- `handleUploadVoice`: entityType = `"other"`, entityName = `"${char.name} - 音色"` ← 需修复
- `handleVoiceGenerate`(TTS): entityType = `"character"` ← 已正确

### 文案混淆
- `MEDIA_TYPE_OPTIONS` audio label = "音色"(应为"音频")
- `ENTITY_TYPE_OPTIONS` voicePersona label = "音色"(应为"歌手音色")
- `ASSET_TYPE_LABELS` 缺少 shot/music/voicePersona/other
- AssetCard 角标 isAudio 显示"音色"(应为"音频")

## 改动方案

### 改动 1: 文案统一(AssetLibrary.tsx + lib/utils.ts)

**AssetLibrary.tsx:**
- `MEDIA_TYPE_OPTIONS`(第 24 行): `{ value: "audio", label: "音色" }` → `label: "音频"`
- `ENTITY_TYPE_OPTIONS`(第 39 行): `{ value: "voicePersona", label: "音色" }` → `label: "歌手音色"`
- `mediaEmptyText`(第 84 行): `"暂无音色资产"` → `"暂无音频资产"`
- AssetCard 角标(第 759 行): `isAudio ? "音色"` → `isAudio ? "音频"`

**lib/utils.ts:**
- `ASSET_TYPE_LABELS`(第 378 行): `voicePersona: "音色"` → `voicePersona: "歌手音色"`
(注: shot/music/other 已在上一轮补齐,无需再改)

### 改动 2: 人物设定页面修复(characters/page.tsx 第 549-557 行)

`handleUploadVoice` 中的 `recordMediaAsset`:
```ts
// 改前
entityType: "other",
entityName: `${char.name || "未命名人物"} - 音色`,
// 改后
entityType: "character",
entityName: char.name || "未命名人物",
```

与 TTS 生成路径(entityType="character")保持一致。

### 改动 3: AddAssetDialog 改造(AssetLibrary.tsx)

#### 3a. 接受预设 mediaType
- 新增 prop: `presetMediaType: MediaAsset["mediaType"]`
- 移除内部 `mediaType` state 和 `ADD_MEDIA_TYPE_OPTIONS` 选择器
- 标题改为 `添加{媒体中文}` (如"添加图片"、"添加音乐")

#### 3b. 扩展 music 支持
- mode 可用性按 mediaType 联动:
  - image: upload / url / generate
  - video: upload / url
  - audio: upload / url
  - music: upload / url
- accept 属性: music 复用 `"audio/*"`

#### 3c. entityType 联动
- 按 mediaType 显示可选 entityType:
  - image: 人物/物品/场景/镜头/截屏/故事板/生成/其他 → 默认"人物"
  - video: 镜头/生成/其他 → 默认"其他"
  - audio: 其他(固定,不可选) → 默认"其他"
  - music: 音乐(固定,不可选) → 默认"音乐"
- audio / music 仅一个选项时,隐藏 entityType 选择器

#### 3d. mode 切换逻辑
- 切换到非 image 时,若当前 mode 为 generate,自动切到 upload
- generate 模式按钮仅在 image 时显示

### 改动 4: 下拉折叠按钮(AssetLibrary.tsx)

#### 4a. 移除旧按钮
- 删除 `+ 创建歌手音色` 按钮(第 307-312 行)
- 删除 `+ 添加资产` 按钮(第 313-318 行)

#### 4b. 新增下拉按钮
- 按钮文案: `+ 添加` 带下拉箭头图标
- 点击展开菜单,包含 5 个选项:
  1. 添加图片 → `setAddMediaType("image"); setAddOpen(true)`
  2. 添加视频 → `setAddMediaType("video"); setAddOpen(true)`
  3. 添加音频 → `setAddMediaType("audio"); setAddOpen(true)`
  4. 添加音乐 → `setAddMediaType("music"); setAddOpen(true)`
  5. 创建歌手音色 → `setVoiceCreateOpen(true)`
- 点击外部关闭(useEffect + document click listener 或 backdrop)

#### 4c. 新增 state
```ts
const [addMediaType, setAddMediaType] = useState<MediaAsset["mediaType"]>("image");
const [addMenuOpen, setAddMenuOpen] = useState(false);
```

#### 4d. AddAssetDialog 调用
```tsx
{addOpen && (
  <AddAssetDialog
    presetMediaType={addMediaType}
    seriesOptions={seriesOptions}
    onClose={() => setAddOpen(false)}
    onCreated={() => { setAddOpen(false); refresh(); }}
  />
)}
```

## 假设与决策

1. **音乐添加仅支持 upload/url**:用户明确要求"提供本地上传和粘贴URL即可",不接入 AI 音乐生成。
2. **audio entityType 固定"其他"**:资产库上传的音频归类为"其他",人物设定页面上传的才归类为"人物"。
3. **music entityType 固定"音乐"**:手动添加的音乐归类为"音乐"实体类型。
4. **历史数据不处理**:用户明确说"历史数据不用管",不写迁移脚本。
5. **多选按钮保留**:不纳入下拉,保持独立(它是模式切换,不是添加操作)。
6. **下拉按钮样式**:品牌色主按钮 `+ 添加 ▾`,菜单为白底圆角阴影浮层。

## 验证步骤

1. 资产库顶部显示 `+ 添加 ▾` 下拉按钮和 `多选` 按钮,无独立添加/创建按钮
2. 点击下拉按钮,展开 5 个选项
3. 选"添加图片" → 弹窗标题"添加图片",支持 upload/url/generate,entityType 可选 8 项
4. 选"添加视频" → 弹窗标题"添加视频",支持 upload/url,entityType 可选 3 项(镜头/生成/其他)
5. 选"添加音频" → 弹窗标题"添加音频",支持 upload/url,无 entityType 选择器(固定"其他")
6. 选"添加音乐" → 弹窗标题"添加音乐",支持 upload/url,无 entityType 选择器(固定"音乐")
7. 选"创建歌手音色" → 打开 VoicePersonaCreateDialog
8. 点击下拉菜单外部 → 菜单关闭
9. 筛选栏 mediaType="audio" 显示"音频"(非"音色")
10. 筛选栏 entityType=voicePersona 显示"歌手音色"
11. 卡片角标 audio 类型显示"音频"
12. 人物设定页面上传音频后,资产库中该记录 entityType="character"(非"other")
