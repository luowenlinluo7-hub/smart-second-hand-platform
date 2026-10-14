# 智能二手交易平台 · 数据库 & API 契约

> 版本 `v1` ｜ 数据库 **MySQL 8.0+** ｜ API 前缀 `/api/v1` ｜ Schema 位置 [`server/prisma/schema.prisma`](../prisma/schema.prisma)

---

## 一、选型说明（必读）

数据库采用 **MySQL 8.0+**。

Prisma 的标量列表（`String[]`）**在 MySQL 上不被支持**，已用 Prisma 6.19.3 实测：

```text
error: Field "images" in model "Product" can't be a list.
       The current connector does not support lists of primitive types.
```

因此商品图片与评价晒图改用 **`Json`** 存字符串数组：`Product.images Json`、`Review.images Json`。
写入时直接传 JS 数组，读出即为数组 —— **API 契约与前端 `string[]` 类型均无需改动**。

> 若改用 PostgreSQL，可把这两处 `Json` 换回 `String[]`（原生数组），其余模型无需改动。

---

## 二、E-R 说明

### 2.1 实体关系图

```mermaid
erDiagram
    User      ||--o{ Product    : "发布(卖家)"
    User      ||--o{ Order      : "下单(买家)"
    User      ||--o{ Review     : "评价人_被评价人"
    Category  ||--o{ Product    : "归类"
    Category  ||--o{ Category   : "父子分类"
    Order     ||--o{ OrderItem  : "包含"
    Product   ||--o{ OrderItem  : "被购买"
    Order     ||--o{ Review     : "产出评价"
    Product   ||--o{ Review     : "被评价"
```

### 2.2 关系与基数

| 关系 | 基数 | 外键 | 说明 |
| --- | --- | --- | --- |
| User → Product | 1 : N | `products.sellerId` | 卖家发布商品 |
| Category → Product | 1 : N | `products.categoryId` | 分类归类 |
| Category → Category | 1 : N | `categories.parentId` | 自关联，二级分类；删除父类置 `NULL` |
| User → Order | 1 : N | `orders.buyerId` | 买家下单 |
| User → Order | 1 : N | `orders.sellerId` | 卖家接单（按卖家拆单） |
| Order → OrderItem | 1 : N | `order_items.orderId` | 级联删除 |
| Product → OrderItem | 1 : N | `order_items.productId` | 订单↔商品的多对多拆解 |
| Order → Review | 1 : N | `reviews.orderId` | 一单可评价多个商品；级联删除 |
| Product → Review | 1 : N | `reviews.productId` | 商品维度聚合评分 |
| User → Review | 1 : N | `reviews.reviewerId` / `reviews.revieweeId` | 评价人（买家）/ 被评价人（卖家） |

### 2.3 建模要点

1. **订单与商品不直接相连**，统一通过 `OrderItem` 关联，并在 `OrderItem` 中保存
   `title / image / price` 快照 —— 商品后续改价、下架都不影响历史订单。
2. **订单按卖家拆单**：`Order` 含 `sellerId`，购物车含多个卖家商品时生成多个订单。
   这样「整单状态流转」语义才能成立（否则 A 已发货、B 未发货时状态无法表达），
   也与电商按店铺拆单的标准做法一致。
3. **金额全部 `Decimal(10, 2)`**，禁止 `Float`（浮点误差会导致对账不平）。
4. **主键统一 `cuid()`**，非自增、不可枚举，避免爬虫按 id 遍历。
5. 所有表都具备 `id / createdAt / updatedAt / status / 外键`。

---

## 三、订单状态机

```text
                      ┌──────────────────┐
   创建订单 ─────────▶ │  PENDING_PAYMENT │ 待付款
                      └────────┬─────────┘
                       支付成功 │        │ 取消 / 超时
                               ▼        ▼
                      ┌──────────────────┐   ┌───────────┐
                      │ PENDING_SHIPMENT │   │ CANCELLED │ 已取消
                      └────────┬─────────┘   └───────────┘
                    卖家发货    │        │ 取消
                               ▼        └───────┘
                          ┌──────────┐
                          │ SHIPPED  │ 已发货
                          └────┬─────┘
                   买家确认收货 │
                               ▼
                          ┌───────────┐
                          │ COMPLETED │ 已完成
                          └─────┬─────┘
                    买家提交评价 │
                               ▼
                          ┌──────────┐
                          │ REVIEWED │ 已评价
                          └──────────┘
```

