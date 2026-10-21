<div align="center">

# 智能二手交易平台

**让二手交易，像聊天一样简单**

用一句话说出需求，AI 帮你找到合适的商品。

![CI](https://github.com/luowenlinluo7-hub/smart-second-hand-platform/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-ff6b35)
![Node](https://img.shields.io/badge/node-%E2%89%A520-339933)
![Vue](https://img.shields.io/badge/vue-3.5-42b883)
![Prisma](https://img.shields.io/badge/prisma-6-2d3748)

一个前后端分离的全栈二手交易平台：**自然语言检索 + SSE 流式导购助手 + 真实聚合数据看板**，
覆盖买家、卖家、管理员三种角色的完整交易闭环。

🚀 **[在线体验](https://smart-second-hand-platform.vercel.app)** · `AI_MOCK` 演示模式，无需配置 Key

> ⚠️ **线上演示需要外网访问**：前端部署在 Vercel、后端与数据库在 Railway（均为海外节点），
> 国内网络可能较慢甚至打不开。若网络受限，或需要**完全断网**演示，请用下面的
> [一键离线演示](#一键离线演示答辩--断网场景)（纯本地运行，零外网请求）。

[功能一览](#功能一览) · [快速开始](#快速开始) · [一键离线演示](#一键离线演示答辩--断网场景) · [离线演示](#没有-deepseek-key也能全功能演示) ·
[架构设计](#系统架构) · [测试](#测试) · [部署](docs/deploy.md) · [API 契约](server/docs/api-contract.md)

</div>

---

## 界面预览

| 首页 · AI 搜索即入口 | 商品详情 · 图库 + 卖家卡 + 评价 |
| --- | --- |
| ![首页](docs/screenshots/01-home.webp) | ![商品详情](docs/screenshots/02-product-detail.webp) |

| 数据看板 · 真实聚合 | 订单详情 · 状态流转时间线 |
| --- | --- |
| ![看板](docs/screenshots/04-dashboard-trend.webp) | ![订单详情](docs/screenshots/06-order-detail.webp) |

| AI 导购助手 · 流式回答 | 看板 · 状态分布与分类占比 |
| --- | --- |
| ![AI 助手](docs/screenshots/03-ai-assistant.webp) | ![看板图表](docs/screenshots/05-dashboard-charts.webp) |

> 截图来自本地真实数据（seed 灌库后），不含任何静态假数据。

---

## 功能一览

| 模块 | 游客 | 买家 | 卖家 | 管理员 |
| --- | :-: | :-: | :-: | :-: |
| 浏览 / 搜索 / 筛选商品 | ✅ | ✅ | ✅ | ✅ |
| **AI 自然语言搜索**（一句话筛选） | ✅ | ✅ | ✅ | ✅ |
| **AI 导购助手**（多轮对话 + 商品卡） | ✅ | ✅ | ✅ | ✅ |
| 商品详情 / 卖家信誉 / 商品评价 | ✅ | ✅ | ✅ | ✅ |
| 注册 / 登录（bcrypt + JWT） | ✅ | ✅ | ✅ | ✅ |
| 个人资料 / 头像 / 改密码 | — | ✅ | ✅ | ✅ |
| 购物车 / 立即购买 / 下单 | — | ✅ | — | — |
| 订单列表 / 详情 / 状态流转 | — | ✅ | ✅ | — |
| 评价商品（评分 + 文字 + 晒图） | — | ✅ | — | — |
| 发布 / 编辑 / 下架 / 重新上架商品 | — | — | ✅ | — |
| 商品审核（通过 / 驳回并填写理由） | — | — | — | ✅ |
| **数据看板**（KPI + 4 张图表） | — | — | — | ✅ |

**核心亮点**

- **AI 三档降级**：真实模型 → 本地规则解析 → 关键词匹配。没有 API Key、模型超时、返回无法解析，都不会让搜索「坏掉」。
- **SSE 流式导购**：思考过程 → 商品卡 → 文字回答三段式推送，首字超时与整体超时都可配；停止生成会真正掐断上游调用，不继续计费。
- **看板全部真实聚合**：用户数 / 订单状态分组 / 销量 Top5 / 近 N 天 GMV 趋势（原生 SQL 按天聚合 + 时区对齐），金额全用 `Decimal` 不丢精度。
- **统一响应信封**：所有接口返回 `{ code, message, data }`，前端拦截器统一处理 401/403/429。
- **上传安全**：MIME→扩展名映射（不信任用户文件名）+ `nosniff` + `CSP sandbox`，杜绝「图片头伪装成 HTML」的同源脚本执行。
- **可测性**：84 条**零依赖**端到端用例（Node 内置 `fetch`，不引 Jest/Supertest），CI 里跑真实 MySQL。

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Vue 3.5（`<script setup lang="ts">`，无 `any`）· Vite 8 · Vue Router 5 · Pinia 4 · Element Plus 2 · ECharts 6 · Axios |
| 后端 | Node ≥ 20 · Express 5 · TypeScript 5（`strict`）· Prisma 6 · MySQL 8 · JWT · bcryptjs · zod · helmet · express-rate-limit |
| 图片 | multer + 可切换驱动：本地磁盘（默认，断网可用）/ Cloudinary（配齐凭据自动启用） |
| AI | DeepSeek Chat Completions（仅后端调用，Key 永不下发前端）+ SSE 流式 |
| 设计 | Noto Serif SC / Noto Sans SC 本地打包（断网可用）· 暖橙 `#ff6b35` 主题 · ECharts 品牌色板 |
| 工程 | 双端 `typecheck` + `build` · GitHub Actions CI · 零依赖 E2E · Docker（MySQL）· PM2 + Nginx |

---

## 系统架构

```mermaid
flowchart LR
    subgraph Client["浏览器"]
        SPA["Vue 3 SPA<br/>Router / Pinia / Element Plus"]
        Chart["ECharts<br/>品牌色板"]
    end

    subgraph Server["Node.js 服务"]
        API["Express 5<br/>/api/*"]
        MW["中间件<br/>JWT 鉴权 · zod 校验<br/>helmet · 限流"]
        SVC["业务服务层<br/>订单状态机 · 权限"]
    end

    DB[("MySQL 8<br/>Prisma")]
    AI["DeepSeek API"]
    RULE["本地规则解析<br/>降级兜底"]
    FS[("本地 /uploads<br/>图片")]

    SPA -->|"HTTPS / JSON"| API
    Chart --> SPA
    API --> MW --> SVC --> DB
    SVC -->|"自然语言 → 结构化条件"| AI
    AI -.->|"无 Key / 超时 / 解析失败"| RULE
    SVC --> FS
```

请求链路：`SPA → /api（同源或 Vite 代理）→ 中间件（鉴权 / 校验 / 限流 / 安全头）→ 服务层 → Prisma → MySQL`。
AI 请求在服务层做「模型优先、规则兜底」，前端拿到的永远是同一套 `{ code, message, data }`。

### 数据模型（ER）

```mermaid
erDiagram
    USER ||--o{ PRODUCT : "出售"
    USER ||--o{ ORDER : "作为买家"
    USER ||--o{ ORDER : "作为卖家"
    USER ||--o{ REVIEW : "评价人"
    USER ||--o{ REVIEW : "被评价人"
    CATEGORY ||--o{ PRODUCT : "归类"
    ORDER ||--|{ ORDER_ITEM : "包含"
    PRODUCT ||--o{ ORDER_ITEM : "被购买"
    ORDER ||--o{ REVIEW : "产生"

    USER {
        string id PK
        string username UK
        string email UK
        string passwordHash
        enum role "USER/SELLER/ADMIN"
        enum status
    }
    PRODUCT {
        string id PK
        string title
        decimal price "Decimal 10,2"
        json images "字符串数组"
        enum condition
        enum status
        string sellerId FK
        string categoryId FK
    }
    ORDER {
        string id PK
        string orderNo UK
        decimal totalAmount
        enum status "6 态"
        datetime paidAt
        datetime shippedAt
        datetime completedAt
        string buyerId FK
        string sellerId FK
    }
    ORDER_ITEM {
        string id PK
        decimal price
        int quantity
        decimal subtotal
        string orderId FK
        string productId FK
    }
    REVIEW {
        string id PK
        int rating
        string content
        json images
        enum status
        string orderId FK
        string productId FK
        string reviewerId FK
    }
    CATEGORY {
        string id PK
        string name
        string slug UK
    }
```

订单状态机：`待付款 → 待发货 → 已发货 → 已完成 → 已评价`，任一阶段可 `已取消`（取消后商品重新上架）。
详见 [数据库与 API 契约](server/docs/api-contract.md)。

---

## 快速开始

### 0. 前置要求

- **Node.js ≥ 20**
- **MySQL 8.0+**（或用下面的 Docker 一行起库）
- 可选：Docker（推荐，省去装 MySQL）

### 1. 启动数据库（二选一）

**方式 A · Docker（推荐）**

```bash
docker compose up -d
# 默认映射到 3306；本机 3306 已被占用时：
# MYSQL_PORT=3307 docker compose up -d
```

**方式 B · 用自己已有的 MySQL**

```sql
CREATE DATABASE smart_second_hand CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. 配置后端环境变量

```bash
cp .env.example server/.env
# 然后编辑 server/.env，至少改这两项：
#   DATABASE_URL="mysql://root:你的密码@localhost:3306/smart_second_hand"
#   JWT_SECRET="换成你自己的随机串"
```

### 3. 安装依赖并初始化数据

```bash
# 后端
cd server
npm install
npx prisma migrate deploy   # 建表
npm run seed                # 灌入演示数据

# 前端（另开终端）
cd client
npm install
```

`seed` 会生成：4 个用户、14 件在售商品、50 件历史成交商品、50 条跨状态订单、53 条评价。

### 4. 启动

```bash
# 终端 1：后端 → http://localhost:3000/api/health
cd server && npm run dev

# 终端 2：前端 → http://localhost:5173
cd client && npm run dev
```

打开 <http://localhost:5173>，用下面的演示账号登录。

> **前端不需要任何环境变量**：`client/vite.config.ts` 已把 `/api` 代理到 `http://localhost:3000`。
> 只有**前端与后端不同域**时（如 Vercel 前端 + Railway 后端）才需要在 `client/.env.local`
> 或 Vercel 的 Environment Variables 里配 `VITE_API_BASE_URL=https://你的后端域名`
> （只填域名，不要带 `/api` 后缀或末尾斜杠；Vite 仅在构建时注入，改完需重新构建）。

### 5. 演示账号

`npm run seed` 创建（密码均已 bcrypt 哈希入库）：

| 账号 | 密码 | 角色 | 用途 |
| --- | --- | --- | --- |
| `admin` | `Admin@123456` | 管理员 | 数据看板、商品审核 |
| `seller_li` | `Seller@123456` | 卖家 | 发布/管理 14 件在售商品 |
| `user_zhang` | `User@123456` | 普通用户 | 下单、付款、收货、评价 |
| `user_wang` | `User@123456` | 普通用户 | 第二个买家（并发/隔离测试用） |

---

## 一键离线演示（答辩 / 断网场景）

没有外网、没有 Docker、没有管理员权限，甚至**目标机器没装 Node、没装 MySQL** 也能跑起来：
**双击根目录的 `start-demo.bat`**。

> 顶部的「在线体验」链接依赖外网；这一节是**纯本地运行**，全程零外网请求，
> 适合答辩现场网络不可控、或学校断网环境。

```bat
:: 双击即可，也可以带参数运行
start-demo.bat                 :: 默认端口 3000，自动打开浏览器
start-demo.bat -Port 3100      :: 换端口
start-demo.bat -Rebuild        :: 强制重建前后端
start-demo.bat -Reseed         :: 强制重灌演示数据
```

### 目标机器没有 Node / MySQL？先打包便携运行时

在一台**已装 Node 和 MySQL 8** 的电脑上执行一次：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\demo\prepare-runtime.ps1
```

它会在项目根目录生成 `runtime/`（约 183 MB，已加入 `.gitignore`，不进仓库）：

| 内容 | 体积 | 说明 |
| --- | --- | --- |
| `runtime/node.exe` | 88 MB | 便携 Node，直接运行无需安装、无需管理员权限 |
| `runtime/mysql/` | 95 MB | 精简 MySQL：`mysqld`/`mysql`/`mysqladmin` + 15 个依赖 DLL + `share`（错误信息与字符集） |
| `runtime/vcruntime140*.dll` 等 | < 1 MB | VC++ 运行库，防目标机器缺失 |

打包完成后把**整个项目文件夹**拷到 U 盘即可。启动器会自动优先使用 `runtime/` 里的运行时，
完全不依赖目标机器的 PATH。

**拷贝清单**（缺一不可）：

```
runtime/                便携运行时
client/dist/            前端构建产物（没有 npm 就无法现场构建）
server/dist/            后端构建产物
client/node_modules/    前端依赖
server/node_modules/    后端依赖（含 Prisma 引擎）
server/.env             JWT_SECRET / DATABASE_URL
client/public/demo/     25 张商品图（已含在 dist 里）
```

### 启动脚本做了什么

脚本会依次完成（每一步都有 `[OK]` 回显）：

| 步骤 | 说明 |
| --- | --- |
| 环境自检 | 优先用 `runtime/node.exe`，没有才回落到 PATH；检查 `node_modules`、`server/.env` |
| 准备数据库 | 本机 3306 有 MySQL 就直接复用；没有就用随包（或已装）的 MySQL 二进制在本地起**便携实例**，无需管理员权限、无需 Docker 服务 |
| 同步结构 | 用 node 直接执行 Prisma CLI（`node node_modules/prisma/build/index.js migrate deploy`），**不需要 npm/npx** |
| 灌演示数据 | 库里没有商品时自动 `node node_modules/tsx/dist/cli.mjs prisma/seed.ts`（幂等） |
| 构建 | `dist` 缺失时才构建；随包运行时的机器没有 npm，产物必须预先准备好 |
| 启动 | 后端**同源托管**前端 `dist`，一个端口同时提供页面和 `/api`，没有跨域也没有反向代理 |
| 强制离线 | `AI_MOCK=true` + 清空 Cloudinary 凭据 → AI 走本地规则、图片存本地磁盘，**全程零外网请求** |

启动后访问 <http://localhost:3000>，演示账号见上一节。

**停止**：在窗口里按 `Ctrl+C` 或直接关闭窗口即可自动清理（mysqld 在 Windows 上会派生子进程，
脚本按数据目录匹配命令行，父子一并清理）。
若窗口被强杀导致端口占用，运行 `stop-demo.bat`（只清理演示用的 node 与便携 mysqld，不碰本机 MySQL 服务）。

**离线包完整性**（已验证）：

- 25 张商品图在 `client/public/demo/`，构建后随 `dist` 发布，无外链
- 字体经 `@fontsource` 本地打包（3 个 woff2，共 3.7 MB），不连 Google Fonts
- 构建产物中**无任何外部主机名**，`index.html` 无 CDN 引用
- AI 搜索与 AI 流式对话在 `AI_MOCK=true` 下功能完整

> **踩过的三个坑（脚本已自动规避）**
> 1. **中文路径**：`datadir` / `basedir` 位于含中文的路径（如 `F:\二手app\...`）时，
>    `mysqld --initialize` 会成功，但随后启动**静默失败**（退出码 1、无日志）。
>    因此数据目录固定在 ASCII 路径 `%LOCALAPPDATA%\smart-second-hand-demo`；
>    随包 MySQL 若位于中文路径，会先复制到该 ASCII 目录再使用（仅首次，约 95 MB）。
> 2. **Windows 保留端口**：Hyper-V / WSL 会预留成段端口（如 3316-3415、3416-3515），
>    这些端口看起来空闲但 mysqld 绑不上。脚本启动前读取 `netsh` 排除段跳过，
>    并以「进程秒退就换端口重试」兜底。
> 3. **mysqld 派生进程**：Windows 上 mysqld 会分裂成监控父进程 + 服务子进程，
>    只停父进程会留下子进程占着端口。脚本按数据目录匹配命令行清理。

> **安全说明**：便携实例使用 root 空密码，因此启动时强制 `--bind-address=127.0.0.1`，
> 只监听本机回环，同网段的其他人无法连接（mysqld 默认监听 `0.0.0.0`，不显式限制会暴露在局域网中）。

---

## 没有 DeepSeek Key？也能全功能演示

**这是本项目最想强调的一点：AI 不是硬依赖。**

在 `server/.env` 里设置：

```env
AI_MOCK=true
```

重启后端即可，效果：

| 能力 | 表现 |
| --- | --- |
| 自然语言搜索 | 走**本地规则解析**：能识别品类、成色、价格区间、关键词，结果与真实模型基本一致 |
| AI 导购助手 | 仍然流式输出、仍然推送商品卡、仍然给追问建议，只是措辞由规则生成 |
| 接口契约 | `source` 字段返回 `mock`，其余结构完全不变（前端无需任何改动） |
| 费用 | 0，且**完全离线可用**（答辩现场断网也能演示） |

同一套降级链路在「模型超时 / 返回无法解析」时也会自动生效（`source=fallback`），
所以线上不会因为第三方抖动而白屏。本项目的 CI 就是用 `AI_MOCK=true` 跑通全部 84 条用例的。

> 想要真实模型效果：申请 [DeepSeek](https://platform.deepseek.com/) Key 填入 `DEEPSEEK_API_KEY`，把 `AI_MOCK` 设为 `false`。
> Key 只在后端使用，前端代码与构建产物中不会出现。

---

## 测试

零依赖端到端测试（Node 内置 `fetch`，不需要 Jest / Supertest），共 **84 条用例**，
打真实 HTTP 接口 + 真实 MySQL：

```bash
# 1) 先确保后端已启动（E2E 打的是真实接口）
cd server && npm run dev

# 2) 回到仓库根目录
cd ..
npm run test:e2e
```

当前结果：**84 通过 / 0 失败 / 2 跳过**（跳过项需要真实模型输出，`AI_MOCK` 下不适用）。

| Suite | 覆盖内容 |
| --- | --- |
| 0. 环境前置检查 | 服务可达性、seed 演示账号可登录（未启动时快速失败并给出提示） |
| 1. 用户模块 | 注册（重复邮箱 409 / 弱密码 400）、登录（错密码 / 未知账号 401）、`/me` 鉴权、改资料、**改密码后旧密码失效新密码可用** |
| 2. 商品模块 | USER 发布 403 → SELLER 发布 `PENDING_REVIEW` → 审核通过上架 → `viewCount` 自增 → 编辑权限 → 下架 → 重新上架；分页 / 价格 / 分类参数校验；**图片上传（返回可用 URL + 当前驱动、非图片拒绝、未登录 401）** |
| 3. 订单模块 | 下单（商品转 `SOLD`）→ 付款 → 发货 → 收货 → 评价；重复下单 409、越权流转 403、非参与方 403、取消订单回滚商品、**评价落库核对** |
| 4. AI 模块 | `/parse`、`/search` 结构契约（`source ∈ {ai, mock, fallback}`、只返回在售）、检索相关性、SSE `/chat` 事件协议与三阶段管线顺序 |
| 5. 管理员看板 | 401 / 403 权限边界、六大区块结构、金额精度、趋势数组长度与日期窗口、状态分布口径一致性 |

跑测试会自动创建测试数据并在结束时清理；想保留现场用 `E2E_KEEP_DATA=1 npm run test:e2e`。
被测服务不在本地时用 `BASE_URL=https://your-api.example.com npm run test:e2e`。

其他质量检查：

```bash
cd server && npm run typecheck && npm run build
cd client && npm run typecheck && npm run build
```

---

## 目录结构

```
smart-second-hand-platform/
├── client/                     前端（Vue 3 + Vite）
│   ├── public/demo/            25 张本地商品图（断网可用，无外链）
│   └── src/
│       ├── api/                接口封装（统一 axios 实例）
│       ├── components/         EChart / EmptyState / UserAvatar / AiAssistant
│       ├── composables/        useIsMobile 等
│       ├── constants/          状态文案与 tag 类型（单一来源）
│       ├── router/             路由 + 角色守卫
│       ├── stores/             auth / cart / aiChat（Pinia）
│       ├── styles/theme.css    品牌主题唯一入口（CSS 变量）
│       ├── types/              全量接口类型（无 any）
│       └── views/              13 个页面
├── server/                     后端（Express 5 + Prisma）
│   ├── prisma/                 schema + migrations + seed + 测试数据清理
│   ├── docs/api-contract.md    数据库与 API 契约
│   └── src/
│       ├── config/env.ts       环境变量 zod 校验（缺项直接退出）
│       ├── controllers/        参数校验（zod）+ 响应
│       ├── middleware/         鉴权 / 错误处理 / 限流
│       ├── routes/             路由表
│       ├── services/           业务逻辑（订单状态机、AI、看板聚合…）
│       └── utils/              统一响应、JWT、密码、上传安全
├── scripts/e2e/                零依赖端到端测试（84 条）
├── scripts/demo/               离线演示一键启动 / 停止脚本
├── docs/
│   ├── deploy.md               部署手册（PM2+Nginx / Vercel+Railway）
│   ├── known-issues.md         已知问题与修复方向
│   └── screenshots/            README 截图（WebP）
├── docker-compose.yml          一键起 MySQL
├── start-demo.bat              离线演示一键启动（双击）
├── stop-demo.bat               清理演示进程（端口被占时用）
└── .github/workflows/ci.yml    类型检查 + 构建 + E2E
```

---

## 接口约定

所有接口统一返回：

```json
{ "code": 0, "message": "ok", "data": {} }
```

- `code === 0` 成功；非 0 为业务错误码（`40001` 参数错误 / `40100` 未登录 / `40300` 无权限 / `40400` 不存在 / `40900` 冲突 / `42900` 限流 / `50000` 服务异常）
- HTTP 状态码与业务码解耦，前端拦截器统一处理
- 分页统一 `{ list, total, page, pageSize }`

完整接口列表、字段说明与 curl 示例见 **[server/docs/api-contract.md](server/docs/api-contract.md)**。

---

## 部署

- **单机云服务器**：PM2 + Nginx 反代 + HTTPS（Let's Encrypt）+ `/uploads` 持久化
- **前后端分离托管**：Vercel（前端）+ Railway（后端 + MySQL）

生产环境前端地址：<https://smart-second-hand-platform.vercel.app>（对应后端 `CORS_ORIGIN` 需放行该域名）

逐步命令、Nginx 配置片段、环境变量清单与常见坑见 **[docs/deploy.md](docs/deploy.md)**。

---

## 已知限制

如实记录，不美化（详见 [docs/known-issues.md](docs/known-issues.md)）：

| # | 问题 | 说明 |
| --- | --- | --- |
| 1 | 订单状态流转存在并发竞态 | 状态机校验在事务外，极端并发下重复点击可能重复写入 |
| 2 | 下单置 `SOLD` 但不递减 `stock` | 二手单件场景可接受，已作为设计取舍记录 |
| 3 | 契约中 2 个管理端接口未实现 | `GET /api/admin/orders`、`PATCH /api/admin/reviews/:id/status` |
| 4 | 趋势图日期标签省略年份 | 近 30 天窗口内不会歧义，仅为卡片宽度做的取舍 |
| 5 | 收藏夹未实现 | `favoriteCount` 字段已预留，功能未开发 |

---

## 许可证

[MIT](LICENSE) © 2026 比那鸣 秋子

**第三方素材**：商品图片来自 [Unsplash](https://unsplash.com/license)（免费可商用），
已下载到 `client/public/demo/` 本地化使用，运行时无外链。

> 本项目在开发过程中使用 GitHub Copilot / DeepSeek 辅助生成部分基础模板代码，
> 业务逻辑设计、代码审查、接口联调与部署均由本人完成。
