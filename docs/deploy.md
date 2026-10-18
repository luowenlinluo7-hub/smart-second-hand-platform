# 部署手册

本项目是**前后端分离**结构，有两种落地方式：

| 方案 | 适合场景 | 组成 |
| --- | --- | --- |
| **A. 单机部署** | 云服务器（1 核 2G 起）、答辩演示、内网 | Nginx + PM2 + MySQL（同机或云数据库） |
| **B. 分离托管** | 免费额度、免运维、公网访问 | Vercel（前端）+ Railway（后端 + MySQL） |

> 无论是哪种方式，**AI 都可以不配置**：设 `AI_MOCK=true` 即走本地规则解析，功能完整可用。

---

## 一、准备：环境变量清单

所有敏感信息只放 `.env`，**不要提交进仓库**。

| 变量 | 必填 | 说明 |
| --- | :-: | --- |
| `NODE_ENV` | ✅ | 生产填 `production` |
| `PORT` | ✅ | 后端端口，默认 `3000` |
| `DATABASE_URL` | ✅ | `mysql://用户:密码@主机:3306/库名` |
| `JWT_SECRET` | ✅ | **至少 16 位随机串**，泄露等于所有账号失守 |
| `JWT_EXPIRES_IN` | — | 默认 `7d` |
| `CORS_ORIGIN` | ✅ | 允许的前端源，多个用英文逗号分隔（分离部署时必须填对） |
| `CLIENT_DIST` | — | 填了就由后端同源托管前端产物（单机方案推荐） |
| `UPLOAD_DIR` | — | 图片上传目录，**必须指向持久化磁盘**（默认 `<cwd>/uploads`） |
| `DEEPSEEK_API_KEY` | — | 不填则自动降级；填了才走真实模型 |
| `AI_MOCK` | — | `true` 时强制走本地规则解析（离线演示 / CI） |
| `AUTH_RATE_LIMIT_MAX` | — | 登录失败次数上限，默认 10 / 15 分钟 |
| `REGISTER_RATE_LIMIT_MAX` | — | 注册失败次数上限，默认 30 / 15 分钟 |

生成随机密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 二、方案 A · 单机部署（PM2 + Nginx）

### 1. 服务器准备

```bash
# Ubuntu 22.04 为例
sudo apt update
sudo apt install -y nginx git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

MySQL 8（如使用云数据库可跳过）：

```bash
sudo apt install -y mysql-server
sudo mysql -e "CREATE DATABASE smart_second_hand CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'sh'@'localhost' IDENTIFIED BY '强密码'; GRANT ALL ON smart_second_hand.* TO 'sh'@'localhost';"
```

### 2. 拉代码并构建

```bash
cd /var/www
sudo git clone https://github.com/luowenlinluo7-hub/smart-second-hand-platform.git
cd smart-second-hand-platform

# 后端（构建需要 tsc，所以不要用 --omit=dev）
cd server
npm ci
npx prisma generate
npx prisma migrate deploy
npm run seed               # 首次部署灌演示数据；已有正式数据时跳过
npm run build
cd ..