| 状态 | 枚举值 | 中文 | 允许的下一步 |
| --- | --- | --- | --- |
| 1 | `PENDING_PAYMENT` | 待付款 | 支付 / 取消 |
| 2 | `PENDING_SHIPMENT` | 待发货 | 发货 / 取消 |
| 3 | `SHIPPED` | 已发货 | 确认收货 |
| 4 | `COMPLETED` | 已完成 | 评价 |
| 5 | `REVIEWED` | 已评价 | 终态 |
| — | `CANCELLED` | 已取消 | 终态（兜底，非需求 5 态） |

> 每个状态流转都会写入对应时间戳（`paidAt / shippedAt / completedAt / reviewedAt / cancelledAt`），
> 用于数据看板计算履约时长与 GMV 趋势。
> **状态流转必须在后端 Service 层校验前置状态**，禁止前端传状态直接落库。

---

## 四、RESTful API 契约

### 4.0 全局约定

**统一响应体**

```jsonc
{
  "code": 0,          // 0 = 成功，非 0 = 业务错误
  "message": "ok",
  "data": {}          // 失败时为 null
}
```

**HTTP 状态码与业务码对照**

| HTTP | code | 含义 |
| --- | --- | --- |
| 200 | `0` | 成功 |
| 400 | `40001` | 参数校验失败（zod） |
| 401 | `40100` | 未登录 / token 无效或过期 |
| 403 | `40300` | 无权限（角色不符或非资源所有者） |
| 404 | `40400` | 资源不存在 |
| 409 | `40900` | 状态冲突（如重复支付、库存不足） |
| 429 | `42900` | 请求过于频繁 |
| 500 | `50000` | 服务器内部错误 |

**鉴权**：`Authorization: Bearer <JWT>`；角色 `USER` / `SELLER` / `ADMIN`。

**分页信封**（列表接口的 `data` 统一为）：

```jsonc
{ "list": [], "total": 128, "page": 1, "pageSize": 20 }
```

**金额字段的序列化约定（已实测确认）**

Prisma 的 `Decimal` 在 JSON 序列化时会**归一化掉尾随零**，直接返回会得到 `"1899"` 而不是 `"1899.00"`：

```js
price.toString()        // "1899"      ← 尾随零丢失，仅是显示问题
price.toFixed(2)        // "1899.00"   ← 正确写法
JSON.stringify(price)   // "1899"
```

精度本身安全（实测写入 `"1899.55"` 可精确往返，聚合求和也无浮点误差），
但**所有出参中的金额字段必须在序列化前调用 `.toFixed(2)`**，
否则前端拿到的 `1899` 与本契约示例不符，金额展示不统一。

---

### 4.1 用户 / 认证 · `/api/v1/auth`

| 方法 | 路径 | 鉴权 | 请求参数 | 响应 `data` |
| --- | --- | --- | --- | --- |
| POST | `/auth/register` | 公开 | `username` `email` `password` `role?`(`USER`\|`SELLER`) | `{ token, user }` |
| POST | `/auth/login` | 公开 | `account`(用户名/邮箱) `password` | `{ token, user }` |
| GET | `/auth/me` | 登录 | — | `user` |
| PUT | `/auth/profile` | 登录 | `nickname?` `avatar?` `phone?`（`null` 表示清空） | `user` |
| PUT | `/auth/password` | 登录 | `oldPassword` `newPassword` | `null` |

> `user` 出参**永远不含 `passwordHash`**（Prisma `select` 白名单）。
> 密码用 `bcryptjs` 加盐哈希，`JWT_SECRET` 只存在于后端 `.env`。
> 修改密码成功后需**重新登录**（前端清除本地 token 并跳转登录页）。

### 4.2 分类 · `/api/v1/categories`

| 方法 | 路径 | 鉴权 | 请求参数 | 响应 `data` |
| --- | --- | --- | --- | --- |
| GET | `/categories` | 公开 | `parentId?` `status?` | `Category[]`（树形） |
| GET | `/categories/:id` | 公开 | — | `Category` |
| POST | `/categories` | ADMIN | `name` `slug` `parentId?` `sortOrder?` `icon?` | `Category` |
| PATCH | `/categories/:id` | ADMIN | 同上（部分更新） | `Category` |
| DELETE | `/categories/:id` | ADMIN | — | `null` |

