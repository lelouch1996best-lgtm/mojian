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

## 世界设定（2026-06-24 接入）
- 配置项：故事背景、核心主题、写作风格，存 localStorage key `mojian_world_settings`。
- `/home` 右上角「世界设定」按钮 → `WorldSettingsModal` 模态框。
- 自动注入到 Step1 故事扩写 (`expansionMessages`) 和 Step2 分镜生成 (`storyboardMessages`) 的 LLM system prompt。
- `lib/world-settings.ts`：getWorldSettings / saveWorldSettings / worldSettingsToText / hasWorldSettings。
