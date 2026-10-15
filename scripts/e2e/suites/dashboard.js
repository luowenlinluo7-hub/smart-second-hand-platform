// 管理员数据看板 E2E：权限边界 + 聚合口径与数据形状
'use strict';

const { api } = require('../lib/http');
const { assert, codes, test } = require('../lib/reporter');
const { context } = require('../lib/context');

const STATUS_LABELS = {
  PENDING_PAYMENT: '待付款',
  PENDING_SHIPMENT: '待发货',
  SHIPPED: '已发货',
  COMPLETED: '已完成',
  REVIEWED: '已评价',
  CANCELLED: '已取消',
};

const isNonNegativeInt = (v) => Number.isInteger(v) && v >= 0;

const pad = (n) => String(n).padStart(2, '0');

const run = async () => {
  // ---------- 权限边界 ----------
  await test('未登录访问看板返回 401', async () => {
    const res = await api.get('/api/admin/dashboard');
    assert.biz(res, codes.UNAUTHORIZED, 401, '未登录访问看板');
  });

  await test('普通用户访问看板返回 403', async () => {
    const res = await api.get('/api/admin/dashboard', { token: context.tokens.buyer });
    assert.biz(res, codes.FORBIDDEN, 403, '普通用户访问看板');
  });

  await test('卖家访问看板返回 403', async () => {
    const res = await api.get('/api/admin/dashboard', { token: context.tokens.temp });
    assert.biz(res, codes.FORBIDDEN, 403, '卖家访问看板');
  });

  await test('非法 days 参数返回 400（days=0 与 days=91）', async () => {
    const zero = await api.get('/api/admin/dashboard?days=0', { token: context.tokens.admin });
    assert.biz(zero, codes.PARAM_ERROR, 400, 'days=0');

    const over = await api.get('/api/admin/dashboard?days=91', { token: context.tokens.admin });
    assert.biz(over, codes.PARAM_ERROR, 400, 'days=91');
  });

  // ---------- 结构 ----------
  await test('管理员访问返回六大区块且 KPI 口径正确', async () => {
    const res = await api.get('/api/admin/dashboard', { token: context.tokens.admin });
    assert.biz(res, 0, 200, '获取看板');
    assert.envelope(res, '获取看板');
    assert.noPasswordHash(res, '获取看板');

    const data = res.body.data;
    for (const key of ['kpi', 'trend', 'orderStatus', 'categoryShare', 'topProducts', 'fulfillment']) {
      assert.ok(key in data, `看板响应缺少区块 "${key}"`);
    }

    const kpi = data.kpi;
    for (const key of ['userCount', 'productCount', 'orderCount', 'onSaleCount', 'pendingAuditCount']) {
      assert.ok(isNonNegativeInt(kpi[key]), `kpi.${key} 应为非负整数，实际 ${JSON.stringify(kpi[key])}`);
    }
    // 金额必须是保精度的两位小数字符串，不能用浮点数
    assert.money(kpi.gmv, 'kpi.gmv');
    assert.ok(kpi.userCount > 0, 'seed 数据下总用户数应大于 0');
    assert.ok(kpi.productCount > 0, 'seed 数据下总商品数应大于 0');
    assert.ok(kpi.orderCount > 0, 'seed 数据下总订单数应大于 0（否则趋势图全为 0）');
  });

  await test('默认窗口 trend 为 7 天且三数组等长', async () => {
    const res = await api.get('/api/admin/dashboard', { token: context.tokens.admin });
    assert.biz(res, 0, 200, '默认窗口');

    const trend = res.body.data.trend;
    assert.arrayLength(trend.dates, 7, 'trend.dates 长度');
    assert.arrayLength(trend.gmv, 7, 'trend.gmv 长度');
    assert.arrayLength(trend.orderCount, 7, 'trend.orderCount 长度');

    for (const amount of trend.gmv) {
      assert.money(amount, 'trend.gmv 元素');
    }
    for (const count of trend.orderCount) {
      assert.ok(isNonNegativeInt(count), `trend.orderCount 元素应为非负整数，实际 ${count}`);
    }

    // 日期标签刻意省略年份（图表 x 轴用 MM-DD 更紧凑），
    // 因此这里直接按「今天往前推 6 天」算出期望序列，而不是拿字符串排序验证
    const label = (offset) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - offset);
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const expected = [];
    for (let i = 6; i >= 0; i -= 1) expected.push(label(i));

    assert.equal(trend.dates.join(','), expected.join(','), 'trend.dates 应为最近 7 天且按时间升序');
  });

  await test('days=30 时趋势数组长度同步为 30', async () => {
    const res = await api.get('/api/admin/dashboard?days=30', { token: context.tokens.admin });
    assert.biz(res, 0, 200, '30 天窗口');
    assert.arrayLength(res.body.data.trend.dates, 30, 'trend.dates 长度');
    assert.arrayLength(res.body.data.trend.gmv, 30, 'trend.gmv 长度');
    assert.arrayLength(res.body.data.trend.orderCount, 30, 'trend.orderCount 长度');
  });

  await test('订单状态分布覆盖六种状态且名称为中文', async () => {
    const res = await api.get('/api/admin/dashboard', { token: context.tokens.admin });
    const items = res.body.data.orderStatus;

    assert.arrayLength(items, 6, '订单状态项数');
    const seen = new Set();
    for (const item of items) {
      assert.ok(item.status in STATUS_LABELS, `未知订单状态「${item.status}」`);
      assert.equal(item.name, STATUS_LABELS[item.status], `${item.status} 的中文名`);
      assert.ok(isNonNegativeInt(item.value), `${item.status} 的数量应为非负整数，实际 ${item.value}`);
      seen.add(item.status);
    }
    for (const status of Object.keys(STATUS_LABELS)) {
      assert.ok(seen.has(status), `订单状态分布缺少「${status}」`);
    }
    // 各状态数量之和不得超过总订单数（聚合口径一致性）
    const sum = items.reduce((acc, i) => acc + i.value, 0);
    assert.equal(sum, res.body.data.kpi.orderCount, '状态数量之和应等于总订单数');
  });

  await test('分类占比与热销 TOP5 结构正确', async () => {
    const res = await api.get('/api/admin/dashboard', { token: context.tokens.admin });
    const { categoryShare, topProducts } = res.body.data;

    assert.ok(Array.isArray(categoryShare), 'categoryShare 应为数组');
    assert.ok(categoryShare.length > 0, 'seed 数据下分类占比不应为空');
    for (const item of categoryShare) {
      assert.ok(typeof item.name === 'string' && item.name.length > 0, 'categoryShare.name 应为非空字符串');
      assert.ok(isNonNegativeInt(item.value), `categoryShare.value 应为非负整数，实际 ${item.value}`);
    }

    assert.ok(Array.isArray(topProducts), 'topProducts 应为数组');
    assert.ok(topProducts.length <= 5, `热销榜最多 5 条，实际 ${topProducts.length}`);
    assert.ok(topProducts.length > 0, 'seed 数据下热销榜不应为空');
    for (const item of topProducts) {
      assert.ok(item.productId && item.title, 'topProducts 应包含 productId 与 title');
      assert.ok(isNonNegativeInt(item.totalQuantity), 'totalQuantity 应为非负整数');
      assert.money(item.totalAmount, `热销商品「${item.title}」的销售额`);
    }
    // 销量降序
    const quantities = topProducts.map((i) => i.totalQuantity);
    const sorted = [...quantities].sort((a, b) => b - a);
    assert.equal(quantities.join(','), sorted.join(','), '热销榜应按销量降序');
  });

  await test('履约时长结构正确（无样本时为 null）', async () => {
    const res = await api.get('/api/admin/dashboard', { token: context.tokens.admin });
    const f = res.body.data.fulfillment;

    assert.ok(isNonNegativeInt(f.sampleCount), `sampleCount 应为非负整数，实际 ${f.sampleCount}`);
    if (f.sampleCount === 0) {
      assert.equal(f.avgHours, null, '无样本时 avgHours 应为 null');
    } else {
      assert.ok(
        typeof f.avgHours === 'number' && f.avgHours >= 0,
        `有样本时 avgHours 应为非负数，实际 ${JSON.stringify(f.avgHours)}`,
      );
    }
  });
};

module.exports = { run };
