// 订单模块 E2E：下单 → 付款 → 发货 → 收货 → 评价 全链路 + 越权与状态机边界
'use strict';

const { api } = require('../lib/http');
const { assert, codes, test, skip } = require('../lib/reporter');
const { context } = require('../lib/context');
const { countReviewsByOrder } = require('../lib/db');

const RECEIVER = {
  receiverName: 'E2E收货人',
  receiverPhone: '13800138000',
  receiverAddress: '北京市海淀区中关村大街 1 号 E2E 测试',
};

const place = (token, productId, quantity = 1) =>
  api.post('/api/orders', {
    token,
    body: { items: [{ productId, quantity }], ...RECEIVER },
  });

const run = async () => {
  const { buyer, temp: seller, buyer2 } = context.tokens;
  const mainProductId = context.product.secondId;
  const cancelProductId = context.product.thirdId;

  if (!mainProductId) {
    skip('订单全流程用例', '订单 suite 依赖商品 suite 预置的在售商品，但未取到');
    return;
  }

  // ---------- 鉴权 ----------
  await test('未登录下单返回 401', async () => {
    const res = await place(null, mainProductId);
    assert.biz(res, codes.UNAUTHORIZED, 401, '未登录下单');
  });

  // ---------- 下单 ----------
  await test('买家下单成功，订单进入 PENDING_PAYMENT 且商品变为 SOLD', async () => {
    const res = await place(buyer, mainProductId);
    assert.biz(res, 0, 201, '下单');
    assert.envelope(res, '下单');

    const orders = res.body.data;
    assert.arrayLength(orders, 1, '单卖家下单的订单数');

    const order = orders[0];
    assert.equal(order.status, 'PENDING_PAYMENT', '新订单状态');
    assert.money(order.totalAmount, '订单总额');
    assert.equal(order.items[0].productId, mainProductId, '订单明细的商品');
    assert.ok(order.orderNo, '订单号应存在');

    context.order.mainId = order.id;
    context.track('order', order.id);

    const detail = await api.get(`/api/products/${mainProductId}`);
    assert.equal(detail.body.data.status, 'SOLD', '下单后商品状态');
  });

  await test('已售出商品再次下单返回 409', async () => {
    const res = await place(buyer2, mainProductId);
    assert.biz(res, codes.CONFLICT, 409, '重复下单已售商品');
  });

  await test('卖家不能下架已售出的商品（409，防止误操作破坏在途订单）', async () => {
    const res = await api.delete(`/api/products/${mainProductId}`, { token: seller });
    assert.biz(res, codes.CONFLICT, 409, '下架已售商品');
  });

  await test('购买不存在的商品返回 400', async () => {
    const res = await place(buyer, 'not-a-real-product-id');
    assert.biz(res, codes.PARAM_ERROR, 400, '下单不存在的商品');
  });

  // ---------- 状态机与角色边界 ----------
  await test('买家付款：PENDING_PAYMENT → PENDING_SHIPMENT', async () => {
    const res = await api.put(`/api/orders/${context.order.mainId}/status`, {
      token: buyer,
      body: { status: 'PENDING_SHIPMENT' },
    });
    assert.biz(res, 0, 200, '买家付款');
    assert.equal(res.body.data.status, 'PENDING_SHIPMENT', '付款后状态');
    assert.ok(res.body.data.paidAt, '付款时间应写入');
  });

  await test('买家不能替卖家发货（403）', async () => {
    const res = await api.put(`/api/orders/${context.order.mainId}/status`, {
      token: buyer,
      body: { status: 'SHIPPED' },
    });
    assert.biz(res, codes.FORBIDDEN, 403, '买家越权发货');
  });

  await test('非参与方查看订单详情返回 403', async () => {
    const res = await api.get(`/api/orders/${context.order.mainId}`, { token: buyer2 });
    assert.biz(res, codes.FORBIDDEN, 403, '非参与方查看订单');
  });

  await test('非参与方修改订单状态返回 403', async () => {
    const res = await api.put(`/api/orders/${context.order.mainId}/status`, {
      token: buyer2,
      body: { status: 'CANCELLED' },
    });
    assert.biz(res, codes.FORBIDDEN, 403, '非参与方改状态');
  });

  await test('订单不存在返回 404', async () => {
    const res = await api.get('/api/orders/not-a-real-order-id', { token: buyer });
    assert.biz(res, codes.NOT_FOUND, 404, '不存在的订单');
  });

  await test('卖家发货：PENDING_SHIPMENT → SHIPPED', async () => {
    const res = await api.put(`/api/orders/${context.order.mainId}/status`, {
      token: seller,
      body: { status: 'SHIPPED' },
    });
    assert.biz(res, 0, 200, '卖家发货');
    assert.equal(res.body.data.status, 'SHIPPED', '发货后状态');
    assert.ok(res.body.data.shippedAt, '发货时间应写入');
  });

  await test('买家确认收货：SHIPPED → COMPLETED', async () => {
    const res = await api.put(`/api/orders/${context.order.mainId}/status`, {
      token: buyer,
      body: { status: 'COMPLETED' },
    });
    assert.biz(res, 0, 200, '确认收货');
    assert.equal(res.body.data.status, 'COMPLETED', '收货后状态');
  });

  await test('卖家不能替买家确认收货（403）', async () => {
    const res = await api.put(`/api/orders/${context.order.mainId}/status`, {
      token: seller,
      body: { status: 'COMPLETED' },
    });
    assert.ok(
      res.http === 403 || res.http === 409,
      `期望 403 或 409，实际 HTTP ${res.http} ${res.text.slice(0, 160)}`,
    );
  });

  await test('买家不能在未完成时非法跳转状态（409 或 403）', async () => {
    const res = await api.put(`/api/orders/${context.order.mainId}/status`, {
      token: buyer,
      body: { status: 'CANCELLED' },
    });
    assert.ok(
      res.http === 409 || res.http === 403,
      `期望 409 或 403，实际 HTTP ${res.http} ${res.text.slice(0, 160)}`,
    );
  });

  // ---------- 评价 ----------
  await test('非法评分（6 分）被拒（400）', async () => {
    const res = await api.post(`/api/orders/${context.order.mainId}/reviews`, {
      token: buyer,
      body: { reviews: [{ productId: mainProductId, rating: 6 }] },
    });
    assert.biz(res, codes.PARAM_ERROR, 400, '非法评分');
  });

  await test('评价不属于该订单的商品被拒（400）', async () => {
    const res = await api.post(`/api/orders/${context.order.mainId}/reviews`, {
      token: buyer,
      body: { reviews: [{ productId: cancelProductId ?? 'x', rating: 5 }] },
    });
    assert.biz(res, codes.PARAM_ERROR, 400, '评价无关商品');
  });

  await test('卖家不能评价买家订单（403）', async () => {
    const res = await api.post(`/api/orders/${context.order.mainId}/reviews`, {
      token: seller,
      body: { reviews: [{ productId: mainProductId, rating: 5 }] },
    });
    assert.biz(res, codes.FORBIDDEN, 403, '卖家评价订单');
  });

  await test('买家评价成功，订单转为 REVIEWED（闭环）', async () => {
    const res = await api.post(`/api/orders/${context.order.mainId}/reviews`, {
      token: buyer,
      body: {
        reviews: [{ productId: mainProductId, rating: 5, content: 'E2E 好评：成色符合描述' }],
      },
    });
    assert.biz(res, 0, 201, '提交评价');
    assert.equal(res.body.data.status, 'REVIEWED', '评价后状态');
    assert.ok(res.body.data.reviewedAt, '评价时间应写入');
    // 注意：订单 DTO 按契约只包含 items 与买卖双方，不含 reviews，这里不作断言
  });

  await test('评价确实落库（评价接口只写不读，只能直连数据库核对）', async () => {
    const { count, reason } = await countReviewsByOrder(context.order.mainId);
    if (count === null) {
      skip('评价落库核对', reason);
      return;
    }
    assert.equal(count, 1, '该订单的评价条数');
  });

  await test('重复评价返回 409', async () => {
    const res = await api.post(`/api/orders/${context.order.mainId}/reviews`, {
      token: buyer,
      body: { reviews: [{ productId: mainProductId, rating: 4 }] },
    });
    assert.biz(res, codes.CONFLICT, 409, '重复评价');
  });

  // ---------- 列表可见性 ----------
  await test('买家 / 卖家订单列表均能命中该订单', async () => {
    const buyerList = await api.get('/api/orders/buyer', { token: buyer });
    assert.biz(buyerList, 0, 200, '买家订单列表');
    assert.pageShape(buyerList.body.data, '买家订单列表');
    assert.ok(
      buyerList.body.data.list.some((o) => o.id === context.order.mainId),
      '买家列表应包含该订单',
    );

    const sellerList = await api.get('/api/orders/seller', { token: seller });
    assert.biz(sellerList, 0, 200, '卖家订单列表');
    assert.ok(
      sellerList.body.data.list.some((o) => o.id === context.order.mainId),
      '卖家列表应包含该订单',
    );

    // 无关用户不应在列表里看到该订单
    const otherList = await api.get('/api/orders/buyer', { token: buyer2 });
    assert.ok(
      !otherList.body.data.list.some((o) => o.id === context.order.mainId),
      '无关用户的列表不应包含该订单',
    );
  });

  await test('订单列表可按状态过滤', async () => {
    const res = await api.get('/api/orders/buyer?status=REVIEWED', { token: buyer });
    assert.biz(res, 0, 200, '按状态过滤');
    for (const o of res.body.data.list) {
      assert.equal(o.status, 'REVIEWED', '过滤结果的状态');
    }
  });

  // ---------- 取消订单回滚商品（闭环）----------
  if (!cancelProductId) {
    skip('取消订单回滚商品', '未取到用于取消场景的商品');
    return;
  }

  await test('取消订单后商品回到 ON_SALE（可再次购买）', async () => {
    const created = await place(buyer2, cancelProductId);
    assert.biz(created, 0, 201, '下单待取消的商品');
    const orderId = created.body.data[0].id;
    context.order.cancelledId = orderId;
    context.track('order', orderId);

    const cancel = await api.put(`/api/orders/${orderId}/status`, {
      token: buyer2,
      body: { status: 'CANCELLED' },
    });
    assert.biz(cancel, 0, 200, '取消订单');
    assert.equal(cancel.body.data.status, 'CANCELLED', '取消后状态');
    assert.ok(cancel.body.data.cancelledAt, '取消时间应写入');

    const detail = await api.get(`/api/products/${cancelProductId}`);
    assert.equal(detail.body.data.status, 'ON_SALE', '取消后商品状态');
  });
};

module.exports = { run };
