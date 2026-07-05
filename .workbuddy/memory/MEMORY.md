# 项目长期记忆 · 墨间 AI 剧本工具

## 项目概述
Next.js 14 (App Router) + Tailwind 的 AI 剧本开发工具：故事扩写 → 分镜表 → 资产准备 → 视频生成 四步流程。数据存 localStorage，LLM/图片/视频 API 经本地 `/api/*` 转发。

## 路由结构（2026-06-22 调整后）
- `/` → 墨间落地页（暖色设计稿还原），CTA 跳 `/home`。
- `/home` → 剧集列表（原首页），头部「墨间」logo 链回 `/`。
- `/episode/[id]` → 四步编辑器，返回按钮回 `/home`。
- 登录功能未实现，「登录」为 `#` 占位。

## 设计系统（墨间暖色）
- 主背景 `#FFFBEB`(warm-50)，白卡片，footer `#44403C`(warm-950)。
- 文字层级：标题 `#44403C` / 正文 `#78716C` / 次级 `#57534E` / 弱 `#A8A29E`。
- 强调色琥珀 `#D97706`（焦点环、@标签、section label）；主 CTA 用深墨 `#44403C`。
- 字体：标题 Noto Serif SC（全局 h1-h3 衬线），正文 Noto Sans SC。
- 配色实现：`tailwind.config.ts` 中 `brand` 与 `slate` 色阶整体重映射为暖色——改组件时优先用 `brand-*`/`slate-*`，会自动套用暖色；语义色（人物/场景/物品 badge、状态、错误）用 amber/emerald/red。
- tag 配色（来自设计稿）：amber `bg-#FDF0E3 text-#92400E`、sage `bg-#F7F8E8 text-#4D7C0F`、gold `bg-#FDF3E3 text-#92400E`。
- 注意：`boxShadow` 在 tailwind config 里必须用逗号拼接字符串，不能用数组（build 时类型检查会报错）。

## 运行
- dev：`npm run dev`（本机 3000 常被占用，可 `-p 3300`）。
- **依赖坑**：`package.json` 中 `next` 版本号曾误写为 `^9.3.3`（Next 9），与 React 18 peer dependency 冲突导致 `npm install` ERESOLVE 报错。2026-07-03 已修正为 `^14.2.5`，后进一步升到 `^14.2.35`。若再次遇到同类报错，先检查 next 版本号是否被改回。
- **npm audit 处理（2026-07-03）**：`package.json` 添加了 `overrides` 字段强制升级 `cos-nodejs-sdk-v5` 内的传递依赖（request→form-data/qs/tough-cookie/uuid、fast-xml-parser、conf→ajv/ajv-formats）及全局 `postcss`。漏洞从 12 个降到 3 个（1 high + 2 moderate）。剩余 3 个无法在不破坏升级（next→16）或更换 SDK 的情况下消除，属于可接受残余风险。
- **⚠️ 热更新保护规则**：`next build` 会在 `.next/` 生成 production 产物，与 `next dev` 的 development 产物互不兼容。若 `next build` 与 dev server 同时存在，dev server 会被污染导致 `Cannot find module` 错误。
  - `package.json` 已配置 `predev` / `prebuild` 自动清理 `.next/`。
  - **Agent 规则**：完成 `next build` 验证后，必须立即 `rm -rf .next` 清理，避免污染用户正在运行的 dev server。

## 腾讯云 COS 存储（2026-06-22 接入）
- SDK：`cos-nodejs-sdk-v5`（仅服务端，API route 中动态 import）。
- 配置：存 localStorage key `mojian_cos_settings`（secretId/secretKey/bucket/region/customDomain?）。
- 上传 API：`/api/cos/upload`，接收 base64 + CosSettings，putObject → 返回公网 URL。
- 对象路径：`ai-script/assets/{timestamp}-{random}.{ext}`。
- 前端上传入口：Step3 资产卡片「上传」按钮（COS 配置后显示），选本地图 → FileReader 读 base64 → 调 API → 写回 imageUrl。
- 视频生成联动：COS URL 为公网可访问 → Step4 `generateVideo` 直接将 COS URL 传给 Seedance API 作为参考帧（已移除 base64 过滤）。

## 世界设定（2026-06-24 接入，2026-07-03 改为独立页面）
- 配置项：故事背景、核心主题、写作风格，存 localStorage key `mojian_world_settings`。
- `/series/[id]` 右上角「世界设定」按钮 → 独立页面 `/series/[id]/world-settings`（系列级，存 `Series.worldSettings`，支持全局 localStorage 回退）。
- 自动注入到 Step1 故事扩写 (`expansionMessages`) 和 Step2 分镜生成 (`storyboardMessages`) 的 LLM system prompt。
- `lib/world-settings.ts`：getWorldSettings / saveWorldSettings / worldSettingsToText / hasWorldSettings。

## 人物设定（2026-07-03 接入）
- 与世界设定平行的系列级功能，`CharacterProfile` 数组（id/name/role/genderAge/appearance/personality/background/relationships/imageUrl?）。
- **独立页面**（非弹窗）：`/series/[id]/characters`，卡片网格布局（1/2/3 列响应式），每张卡片顶部预留图片区域（未来扩展上传），支持全部展开/收起、未保存离开确认。入口在 `/series/[id]` 右上角（世界设定与漫剧风格之间）。
- 存储：`Series.characterSettings`（系列级优先，全局 localStorage `mojian_character_settings` 回退）；server 模式 DB 有 `character_settings` 列（`lib/db.ts` 含迁移逻辑），`/api/data/series` route 读写该字段。
- `lib/character-settings.ts`：getCharacterSettings / saveCharacterSettings / characterSettingsToText / hasCharacterSettings / emptyCharacterProfile。
- **三处注入**：Step1 扩写 (`expansionMessages`) + Step2 分镜 (`storyboardMessages`) + Step3 资产 (`assetMessages`)，注入顺序 `...指令...${worldContext}${characterContext}${prevCtx}`。
- **提取**：Step1 扩写结果下方「提取人物设定」按钮（手动触发），`extractCharacterMessages` prompt → LLM 返回 JSON → `extractCharacters`/`toCharacterProfile` 解析 → `handleCharactersExtracted` 按姓名去重合并到系列级 → 返回 `{added, total}` 给 ContentExpansion 显示绿色 emerald 内联提示。
- **Step3 联动**：进入 Step3 时若 assets 为空且有人物设定，自动预填 character 资产卡片（name/description/imagePrompt 来自人物档案，不自动生图）；`handleGenerateAll` 注入 characterText 让 LLM 参考人物设定生成资产。
- 数据迁移：`lib/storage.ts` normalizeSeries 补 `characterSettings`；`lib/utils.ts` emptySeries 加 `characterSettings: []`。

## 漫剧风格（独立页面，2026-07-03 改造）
- 独立页面 `/series/[id]/style-settings`（原为 `StyleSettingsModal` 弹窗，已删除）。
- 风格选择卡片网格 + 模板编辑区（人物/场景/物品提示词模板 + 视频风格后缀），保存到 `series.styleSettings`，支持恢复默认。
- 三个设定页面统一布局：返回箭头 + 标题 + 企划名副标题 + 保存按钮 + 琥珀色说明条 + 未保存修改提示 + 离开确认。
