# 智能二手交易平台

基于 Vue3 + TypeScript + Node.js 的全栈二手交易平台，集成 AI 自然语言搜索与 ECharts 数据看板。

## 技术栈

| 端 | 技术 |
| --- | --- |
| 前端 | Vue3 + TypeScript + Vite + Pinia + Vue Router + Element Plus + ECharts + Axios |
| 后端 | Node.js + Express + TypeScript + Prisma + MySQL + JWT + zod + bcryptjs |
| AI | DeepSeek（仅后端调用，Key 永不下发前端） |

## 目录结构

```
.
├── client/                     前端
│   └── src/
│       ├── api/                接口封装（axios 实例 + 统一拆包）
│       ├── components/         组件
│       ├── router/             路由
│       ├── stores/             Pinia
│       ├── types/              类型定义
│       └── views/              页面
├── server/                     后端
│   ├── prisma/schema.prisma    数据库模型
│   ├── prisma/seed.ts          演示数据（幂等，可重复执行）
│   ├── docs/api-contract.md    数据库与 API 契约
│   └── src/
│       ├── config/             环境变量校验
│       ├── middleware/         鉴权 / 统一错误处理
│       ├── routes/             路由（挂载在 /api 前缀）
│       └── utils/              工具
├── .env.example
└── README.md
```

## 环境要求

- Node.js >= 20
- MySQL >= 8.0（本机需有可用的库与账号）

## 启动步骤

### 1. 配置环境变量

```bash
cp .env.example server/.env
```

编辑 `server/.env`，至少确认 `DATABASE_URL`、`JWT_SECRET` 两项。**缺失时后端会直接退出并打印缺哪一项。**

### 2. 启动后端

```bash
cd server
npm install
npm run prisma:generate     # 生成 Prisma Client
npm run prisma:migrate      # 首次执行，建表
npm run seed                # 灌入演示数据（幂等，可重复执行）
npm run dev                 # http://localhost:3000/api/health
```

浏览器访问 <http://localhost:3000/api/health>，应返回：

```json
{ "code": 0, "message": "ok", "data": { "status": "ok", "service": "smart-second-hand-server" } }
```

### 3. 启动前端

```bash
cd client
npm install
npm run dev                 # http://localhost:5173
```

Vite 已配置代理 `/api` → `http://localhost:3000`，开发时无需额外处理跨域。

## npm 脚本

| 目录 | 命令 | 说明 |
| --- | --- | --- |
| client | `npm run dev` | 启动 Vite 开发服务器 |
| client | `npm run build` | 类型检查 + 生产构建 |
| client | `npm run start` | 预览生产构建产物 |
| client | `npm run typecheck` | 仅做类型检查 |
| server | `npm run dev` | nodemon 热重载启动 |
| server | `npm run build` | 编译 TypeScript 到 dist/ |
| server | `npm run start` | 运行编译后的 dist/index.js |
| server | `npm run typecheck` | 仅做类型检查 |

## 接口约定

所有接口统一返回 `{ code, message, data }`，`code === 0` 表示成功。

| 业务码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 40001 | 参数校验失败 |
| 40100 | 未登录 / token 失效 |
| 40300 | 无权限 |
| 40400 | 资源不存在 |
| 40900 | 状态冲突 |
| 50000 | 服务器内部错误 |

完整接口契约见 [server/docs/api-contract.md](server/docs/api-contract.md)。

## 演示账号（仅开发环境）

`npm run seed` 会创建以下账号，密码均已用 bcryptjs 哈希入库：

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `Admin@123456` | 管理员 |
| `seller_li` | `Seller@123456` | 卖家（10 个商品的归属人） |
| `user_zhang` | `User@123456` | 普通用户 |
| `user_wang` | `User@123456` | 普通用户 |

> 演示密码仅用于本地开发，**生产环境必须全部更换**。
> 本次不灌入订单与评价，故数据看板暂无数据，属预期。

## 常见报错处理

| 报错 | 原因 | 解决 |
| --- | --- | --- |
| `P1000 Authentication failed` | `DATABASE_URL` 的账号或密码不对 | 核对 `server/.env` 里的 MySQL 账号密码 |
| `P1001 Can't reach database server` | MySQL 没启动，或 host/端口不对 | 启动 MySQL 服务，确认 3306 在监听 |
| `P1012 ... can't be a list` | 在 MySQL 上用了 `String[]` | 图片字段必须用 `Json`（本项目已改） |
| `P1017 Server has closed the connection` | 连接被中断（超时 / 代理 / SSL） | 检查网络与代理；云实例常需 `?sslaccept=strict` |
| `P3014` / shadow database 报错 | 账号没有 `CREATE DATABASE` 权限，建不了影子库 | 给账号授权，或在 datasource 里配 `shadowDatabaseUrl` |
| `P3005 The database schema is not empty` | 库里已有旧表但无迁移记录 | `npx prisma migrate reset --force`（**会清库**） |
| `package.json#prisma is deprecated` | Prisma 7 将移除这种配置方式 | 当前锁定 `6.x`，仅告警可忽略；升 7 需改用 `prisma.config.ts` |
| `npm run seed` 提示没有 seed 配置 | 只加了 `scripts.seed`，缺 `prisma.seed` | 两处都要配（本项目已配，见 `server/package.json`） |
| seed 报唯一约束冲突 | 库里已有同 `username`/`email` 但 id 不同 | seed 按固定主键 upsert；必要时 `migrate reset` 后重跑 |

## 在线 Demo
（待部署后补充）