### 4.3 商品 · `/api/v1/products`

| 方法 | 路径 | 鉴权 | 请求参数 | 响应 `data` |
| --- | --- | --- | --- | --- |
| GET | `/products` | 公开 | `keyword?`(模糊匹配 title/description) `categoryId?` `condition?` `priceMin?` `priceMax?` `page?` `pageSize?` | 分页信封，仅返回 `ON_SALE` |
| GET | `/products/mine` | 登录 | `status?`(`DRAFT`\|`PENDING_REVIEW`\|`ON_SALE`\|`SOLD`\|`OFF_SHELF`\|`REJECTED`) `page?` `pageSize?` | 分页信封 + `counts`（各状态数量），**返回全部状态** |
| GET | `/products/:id` | 公开 | — | `Product`（含 `seller`、`category`，`viewCount` 自增 1） |
| POST | `/products` | SELLER | `title` `description?` `price` `originalPrice?` `images[]` `condition` `categoryId` `stock?` | `Product`（**进入待审核 `PENDING_REVIEW`**） |
| PUT | `/products/:id` | SELLER(本人) | 可编辑字段（部分更新） | `Product`（`SOLD` / `PENDING_REVIEW` 状态拒绝编辑，返回 40900） |
| DELETE | `/products/:id` | SELLER(本人) | — | `null`（软删：置 `OFF_SHELF` 并清空 `publishedAt`；`SOLD` 拒绝，返回 40900） |

> `price` / `originalPrice` 必须是**数字或数字字符串**，后端用 zod + Prisma `Decimal` 接收，禁止经 `Number` 二次转换后写库。
> 编辑用**部分更新**语义：未传字段保持原值，出参金额统一 `toFixed(2)`。
> 越权防护：PUT/DELETE 校验 `sellerId === 当前用户 id`，不符返回 403。
> **审核状态机**：发布 → `PENDING_REVIEW`（`publishedAt` 为 `null`）→ 管理员审核 → `ON_SALE`（写入 `publishedAt`）/ `REJECTED`（写入 `rejectReason`）。
> 因此卖家必须通过 `/products/mine` 查看待审核商品，`GET /products` 只会返回已上架的。
> ⚠️ 路由顺序：`/products/mine` 必须注册在 `/products/:id` **之前**，否则 `mine` 会被当作商品 id。

### 4.3.1 图片上传 · `/api/v1/upload`

| 方法 | 路径 | 鉴权 | 请求参数 | 响应 `data` |
| --- | --- | --- | --- | --- |
| POST | `/upload` | 登录 | `multipart/form-data`，字段 `files`（多文件，≤9 张，单张 ≤5MB） | `{ urls: string[] }` |

> 支持 jpg / png / webp / gif；文件存 `server/uploads/`，经 `/uploads/<filename>` 静态托管。
> 前端 vite 已配置 `/uploads` 代理到后端 3000。生产环境建议换 OSS/CDN。
>
> **图片字段接受两种格式**（`商品 images` / `评价晒图 images` / `用户头像 avatar`）：
> 1. 站内相对路径：`/uploads/1791614783752-5df3ca2b7f28.png`（用户上传）
>    或 `/demo/p1.jpg`（平台内置示例图，seed 数据使用，保证断网时不裂图）
> 2. 外部完整链接：`https://example.com/a.jpg`
>
> ⚠️ 后端校验**不可用** `z.string().url()` —— 它要求完整协议，会拒绝站内相对路径。
> 统一使用 `server/src/utils/validators.ts` 的 `imageUrlSchema`。

### 4.4 交易 · `/api/v1/orders`

> **按卖家拆单**：`Order` 含 `sellerId`，购物车含多个卖家商品时，`POST /orders` 会为每个卖家各生成一个订单
> （行业标准做法，保证「整单状态流转」语义成立）。响应 `data` 为订单**数组**。

