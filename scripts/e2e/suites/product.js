// 商品模块 E2E：发布 → 审核 → 上架 → 编辑 → 下架 → 重新上架 全生命周期 + 权限边界
'use strict';

const { api } = require('../lib/http');
const { assert, codes, test, skip } = require('../lib/reporter');
const { context } = require('../lib/context');

const IMAGE = '/demo/p1.jpg';

// 发布一件测试商品，返回 { id, title }
const publish = async (title, price) => {
  const res = await api.post('/api/products', {
    token: context.tokens.temp,
    body: {
      title,
      description: `E2E 自动化测试商品 ${context.runId}`,
      price,
      originalPrice: price + 1000,
      images: [IMAGE, '/demo/p2.jpg'],
      condition: 'LIKE_NEW',
      categoryId: context.categoryId,
      stock: 1,
    },
  });
  assert.biz(res, 0, 201, `发布商品「${title}」`);
  const id = res.body.data.id;
  context.track('product', id);
  return { id, title };
};

// 管理员审核通过，使商品上架
const approve = async (id, label) => {
  const res = await api.patch(`/api/admin/products/${id}/audit`, {
    token: context.tokens.admin,
    body: { approve: true },
  });
  assert.biz(res, 0, 200, label);
  assert.equal(res.body.data.status, 'ON_SALE', `${label}后的状态`);
};

