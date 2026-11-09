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
# Node 20 已 EOL，这里用 24 LTS（与开发/测试环境一致：v24.22.1）
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
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
  - `CORS_ORIGIN=https://smart-second-hand-platform.vercel.app`
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
- **必须有 `client/vercel.json` 的 SPA 回退**（仓库里已提供）：

  ```json
  {
    "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }]
  }
  ```

  > 没有它，只有 `/` 能打开；直接访问或**刷新** `/orders`、`/dashboard` 这类路由会返回
  > Vercel 的 `404 NOT_FOUND` 页（因为是静态托管，服务器上并不存在这些路径）。
  > 移动端演示时随手刷新一下就白屏，属于必配项。
  > 同理，Netlify 需要在 `client/public/_redirects` 写 `/*  /index.html  200`。
- 后端 `CORS_ORIGIN` 里填 Vercel 的域名：`https://smart-second-hand-platform.vercel.app`
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
      },
      {
        "source": "/((?!api/|uploads/).*)",
        "destination": "/index.html"
      }
    ]
  }
  ```

  > 最后一条不能省：`rewrites` 是整体替换的，只写前两条会把 SPA 回退覆盖掉，
  > 非首页路由又会 404。
  >
  > 只在**本地驱动**下才需要第二条 `/uploads` rewrite；
  > 用 Cloudinary 时图片是绝对地址，直接由 `res.cloudinary.com` 提供，可以删掉。
  >
  > 另外 CORS 白名单与 rewrite 并不冲突：rewrite 让浏览器侧变成同源（更简单），
  > CORS 则保证「前端直连后端」这条路也能走（例如将来接移动端）。

- 若你更想直连后端（直接跨域，不经过 Vercel 代理），**不需要改任何代码**：
  在 Vercel 项目的 Environment Variables 里加
  `VITE_API_BASE_URL = https://你的后端.up.railway.app`
  （只填到域名，**不要带 `/api` 后缀，也不要带末尾斜杠**），然后重新 Deploy。
  axios 实例（`client/src/api/request.ts`）与 SSE 的 `fetch`（`client/src/api/aiChat.ts`）
  都已读取该变量并自动拼上 `/api`；Vite 只在构建时注入 `VITE_` 前缀的变量，所以改完必须重新部署。
  后端已放行 `https://smart-second-hand-platform.vercel.app` 与本项目的 `*.vercel.app` 预览域名。

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
curl -N -X POST https://smart-second-hand-platform.vercel.app/api/ai/chat \
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

---

## 六、答辩场景：国内免备案访问

> 增补于 2026-11。Vercel 官方知识库明确：其在中国大陆没有服务器与 CDN 节点，
> `*.vercel.app` 受网络干扰，换自定义域名或前置 CDN 也**不保证**可用性。
> 因此「国内教室展示」不要继续优化第三节的 Vercel + Railway 方案。

### 6.1 结论速查

| 路线 | 入口 | 备案 | 依赖公网 | 定位 |
| --- | --- | :---: | :---: | --- |
| 1 + 2 组合 | **根目录 `start-defense-demo.bat`**（答辩当天只双击这个） | 否 | 仅备用链接 | **推荐** |
| 1 · 局域网直连 | 根目录 `start-lan-demo.bat` | 否 | 否 | **主用** |
| 2 · 内网穿透 | 见 6.3 | 否 | 是 | **备用**：给评委扫码 / 异地查看 |
| 3 · 国内轻量服务器 | 见 6.4 | IP + 高端口通常无需 | 是 | 需要长期有效的公网链接 |

`start-defense-demo.bat` 是路线 1 + 2 的**预配置双击入口**：把隧道服务商、固定域名、
端口、二维码等集中在文件顶部，双击即按「局域网主用 + 公网备用」一次启动，详见 6.3。

三者共用同一个「单端口同源」底座，均已存在于仓库中，**无需改造业务代码**：

- `server/src/app.ts`：`CLIENT_DIST` 静态托管 + SPA fallback（`app.use` 写法，兼容 Express 5）
- `client/src/api/request.ts`：未注入 `VITE_API_BASE_URL` 时 `baseURL = '/api'`
- `scripts/demo/start-demo.ps1`：强制 `AI_MOCK=true`、清空 Cloudinary 凭据、便携 MySQL 仅绑 `127.0.0.1`
- `client/dist`：已核实不含 `vercel.app` / `railway.app` 地址；字体由 `@fontsource` 本地打包