| 方法 | 路径 | 鉴权 | 请求参数 | 响应 `data` |
| --- | --- | --- | --- | --- |
| POST | `/orders` | 登录 | `items[]{ productId, quantity }` `receiverName` `receiverPhone` `receiverAddress` `remark?` | `Order[]`（每个卖家一单，`PENDING_PAYMENT`） |
| GET | `/orders/buyer` | 登录 | `status?` `page?` `pageSize?` | 分页信封（我买到的） |
| GET | `/orders/seller` | 登录 | `status?` `page?` `pageSize?` | 分页信封（我卖出的） |
| GET | `/orders/:id` | 买卖双方 | — | `Order`（含 `items` 快照、买卖双方信息；非参与方 403） |
| PUT | `/orders/:id/status` | 买家/卖家 | `{ status }` | `Order`（状态流转，见下表） |
| POST | `/orders/:id/reviews` | 买家 | `{ reviews[]{ productId, rating(1-5), content?, images? } }` | `Order`（订单 → `REVIEWED`） |

> ⚠️ 路由顺序：`/buyer`、`/seller` 必须注册在 `/:id` **之前**，否则会被当成订单 id。

**状态流转规则**（`PUT /orders/:id/status`，严格校验「角色 + 前置状态」）

| 前置状态 | 目标状态 | 谁可操作 | 副作用 |
| --- | --- | --- | --- |
| `PENDING_PAYMENT` | `PENDING_SHIPMENT` | 买家 | 写 `paidAt`（模拟支付，无真实支付） |
| `PENDING_PAYMENT` | `CANCELLED` | 买家 | 写 `cancelledAt`，**商品回滚 `ON_SALE`** |
| `PENDING_SHIPMENT` | `SHIPPED` | **卖家** | 写 `shippedAt` |
| `SHIPPED` | `COMPLETED` | 买家 | 写 `completedAt` |
| `COMPLETED` | `REVIEWED` | 买家（评价接口触发） | 写 `reviewedAt` |
| 其他组合 | — | — | `40300`（角色不符）/ `40900`（状态不符） |

> `REVIEWED` 只能由评价接口触发，不接受通过 `/status` 直接指定。
> **下单事务**：校验商品 `status=ON_SALE` 且库存充足 → 按 `sellerId` 分组 → 每组创建
> `Order` + `OrderItem[]`（快照 `title`/`image`/`price`，计算 `subtotal`）→ 汇总 `totalAmount`
> → 商品置 `SOLD`。全流程在 `prisma.$transaction()` 内，避免超卖。

### 4.5 AI 搜索 · `/api/v1/ai`

| 方法 | 路径 | 鉴权 | 请求参数 | 响应 `data` |
| --- | --- | --- | --- | --- |
| POST | `/ai/search` | 公开 | `{ query: string, page?, pageSize? }` | `{ parsed, relaxed, relaxedNote, source, parseNote, list, total, page, pageSize }` |
| POST | `/ai/parse` | 公开 | `{ query: string }` | `{ parsed, source, note }`（仅解析，不查库） |

**限流**：整个 `/api/ai` 前缀按 IP 限流 **10 次 / 分钟**，超出返回 HTTP 429 + `code: 42900`。

**`parsed` 结构**（前端「已识别」标签直接消费）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `category` | `{ id, name } \| null` | 已映射到库中真实分类；映射不到时为 `null` |
| `condition` | `ProductCondition \| null` | 成色枚举，识别不了时为 `null` |
| `conditionLabel` | `string \| null` | 用户原始说法（如「九成新」），用于展示 |
| `priceMin` / `priceMax` | `number \| null` | 价格区间 |
| `keyword` | `string` | 关键词（可能为空字符串） |

**`source` 取值**（条件来源，前端据此提示用户）

| 值 | 含义 |
| --- | --- |
| `ai` | 真实调用 DeepSeek 成功 |
| `mock` | 未配置 `DEEPSEEK_API_KEY`，或 `AI_MOCK=true`，走本地规则解析 |
| `fallback` | 模型超时 / 报错 / 返回内容无法解析，降级为本地规则解析 |

**请求 / 响应示例**

```jsonc
// 请求
{ "query": "九成新2000以内的游戏本", "page": 1, "pageSize": 12 }

// 响应
{
  "code": 0,
  "message": "ok",
  "data": {
    "parsed": {
      "category": { "id": "seed-cat-computer", "name": "电脑办公" },
      "condition": "LIKE_NEW",
      "conditionLabel": "九成新",
      "priceMin": null,
      "priceMax": 2000,
      "keyword": "游戏本"
    },
    "relaxed": false,          // 条件过严被放宽时为 true
    "relaxedNote": null,       // 放宽时给出中文说明，如「已忽略成色要求」
    "source": "ai",
    "parseNote": null,         // 降级 / mock 时的说明文字
    "list": [],
    "total": 2,
    "page": 1,
    "pageSize": 12
  }
}
```