# 前端（产物交给后端同源托管，省一个反向代理）
cd client
npm ci
npm run build              # 输出 client/dist
cd ..
```

### 3. 配置 `server/.env`

```bash
cat > server/.env <<'EOF'
NODE_ENV=production
PORT=3000
DATABASE_URL="mysql://sh:强密码@127.0.0.1:3306/smart_second_hand"
JWT_SECRET="替换成 32 字节随机串"
CORS_ORIGIN="https://你的域名.com"
CLIENT_DIST="/var/www/smart-second-hand-platform/client/dist"
UPLOAD_DIR="/var/www/smart-second-hand-platform/server/uploads"
AI_MOCK=false
DEEPSEEK_API_KEY=""
EOF
chmod 600 server/.env
```

### 4. PM2 守护

`ecosystem.config.cjs`（放在仓库根目录，或在服务器上临时创建）：

```js
module.exports = {
  apps: [
    {
      name: 'smart-second-hand',
      cwd: './server',
      script: 'dist/index.js',
      instances: 1,              // 有内存态（限流计数）时不要多实例
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
    },
  ],
}
```

```bash
cd server && npm run build && cd ..
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup            # 按提示执行输出的命令，实现开机自启
pm2 logs smart-second-hand
```

### 5. Nginx 反向代理

```nginx
server {
    listen 80;
    server_name 你的域名.com;

    # 上传的图片与前端静态资源都走后端（同源托管），这里只做反代
    client_max_body_size 10M;     # 商品图上传，默认 1M 会 413

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 必须关闭缓冲，否则 AI 流式回答会「一次性蹦出来」
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    # 静态资源长缓存（文件名带 hash，可放心 immutable）
    location /assets/ {
        proxy_pass http://127.0.0.1:3000;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/smart-second-hand /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

> **SSE 的坑**：`proxy_buffering off` 必须开，否则 `/api/ai/chat` 的流式效果会被 Nginx 攒成一坨。

### 6. HTTPS（Let's Encrypt）

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名.com
```

证书自动续期由 certbot 的 systemd timer 负责，可用 `sudo certbot renew --dry-run` 验证。

### 7. 数据备份

```bash
# 每日 3 点备份，保留 14 天
cat > /home/ubuntu/backup.sh <<'EOF'
#!/usr/bin/env bash
set -e
STAMP=$(date +%F)
mysqldump -ush -p'强密码' smart_second_hand | gzip > /var/backups/sh-$STAMP.sql.gz
find /var/backups -name 'sh-*.sql.gz' -mtime +14 -delete
EOF
chmod +x /home/ubuntu/backup.sh
( crontab -l 2>/dev/null; echo "0 3 * * * /home/ubuntu/backup.sh" ) | crontab -
```

### 8. 更新发布

```bash
cd /var/www/smart-second-hand-platform
git pull
cd server && npm ci && npx prisma migrate deploy && npm run build && cd ..
cd client && npm ci && npm run build && cd ..
pm2 restart smart-second-hand
```

---

## 三、方案 B · Vercel（前端）+ Railway（后端）

### 1. 数据库（Railway 或任何托管 MySQL）

1. Railway → New Project → **Provision MySQL**
2. 拿到 `DATABASE_URL`（形如 `mysql://root:xxx@containers-us-west-x.railway.app:6543/railway`）

> 本地对云数据库初始化：
> ```bash
> cd server
> DATABASE_URL="粘贴云库地址" npx prisma migrate deploy
> DATABASE_URL="粘贴云库地址" npm run seed
> ```

### 2. 后端（Railway）

- New Service → Deploy from GitHub repo
- **Root Directory**：`server`
- **Build Command**：`npm ci && npx prisma generate && npm run build`
- **Start Command**：`node dist/index.js`
- 环境变量：`NODE_ENV=production`、`DATABASE_URL`、`JWT_SECRET`、`CORS_ORIGIN=https://你的前端.vercel.app`、`AI_MOCK=true`（或有 Key 时填 `DEEPSEEK_API_KEY`）
- ⚠️ **上传目录**：Railway 容器文件系统是临时的，重启会丢图。要么挂 Volume 并把 `UPLOAD_DIR` 指过去，要么把图片改成对象存储（OSS/S3）。演示项目挂 Volume 即可。

### 3. 前端（Vercel）

- Import Project → **Root Directory** 选 `client`
- Framework：**Vite**；Build：`npm run build`；Output：`dist`
- **关键：跨域怎么解决**

  前端所有请求都用相对路径 `/api`（`client/src/api/request.ts` 的 `baseURL = '/api'`，
  SSE 也是 `fetch('/api/ai/chat')`），因此最省事的做法是让 Vercel 把 `/api` 反代到后端，
  保持同源（**不需要改任何代码，也不需要配 CORS**）。在 `client/vercel.json` 加：

  ```json
  {
    "rewrites": [
      {
        "source": "/api/:path*",
        "destination": "https://你的后端.up.railway.app/api/:path*"
      },
      {
        "source": "/uploads/:path*",
        "destination": "https://你的后端.up.railway.app/uploads/:path*"
      }
    ]
  }
  ```

- 若你更想直连后端（例如要给移动端复用），则需要把 `baseURL` 改成
  `import.meta.env.VITE_API_BASE ?? '/api'`，同时改 `client/src/api/aiChat.ts` 里的
  `fetch('/api/ai/chat')`，并在 Vercel 配 `VITE_API_BASE`、在后端配 `CORS_ORIGIN`。

> SSE 走 Vercel 反代是可用的（Vercel 支持流式响应），但记得后端不要被任何中间层加缓冲。

### 4. 跨域与安全头

- 按上面的 Vercel rewrite 方案，浏览器侧全是同源请求，`CORS_ORIGIN` 保持默认即可
- 如果改成直连后端，则 `CORS_ORIGIN` 必须包含 `https://你的前端.vercel.app`（含协议，不要写 `*`）
- helmet 已内置 CSP；后端只返回 JSON 时不受影响，同源托管前端时已针对 Element Plus 内联样式放开

---

## 四、常见坑

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| AI 回答一次性蹦出来，没有打字效果 | Nginx 缓冲区把 SSE 攒批了 | `proxy_buffering off; proxy_cache off;` |
| 上传图片 413 | Nginx 默认 `client_max_body_size 1M` | 调到 `10M` |
| 重启后图片全 404 | 容器/临时磁盘 | `UPLOAD_DIR` 指向持久卷，或改用对象存储 |
| 前端请求 401 后又跳登录 | Token 过期（默认 7 天） | 重新登录；或调 `JWT_EXPIRES_IN` |
| 部署后报 `P1001 无法连接数据库` | 云库未开放公网 / 端口不对 | 检查 `DATABASE_URL` 端口与白名单 |
| 中文乱码 / `Incorrect string value` | 库表不是 `utf8mb4` | 建库时指定 `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` |
| 看板日期与本地差 8 小时 | 数据库/应用时区不一致 | 统一设 `TZ=Asia/Shanghai`，MySQL 用 `--default-time-zone='+08:00'` |
| 登录提示「失败次数过多」 | 触发了限流（15 分钟） | 等窗口结束，或调大 `AUTH_RATE_LIMIT_MAX` |

---

## 五、上线检查清单

- [ ] `JWT_SECRET` 已换成随机串，且未提交进仓库
- [ ] `NODE_ENV=production`
- [ ] `prisma migrate deploy` 已执行（不是 `migrate dev`）
- [ ] `/uploads` 有持久化卷与备份
- [ ] HTTPS 证书生效，HTTP 自动跳转
- [ ] `CORS_ORIGIN` 只包含自己的域名
- [ ] 演示账号密码已按需修改（或删除 `seed` 生成的账号）
- [ ] `pm2 save` + `pm2 startup` 已配置
- [ ] 数据库定时备份已生效
