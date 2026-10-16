# 已知问题清单（Known Issues）

> **文档位置说明**：`AGENTS.md` 约定的文档目录是 `server/docs/`，那里放的是**契约类**文档
> （数据库设计、API 契约，需要跟着后端代码走）。本文件是**跨端**的测试产出 —— E2E 同时
> 覆盖前端可见行为与后端接口，因此放在仓库根的 `docs/` 下，与契约文档互补：
> - 契约（应该怎样）：[server/docs/api-contract.md](../server/docs/api-contract.md)
> - 实际测试结论（跑出来怎样）：本文件

## 结论摘要

全量 E2E（`npm run test:e2e`）当前结果：**77 通过 / 0 失败 / 2 跳过**。

测试过程中**没有发现阻断级（🔴）缺陷**。下面 5 条是评审代码与实测过程中确认的
🟡 级问题：它们不影响主流程走通，但在多用户并发或完整演示场景下会暴露，
因此如实记录并给出修复方向，本阶段**有意不修**（理由逐条说明）。

| # | 严重度 | 位置 | 问题 | 处置 |
| --- | --- | --- | --- | --- |
| 1 | 🟡 | [order.service.ts:223](../server/src/services/order.service.ts) | 状态流转存在并发竞态 | 记录不改 |
| 2 | 🟡 | [order.service.ts:157](../server/src/services/order.service.ts) | 下单置 `SOLD` 但不递减 `stock` | 记录不改 |
| 3 | 🟡 | 全库（仅 `POST /orders/:id/reviews`） | 评价只写不读，无任何展示入口 | 记录不改 |
| 4 | 🟡 | [api-contract.md](../server/docs/api-contract.md) | 契约里有 2 个接口未实现 | 记录不改 |
| 5 | ⚪ | [dashboard.service.ts](../server/src/services/dashboard.service.ts) | 趋势图日期标签省略年份 | 记录不改 |

---

## 1. 🟡 订单状态流转的并发竞态

**位置**：[server/src/services/order.service.ts:223](../server/src/services/order.service.ts)

**现象**：`updateOrderStatus` 先**在事务外**读取订单状态做状态机校验，再**在事务内**执行更新。
两次几乎同时到达的同向流转请求（最典型的是重复点击「立即付款」）可能都通过前置校验，
导致状态被重复写入、对应的时间戳被刷新为后一次的时间。

**复现**（并发两次）：

```bash
# 同一订单并发发起两次付款，两者都可能返回 200
curl -X PUT http://localhost:3000/api/orders/<orderId>/status \
  -H "Authorization: Bearer <buyerToken>" -H "Content-Type: application/json" \
  -d '{"status":"PENDING_SHIPMENT"}' &
curl -X PUT http://localhost:3000/api/orders/<orderId>/status \
  -H "Authorization: Bearer <buyerToken>" -H "Content-Type: application/json" \
  -d '{"status":"PENDING_SHIPMENT"}' &
```

**影响范围**：不会越权、不会产生脏数据或错误金额，只是重复写入 + 时间戳偏移。
单机演示场景下前端按钮自带 loading 态，正常操作无法触发。

**为什么不修**：修复需要把「读取 → 校验 → 更新」整体改成带条件的原子更新
（例如 `updateMany({ where: { id, status: rule.from } })` 后判断 `count === 1`），
这会改动订单核心事务边界，回归面覆盖整个交易链路。本阶段目标是「跑通闭环 + 记录缺陷」，
不宜在无充分验证的情况下动核心事务。

**建议修复方向**：

```ts
// 把事务外的状态读取并入条件更新，用受影响行数做乐观锁
const updated = await prisma.$transaction(async (tx) => {
  const res = await tx.order.updateMany({
    where: { id, status: rule.from },          // 关键：把前置状态作为更新条件
    data: { status: targetStatus, [rule.timestampField]: new Date() },
  });
  if (res.count === 0) {
    throw ApiError.conflict('订单状态已变更，请刷新后重试');
  }
  return tx.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
});
```

---

## 2. 🟡 下单把商品置为 `SOLD`，但不递减 `stock`

**位置**：[server/src/services/order.service.ts:157](../server/src/services/order.service.ts)

**现象**：`createOrder` 在事务内把订单涉及的商品统一置为 `SOLD`，但没有同步减少
`Product.stock`。下单后商品处于「已售出」状态，`stock` 却仍是下单前的值。

**影响范围**：二手平台默认单件交易（`quantity` 恒为 1），且 `SOLD` 商品已无法再次下单
（返回 409），所以不会出现超卖或金额错算。仅在「多件库存商品」这一未来场景下，
或直接展示 `stock` 字段时才会与实际不符。

**为什么不修**：这是**有意保留的既有取舍** —— 项目此前已明确不调整 `stock` / `quantity`
的语义，改动会波及商品详情页展示、下单校验和看板口径。属于架构级决策，不适合在测试阶段顺手改。