**处理链路**：自然语言 → 模型输出 JSON → zod 宽松校验 → **逐字段清洗（异常值丢弃）**
→ 映射成真实分类与成色枚举 → Prisma 动态 where 查询。

**条件过严时的放宽阶梯**（严格匹配为空才逐级放宽，**关键词永不丢弃**）

| 步骤 | 保留的条件 |
| --- | --- |
| 1 | 分类 + 成色 + 价格 + 关键词（严格） |
| 2 | 分类 + 价格 + 关键词 |
| 3 | 分类 + 成色 + 关键词 |
| 4 | 分类 + 关键词 |
| 5 | 成色 + 价格 + 关键词 |
| 6 | 仅关键词 |

六步全空时返回空列表（**不会**退化成返回全量商品）。

> `DEEPSEEK_API_KEY` **只能在后端 `.env` 中使用**，前端只调用 `/ai/search`，
> 绝不接触 Key，也绝不直连 DeepSeek。模型输出必须经 zod 校验与逐字段清洗后
> 再交给 Prisma 查询，禁止把模型输出直接拼进查询。

### 4.5.1 AI 导购助手（流式） · `POST /ai/chat`

> ⚠️ **统一响应信封的显式例外**
>
> 项目约定所有接口返回 `{ code, message, data }`。本接口以 **SSE 事件流**返回，
> 无法用单个 JSON 信封承载，因此**不适用**该约定，错误也改用 `error` 事件下发。
>
> 仅两种情况仍返回标准信封，因为它们发生在事件流开始**之前**：
> 参数校验失败（HTTP 400 + `40001`）与限流（HTTP 429 + `42900`）。

**请求**

```jsonc
{
  "message": "九成新2000以内的游戏本",
  "history": [                                   // 可省略；后端会自行裁剪
    { "role": "user", "content": "想买个游戏本" },
    { "role": "assistant", "content": "..." }
  ],
  "context": {
    "focusProductId": "seed-prod-11",            // 用户当前关注的商品
    "excludeProductIds": ["seed-prod-11"],       // 已推荐过的，避免重复
    "previousFilters": { /* 上一轮的 parsed，原样回传即可 */ }
  }
}
```

**响应：SSE 事件流**（`Content-Type: text/event-stream`）

| 事件 | 载荷 | 前端动作 |
| --- | --- | --- |
| `thought` | `{ text }`，可多次 | 往折叠区追加一行「思考过程」 |
| `products` | `{ items[], total, weak, relaxedNote, parsed }` | 渲染商品卡片；**保存 `parsed` 供下一轮回传** |
| `delta` | `{ text }`，可多次 | 追加到回答气泡（打字机） |
| `suggestions` | `{ items[] }` | 渲染可点击的建议词 |
| `done` | `{ parseSource, replySource, degraded, elapsedMs, total }` | 收尾，发送按钮复原 |
| `error` | `{ code, message }` | 红字提示 + 重试入口 |

`parseSource` / `replySource` 取值：`ai`（真实模型）/ `mock`（本地规则）/ `fallback`（降级）。
`parseSource` 为 `null` 表示本轮是商品细节追问（如「这件成色怎么样」），未解析条件。

另外每 15 秒发送一次 `: ping` 心跳注释，防止中间代理掐断连接。

**三阶段管线**

| 阶段 | 做什么 | 是否依赖模型 |
| --- | --- | --- |
| ① 解析条件 | 复用自然语言解析（规则 / 模型 / 超时降级），立刻推 `thought` | 可能 |
| ② 检索商品 | 相关性排序 + 逐级放宽，推 `products`（数据全部来自数据库） | **否** |
| ③ 生成回答 | 模型只负责把已查好的结果说成人话，流式推 `delta` | 是 |

> **思考过程不是模型编的**：每一条 `thought` 都来自后端真实执行的步骤
> （识别出的条件、检索命中数、是否放宽），因此零延迟、不耗 token、不会瞎编。
> 阶段 ② 不依赖模型，所以**模型超时或断网时，思考过程与商品卡片依然完整展示**，
> 只有回答退化为本地话术 —— 这也是离线演示能保持完整体验的原因。

