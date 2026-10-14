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
├── scripts/demo/               答辩离线演示包（打包脚本 + 启动器 + 说明）
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

## AI 自然语言搜索

```
用户输入中文 → 后端调 DeepSeek → 输出 JSON 查询条件 → zod 清洗 → Prisma 查询 → 返回商品
```

前端首页顶部的「AI 智能搜索」框输入一句话即可，例如：

| 输入 | 解析结果 |
| --- | --- |
| `九成新2000以内的游戏本` | 品类=电脑办公，成色=九成新，预算≤2000，关键词=游戏本 |
| `求购二手自行车` | 关键词=自行车（库中无该分类，故无结果） |
| `无线鼠标 1000 以内` | 品类=电脑办公，预算≤1000，关键词=无线鼠标 |

### 后端配置（`server/.env`）

| 变量 | 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API Key，**仅后端使用，前端永远拿不到** |
| `DEEPSEEK_API_URL` | 接口地址，默认 `https://api.deepseek.com/v1/chat/completions` |
| `DEEPSEEK_MODEL` | 模型名，默认 `deepseek-chat` |
| `AI_TIMEOUT_MS` | 条件解析超时，默认 `5000`，超时自动降级 |
| `AI_FIRST_TOKEN_TIMEOUT_MS` | 助手回答的首字超时，默认 `6000` |
| `AI_CHAT_TIMEOUT_MS` | 助手回答的整体超时，默认 `30000` |
| `AI_MOCK` | 设为 `true` 时完全走本地规则解析，**不联网、不消耗额度** |

### 两条入口

| 入口 | 形态 | 用途 |
| --- | --- | --- |
| 首页「AI 智能搜索」框 | 一次性 JSON | 快速搜索：输入一句话直接出结果列表 |
| **右下角悬浮「AI 导购助手」** | **SSE 事件流** | 多轮对话：思考过程 + 商品卡片 + 流式回答 + 可点建议词 |

**AI 导购助手（前端）**

- 右下角悬浮球（带呼吸灯）→ 点击弹出右侧抽屉
- 挂在 `App.vue` 布局层，因此**切换页面时对话记录不会丢失**
- 记录存 `localStorage`（key 带版本号 `ai-chat-v1`），支持「清空对话」重置
- 每条回答上方可展开**思考过程**（后端真实步骤，非模型编造）
- 回答流式呈现（打字机效果），流式期间发送按钮变红色**「停止生成」**
- 命中的商品以**卡片形式嵌入对话**，可直接点进详情页
- 回复末尾给出**可点击的建议词**，点一下就是下一轮提问
- 商品详情页有「问 AI 这件商品的细节」按钮，会注入 `focusProductId`，
  这样问「这件成色怎么样」时能正确指向当前商品

> 流式实现要点：用 `fetch` + `ReadableStream` 消费（**不是 `EventSource`**，
> 它只支持 GET、不能带 `Authorization` 头），并且**绕过 axios 拦截器**
> （拦截器按 `{ code, message, data }` 信封拆包，流式响应不是那个形状）。
> 解析时维护 buffer、按空行切分事件，并用 `TextDecoder(stream: true)` 处理跨包的多字节中文。
> 「停止生成」用 `AbortController.abort()`，后端据此触发 `res` 的 close 并**同步掐断上游模型调用**。

### 检索相关性排序

关键词不再用 `LIKE '%x%'` 直接排时间，而是**打分排序**：

| 机制 | 说明 |
| --- | --- |
| 拉丁词整词匹配 | 用字母数字边界，`ai` **不再**误命中 `Air`、`13` 不误命中 `128G` |
| 中文 2-gram | 「游戏本」既能整词命中，也能部分命中标题里只写了「游戏」的商品 |
| 权重 | 整句命中 > 标题整词 > 标题片段 > 描述，热度（浏览量/收藏量）仅用于打破同分 |
| 弱结果识别 | 最高分偏低时标记 `weak`，让助手主动提示放宽条件 |

### AI 助手的工作方式

```
用户输入
 ├─① 解析条件  → 复用规则/模型解析，立刻推 thought（思考过程来自真实步骤，不是模型编的）
 ├─② 检索商品  → 打分排序 + 逐级放宽，推 products（数据全部来自数据库，模型碰不到）
 └─③ 生成回答  → 模型只负责把结果说成人话，流式推 delta
```

**阶段 ② 不依赖模型**：所以模型超时/断网时，思考过程与商品卡片依然完整，
只有回答退化为本地话术 —— 这是离线演示能保持完整体验的关键。

其他要点：

- **多轮对话**：历史只保留最近 6 条 + 更早压成一句摘要；追问句用本地规则解析，省一次模型调用
- **指代消解**：前端传 `focusProductId` 显式锚点，绝不靠模型从历史里猜「这款」
- **防幻觉**：商品价格/成色/数量全部由后端回填；平台没有议价功能，助手会明确说明
- **防注入**：用户输入被当作「购物需求描述」而非指令
- **停止生成**：前端 abort 后，后端会同步掐断上游模型调用（否则继续计费）
- **建议词**：后端白名单生成，保证每条都答得出来

### 三条降级路径

| `source` | 触发条件 |
| --- | --- |
| `ai` | 真实调用 DeepSeek 成功 |
| `mock` | 未配置 `DEEPSEEK_API_KEY`，或 `AI_MOCK=true` |
| `fallback` | 模型超时 / 网络错误 / 返回内容无法解析 |

