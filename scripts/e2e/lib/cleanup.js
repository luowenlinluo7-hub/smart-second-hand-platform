// E2E 结束后的可选清理
//
// 为什么需要它：E2E 会创建真实的用户 / 商品 / 订单，而数据看板是**全库聚合**的，
// 测试数据会改变 GMV、订单数等数字（答辩要用干净数据）。API 层无法清理
// （商品 DELETE 是软删除、没有删除用户的接口），所以只能走 Prisma。
//
// 触发条件：E2E_CLEANUP=1 且目标为本地地址。
// 指向公网时直接跳过 —— 远端库不应被测试脚本直连，也不该被删除数据。
'use strict';

const { openDb, closeDb, dbUnavailableReason } = require('./db');
const { context } = require('./context');

const cleanup = async () => {
  if (process.env.E2E_CLEANUP !== '1') {
    return { ran: false, reason: '未开启（设 E2E_CLEANUP=1 可清理）' };
  }

  const { prisma, reason } = openDb();
  if (!prisma) {
    return { ran: false, reason: reason ?? dbUnavailableReason() ?? '数据库不可用' };
  }

  const removed = { reviews: 0, orders: 0, products: 0, users: 0 };

  try {
    const { orderIds, productIds, userIds } = context.created;

    // 顺序要紧：先删引用方，再删被引用方，避免外键约束报错
    if (orderIds.length) {
      const reviews = await prisma.review.deleteMany({ where: { orderId: { in: orderIds } } });
      removed.reviews += reviews.count;

      // OrderItem 有 onDelete: Cascade，删订单会一并清掉明细
      const orders = await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      removed.orders += orders.count;
    }

    // 兜底：临时用户可能还发过评价（引用 order / product）
    if (userIds.length) {
      const reviews = await prisma.review.deleteMany({ where: { reviewerId: { in: userIds } } });
      removed.reviews += reviews.count;

      // 临时用户如果是卖家，其商品可能被其他订单引用，先把这些订单清掉
      const strayOrders = await prisma.order.deleteMany({
        where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] },
      });
      removed.orders += strayOrders.count;
    }

    if (productIds.length) {
      const products = await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      removed.products += products.count;
    }

    if (userIds.length) {
      const users = await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      removed.users += users.count;
    }

    return { ran: true, removed };
  } catch (error) {
    return { ran: false, reason: `清理失败：${error.message}` };
  } finally {
    await closeDb();
  }
};

module.exports = { cleanup };