**超时**：`AI_TIMEOUT_MS`（条件解析，默认 5000ms）、
`AI_FIRST_TOKEN_TIMEOUT_MS`（首字，默认 6000ms）、`AI_CHAT_TIMEOUT_MS`（整体，默认 30000ms）。

**上下文裁剪**：只保留最近 6 条历史并把更早的压成一句摘要，同时有总字符上限兜底。
历史里**不放商品 JSON**，避免 token 爆炸。

**停止生成**：前端 abort 请求后，后端同步掐断对模型的调用（否则会继续计费）。

**建议词**：由后端按阶段从白名单生成，**不让模型自由生成** ——
避免出现「可以便宜点吗」这种平台答不出来的建议（本项目无议价功能）。

### 4.6 数据看板 · `/api/v1/admin/dashboard`

看板接口统一挂在 `/api/admin/*` 下，复用该 router 已注册的 `authenticate` + `requireRole('ADMIN')`，
无需在每个接口上重复声明鉴权。

| 方法 | 路径 | 鉴权 | 请求参数 | 响应 `data` |
| --- | --- | --- | --- | --- |
| GET | `/admin/dashboard` | ADMIN | `days?`（默认 7，范围 1~90） | 见下方结构说明 |

**响应结构**

```jsonc
{
  "code": 0,
  "message": "ok",
  "data": {
    "kpi": {
      "userCount": 5,
      "productCount": 35,
      "orderCount": 20,
      "gmv": "22705.00",         // 字符串，严格两位小数
      "onSaleCount": 14,         // 在售商品数
      "pendingAuditCount": 1     // 待审核数
    },
    "trend": {                   // 长度 = days，按日期升序，三条数组等长
      "dates": ["10-08", "10-09"],
      "gmv": ["1460.00", "3930.00"],
      "orderCount": [2, 2]
    },
    "orderStatus": [             // 固定 6 项，未出现的状态补 0，保证图例稳定
      { "status": "PENDING_PAYMENT", "name": "待付款", "value": 2 }
    ],
    "categoryShare": [           // 已过滤 value=0 的分类
      { "name": "手机数码", "value": 11 }
    ],
    "topProducts": [             // 高价值商品 Top 5
      { "productId": "seed-hist-05", "title": "[历史] MacBook Air M2 8G+256G", "totalQuantity": 1, "totalAmount": "4200.00" }
    ],
    "fulfillment": {             // 付款 → 发货
      "avgHours": 27.4,
      "sampleCount": 13
    }
  }
}
```

**口径约定**

| 指标 | 口径 |
| --- | --- |
| **GMV** | 仅统计**已付款**订单（`paidAt` 非空）即 `PENDING_SHIPMENT` / `SHIPPED` / `COMPLETED` / `REVIEWED`；**不含** `PENDING_PAYMENT` 与 `CANCELLED` |
| **趋势** | 三条序列都按**下单日期**（`createdAt`）归组，只用一个日期轴，口径一致易核对；`gmv` 仅累计其中的已付款订单 |
| **金额** | 一律 `toFixed(2)` 字符串。**不可直接 `toString()`**，Prisma Decimal 会丢掉尾随零（`1899.00` → `"1899"`） |
| **Top 5** | 按 `_sum.subtotal`（成交额）降序。二手商品单件交易，`quantity` 恒为 1，按销量排行没有区分度 |
| **履约时长** | `shippedAt - paidAt` 的平均小时数；无样本时 `avgHours` 为 `null` |
| **分类占比** | 按分类统计**全部**商品数（不限状态），已过滤 0 值 |

**按天分组的实现说明**

分组在 **JS 侧**完成，未使用 `$queryRaw`：

1. 项目硬性约束是「数据库必须 Prisma 参数化，禁止拼接 SQL」
2. 答辩演示包运行在 MariaDB 上，`CONVERT_TZ()` 依赖预加载的时区表，与 MySQL 行为可能不一致
3. 订单量在百级，SQL 侧用 `@@index([createdAt])` 裁掉窗口外数据后再内存分组完全够用，且口径可读

日期键使用**服务器本地时间**生成，**不可用 `toISOString()`**（那是 UTC，会跨日错位）。

**尚未实现（本次范围外）**：卖家看板 `/api/dashboard/seller`、`/api/dashboard/seller/trend`
（属卖家模块，需要时另开接口，届时也建议统一到 `/api/dashboard/*` 或 `/api/seller/*` 下）。