**建议修复方向**：若将来支持多件库存，应改为
`stock: { decrement: quantity }` 并在库存归零时才置 `SOLD`，同时把下单校验
`product.stock < quantity` 换成数据库层的条件更新以避免并发超卖。

---

## 3. 🟡 评价数据「只写不读」，没有任何展示入口

**位置**：全库。除 `POST /api/orders/:id/reviews` 外，没有任何接口读取 `Review`。

**现象**：

- `Review` 表有完整模型（含 `status: ReviewStatus` 默认 `VISIBLE`）、seed 里造了 34 条评价，
  但**后端没有任何读取接口**，`orderInclude` 也不含 `reviews`。
- 前端 `OrderDetailView.vue` 只有「提交评价」表单项，提交后订单变成「已评价」，
  评价内容再也看不到；商品详情页没有评分与评价列表。
- 因此 `ReviewStatus`（可见 / 隐藏）字段完全未被使用。

**复现**：登录 → 我的订单 → 完成后提交评价 → 成功；随后打开商品详情 / 订单详情 / 个人中心，
都没有任何地方能看到这条评价。

**为什么不算缺陷**：`api-contract.md` 对 `GET /orders/:id` 的承诺是
「含 `items` 快照、买卖双方信息」，并**没有**承诺返回 `reviews`；实现与契约一致。
所以这是**功能缺口**而非实现错误。本阶段范围是逻辑闭环测试，新增读取接口 + 评价展示 UI
会明显扩大改动面，故记录待办。

**E2E 如何覆盖**：因为接口读不回来，`scripts/e2e/suites/order.js` 里的
「评价确实落库」用例改为**直连本地数据库**核对 `review` 行数
（仅在目标为本地地址时启用，指向公网时自动跳过）。这样「接口返回成功」与
「数据真的写进去了」两件事都被验证到。

**建议修复方向**：

1. 后端：新增 `GET /api/products/:id/reviews`（分页，仅返回 `status = VISIBLE`）；
   seed 已预留索引 `reviews(productId, status)`，可直接命中。
2. 前端：商品详情页加评价列表与平均分；`OrderDetailView` 在状态为 `REVIEWED` 时展示已提交内容。

---

## 4. 🟡 契约文档中 2 个接口尚未实现

**位置**：[server/docs/api-contract.md](../server/docs/api-contract.md)（4.6 管理端接口表）

| 契约中的接口 | 实现状态 |
| --- | --- |
| `GET /api/admin/orders` | 未实现（`server/src/routes/admin.ts` 只有 dashboard / products / audit） |
| `PATCH /api/admin/reviews/:id/status` | 未实现（与问题 3 相关，评价可见性治理未落地） |

**影响范围**：契约文档超前于实现。前端没有调用这两个接口，因此不影响任何现有页面。

**为什么不修**：属于新功能开发，不属于闭环测试阶段的范围；且问题 3 未解决时，
审核评价可见性也没有实际意义（前端根本不展示评价）。

**建议修复方向**：要么按契约补齐实现，要么在契约文档中把这 2 行标注为「规划中」，
避免后续接手的人误以为已可用。

---

## 5. ⚪ 趋势图日期标签省略年份

**位置**：[server/src/services/dashboard.service.ts](../server/src/services/dashboard.service.ts)
（`dates: [...buckets.keys()].map((key) => key.slice(5))`）

**现象**：看板 `trend.dates` 返回 `MM-DD`（如 `10-09`），而不是 `YYYY-MM-DD`。
这是**刻意**为图表 x 轴紧凑显示而做的截断，不是缺陷。

**唯一的边界情况**：当查询窗口跨越年份（`days=30/90` 且落在 12 月到 1 月之间）时，
标签会同时出现 `12-28` 和 `01-03`。分桶本身用的是完整 `YYYY-MM-DD` 作 key，
数据不会串桶，只是标签读起来需要靠顺序判断年份，且按字符串排序会失真。

**为什么不修**：纯展示层问题，对聚合数据没有任何影响。修它需要同时改后端出参和
前端 x 轴 `axisLabel.formatter`，收益极小。

**建议修复方向**：跨年时改用 `MM-DD` 之外的策略，例如在每月 1 号显示 `M月`，
或直接返回完整 `YYYY-MM-DD` 交给 ECharts 的 `axisLabel.formatter` 处理。

---

## 复跑测试

```bash
# 1. 启动后端（另开一个终端）
cd server && npm run dev

# 2. 跑全量 E2E（测试数据默认会自动清理）
npm run test:e2e
```

需要保留测试数据时：`E2E_KEEP_DATA=1 npm run test:e2e`
（Windows PowerShell：`$env:E2E_KEEP_DATA="1"; npm run test:e2e`）

单独清理残留数据（只删含 `E2E` 标识的记录，不碰 seed 数据）：

```bash
cd server
npm run db:clean-e2e              # dry-run，先看会删什么
npm run db:clean-e2e -- --yes     # 确认后删除
npm run db:reset-demo             # 清理 + 重灌 seed（答辩前一键清场）
```

更完整的说明见 [README.md](../README.md) 的「端到端（E2E）测试」一节。
