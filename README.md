# 智能二手交易平台

基于 Vue3 + TypeScript + Node.js 的全栈二手交易平台，集成 AI 自然语言搜索与 ECharts 数据看板。

## 技术栈

| 端 | 技术 |
| --- | --- |
| 前端 | Vue3 + TypeScript + Vite + Pinia + Vue Router + Element Plus + ECharts + Axios |
| 后端 | Node.js + Express + TypeScript + Prisma + PostgreSQL + JWT + zod + bcryptjs |
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
- PostgreSQL >= 15（也可直接使用 Supabase 的连接串）

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

## 在线 Demo
（待部署后补充）