由此天然获得：无跨域白名单问题、无 Nginx 反代、无境外图床、断网可演示。

### 6.2 路线 1 · 局域网直连（推荐主用）

双击根目录 `start-lan-demo.bat` 即可启动主用链路（备用公网隧道见 6.3；
答辩当天建议直接双击预配置好的 `start-defense-demo.bat`），或：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\demo\start-lan-demo.ps1
# 校园网 / 手机热点被 Windows 识别为「公用网络」时
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\demo\start-lan-demo.ps1 -AllowPublic
# 答辩后删除防火墙规则
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\demo\start-lan-demo.ps1 -Cleanup
# 只检查、不启动、不需要管理员
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\demo\start-lan-demo.ps1 -DryRun
```

脚本依次：自动申请管理员权限（仅防火墙需要）→ 放行 TCP 3000 入站 → 按默认路由网卡
枚举局域网 IPv4 → 输出 `http://<IP>:3000` → 启动原离线演示服务（阻塞至 Ctrl+C）。
`-Qr` 在装有 `qrcode` + `pillow` 时生成二维码（`pip install "qrcode[pil]"`）。

注意事项：

- 端口以启动窗口输出为准：仓库内 `start-demo.ps1` 默认 **3000**；`build-demo.ps1` 打出的独立演示包默认 **3210**。
- 脚本会清除当前会话的 `VITE_API_BASE_URL`，避免前端重建时把 Vercel / Railway 地址注入产物。
- 校园网常开启 AP 隔离导致同 WiFi 设备互不可达；**用手机热点自建局域网**即可绕开。
- 便携 MySQL 使用 root 空密码且只绑 `127.0.0.1`，**不要**改成 `0.0.0.0`。
- 同源访问下 `CORS_ORIGIN=http://localhost:3000` 不影响浏览器请求（同源不触发 CORS 拦截）。
- 防火墙规则名为 `SmartSecondHand-LAN-<端口>`，`-Cleanup` 仅删除本脚本创建的规则。
- 若机器装了代理软件并同时注入 `HTTPS_PROXY` 与 `https_proxy`（仅大小写不同），
  PowerShell 5.1 的 `Start-Process` 会抛「已添加了具有相同键的项」而启动失败。
  `start-lan-demo.ps1` 已在启动前自动去重（仅当前进程生效、不改系统设置）；
  直接双击原 `start-demo.bat` 不在此保护范围内。

### 6.3 路线 2 · 内网穿透（备用公网链接）

> **定位**：给评委扫码、异地回看的**备用**链接，不是答辩主演示链路。
> 主链路仍是本机 `localhost` / 局域网（路线 1）。隧道依赖三段：笔记本持续在线、
> 教室出口网、服务商节点，任何一段中断都会白屏。

#### 第 0 步：去哪里注册、买固定域名

> 注册的是**隧道服务商账号**，不是域名注册商，也不涉及 ICP 备案：固定地址用的是
> 服务商已备案的二级子域名。选一家即可，下面两家脚本都支持。