const run = async () => {
  // ---------- 前置：取一个真实分类 ----------
  await test('GET /api/categories 返回可用分类（公开接口）', async () => {
    const res = await api.get('/api/categories');
    assert.biz(res, 0, 200, '获取分类');
    assert.envelope(res, '获取分类');
    assert.ok(Array.isArray(res.body.data) && res.body.data.length > 0, '分类列表不应为空');
    context.categoryId = res.body.data[0].id;
  });

  if (!context.categoryId) {
    skip('商品全流程用例', '未取到分类，后续用例全部依赖 categoryId');
    return;
  }

  // ---------- 发布权限 ----------
  await test('USER 角色发布商品被拒（403）', async () => {
    const res = await api.post('/api/products', {
      token: context.tokens.buyer,
      body: {
        title: `E2E越权发布-${context.runId}`,
        price: 100,
        categoryId: context.categoryId,
      },
    });
    assert.biz(res, codes.FORBIDDEN, 403, 'USER 发布商品');
  });

  await test('SELLER 发布成功且进入 PENDING_REVIEW（未审核不上架）', async () => {
    const created = await publish(`E2E生命周期-${context.runId}`, 1999);
    context.product.id = created.id;
    context.product.title = created.title;
    context.product.price = '1999.00';

    const res = await api.get(`/api/products/${created.id}`);
    assert.biz(res, 0, 200, '查询新发布商品');
    assert.equal(res.body.data.status, 'PENDING_REVIEW', '新发布商品状态');
    assert.money(res.body.data.price, '商品价格');
  });

  await test('未审核商品不出现在公开列表', async () => {
    const res = await api.get(`/api/products?keyword=${encodeURIComponent(context.product.title)}`);
    assert.biz(res, 0, 200, '关键词搜索');
    assert.pageShape(res.body.data, '公开列表');
    const hit = res.body.data.list.find((p) => p.id === context.product.id);
    assert.ok(!hit, '待审核商品不应出现在公开列表');
  });

  // ---------- 审核 ----------
  await test('非管理员调用审核接口被拒（403）', async () => {
    const res = await api.patch(`/api/admin/products/${context.product.id}/audit`, {
      token: context.tokens.buyer,
      body: { approve: true },
    });
    assert.biz(res, codes.FORBIDDEN, 403, '普通用户审核');
  });

  await test('管理员审核通过后商品上架并出现在公开列表', async () => {
    await approve(context.product.id, '审核通过');

    const res = await api.get(`/api/products?keyword=${encodeURIComponent(context.product.title)}`);
    assert.biz(res, 0, 200, '审核后搜索');
    const hit = res.body.data.list.find((p) => p.id === context.product.id);
    assert.ok(hit, '审核通过后商品应出现在公开列表');
    assert.equal(hit.status, 'ON_SALE', '上架商品状态');
    // 公开列表不应泄露卖家敏感字段
    assert.noPasswordHash(res, '公开列表');
  });

  await test('查看详情会累加 viewCount', async () => {
    const before = await api.get(`/api/products/${context.product.id}`);
    const first = before.body.data.viewCount;
    const after = await api.get(`/api/products/${context.product.id}`);
    assert.equal(after.body.data.viewCount, first + 1, 'viewCount 自增');
  });

  await test('查询不存在的商品 id 返回 404', async () => {
    const res = await api.get('/api/products/not-a-real-product-id');
    assert.biz(res, codes.NOT_FOUND, 404, '不存在的商品');
  });

  // ---------- 编辑权限 ----------
  await test('编辑他人商品被拒（403）', async () => {
    const res = await api.put(`/api/products/${context.product.id}`, {
      token: context.tokens.seller,
      body: { price: 1 },
    });
    assert.biz(res, codes.FORBIDDEN, 403, '编辑他人商品');
  });

  await test('本人编辑商品成功，价格变更持久化', async () => {
    const res = await api.put(`/api/products/${context.product.id}`, {
      token: context.tokens.temp,
      body: { price: 1888, condition: 'GOOD' },
    });
    assert.biz(res, 0, 200, '编辑自己的商品');

    const detail = await api.get(`/api/products/${context.product.id}`);
    assert.equal(detail.body.data.price, '1888.00', '编辑后的价格');
    assert.equal(detail.body.data.condition, 'GOOD', '编辑后的成色');
  });

  await test('负数价格被拒（400）', async () => {
    const res = await api.put(`/api/products/${context.product.id}`, {
      token: context.tokens.temp,
      body: { price: -5 },
    });
    assert.biz(res, codes.PARAM_ERROR, 400, '负数价格');
  });

  await test('非法分页参数被拒（400）', async () => {
    const res = await api.get('/api/products?page=0&pageSize=999');
    assert.biz(res, codes.PARAM_ERROR, 400, '非法分页');
  });

  await test('空分类 id 被拒（400）', async () => {
    const res = await api.post('/api/products', {
      token: context.tokens.temp,
      body: { title: `E2E无分类-${context.runId}`, price: 10, categoryId: '' },
    });
    assert.biz(res, codes.PARAM_ERROR, 400, '空分类');
  });

  // ---------- 下架 / 重新上架 ----------
  await test('下架后商品从公开列表消失（软删除）', async () => {
    const del = await api.delete(`/api/products/${context.product.id}`, {
      token: context.tokens.temp,
    });
    assert.biz(del, 0, 200, '下架商品');

    const detail = await api.get(`/api/products/${context.product.id}`);
    assert.equal(detail.body.data.status, 'OFF_SHELF', '下架后的状态');

    const list = await api.get(`/api/products?keyword=${encodeURIComponent(context.product.title)}`);
    const hit = list.body.data.list.find((p) => p.id === context.product.id);
    assert.ok(!hit, '下架商品不应出现在公开列表');
  });

  await test('重新上架后回到 PENDING_REVIEW（审核流闭环）', async () => {
    const res = await api.post(`/api/products/${context.product.id}/relist`, {
      token: context.tokens.temp,
    });
    assert.biz(res, 0, 200, '重新上架');
    assert.equal(res.body.data.status, 'PENDING_REVIEW', '重新上架后的状态');
  });

  await test('已下架商品不能被外人重新上架（403）', async () => {
    const res = await api.post(`/api/products/${context.product.id}/relist`, {
      token: context.tokens.seller,
    });
    assert.biz(res, codes.FORBIDDEN, 403, '他人重新上架');
  });

  // ---------- 为订单 suite 预置两件在售商品 ----------
  await test('预置订单用例所需的在售商品（A/B）', async () => {
    const main = await publish(`E2E订单主流程-${context.runId}`, 2000);
    await approve(main.id, '审核订单主流程商品');
    context.product.secondId = main.id;

    const cancel = await publish(`E2E订单取消-${context.runId}`, 300);
    await approve(cancel.id, '审核订单取消商品');
    context.product.thirdId = cancel.id;
  });

  // ---------- 图片可访问性（需要前端源站，默认跳过）----------
  const frontendUrl = (process.env.E2E_FRONTEND_URL || '').replace(/\/$/, '');
  if (!frontendUrl) {
    skip('商品图片 URL 可访问性', '未设置 E2E_FRONTEND_URL（示例图由前端 Vite public 目录提供）');
  } else {
    await test('商品图片 URL 均可访问（200）', async () => {
      const res = await api.get('/api/products?pageSize=20');
      const urls = new Set();
      for (const p of res.body.data.list) {
        for (const img of p.images ?? []) {
          if (img.startsWith('/')) urls.add(img);
        }
      }
      assert.ok(urls.size > 0, '公开列表应至少有一张站内图片');

      for (const url of urls) {
        const head = await fetch(`${frontendUrl}${url}`, { method: 'HEAD' });
        assert.equal(head.status, 200, `图片 ${url} 可访问性`);
      }
    });
  }
};

module.exports = { run };
