# 墨间 AI 剧本工具 — 服务器部署指南（Agent 执行版）

> 本文档供服务器上的 AI Agent 自动化执行。所有命令均可直接复制运行。

## 项目概览

| 项目 | 值 |
|------|-----|
| 名称 | 墨间 AI 剧本工具 (ai-script-tool) |
| 技术栈 | Next.js 16 (App Router) + TypeScript + Tailwind CSS 3 |
| 数据库 | SQLite (better-sqlite3，原生编译模块) |
| 对象存储 | 腾讯云 COS (cos-nodejs-sdk-v5，服务端动态 import) |
| 仓库地址 | `https://github.com/lelouch1996best-lgtm/mojian.git` (Private) |
| 默认端口 | 3000 |
| Node 要求 | >= 20.0.0（推荐 22 LTS） |

### 架构说明

```
浏览器 (localStorage 存配置)
  │
  ├── /api/llm        → 转发到用户配置的 LLM API (DeepSeek/GLM/MiMo/自定义)
  ├── /api/image      → 转发到火山引擎 Seedream 图片生成 API
  ├── /api/video/*    → 转发到火山引擎 Seedance 视频生成 API
  ├── /api/cos/*      → 腾讯云 COS 上传/转存
  │
  ├── /api/data/*     → SQLite 增删改查（需 Bearer Token 鉴权）
  ├── /api/settings/* → SQLite 设置读写（需 Bearer Token 鉴权）
  └── /api/migrate    → localStorage → SQLite 数据迁移（需 Bearer Token 鉴权）
```

**关键设计**：所有上游 API 密钥（LLM / 图片 / 视频 / COS）由终端用户在浏览器 UI 中配置，存储在浏览器 localStorage，每次请求随 body 发送到服务端 API Route 转发。服务端唯一需要的密钥是 `STORAGE_TOKEN`（用于数据 API 的 Bearer Token 鉴权）。

---

## 部署步骤

### 第 1 步：安装 Node.js

```bash
# 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc

# 安装 Node 22 并设为默认
nvm install 22
nvm use 22
nvm alias default 22

# 验证
node -v   # 应显示 v22.x.x
npm -v
```

### 第 2 步：安装系统依赖

better-sqlite3 是原生 C++ 模块，需要编译工具链：

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3 git
```

### 第 3 步：克隆仓库

仓库是 Private 的，需要认证。选择一种方式：

**方式 A：用 GitHub CLI（推荐）**
```bash
# 安装 gh
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update && sudo apt install gh -y

# 登录（按提示用浏览器授权）
gh auth login

# 克隆
cd /opt
gh repo clone lelouch1996best-lgtm/mojian
```

**方式 B：用 Deploy Key（适合纯命令行）**
```bash
# 生成专用密钥
ssh-keygen -t ed25519 -C "mojian-deploy" -f ~/.ssh/mojian_deploy -N ""

# 打印公钥，添加到 GitHub 仓库 Settings → Deploy keys
cat ~/.ssh/mojian_deploy.pub

# 配置 SSH
cat >> ~/.ssh/config << 'EOF'
Host github-mojian
  HostName github.com
  IdentityFile ~/.ssh/mojian_deploy
  IdentitiesOnly yes
EOF

# 克隆
cd /opt
git clone git@github-mojian:lelouch1996best-lgtm/mojian.git
```

**方式 C：用 Personal Access Token**
```bash
cd /opt
git clone https://<TOKEN>@github.com/lelouch1996best-lgtm/mojian.git
```

### 第 4 步：安装依赖

```bash
cd /opt/mojian
npm install
```

如果 better-sqlite3 编译失败，确认已安装 `build-essential` 和 `python3`，且 Node >= 18。

### 第 5 步：创建数据目录

```bash
sudo mkdir -p /data/mojian/backups
sudo chown -R $(whoami):$(whoami) /data/mojian
```

### 第 6 步：生成鉴权 Token 并配置环境变量

```bash
# 生成随机 Token
TOKEN=$(openssl rand -hex 32)
echo "Generated TOKEN: $TOKEN"
# 请记下这个值

