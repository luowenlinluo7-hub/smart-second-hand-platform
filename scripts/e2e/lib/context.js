// E2E 跨 suite 共享的运行时上下文
//
// suite 之间有真实的依赖：订单用例需要商品用例创建出的商品 id，
// 商品用例需要认证用例拿到的 token。用一个显式上下文传参，
// 比全局变量更好追踪，也能在失败时打印出「已经走到哪一步」。
'use strict';

// 每次运行生成唯一标识，避免与上次运行的数据冲突
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const context = {
  runId,

  // 演示账号（由 seed 创建）
  seed: {
    admin: { account: 'admin@example.com', password: 'Admin@123456' },
    seller: { account: 'seller_li@example.com', password: 'Seller@123456' },
    buyer: { account: 'zhang@example.com', password: 'User@123456' },
    buyer2: { account: 'wang@example.com', password: 'User@123456' },
  },

  // 运行时获取的 token
  tokens: {
    admin: null,
    seller: null,
    buyer: null,
    buyer2: null,
    // 认证 suite 注册出来的临时用户
    temp: null,
  },

  // 认证 suite 注册的临时用户
  tempUser: null,

  // 商品 suite 从 /api/categories 取到的分类 id
  categoryId: null,

  // 商品 suite 创建的测试商品
  product: {
    id: null,
    title: null,
    price: null,
    // 用于「已售商品不可再下单」的第二个商品
    secondId: null,
    // 取消订单场景用的第三个商品
    thirdId: null,
  },

  // 订单 suite 创建的测试订单
  order: {
    mainId: null,
    cancelledId: null,
  },

  // 本次运行创建的所有实体，供结束时披露与清理
  created: {
    userIds: [],
    emails: [],
    productIds: [],
    orderIds: [],
    reviewIds: [],
  },

  track(kind, value) {
    if (kind === 'user') context.created.userIds.push(value);
    else if (kind === 'email') context.created.emails.push(value);
    else if (kind === 'product') context.created.productIds.push(value);
    else if (kind === 'order') context.created.orderIds.push(value);
    else if (kind === 'review') context.created.reviewIds.push(value);
  },

  // 结束时打印本次创建了什么，诚实披露对看板数字的影响
  describeCreated() {
    const c = context.created;
    const lines = [
      `临时用户 ${c.userIds.length} 个`,
      `测试商品 ${c.productIds.length} 件`,
      `测试订单 ${c.orderIds.length} 条`,
    ];
    if (c.emails.length) lines.push(`  邮箱：${c.emails.join(', ')}`);
    if (c.productIds.length) lines.push(`  商品 id：${c.productIds.join(', ')}`);
    if (c.orderIds.length) lines.push(`  订单 id：${c.orderIds.join(', ')}`);
    return lines;
  },
};

module.exports = { context, runId };