### 4.7 管理员 · `/api/v1/admin`

| 方法 | 路径 | 鉴权 | 请求参数 | 响应 `data` |
| --- | --- | --- | --- | --- |
| GET | `/admin/users` | ADMIN | `keyword?` `role?` `status?` `page?` | 分页信封 |
| PATCH | `/admin/users/:id/status` | ADMIN | `{ status: "ACTIVE" \| "BANNED" }` | `user` |
| GET | `/admin/products` | ADMIN | `status?` `page?` | 分页信封（审核队列） |
| PATCH | `/admin/products/:id/audit` | ADMIN | `{ approve: boolean, rejectReason? }` | `Product`（→ `ON_SALE` / `REJECTED`） |
| GET | `/admin/orders` | ADMIN | `status?` `page?` | 分页信封 |
| PATCH | `/admin/reviews/:id/status` | ADMIN | `{ status: "VISIBLE" \| "HIDDEN" }` | `Review` |

---

## 五、索引建议

`schema.prisma` 中已声明 **30 个索引**（含唯一索引），加上 6 个主键隐式索引，落库后共 **36 个索引**。设计依据：

| 表 | 索引 | 服务的查询 |
| --- | --- | --- |
| `users` | `username` `email` `phone`(唯一) | 登录、唯一性校验 |
| `users` | `(role)` `(status)` `(createdAt)` | 管理员筛选、用户增长趋势 |
| `categories` | `name` `slug`(唯一) | 路由 / SEO |
| `categories` | `(parentId)` `(status, sortOrder)` | 子分类、前台分类树 |
| `products` | `(sellerId)` `(categoryId)` | 卖家商品列表、分类筛选 |
| `products` | `(status, createdAt)` | 首页在售商品倒序（覆盖索引，免排序） |
| `products` | `(status, price)` `(status, viewCount)` | 价格区间 / 排序、热门榜 |
| `orders` | `orderNo`(唯一) | 对外订单号查询 |
| `orders` | `(buyerId, status)` | 买家「我的订单」按状态筛选 |
| `orders` | `(sellerId, status)` | 卖家「我的订单」按状态筛选 |
| `orders` | `(status, createdAt)` `(createdAt)` | 待处理订单、GMV 按日聚合 |
| `order_items` | `(orderId, productId)`(唯一) | 防重复下单同一商品 |
| `order_items` | `(orderId)` `(productId)` `(status)` | 订单详情、销量统计、分行履约 |
| `reviews` | `(orderId, productId, reviewerId)`(唯一) | 同一订单同一商品只能评价一次 |
| `reviews` | `(productId, status)` `(revieweeId, status)` | 商品评价列表、卖家信誉分 |

**额外建议（Prisma schema 无法表达，需手写迁移）**：

AI 搜索的关键词模糊匹配请不要用 `LIKE '%x%'`（无法走索引）。商品量上万后执行：

```sql
-- MySQL 全文索引：ngram 分词器专门用于中文（MySQL 5.7.6+ 内置）
ALTER TABLE products
  ADD FULLTEXT INDEX products_title_desc_ft (title, description) WITH PARSER ngram;
```

查询改写为 `MATCH(title, description) AGAINST ('iPhone' IN BOOLEAN MODE)`。
注意 MySQL 全文索引的 `ngram_token_size` 默认是 2，即**不会匹配单字关键词**；
中文场景通常够用，若需单字检索须在建库时调小该参数（需重建索引）。

放置位置：`server/prisma/migrations/<时间戳>_add_search_index/migration.sql`（迁移创建后手工追加以保持可追溯）。

---

## 六、curl 示例

> 以下为 bash / Git Bash 语法。Windows PowerShell 中请把 `curl` 写成 `curl.exe`，
> 或使用 `Invoke-RestMethod`，否则 `curl` 是 `Invoke-WebRequest` 的别名、`\` 续行会报错。

### 示例 1 · 注册并获取 JWT

```bash
curl -X POST "http://localhost:3000/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "seller_li",
    "email": "seller_li@example.com",
    "password": "Passw0rd!2026",
    "role": "SELLER"
  }'
