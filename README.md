# 墨间 · AI 剧本开发工具

> 让故事安静地，长成视频。

从一段灵感文字到可成片的分镜脚本——墨间用 AI 把故事扩写、分镜拆解、资产生成、视频产出串成一条完整流水线，专为短视频/漫剧创作者设计。

## ✨ 核心特性

- **四步创作流程**：故事扩写 → 分镜表 → 资产准备 → 视频生成，逐步推进，随时回溯
- **多 LLM 接入**：支持 DeepSeek / GLM / 小米 MiMo 等兼容 OpenAI 格式的模型，自带 API 代理转发
- **智能分镜**：一键将扩写内容拆解为结构化分镜表（景别/运镜/光影/对白/音效），全字段可编辑
- **资产自动派生**：从分镜文本中的 `@标签` 自动提取人物/场景/物品，生成描述与图片提示词
- **图片生成**：接入火山引擎 Seedream/Doubao，一键生成角色立绘、场景设定、道具图
- **视频生成**：接入火山引擎 Seedance，支持参考帧、分辨率/比例/时长/有声视频配置
- **腾讯云 COS**：资产图片上传至 COS，生成公网 URL 供视频 API 直接引用
- **世界设定**：全局故事背景/主题/写作风格，自动注入 LLM 上下文，保持系列一致性
- **漫剧风格预设**：不同风格的图片/视频提示词模板，每个系列可独立配置
- **暖色设计语言**：墨间原创暖色系 UI，Noto Serif SC + Noto Sans SC 字体搭配

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 14 (App Router) + React 18 |
| 样式 | Tailwind CSS 3.4（自定义暖色主题） |
| 语言 | TypeScript 5.5 |
| 数据存储 | localStorage（前端）/ better-sqlite3（服务端可选） |
| 对象存储 | 腾讯云 COS（cos-nodejs-sdk-v5） |
| AI 服务 | LLM（OpenAI 兼容格式）/ 火山引擎 Seedream + Seedance |

## 📦 快速开始

### 环境要求

- Node.js 18+（推荐 20）
- npm 10+

### 安装与运行

```bash
# 安装依赖
npm install

# 启动开发服务器（默认 3000 端口）
npm run dev

# 如 3000 端口被占用，可指定其他端口
npm run dev -- -p 3300
```

开发服务器启动后访问 [http://localhost:3000](http://localhost:3000)。

### 生产构建

```bash
npm run build
npm start
```

> **⚠️ 热更新注意事项**：`next build` 会在 `.next/` 生成 production 产物，与 dev server 的 development 产物互不兼容。项目已通过 `predev`/`prebuild` 脚本自动清理 `.next/`，但如果手动执行过 `next build`，完成后请手动 `rm -rf .next`，避免污染正在运行的 dev server。

## 📂 项目结构

```
mojian/
├── app/                        # Next.js App Router
│   ├── page.tsx                # 落地页（暖色设计稿还原）
│   ├── home/page.tsx           # 剧集列表页
│   ├── episode/[id]/page.tsx   # 四步编辑器
│   ├── series/[id]/page.tsx    # 系列管理
│   ├── layout.tsx              # 全局布局
│   ├── globals.css             # 全局样式
│   └── api/                    # API Routes（服务端代理）
│       ├── llm/route.ts        #   LLM 流式/非流式代理
│       ├── image/route.ts      #   图片生成代理
│       ├── video/              #   视频生成（create/query/cancel）
│       ├── cos/                #   COS 上传/迁移
│       ├── data/               #   服务端数据 CRUD（episodes/series）
│       ├── settings/           #   设置读写
│       └── migrate/route.ts    #   localStorage → 服务端迁移
├── components/                 # React 组件
│   ├── ContentExpansion.tsx    #   Step1 故事扩写
│   ├── StoryboardTable.tsx     #   Step2 分镜表
│   ├── StoryboardRow.tsx       #   分镜行（可编辑单元格）
│   ├── AssetPreparation.tsx    #   Step3 资产准备
│   ├── VideoGeneration.tsx     #   Step4 视频生成
│   ├── Stepper.tsx             #   步骤导航
│   ├── EpisodeList.tsx         #   剧集列表
│   ├── SeriesList.tsx          #   系列列表
│   ├── SettingsModal.tsx       #   LLM/图片/视频 API 设置
│   ├── WorldSettingsModal.tsx  #   世界设定
│   ├── StyleSettingsModal.tsx  #   漫剧风格设置
│   ├── TaggedText.tsx          #   @标签高亮渲染
│   ├── EditableCell.tsx        #   可编辑单元格
│   ├── ImageLightbox.tsx       #   图片大图查看
│   └── ui/                     #   基础 UI 组件
├── lib/                        # 核心逻辑
│   ├── types.ts                #   全局类型定义
│   ├── api-client.ts           #   前端 API 客户端
│   ├── llm-client.ts           #   LLM 调用封装
│   ├── image-client.ts         #   图片生成封装
│   ├── video-client.ts         #   视频生成封装
│   ├── cos-client.ts           #   COS 客户端
│   ├── storage.ts              #   数据持久化（localStorage）
│   ├── db.ts                   #   服务端数据库（better-sqlite3）
│   ├── prompts.ts              #   LLM Prompt 模板
│   ├── model-presets.ts        #   模型预设
│   ├── world-settings.ts       #   世界设定管理
│   ├── style-settings.ts       #   风格预设管理
│   ├── auth.ts                 #   鉴权
│   └── utils.ts                #   工具函数
├── tailwind.config.ts          # Tailwind 暖色主题配置
├── next.config.mjs             # Next.js 配置
└── DEPLOY.md                   # 部署指南
```

## 🎬 四步创作流程

```
故事扩写          分镜拆解          资产准备          视频生成
  │                │                │                │
  ▼                ▼                ▼                ▼
原始文字  ──▶  AI 扩写  ──▶  分镜表  ──▶  角色/场景/  ──▶  参考帧
              （可编辑）    （可编辑）    道具图片        + 提示词
                                                          │
                                                          ▼
                                                       AI 视频
```

1. **故事扩写**：输入简短灵感，AI 扩写为完整故事段落，可手动编辑
2. **分镜拆解**：将故事自动拆解为结构化分镜（景别/运镜/光影/对白/音效），全字段可编辑
3. **资产准备**：从分镜中的 `@标签` 自动派生资产，生成图片提示词并调用图片 API
4. **视频生成**：将分镜的最终提示词 + 关联资产图片传给视频 API，生成短视频

## 🔧 配置说明

所有配置项通过应用内「设置」面板管理，存储在 localStorage（或服务端数据库）。需要配置：

- **LLM 设置**：选择 provider → 填入 baseURL / apiKey / model
- **图片 API**：火山引擎方舟 API Key + 模型 ID
- **视频 API**：与图片 API 共用同一 Key + Seedance 模型 ID
- **腾讯云 COS**（可选）：SecretId / SecretKey / Bucket / Region

## 🎨 设计系统

墨间采用原创暖色系设计语言：

- **主背景**：`#FFFBEB`（warm-50）
- **标题色**：`#44403C`（warm-950）
- **正文色**：`#78716C`（warm-800）
- **强调色**：`#D97706`（琥珀色，用于焦点环、标签、section label）
- **主 CTA**：`#44403C`（深墨色）
- **字体**：标题 Noto Serif SC（衬线）· 正文 Noto Sans SC

Tailwind 配置中 `brand` / `slate` 色阶已整体重映射为暖色，改组件时优先使用 `brand-*` / `slate-*`。

## 📄 License

Private