# 创建环境变量文件
cat > /opt/mojian/.env.production << EOF
NEXT_PUBLIC_STORAGE_MODE=server
NEXT_PUBLIC_STORAGE_TOKEN=$TOKEN
STORAGE_TOKEN=$TOKEN
DB_PATH=/data/mojian/data.db
EOF
```

**环境变量说明：**

| 变量 | 必填 | 说明 |
|------|------|------|
| `NEXT_PUBLIC_STORAGE_MODE` | 是 | 设为 `server` 启用服务端 SQLite 存储（否则用浏览器 localStorage） |
| `NEXT_PUBLIC_STORAGE_TOKEN` | 是 | 前端请求 API 时携带的 Bearer Token（会编译进前端 JS） |
| `STORAGE_TOKEN` | 是 | 服务端校验 Bearer Token 用（必须与上面值一致） |
| `DB_PATH` | 否 | SQLite 文件路径，默认 `data/mojian-dev.db`（相对项目目录）。生产环境建议指向 `/data/mojian/data.db` |

> 注意：`.env.production` 在 `.gitignore` 中，不会被提交到仓库，需在服务器上手动创建。

### 第 7 步：构建

```bash
cd /opt/mojian
npm run build
```

构建脚本 `prebuild` 会自动清理 `.next/` 目录。如果构建报类型错误，检查 TypeScript 配置。

### 第 8 步：安装 PM2 并启动

```bash
# 安装 PM2
npm install -g pm2

# 启动（默认监听 3000 端口）
cd /opt/mojian
pm2 start npm --name "mojian" -- start

# 验证运行状态
pm2 status
pm2 logs mojian --lines 20

# 设置开机自启
pm2 startup
pm2 save
```

### 第 9 步：验证服务

```bash
# 本地健康检查
curl -s http://127.0.0.1:3000 | head -20

# 测试数据 API 鉴权（应返回 401 未授权）
curl -s http://127.0.0.1:3000/api/data/series

# 带 Token 测试（应返回空数组或数据）
curl -s -H "Authorization: Bearer <你的TOKEN>" http://127.0.0.1:3000/api/data/series
```

如果 `curl` 返回 HTML（首页），说明服务已启动。如果连接被拒绝，检查 `pm2 logs mojian`。

---

## Nginx 反向代理（推荐）

如果要用 80 端口或绑定域名，配置 Nginx：

```bash
sudo apt-get install -y nginx