| | cpolar（默认、推荐） | NATAPP（预算优先） |
| --- | --- | --- |
| 官网 / 注册 | `https://www.cpolar.com/` →「免费注册」（邮箱） | `https://natapp.cn` →「免费注册」（手机号 + 验证码） |
| 后台 | `https://dashboard.cpolar.com/` | 登录后「会员中心」 |
| 实名认证 | 国内节点固定二级子域名需要，后台按提示完成 | **必须先做**，左侧「实名认证」，支付宝扫码；否则不能买隧道 |
| 客户端下载 | `https://www.cpolar.com/download` → Windows 64 位 | 后台「客户端下载」→ Windows 64 位（或一键脚本） |
| 本地管理面板 | `http://127.0.0.1:9200` | 无（隧道在官网后台配置） |
| 绑定凭据 | 后台「验证」页复制 authtoken → 执行一次 `cpolar authtoken <token>`（保存在 `%USERPROFILE%\.cpolar\`） | 后台「我的隧道」复制该隧道的 authtoken → 写入 `config.ini` 或 `NATAPP_AUTHTOKEN` |
| 买固定地址 | 后台「套餐升级」→ 基础版及以上（免费版**不支持**固定域名）→「预留」→「保留二级子域名」，地区选 China Top / China VIP，填自定义前缀 | 后台「购买隧道」→ 协议选 **Web**、本地端口填 **3000** → 在「二级域名」里选一个固定二级域名 |
| 生效地址在哪看 | 本地面板「状态 → 在线隧道列表」，或把隧道「域名类型」改为「二级子域名」并填 Sub Domain | 「我的隧道」列表里的域名 |

##### 预留表单逐项怎么填（`dashboard.cpolar.com/reserved`）

| 字段 | 填什么 | 说明 |
| --- | --- | --- |
| 地区 | **China Top** | 下拉框默认可能是 `United States`，**务必改掉**：美国节点是跨境链路，国内教室又慢又不稳，等于回到 Vercel 的老问题；且与国内隧道地区不匹配会绑不上。预留与 9200 面板里的隧道必须是同一地区。 |
| 名称 | 自定义小写短前缀，如 `myershou` | 全局唯一，被占用就换一个；只用小写字母 / 数字 / 连字符，短一点好念，别用 `YOUR-SUBDOMAIN` 这类占位词。 |
| 描述 | 可留空，或填「毕业答辩演示」 | 仅备注，不影响地址。 |

点「保留」若提示升级，先去左侧「套餐」升级（免费版不支持固定域名）；国内节点可能要求
先完成左侧「实名认证」。

**页面上的 `--subdomain=YOUR_SUBDOMAIN` 说明只适用于命令行启动隧道**。本机 cpolar 是
后台服务常驻（见第 0.5 步），不用敲这条命令；改为在 `http://127.0.0.1:9200`
「隧道管理 → 隧道列表」编辑那条 **3000 端口**的隧道：域名类型选「二级子域名」、
Sub Domain 填刚保留的名称、地区同样选 China Top → 更新。之后「状态 → 在线隧道列表」
里的地址才会变成固定域名。**只保留、不绑定，公网地址依旧是随机域名。**

页面下方「保留自定义域名」「保留的 TCP 地址」两块不要碰：前者要自有域名 + CNAME，
会重新牵出备案；后者给 SSH / 远程桌面用且需要更高等级套餐。固定二级子域名通常形如
`https://<名称>.cpolar.top`（不像免费随机域名那样带 `.r2.` 段），最终仍以
「在线隧道列表」显示为准。

**从后台复制完整地址**（形如 `https://你的前缀.cpolar.top` 或 `.cpolar.cn` / `.cpolar.io`，
后缀以实际显示为准，不要照抄本仓库的占位值），填进 `start-defense-demo.bat` 的
`DEMO_FIXED_URL`。免费随机域名常带**地区前缀**，例如 `https://abcd1234.r2.cpolar.top`、
`https://abcd1234.r8.vip.cpolar.cn`；必须**原样整串复制**，不要自行删掉中间的 `.r2.` / `.vip.`，
少一段就会得到 cpolar 的 404「domain doesn't exist」页（页面看起来像项目挂了，其实是地址抄错）。
另两个必须对齐的细节：

- **地区要一致**：cpolar 预留子域名时选的地区，必须与隧道地区相同，否则域名不生效。
- **端口要一致**：cpolar 隧道本地地址填 3000；NATAPP 购买 Web 隧道时本地端口填 3000。
  与 `DEMO_PORT` 不一致时公网页面会 502。

脚本会把固定地址转成 cpolar 的 `--subdomain=<前缀>` 启动参数（自有域名则转
`--hostname=`），保证窗口打印的地址就是隧道实际绑定的地址；未填真实域名时会
拒绝传参，只用随机地址。NATAPP 的域名与端口绑定在官网隧道配置里，客户端只负责连接，
所以脚本无需额外参数。

> 安全：authtoken 等于账号下所有隧道的钥匙，只放在客户端本地配置或环境变量里，
> **不要**写进脚本、PPT 或提交到 git。本仓库脚本不保存、不传递任何明文 token。

#### 第 0.5 步：先免费跑通，再付费