三条路径产出同一套结构化条件，因此**断网或没有 Key 时功能依然完整可用**
（本地规则解析器零网络依赖）。

### 限流

`/api/ai` 按 IP 限流 **10 次 / 分钟**，超出返回 HTTP 429 + `code: 42900`。

### 容错

- 模型输出带 Markdown 围栏或前后解释文字 → 自动提取 JSON
- 字段类型错乱（价格是负数 / 成色瞎写 / 关键词是数字）→ **逐个丢弃非法字段**，绝不 500
- 价格上下限写反 → 自动交换
- 分类匹配不到 → 该文本并入关键词，信息不丢失
- 条件过严导致 0 结果 → 按 6 级阶梯放宽（**关键词永不丢弃**）并告知前端

## 演示账号（仅开发环境）

`npm run seed` 会创建以下账号，密码均已用 bcryptjs 哈希入库：

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `Admin@123456` | 管理员 |
| `seller_li` | `Seller@123456` | 卖家（14 个商品的归属人） |
| `user_zhang` | `User@123456` | 普通用户 |
| `user_wang` | `User@123456` | 普通用户 |

> 演示密码仅用于本地开发，**生产环境必须全部更换**。
> `seed` 会额外灌入 **20 条历史订单与 5 条评价**（覆盖全部订单状态，时间分布在近 30 天），
> 以及 **20 件 `[历史]` 前缀的已成交商品**（状态 `SOLD`）用于支撑数据看板。
> 历史商品不会出现在首页列表与 AI 搜索中（前台只查 `ON_SALE`）。

## 数据看板

`GET /api/admin/dashboard?days=7` —— **仅 ADMIN 角色可访问**（导航栏入口也只对管理员显示）。

所有指标都由 Prisma 在数据库中实时聚合，**没有任何硬编码假数据**：

| 模块 | 内容 |
| --- | --- |
| KPI 卡 | 总用户数 / 总商品数 / 总订单数 / 总成交额（GMV） |
| 附加指标 | 在售商品数、待审核数、平均履约时长、已付款订单占比 |
| 成交额与订单量趋势 | 折线 + 面积，双 Y 轴（左金额 / 右订单量），可切近 7 / 14 / 30 天 |
| 订单状态分布 | 饼图，固定 6 类状态 |
| 商品分类占比 | 环形图 |
| 高价值商品 Top 5 | 横向柱状图，按**成交额**排序，tooltip 同时展示成交额与销量 |

**口径**：GMV 只统计已付款订单（`paidAt` 非空），不含待付款与已取消；
趋势按下单日期归组；金额一律两位小数字符串。
详见 [server/docs/api-contract.md](server/docs/api-contract.md) 4.6 节。

> 看板数据来自 seed 生成的历史订单。若发现图表为空，先执行 `npm run seed`。

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

## 答辩演示包（零环境离线运行）

如果需要在**没有 Node、MySQL、Git，装不上 VS Code 扩展、甚至没有网络**的电脑上演示本项目
（例如学校答辩机），用打包脚本生成一个「拷 U 盘 → 双击即用」的离线包。

**特点**：自带便携 Node + 便携 MariaDB；数据库在**打包时**就已初始化并灌好演示数据，
目标机器上不需要任何安装或导入步骤，全程离线，也不依赖系统 PATH。

### 生成

```powershell
powershell -ExecutionPolicy Bypass -File scripts\demo\build-demo.ps1
```

首次执行会联网下载 Node 与 MariaDB 官方压缩包并缓存，之后重复打包直接复用缓存。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-OutDir` | `F:\smart-second-hand-demo` | 输出目录，**必须是纯英文路径**（脚本会校验） |
| `-CacheDir` | `F:\demo-build` | 运行时压缩包与构建缓存目录 |
| `-SkipDownloads` | 关闭 | 只用已缓存的 zip，完全不联网 |
| `-ReuseDb` | 关闭 | 复用已有 `data\`，跳过数据库重新初始化（调试用） |

### 使用

1. 把输出目录整体拷到目标电脑（**路径必须是纯英文**，例如 `D:\demo`）
2. 双击 `启动演示.bat` —— 自动启动数据库 → 启动服务 → 打开浏览器（约 10～20 秒）
3. 访问 <http://localhost:3210>，演示账号见包内 `使用说明.txt`
4. 结束时按 `Ctrl+C`，或双击 `停止演示.bat`（务必用这两种方式，直接关窗口可能损坏数据文件）

### 设计说明

- 端口用 **3310（数据库）/ 3210（应用）**，避开目标机器上可能已装的 MySQL（3306）与占用 3000 的程序
- 前端构建产物由后端**同源托管**（`CLIENT_DIST`），因此演示包只需暴露一个端口，前端零改动
- 演示图片使用仓库内 `client/public/demo/*.jpg` 占位图，不依赖外网；
  需要重新生成时执行 `scripts/demo/make-placeholders.ps1`（该脚本必须保存为 **UTF-8 BOM**）
- 演示包约 310 MB，放在仓库之外，**不进 git**
- 包内 `.env` 是公开的演示配置（root 无密码、仅监听 `127.0.0.1`、JWT 密钥公开），**严禁用于生产**

## 在线 Demo
（待部署后补充）

### 本项目在开发过程中使用 GitHub Copilot / DeepSeek 辅助生成部分基础模板代码，所有业务逻辑设计、代码审查、接口联调与部署均由本人独立完成。