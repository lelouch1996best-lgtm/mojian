# 墨间 — 腾讯云轻量服务器部署指南

## 一、服务器准备

### 1.1 登录服务器

```bash
ssh ubuntu@你的服务器IP
```

腾讯云轻量服务器默认用户通常是 `ubuntu` 或 `root`，以你的实际为准。

### 1.2 安装 Node.js 20（通过 nvm）

```bash
# 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc

# 安装 Node 20 并设为默认
nvm install 20
nvm use 20
nvm alias default 20

# 验证
node -v   # 应显示 v20.x.x
npm -v
```

### 1.3 安装构建依赖（better-sqlite3 需要编译）

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3
```

### 1.4 安装 PM2（进程守护）

```bash
npm install -g pm2
```

### 1.5 创建数据目录

```bash
sudo mkdir -p /data/mojian
sudo chown -R $USER:$USER /data/mojian
```

数据库文件会存到 `/data/mojian/data.db`。

---

## 二、上传代码

### 方式 A：用 Git（推荐）

如果你的项目已推到 GitHub/Gitee：

```bash
cd /opt
git clone https://github.com/你的用户名/你的仓库.git mojian
cd mojian
```

### 方式 B：用 rsync 从本地上传

在你的 **Mac 本地** 执行：

```bash
cd /Users/hehuajiu/WorkBuddy/2026-06-20-21-27-32

rsync -avz --exclude 'node_modules' --exclude '.next' --exclude '.git' --exclude 'data' \
  ./ ubuntu@你的服务器IP:/opt/mojian/
```

---

## 三、安装依赖 + 构建

在服务器上：

```bash
cd /opt/mojian

# 安装依赖（含 better-sqlite3 原生编译）
npm install

# 生成随机鉴权 Token（记下来，下一步要用）
openssl rand -hex 32
```

把输出的 64 位 hex 字符串复制下来。

---

## 四、配置环境变量

在服务器上 `/opt/mojian/` 目录创建 `.env.production`：

```bash
cat > .env.production << 'EOF'
NEXT_PUBLIC_STORAGE_MODE=server
NEXT_PUBLIC_STORAGE_TOKEN=替换成上一步生成的token
STORAGE_TOKEN=替换成上一步生成的token
DB_PATH=/data/mojian/data.db
EOF
```

注意 `NEXT_PUBLIC_STORAGE_TOKEN` 和 `STORAGE_TOKEN` 用同一个值。前者会打进前端 JS（浏览器请求 API 时用），后者是服务端校验用。

---

## 五、构建 + 启动

```bash
cd /opt/mojian

# 生产构建
npm run build

# 用 PM2 启动（默认监听 3000 端口）
pm2 start npm --name "mojian" -- start

# 查看状态
pm2 status
pm2 logs mojian

# 设置开机自启
pm2 startup
pm2 save
```

此时墨间已运行在 `http://你的服务器IP:3000`。

---

## 六（可选）、配置 Nginx 反向代理

如果你要用 80 端口或绑定域名，装 Nginx：

```bash
sudo apt-get install -y nginx
```

创建配置：

```bash
sudo cat > /etc/nginx/sites-available/mojian << 'EOF'
server {
    listen 80;
    server_name _;   # 改成你的域名，如 mojian.example.com

    client_max_body_size 50M;   # COS 上传 base64 可能较大

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/mojian /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

现在可以直接用 `http://你的服务器IP` 访问（80 端口）。

---

## 七（可选）、配置 HTTPS

如果有域名，用 certbot 免费申请 Let's Encrypt 证书：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mojian.example.com   # 换成你的域名
```

按提示操作，证书自动续期。

---

## 八、腾讯云防火墙放行端口

登录腾讯云控制台 → 轻量服务器实例 → 防火墙：

- 添加规则：放行 **80 端口**（TCP，源 0.0.0.0/0）
- 如果不用 Nginx，放行 **3000 端口**
- 如果配了 HTTPS，放行 **443 端口**

---

## 九、后续更新代码

本地改完代码后，重新部署：

```bash
# 本地：推送代码
git add . && git commit -m "update" && git push

# 服务器：拉取并重启
cd /opt/mojian
git pull
npm install        # 如有新依赖
npm run build
pm2 restart mojian
```

---

## 十、数据备份（推荐）

数据库文件就一个 `/data/mojian/data.db`，加个 cron 每天备份：

```bash
# 创建备份目录
mkdir -p /data/mojian/backups

# 编辑 crontab
crontab -e
```

加入以下内容（每天凌晨 3 点备份，保留 30 天）：

```
0 3 * * * cp /data/mojian/data.db /data/mojian/backups/data-$(date +\%Y\%m\%d).db
0 4 * * * find /data/mojian/backups -name "data-*.db" -mtime +30 -delete
```

---

## 常见问题

**Q：访问报 502 / 连不上？**
- 检查 PM2 是否在跑：`pm2 status`
- 检查端口：`curl http://127.0.0.1:3000`
- 检查腾讯云防火墙是否放行端口

**Q：better-sqlite3 安装失败？**
- 确认装了 `build-essential` 和 `python3`
- Node 版本必须是 18+，推荐 20

**Q：数据迁移？**
- 首次部署后，本地浏览器还有 localStorage 数据
- 打开墨间设置页（如果加了迁移按钮），或在浏览器控制台手动 POST 到 `/api/migrate`
- 之后浏览器数据可以不管，服务端是新的真实数据源