买套餐只买到「固定二级子域名」这一项能力，**不买也能立刻拿到随机公网地址**。
正确顺序是先花 20 分钟用免费地址把整条链路验通，确认没有端口、SSE、图片问题，
再付款保留固定域名；否则买完才发现 502 / AI 不流式，钱和时间都白花。

1. 客户端装好后先在 `http://127.0.0.1:9200` 用官网账号登录，确认「状态 → 在线隧道列表」
   能看到一条 https 地址（免费随机域名，24 小时会变，仅用于验证）。
2. **把隧道的本地地址改成 3000**。安装后自带的示例隧道常指向 `8080`（website）或
   `3389`（remoteDesktop），这两个端口通常没有服务；用 `netstat` 或启动窗口确认演示服务
   实际端口，与 `DEMO_PORT` 保持一致，否则公网一律 502。不用的示例隧道建议停掉，
   避免占用免费版隧道额度。
3. 先跑一次 `start-demo.bat`（或 `start-defense-demo.bat`），本机 `/api/health` 返回 200。
4. 手机**关闭 WiFi 走蜂窝网络**打开随机地址，逐项验证：登录、下单、上传图片、
   AI 流式回答首行立即返回 `: stream-open`、深链刷新。
5. 全部通过 → 再买套餐 →「预留 / 保留二级子域名」→ 把该子域名绑到**同一条 3000 端口的
   隧道** → 从「在线隧道列表」复制完整固定地址 → 填入 `DEMO_FIXED_URL` → 再验一次。

##### 客户端已作为后台服务运行时，不要再让脚本起第二个进程

若 cpolar 已装成 Windows 服务 / 开机自启（任务管理器有 cpolar 进程、9200 面板可访问、
`%USERPROFILE%\.cpolar\cpolar.yml` 里已有 `authtoken` 和 `tunnels`），说明隧道由后台服务
常驻管理。此时**推荐面板模式**：

```bat
set "DEMO_TUNNEL=none"                          rem 不让脚本另起 cpolar 进程
set "DEMO_FIXED_URL=https://你的前缀.cpolar.top"  rem 面板里看到的固定地址
```

脚本只负责本机演示服务、防火墙、地址展示与二维码；隧道转发交给后台服务，
不受演示服务启停影响，答辩现场更稳。若坚持让脚本启动隧道（**命令行模式**），
需先停掉后台服务避免同账号重复占用，并注意客户端往往不在 PATH：

```bat
set "DEMO_TUNNEL=cpolar"
set "DEMO_TUNNEL_EXE=F:\coplar\cpolar.exe"     rem 按本机实际安装路径填
```

判断客户端是否在 PATH：PowerShell 执行 `Get-Command cpolar`；无输出就必须填 `DEMO_TUNNEL_EXE`。

#### 第 0.6 步：本机公网链路实测（2026-11-09，已通过 → 可以购买固定域名）

从**独立公网出口**（非 localhost、非同一 WiFi）对免费随机域名做了一轮完整验收，
结论是链路已通，付款前的技术风险已经排除：

| 验收项 | 实测结果 |
| --- | --- |
| 地址格式 | 实际生效的是带地区前缀的 `https://<随机串>.r2.cpolar.top`；从后台「在线隧道列表」复制，或从 `%USERPROFILE%\.cpolar\logs\cpolar_service.log` 里查 `https://...cpolar.top` |
| `/api/health` | 200，`service=smart-second-hand-server`、`imageDriver=local` |
| SPA 深链刷新 `/` `/orders` `/cart` `/publish` `/admin` | 全部 200 且返回 index.html（单端口同源托管 + SPA fallback 生效） |
| 数据接口 `/api/products`、`/api/categories` | 200，分别约 9.6KB / 383B |
| 静态资源 | 200；主 JS 885KB、主 CSS 375KB |
| AI 流式 `POST /api/ai/chat` | TTFB **0.31s**，首行立即 `: stream-open`；响应头含 `Cache-Control: no-transform`、`Content-Encoding: identity`、`X-Accel-Buffering: no` → 中间层没有攒批 |

两点必须记住：

- **随机域名会变，绝不能印进 PPT**。本机同一份客户端日志里已出现过两个不同随机域名
  （`.r2.cpolar.top` 与 `.r8.vip.cpolar.cn`），重连、重启、24 小时刷新都会换地址。
  这一步通过后即可去后台购买固定二级子域名，拿到后填入 `DEMO_FIXED_URL`，
  再用同一套验收重跑一次。
