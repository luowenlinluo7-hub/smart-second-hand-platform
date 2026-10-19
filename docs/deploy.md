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
- 环境变量：
  - `NODE_ENV=production`
  - `DATABASE_URL`（第 1 步拿到的云库地址）
  - `JWT_SECRET`
  - `CORS_ORIGIN=https://smart-second-hand.vercel.app`
  - `AI_MOCK=true`（或有 Key 时填 `DEEPSEEK_API_KEY`）
  - **图片存储**：`CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET`
- ⚠️ **为什么必须配 Cloudinary**：Railway 容器文件系统是临时的，重启即丢。
  三项凭据配齐后上传自动切到云端（`GET /api/health` 的 `imageDriver` 会变成 `cloudinary`）；
  不配则退回本地盘，重启后图片全部 404。
  替代方案是挂 Railway Volume 并设 `UPLOAD_DIR` 指向它，但多实例时会不一致，云端更省心。
- 部署完访问 `https://<你的后端>.up.railway.app/api/health`，确认
  `{"imageDriver":"cloudinary"}` 再继续。

### 3. 前端（Vercel）

- Import Project → **Root Directory** 选 `client`
- Framework：**Vite**；Build：`npm run build`；Output：`dist`
- 后端 `CORS_ORIGIN` 里填 Vercel 的域名：`https://smart-second-hand.vercel.app`
  （预览部署的 `<project>-<hash>-<scope>.vercel.app` 由后端代码里的正则自动放行，不用逐个加）
- **关键：跨域怎么解决**

  前端所有请求都用相对路径 `/api`（`client/src/api/request.ts` 的 `baseURL = '/api'`，
  SSE 也是 `fetch('/api/ai/chat')`），因此最省事的做法是让 Vercel 把 `/api` 反代到后端，
  保持同源。在 `client/vercel.json` 加：

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

  > 只在**本地驱动**下才需要第二条 `/uploads` rewrite；
  > 用 Cloudinary 时图片是绝对地址，直接由 `res.cloudinary.com` 提供，可以删掉。
  >
  > 另外 CORS 白名单与 rewrite 并不冲突：rewrite 让浏览器侧变成同源（更简单），
  > CORS 则保证「前端直连后端」这条路也能走（例如将来接移动端）。

- 若你更想直连后端（直接跨域，不经过 Vercel 代理），把 `baseURL` 改成
  `import.meta.env.VITE_API_BASE ?? '/api'`，同时改 `client/src/api/aiChat.ts` 里的
  `fetch('/api/ai/chat')`，并在 Vercel 配 `VITE_API_BASE`。
  后端已放行 `https://smart-second-hand.vercel.app` 与所有 `*.vercel.app` 预览域名。

### 4. SSE 在 Vercel 代理下的注意事项

后端已经把能做的都做了（`X-Accel-Buffering: no`、`Content-Encoding: identity`、
`Cache-Control: no-cache, no-transform`、开流即发 `: stream-open`、10s 心跳），
浏览器侧只要用 `fetch` + `ReadableStream` 逐块解析即可（本项目已如此实现）。

部署侧还要注意：

| 项 | 要求 |
| --- | --- |
| Vercel 侧压缩 | 关闭（`vercel.json` 不要启用 gzip/brotli 相关配置，默认也不会对流式响应压缩） |
| 中间 CDN | Cloudflare 等如果要接，关掉「Rocket Loader」与响应压缩，否则会攒批 |
| 代理读超时 | 不小于 `AI_CHAT_TIMEOUT_MS`（默认 30s） |
| 前端读取方式 | 必须 `fetch`，不能用 `EventSource`（本接口是 POST + JSON body） |

验证方法（部署后直接对代理地址测）：

```bash
curl -N -X POST https://smart-second-hand.vercel.app/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"2000 以内的游戏本"}'
```

正常表现：**第一行立刻出现 `: stream-open`**，随后逐条出现 `event: thought` / `event: delta`。
如果 3 秒内一个字节都没回来，说明中间层在缓冲。

### 5. 跨域与安全头

- 后端 CORS 采用「显式白名单 + `*.vercel.app` 预览域名正则」，
  不放行的来源不会返回 `Access-Control-Allow-Origin`（浏览器自然拦住），
  但服务端不抛错，避免日志里堆 500
- helmet 已内置 CSP：
  - 同源托管前端时已针对 Element Plus 内联样式放开 `style-src`
  - **启用 Cloudinary 时 `img-src` 会自动加上 `https://res.cloudinary.com`**
    （不加的话上传后的商品图会被浏览器以 CSP 为由拦掉，这是最容易踩的坑）
  - `connect-src` 会加上 `https://api.cloudinary.com`

---

## 四、常见坑

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| AI 回答一次性蹦出来，没有打字效果 | 中间层把 SSE 攒批了 | Nginx: `proxy_buffering off;`；CDN: 关压缩；见第三节第 4 小节 |
| 上传图片 413 | Nginx 默认 `client_max_body_size 1M` | 调到 `10M` |
| 重启后图片全 404 | 用了本地驱动但磁盘是临时的 | 配齐 `CLOUDINARY_*` 三项切云端，或 `UPLOAD_DIR` 指向持久卷 |
| 上传报「图片上传到云端失败：Invalid Signature」 | `CLOUDINARY_API_SECRET` 填错 / 多了引号或空格 | 到 Cloudinary 控制台重新复制；`.env` 里不要带多余空格 |
| 上传成功但商品图裂图、控制台报 CSP | `img-src` 没放行 Cloudinary | 本仓库已自动处理；若自己改过 helmet，需加 `https://res.cloudinary.com` |
| `/api/health` 里 `imageDriver` 仍是 `local` | 凭据没配齐（三项缺一即回落） | 检查三个变量是否都存在值（空字符串也算缺） |
| 前端请求 401 后又跳登录 | Token 过期（默认 7 天） | 重新登录；或调 `JWT_EXPIRES_IN` |
| 部署后报 `P1001 无法连接数据库` | 云库未开放公网 / 端口不对 | 检查 `DATABASE_URL` 端口与白名单 |
| 浏览器报 CORS 错误 | 前端域名不在白名单 | 写进 `CORS_ORIGIN`；`*.vercel.app` 预览域名已自动放行 |
| 中文乱码 / `Incorrect string value` | 库表不是 `utf8mb4` | 建库时指定 `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` |
| 看板日期与本地差 8 小时 | 数据库/应用时区不一致 | 统一设 `TZ=Asia/Shanghai`，MySQL 用 `--default-time-zone='+08:00'` |
| 登录提示「失败次数过多」 | 触发了限流（15 分钟） | 等窗口结束，或调大 `AUTH_RATE_LIMIT_MAX` |

---

## 五、上线检查清单

- [ ] `JWT_SECRET` 已换成随机串，且未提交进仓库
- [ ] `NODE_ENV=production`
- [ ] `prisma migrate deploy` 已执行（不是 `migrate dev`）
- [ ] `GET /api/health` 返回的 `imageDriver` 符合预期（云部署应为 `cloudinary`）
- [ ] `/uploads` 有持久化卷与备份（仅本地驱动时）
- [ ] HTTPS 证书生效，HTTP 自动跳转
- [ ] `CORS_ORIGIN` 只包含自己的域名（不要写 `*`）
- [ ] SSE 已验证：`curl -N` 第一行立刻返回 `: stream-open`
- [ ] 演示账号密码已按需修改（或删除 `seed` 生成的账号）
- [ ] `pm2 save` + `pm2 startup` 已配置
- [ ] 数据库定时备份已生效