```

```jsonc
// 响应
{
  "code": 0,
  "message": "注册成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "clz8k1x2b0000abcd1234efgh",
      "username": "seller_li",
      "email": "seller_li@example.com",
      "nickname": null,
      "avatar": null,
      "role": "SELLER",
      "status": "ACTIVE",
      "createdAt": "2026-10-07T09:27:32.414Z"
    }
  }
}
```

### 示例 2 · 卖家发布商品（进入待审核）

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X POST "http://localhost:3000/api/v1/products" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "title": "iPhone 13 128G 蓝色 九成新",
    "description": "自用无拆修，电池健康 92%，配件齐全",
    "price": "1899.00",
    "originalPrice": "5999.00",
    "images": [
      "https://cdn.example.com/p/iphone13-1.jpg",
      "https://cdn.example.com/p/iphone13-2.jpg"
    ],
    "condition": "LIKE_NEW",
    "categoryId": "clz8k2c4d0001efgh5678ijkl",
    "stock": 1
  }'
```

```jsonc
// 响应
{
  "code": 0,
  "message": "发布成功，等待管理员审核",
  "data": {
    "id": "clz8k9m0n0002opqr9012stuv",
    "title": "iPhone 13 128G 蓝色 九成新",
    "price": "1899.00",          // Decimal 序列化为字符串，避免精度丢失
    "images": ["https://cdn.example.com/p/iphone13-1.jpg", "https://cdn.example.com/p/iphone13-2.jpg"],
    "status": "PENDING_REVIEW",
    "stock": 1,
    "publishedAt": null,         // 待审核阶段未上架，审核通过后才写入时间
    "sellerId": "clz8k1x2b0000abcd1234efgh",
    "categoryId": "clz8k2c4d0001efgh5678ijkl",
    "createdAt": "2026-10-07T09:31:05.120Z"
  }
}
```

### 示例 3 · 买家下单（创建待付款订单）

```bash
BUYER_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X POST "http://localhost:3000/api/v1/orders" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -d '{
    "items": [{ "productId": "clz8k9m0n0002opqr9012stuv", "quantity": 1 }],
    "receiverName": "李四",
    "receiverPhone": "13800138000",
    "receiverAddress": "广东省广州市天河区体育西路 1 号",
    "remark": "工作日送货"
  }'
```

```jsonc
// 响应
{
  "code": 0,
  "message": "下单成功",
  "data": {
    "id": "clz8ka1b20003wxyz3456abcd",
    "orderNo": "20261007093105001",
    "buyerId": "clz8k7f8g0009qrst1234mnop",
    "totalAmount": "1899.00",
    "status": "PENDING_PAYMENT",
    "receiverName": "李四",
    "receiverPhone": "13800138000",
    "receiverAddress": "广东省广州市天河区体育西路 1 号",
    "paidAt": null,
    "shippedAt": null,
    "completedAt": null,
    "reviewedAt": null,
    "cancelledAt": null,
    "items": [
      {
        "id": "clz8ka1b20004efgh7890ijkl",
        "productId": "clz8k9m0n0002opqr9012stuv",
        "title": "iPhone 13 128G 蓝色 九成新",   // 下单快照
        "image": "https://cdn.example.com/p/iphone13-1.jpg",
        "price": "1899.00",
        "quantity": 1,
        "subtotal": "1899.00",
        "status": "PENDING"
      }
    ],
    "createdAt": "2026-10-07T09:31:05.120Z"
  }
}
```

---

## 七、迁移与回退

```bash
# 1) 进入后端目录并安装依赖（Prisma 固定 6.x，latest 目前指向 8.0.0-rc 不建议）
cd server
npm i @prisma/client@^6
npm i -D prisma@^6 typescript tsx nodemon @types/node

# 2) 配置 .env（复制根目录 .env.example，填入本机 MySQL 密码）
#    DATABASE_URL="mysql://root:密码@localhost:3306/smart_second_hand"

# 3) 生成 client + 执行首次迁移
npx prisma generate
npx prisma migrate dev --name init
# 4) 灌入演示数据（幂等，可重复执行）
npm run seed

# 5) 可视化查看数据
npx prisma studio
```

**回退方案**

```bash
# 回退最近一次迁移（生产慎用，会丢数据）
npx prisma migrate resolve --rolled-back <migration_name>

# 开发环境整体重置
npx prisma migrate reset --force

# 彻底回退本次交付：删除目录 + 还原 .env.example
rm -rf server/prisma server/docs
git checkout -- .env.example
```