- **首屏体积是固定成本**：静态资源合计约 **1.47MB**。免费随机隧道实测约 150KB/s
  （主 JS 885KB 传了约 6 秒），首屏明显偏慢；换成保留的固定域名后实测约 266KB/s
  （见第 0.7 步），已有明显改善但仍需数秒。因此答辩主用仍是本机 `localhost` + 局域网，
  公网链接只给评委扫码回看；可提前在教室打开页面预热，避免现场等白屏。

验收命令模板（`BASE` 换成后台显示的**完整**地址，别漏地区前缀）：

```bash
BASE="https://<你的完整地址>"
curl -sS -w "\nHTTP=%{http_code} TTFB=%{time_starttransfer}s\n" "$BASE/api/health"
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE/orders"            # 深链刷新须 200
curl -sS -N --max-time 10 -X POST "$BASE/api/ai/chat" \
  -H "Content-Type: application/json" -d '{"message":"2000 以内的游戏本"}'
# 首行须立即出现 : stream-open
```

> 上述为脚本化实测，等价于从外部网络访问；仍建议用**手机关闭 WiFi 走蜂窝网络**复核一次，
> 排除校园网 DNS / 运营商劫持。探测 AI 接口会消耗一次后端限流额度（`Ratelimit: 20/60s`），
> 演示包为 `AI_MOCK=true`，不消耗模型额度。

#### 第 0.7 步：固定域名验收通过（2026-11-09）

已保留一个固定的二级子域名并绑定到 3000 端口隧道，固定地址形如
**`https://<你的前缀>.cpolar.top`**（用 https，不要填 http；响应带 HSTS）。
该地址**不写进仓库**，而是填在本机的 `demo-config.local.bat` 里（该文件已 gitignore）：

```bat
set "DEMO_FIXED_URL=https://<你的前缀>.cpolar.top"
```

入口脚本会在套用默认值**之前**加载这个文件，因此占位保护自动失效，
`-PublicUrl` 会把它用于地址展示与二维码。

从独立公网出口重验结果：

| 验收项 | 结果 |
| --- | --- |
| `https` / `http` 健康检查 | 均 200，`imageDriver=local`；https 首次 TLS 握手约 2.1s，之后 0.27s |
| 深链刷新 `/` `/orders` `/cart` `/publish` `/admin` | 全部 200 |
| `/api/products`、`/api/categories` | 200，9.6KB / 383B |
| 静态资源 | 200；主 JS 885KB 约 3.3s（266KB/s）、主 CSS 375KB 约 0.57s，合计 1.47MB |
| AI 流式 | TTFB **0.13s**，首行 `: stream-open`；`Transfer-Encoding: chunked` + `no-transform` + `X-Accel-Buffering: no` |
| 旧随机域名（形如 `<随机串>.r2.cpolar.top`） | **404**——绑定固定域名后旧地址立即失效，证实随机地址绝不能印进 PPT |

结论：**这个固定地址现在可以印进 PPT / 二维码**。答辩当天仍按「本机 `localhost` 主用 →
局域网 → 公网扫码备用」的优先级；首次打开建议提前预热（TLS 握手 + 1.47MB 首屏）。
换服务商或改子域名前缀时，只需改 `DEMO_FIXED_URL` 一行并重跑第 0.6 步的验收命令。

二维码**不进仓库**（它包含固定地址）。需要打印版时，用入口的 `-Qr` 生成到
`%TEMP%\smart-second-hand-demo-qr.png`，再手动另存到本地或直接插入 PPT。

**机房实机复核（2026-11-09 14:07，校内机房电脑）**：通过校园网直接打开
该固定公网地址，首页与导航完整渲染，右上角「管理员已登录」状态正常，
4 张商品图全部显示（`imageDriver=local` 的 `/uploads` 经公网隧道正常返回，无裂图），
无错误提示。说明**公网备用链路在答辩实际网络环境下可用**，不必依赖同一 WiFi。
截图仅覆盖首页，深链刷新、下单 / 上传图片 / AI 流式仍需按 6.5 清单现场走一遍。