sudo tee /etc/nginx/sites-available/mojian << 'EOF'
server {
    listen 80;
    server_name _;

    # COS 上传走 base64，请求体可能较大
    client_max_body_size 50M;

    # 视频生成轮询可能耗时，增加超时
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/mojian /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

现在可以直接用 `http://服务器IP` 访问（80 端口）。

---

## HTTPS（可选）

如果有域名，用 certbot 免费申请 Let's Encrypt 证书：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mojian.example.com   # 换成你的域名
```

证书自动续期，无需额外操作。

---

## 防火墙放行

在云服务商控制台放行端口：

- **80 端口**（如果配置了 Nginx）— TCP，源 0.0.0.0/0
- **3000 端口**（如果直连）— TCP，源 0.0.0.0/0
- **443 端口**（如果配置了 HTTPS）— TCP，源 0.0.0.0/0

---

## 数据备份

SQLite 文件在 `/data/mojian/data.db`，配置定时备份：

```bash
# 编辑 crontab
crontab -e

# 加入以下内容（每天凌晨 3 点备份，保留 30 天）
0 3 * * * cp /data/mojian/data.db /data/mojian/backups/data-$(date +\%Y\%m\%d).db
0 4 * * * find /data/mojian/backups -name "data-*.db" -mtime +30 -delete
```

---

## 更新代码

本地改完代码推送后，服务器更新：

```bash
cd /opt/mojian
git pull
npm install          # 如有新依赖
npm run build
pm2 restart mojian
```

---

## 项目目录结构

```
mojian/
├── app/
│   ├── api/                    # API Routes（服务端）
│   │   ├── llm/route.ts        # LLM 代理
│   │   ├── image/route.ts      # 图片生成代理
│   │   ├── video/              # 视频生成代理
│   │   │   ├── create/route.ts
│   │   │   ├── query/route.ts
│   │   │   └── cancel/route.ts
│   │   ├── cos/                # 腾讯云 COS
│   │   │   ├── upload/route.ts
│   │   │   └── transfer/route.ts
│   │   ├── data/               # 数据 CRUD
│   │   │   ├── series/
│   │   │   └── episodes/
│   │   ├── settings/[key]/    # 设置读写
│   │   └── migrate/route.ts    # 数据迁移
│   ├── episode/[id]/page.tsx   # 编辑器
│   ├── home/page.tsx           # 剧集列表
│   ├── series/[id]/page.tsx    # 系列列表
│   ├── layout.tsx
│   └── page.tsx                # 落地页
├── components/                 # React 组件
├── lib/                        # 工具库
│   ├── db.ts                   # SQLite 连接 + 建表
│   ├── auth.ts                 # Bearer Token 鉴权
│   ├── storage.ts               # 数据存储抽象层
│   ├── api-client.ts           # 服务端模式 API 客户端
│   ├── types.ts                # TypeScript 类型定义
│   └── ...
├── public/                     # 静态资源
├── .gitignore
├── package.json
├── next.config.mjs
├── tailwind.config.ts
└── tsconfig.json
```

---

## 常见问题排查

**Q: `npm install` 时 better-sqlite3 编译失败？**

确认已安装编译工具链：
```bash
sudo apt-get install -y build-essential python3
```
Node 版本必须 >= 18，推荐 20 或 22。如仍失败，尝试 `npm rebuild better-sqlite3`。

**Q: 启动后访问报 502 / 连不上？**

```bash
pm2 status          # 确认 mojian 进程在运行
pm2 logs mojian     # 查看错误日志
curl http://127.0.0.1:3000   # 本地直连测试
```
如果本地能访问但外部不行，检查云服务器防火墙端口是否放行。

**Q: 构建时 TypeScript 报错？**

```bash
npx tsc --noEmit   # 单独跑类型检查，查看详细错误
```
本项目 `tsconfig.json` 开启了 `strict: true`，确保代码无类型错误。

**Q: 数据 API 返回 401？**

检查 `.env.production` 中的 `STORAGE_TOKEN` 和 `NEXT_PUBLIC_STORAGE_TOKEN` 是否一致。重新修改后需要重新 `npm run build`（因为 `NEXT_PUBLIC_*` 变量会编译进前端代码）。

**Q: 数据库在哪？怎么迁移？**

- 数据库文件路径由 `DB_PATH` 环境变量指定，默认 `/data/mojian/data.db`
- 从本地 localStorage 迁移：在浏览器打开墨间，配置好与服务器一致的 Token，然后通过 `/api/migrate` POST 接口提交

**Q: PM2 日志在哪？**

```bash
pm2 logs mojian              # 实时日志
pm2 logs mojian --lines 100  # 最近 100 行
cat ~/.pm2/logs/mojian-out.log   # stdout 日志文件
cat ~/.pm2/logs/mojian-error.log # stderr 日志文件
```

---

## 快速验证清单

部署完成后逐项确认：

- [ ] `node -v` 显示 v22.x
- [ ] `npm install` 无报错
- [ ] `.env.production` 已创建，4 个变量均已填写
- [ ] `npm run build` 构建成功
- [ ] `pm2 status` 显示 mojian 为 online
- [ ] `curl http://127.0.0.1:3000` 返回 HTML
- [ ] 云防火墙已放行 80 或 3000 端口
- [ ] 浏览器访问 `http://服务器IP` 能看到墨间落地页
- [ ] 进入 `/home` 能看到剧集列表（空列表正常）
- [ ] 设置中能保存 LLM 配置并成功调用
