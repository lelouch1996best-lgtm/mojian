# 人物设定上传按钮实现计划

## 需求分析

用户希望在人物设定功能中新增一个上传按钮，允许用户手动上传本地图片作为人物形象图。目前人物卡片仅支持通过 AI 生成图片，缺少手动上传功能。

## 现有代码分析

### 核心文件

1. **[CharacterCard.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/CharacterCard.tsx)** - 人物卡片组件，包含图片展示区域和"生成图片"按钮

2. **[page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/page.tsx)** - 人物设定页面，包含图片生成逻辑和状态管理

3. **[cos/upload/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/cos/upload/route.ts)** - 现有的 COS 上传 API，支持 base64 图片上传

### 当前图片逻辑

- 已有 `imageUrl` 字段存储人物形象图 URL
- 已有 `generateImage` 函数通过 AI 生成图片
- 已有 COS 上传 API `/api/cos/upload` 支持 base64 格式上传

## 实现方案

### 修改文件

1. **CharacterCard.tsx** - 添加上传按钮和文件选择器

2. **page.tsx** - 添加文件上传处理函数

### 具体步骤

#### 步骤 1：修改 CharacterCard.tsx

- 在图片区域添加一个上传按钮（在没有图片且未生成时显示）
- 添加隐藏的 file input 用于选择本地文件
- 添加 `onUploadImage` 回调 prop
- 添加 `isUploading` 状态 prop

#### 步骤 2：修改 page.tsx

- 添加 `uploadingImageIds` 状态
- 实现 `handleUploadImage` 函数：
  - 将选中的图片文件转换为 base64
  - 调用 `/api/cos/upload` API（需要 COS 配置）
  - 更新人物的 `imageUrl`

## 技术细节

### 文件上传流程

1. 用户点击上传按钮 → 触发 file input 点击
2. 用户选择图片文件 → `onChange` 事件触发
3. 将文件读取为 base64 格式
4. 调用 COS 上传 API
5. 获取返回的 URL 并更新人物数据

### 错误处理

- 如果未配置 COS，提示用户先配置
- 如果文件格式不支持，提示错误
- 上传过程中显示加载状态

## 风险与注意事项

1. **COS 配置依赖**：上传功能依赖 COS 配置，如果未配置则无法上传
2. **文件大小限制**：base64 格式会增加 30% 体积，需注意大文件上传
3. **图片格式限制**：仅支持常见图片格式（png、jpg、webp、gif、bmp）

## 代码修改预估

### CharacterCard.tsx 修改点

- 添加 `onUploadImage` 和 `isUploading` prop
- 添加上传按钮 UI（在"生成图片"按钮旁边或下方）
- 添加隐藏的 file input

### page.tsx 修改点

- 添加 `uploadingImageIds` 状态
- 添加 `handleUploadImage` 函数
- 将上传函数传递给 CharacterCard

## 完成标准

1. 人物卡片显示上传按钮
2. 点击按钮可选择本地图片文件
3. 上传成功后图片显示在卡片上
4. 上传过程中有加载状态提示
5. 未配置 COS 时有友好提示