> 二维码依赖的 Python 解释器坑：脚本用 `Get-Command python` 解析到的解释器
> （本机为 `C:\Python314\python.exe`），**必须把 `qrcode[pil]` 装到这一个**：
> `C:\Python314\python.exe -m pip install "qrcode[pil]"`。
> 装到其它 Python（如编辑器内置解释器）时 `-Qr` 仍会提示缺库。

#### 答辩专用双击入口（推荐）

根目录 `start-defense-demo.bat` 把常用参数固化成文件顶部的配置区，**答辩当天只需双击**，
不用记任何命令。用记事本打开，按实际情况改这几行（其余保持默认）：

```bat
if not defined DEMO_TUNNEL       set "DEMO_TUNNEL=none"
if not defined DEMO_FIXED_URL    set "DEMO_FIXED_URL=https://YOUR-SUBDOMAIN.cpolar.top"
if not defined DEMO_TUNNEL_EXE   set "DEMO_TUNNEL_EXE="
if not defined DEMO_PORT         set "DEMO_PORT=3000"
if not defined DEMO_QR           set "DEMO_QR=1"
if not defined DEMO_ALLOW_PUBLIC set "DEMO_ALLOW_PUBLIC=1"
```

只改等号右边的值，不要动前面的 `if not defined`（它让环境变量可以临时覆盖配置）。

> **固定公网地址不要写进这个 .bat**。仓库是公开的，写进去等于把地址公开。
> 把地址填在同目录的 **`demo-config.local.bat`**（已 gitignore，不会进仓库）：
>
> ```bat
> set "DEMO_FIXED_URL=https://<你的前缀>.cpolar.top"
> ```
>
> 入口会在套用默认值之前 `call` 这个文件，所以本地双击照常读到真实地址；
> 别人 clone 下来没有这个文件，就会落回占位值并自动降级为「纯局域网」。
> 换机器或换域名时，只改本地这个文件即可。
>
> `DEMO_FIXED_URL` 填保留的固定域名（**用 https；更换服务商或前缀时，原样复制后台显示的整串地址**）；
`DEMO_TUNNEL` 默认 `none` 即面板模式（本机 cpolar 已是后台服务，见第 0.5 步），
只有停用后台服务、改由脚本启动客户端时才改成 `cpolar` / `natapp`；
`DEMO_TUNNEL_EXE` 在客户端没加入 PATH 时填绝对路径；`DEMO_PORT` 必须与隧道指向的
本地端口一致；`DEMO_QR=1` 需先 `pip install "qrcode[pil]"`；校园网/热点建议保持
`DEMO_ALLOW_PUBLIC=1`。**不要在 `set` 行尾追加 `rem` 注释**，那会被当成变量值的一部分。

配置区的值也可用同名环境变量临时覆盖，便于彩排不改文件：

```powershell
$env:DEMO_EXTRA_ARGS = '-DryRun'   # 干跑：只打印将要执行的动作
.\start-defense-demo.bat
```

要点：

- **占位保护**：`DEMO_FIXED_URL` 仍含 `YOUR-SUBDOMAIN` / `YOUR_DOMAIN` / `EXAMPLE` 时，
  入口会清空 `DEMO_PUBLIC_URL`、不传 `-PublicUrl`。面板模式（`DEMO_TUNNEL=none`）下本次
  没有公网链接、不额外打扰；命令行模式下会打印 `[NOTICE]` 并说明脚本只从客户端日志
  提取临时地址。这是为了防止把假链接或 24 小时就失效的随机域名印进 PPT。
  本机已在 `demo-config.local.bat` 填好固定地址（见第 0.7 步），提示不会触发、
  二维码直接指向该稳定地址；更换地址时只需改这个本地文件。
- **命令行参数优先**：直接传参时配置区不生效，例如
  `.\start-defense-demo.bat -DryRun`、`.\start-defense-demo.bat -Cleanup`、
  `.\start-defense-demo.bat -Tunnel natapp -TunnelExe "D:\tools\natapp.exe"`。
  因此答辩后的清理、彩排时的干跑都仍用同一个入口。
- 双击窗口会停留（`Press any key to close`）；供脚本调用时可设 `DEMO_NO_PAUSE=1` 跳过。
- 默认 `-AllowPublic`：主脚本发现已有同名规则时会用 `Set-NetFirewallRule` 补齐
  Domain/Private/**Public** 配置文件，避免校园网被识别为「公用网络」时连不上
  （早期版本只复用旧规则、不补配置文件，会导致这个开关形同虚设）。

#### 手动一键用法（等价命令）

客户端预先登录一次，token 不进仓库、不进脚本：

```bash
cpolar authtoken <你的token>      # cpolar：一次配置长期保存
# natapp：在 natapp.exe 同级放 config.ini（authtoken=...），或设环境变量 NATAPP_AUTHTOKEN
```

```powershell
# 自动启动 cpolar，从客户端日志提取 https 地址（免费随机域名）
.\start-lan-demo.bat -Tunnel cpolar

# 推荐：使用已保留的固定二级子域名，地址不变，可提前印进 PPT / 二维码
.\start-lan-demo.bat -Tunnel cpolar -PublicUrl https://demo.cpolar.top -Qr

# 客户端已作为 Windows 服务在后台运行时，不需要脚本再启一个进程
.\start-lan-demo.bat -PublicUrl https://demo.cpolar.top -Qr

# natapp（隧道的本地端口需在官网配置为 3000）
.\start-lan-demo.bat -Tunnel natapp -TunnelExe "D:\tools\natapp.exe"
```

脚本不保存、不传递任何明文 token；只从 PATH 或 `-TunnelExe` 找客户端，再从客户端
stdout 日志按域名特征（`cpolar` / `natapp`）提取 https 地址，不依赖任何未公开的管理 API。
固定地址也可用环境变量 `DEMO_PUBLIC_URL` 提供。找不到客户端或提取失败时，只是少一条
备用链接，**不影响本机与局域网演示**。隧道进程会在演示服务退出时一并停止。

#### 套餐选择（2026-11 核实，以官网当期为准）

| 服务 | 免费版 | 固定地址 | 建议 |
| --- | --- | --- | --- |
| cpolar | 1Mbps、域名约 24 小时刷新、4 隧道 | 基础版 ¥99/年（保留 3 个子域名、2Mbps） | **推荐**：国内节点、中文面板、自动 https |
| NATAPP | 1Mbps、随机域名、约 2G/月、需实名 | 二级域名约 ¥9–20/年 | 预算优先时可选 |

**答辩不要用免费随机域名**：地址每 24 小时变化，提前印在 PPT / 二维码上的链接到答辩
当天可能已失效；1Mbps 带宽下 Element Plus + ECharts 首屏资源也会明显偏慢。
保留一个固定二级子域名的成本很低，10 天时间完全够。

#### 验收

1. 手机**关闭 WiFi（走蜂窝网络）**访问公网地址，确认不是局域网误判。
2. 验证 AI 流式回答未被中间层缓冲：

```bash
curl -N -X POST https://<公网地址>/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"2000 以内的游戏本"}'
```

首行应立即出现 `: stream-open`；若数秒无字节，说明中间层在攒批，需换节点或关闭压缩。

3. 检查 `/api/health` 返回 `imageDriver=local`（演示包已清空 Cloudinary），图片走同源 `/uploads`。

演示包已强制 `AI_MOCK=true`，不消耗模型额度；若临时启用真实 Key，务必在后端加按 IP 限流。

#### 10 天倒排

| 时间 | 事项 |
| --- | --- |
| T-10 ~ T-8 | **已完成（11/09）**：注册、保留固定子域名、填入配置区、公网全链路验收通过；仅剩手机蜂窝网复核 |
| T-7 ~ T-5 | 确认输出中已无 `[NOTICE]`、二维码指向固定域名；把固定链接放进 PPT，完整走一遍演示流程 |
| T-4 ~ T-2 | 至少 2 次全流程彩排（登录 → 下单 → 发货 → 评价 → 看板），录屏兜底 |
| T-1 | 到教室实测网络（校园网 AP 隔离）、备好手机热点、确认防火墙与端口 |
| T-0 | 本机 `localhost` 主演示；公网链接仅作备用与评委回看 |

**时间判断**：ICP 备案（常见 7–20 工作日）确实赶不上，但内网穿透使用服务商已备案的
二级域名，用户完全不接触备案流程，**当天即可跑通**。「时间不够」不是这条路的风险，
真正的风险是把时间都花在部署上、挤掉了彩排。

### 6.4 路线 3 · 国内轻量服务器（长期链接）

基于第二节「单机部署」流程的**删减版**——跳过 Nginx 80、HTTPS 证书与域名绑定：

1. 购买国内轻量应用服务器（新人/学生价常见 ¥38–68/年，以官网当期为准），Ubuntu 22.04 + Node 24 LTS + MySQL 8。
2. 按第二节第 2、3 步构建，但 `server/.env` 这样配：

```env
NODE_ENV=production
PORT=3000
DATABASE_URL="mysql://sh:强密码@127.0.0.1:3306/smart_second_hand"
JWT_SECRET="32 字节随机串"
CORS_ORIGIN="http://<服务器公网IP>:3000"
CLIENT_DIST="/var/www/smart-second-hand-platform/client/dist"
UPLOAD_DIR="/var/www/smart-second-hand-platform/server/uploads"
AI_MOCK=true
```

3. 云控制台安全组**只放行 TCP 3000**（不要放行 3306 到公网），用 PM2 守护 `dist/index.js`。
4. 访问 `http://<公网IP>:3000`。同源托管，无需反代。

**备案约束**：域名解析到大陆服务器并走 80/443 需完成 ICP 备案（常见 7–20 个工作日），
答辩通常来不及。使用「公网 IP + 非 80/443 高端口」一般不受域名备案校验影响，但各云厂商
策略存在差异，**务必提前实测**；该方式仅适合短期演示，正式对外服务仍应完成备案。

另外：国内部署**不要启用 Cloudinary**（境外图床可能加载慢或裂图），保持本地磁盘驱动，
并确保 `UPLOAD_DIR` 指向持久化目录。

### 6.5 现场验收与回退

- [ ] 本机 `http://localhost:3000/api/health` 返回 200，`imageDriver=local`
- [ ] 手机连同一 WiFi 访问 `http://<局域网IP>:3000`，首页与 `/orders` 深链刷新均正常
- [ ] 登录 → 下单 → 上传图片 → AI 流式回答逐项走通
- [x] 校内机房电脑通过校园网访问固定公网地址，首页、登录态与商品图正常（11/09）
- [ ] 可选：关闭 WiFi 用蜂窝网络再复核一次路线 2，排除校园网 DNS / 运营商差异
- [ ] 答辩后执行 `-Cleanup` 删除防火墙规则

#### 彩排后复原演示数据

每次彩排走完「下单 → 支付 → 评价」都会产生非 `seed-` 前缀的订单，并把在售商品置为
`SOLD` / 扣减库存，答辩前需复原。基线数值：**用户 4 / 分类 3 / 商品 64（14 在售 + 50
历史成交）/ 订单 50 / 明细 50 / 评价 53**。

复原必须两步：① 用 Prisma 删除所有非 `seed-` 前缀订单（关联 `OrderItem` 与 `Review`
由 `onDelete: Cascade` 一并清除）；② 执行 `prisma/seed.ts`，其 `upsert` 会把被改动的
标题、价格、状态、库存、浏览量恢复基线，并把历史订单时间刷新到近 30 天（避免看板空图）。
只做 ② 会留下测试订单；只做 ① 商品仍是 `SOLD`。`-Reseed` 只等价于第 ② 步。

> **连接串陷阱**：演示库是便携 MySQL `mysql://root:@127.0.0.1:3307/smart_second_hand_demo`
> （无密码），而 `server/.env` 的 `DATABASE_URL` 指向 `localhost:3306` 常规开发库。
> 手工跑 Prisma / seed 时**必须显式覆盖 `DATABASE_URL`**，否则会连错库甚至误改开发数据。
> `start-demo.ps1` 启动时已自行覆盖，走脚本无需关心。
>
> 任何写操作前先做全量逻辑备份（Prisma 导出 6 张表为 JSON），存放于
> `%LOCALAPPDATA%\smart-second-hand-demo\backups\`，该目录不进仓库。

回退顺序：① 本机 `localhost` 演示（不依赖任何网络）→ ② 录屏与 `docs/screenshots` 截图
→ ③ 保留 Vercel 链接作境外备用。**不要把公网链接作为唯一演示手段。**
