// 商品模块验收脚本（本地开发用）
// 覆盖：发布状态机 → 待审核隔离 → /products/mine → 权限 → SOLD 守卫 → 审核上架
// 用法：node scripts/acceptance-product.mjs
import { PrismaClient } from '@prisma/client';

const BASE = process.env.ACCEPTANCE_BASE ?? 'http://localhost:3001/api';
const prisma = new PrismaClient();

const SELLER = { account: 'seller_li', password: 'Seller@123456' };
const ADMIN = { account: 'admin', password: 'Admin@123456' };

let pass = 0;
let fail = 0;
const cleanup = [];

const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}  →  ${JSON.stringify(actual)}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}  →  实际 ${JSON.stringify(actual)} / 期望 ${JSON.stringify(expected)}`);
  }
};

const api = async (method, path, { body, token } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { http: res.status, code: json?.code, message: json?.message, data: json?.data };
};

const setStatus = (id, status) =>
  prisma.product.update({
    where: { id },
    data: { status, publishedAt: status === 'ON_SALE' ? new Date() : null },
  });

const main = async () => {
  console.log(`\n=== 商品模块验收 @ ${BASE} ===\n`);

  const sellerToken = (await api('POST', '/auth/login', { body: SELLER })).data.token;
  const adminToken = (await api('POST', '/auth/login', { body: ADMIN })).data.token;
  const baseline = (await api('GET', '/products?pageSize=1')).data.total;
  console.log(`前台在售基线 = ${baseline}\n`);

  // ---------- 1. 发布 -> PENDING_REVIEW ----------
  console.log('[1] 卖家发布商品');
  const created = await api('POST', '/products', {
    token: sellerToken,
    body: {
      title: '【验收】状态机检查机',
      description: '自动化验收用，结束后软删',
      price: 88.8,
      images: ['https://picsum.photos/seed/acc/640/480'],
      condition: 'GOOD',
      categoryId: 'seed-cat-phone',
      stock: 1,
    },
  });
  const id = created.data.id;
  cleanup.push(id);
  check('HTTP 201', created.http, 201);
  check('status 为 PENDING_REVIEW', created.data.status, 'PENDING_REVIEW');
  check('publishedAt 为 null', created.data.publishedAt, null);
  check('提示语', created.message, '发布成功，等待管理员审核');

  // ---------- 2. 待审核商品不泄漏到前台 ----------
  console.log('\n[2] 待审核隔离');
  const afterPublish = (await api('GET', '/products?pageSize=1')).data.total;
  check('前台在售数量不变', afterPublish, baseline);

  // ---------- 3. /products/mine ----------
  console.log('\n[3] GET /products/mine');
  const mine = await api('GET', '/products/mine?pageSize=100', { token: sellerToken });
  check('HTTP 200', mine.http, 200);
  const inList = mine.data.list.some((p) => p.id === id);
  check('待审核商品在列表中可见', inList, true);
  check('该商品状态', mine.data.list.find((p) => p.id === id)?.status, 'PENDING_REVIEW');
  check('counts 含全部 6 个状态', Object.keys(mine.data.counts).sort(), [
    'DRAFT',
    'OFF_SHELF',
    'ON_SALE',
    'PENDING_REVIEW',
    'REJECTED',
    'SOLD',
  ]);
  check('counts.PENDING_REVIEW 计数', mine.data.counts.PENDING_REVIEW >= 1, true);

  const filtered = await api('GET', '/products/mine?status=OFF_SHELF', { token: sellerToken });
  check('按 status 过滤生效', filtered.data.list.every((p) => p.status === 'OFF_SHELF'), true);

  // ---------- 4. 鉴权 / 参数校验 ----------
  console.log('\n[4] 鉴权与参数校验');
  check('未登录 /mine 返回 401', (await api('GET', '/products/mine')).http, 401);
  const badStatus = await api('GET', '/products/mine?status=BOGUS', { token: sellerToken });
  check('非法 status 返回 400', badStatus.http, 400);
  check('非法 status 业务码', badStatus.code, 40001);

  // ---------- 5. 审核中不可编辑 ----------
  console.log('\n[5] 审核中禁止编辑');
  const editPending = await api('PUT', `/products/${id}`, { token: sellerToken, body: { price: 99 } });
  check('HTTP 409', editPending.http, 409);
  check('业务码 40900', editPending.code, 40900);

  // ---------- 6. 越权 ----------
  console.log('\n[6] 越权防护');
  const othersEdit = await api('PUT', `/products/${id}`, { token: adminToken, body: { price: 1 } });
  check('非归属者编辑返回 403', othersEdit.http, 403);
  check('业务码 40300', othersEdit.code, 40300);

  // ---------- 7. SOLD 守卫 ----------
  console.log('\n[7] SOLD 状态守卫');
  await setStatus(id, 'SOLD');
  const editSold = await api('PUT', `/products/${id}`, { token: sellerToken, body: { price: 77 } });
  check('SOLD 编辑返回 409', editSold.http, 409);
  check('SOLD 编辑提示', editSold.message, '商品已售出，不能再编辑');
  const delSold = await api('DELETE', `/products/${id}`, { token: sellerToken });
  check('SOLD 下架返回 409', delSold.http, 409);
  check('SOLD 下架提示', delSold.message, '商品已售出，不能下架');

  // ---------- 8. 待审核可撤回（软删） ----------
  console.log('\n[8] 待审核可撤回');
  await setStatus(id, 'PENDING_REVIEW');
  const cancel = await api('DELETE', `/products/${id}`, { token: sellerToken });
  check('撤回 HTTP 200', cancel.http, 200);
  const afterCancel = await prisma.product.findUnique({
    where: { id },
    select: { status: true, publishedAt: true },
  });
  check('撤回后状态', afterCancel.status, 'OFF_SHELF');
  check('撤回后 publishedAt 清空', afterCancel.publishedAt, null);
  check('前台仍不可见', (await api('GET', '/products?pageSize=1')).data.total, baseline);

  // ---------- 9. 审核通过 -> 上架（走真实审核 API）----------
  console.log('\n[9] 审核通过后上架');
  await setStatus(id, 'PENDING_REVIEW'); // 回到待审核，才能走审核接口
  const audit = await api('PATCH', `/admin/products/${id}/audit`, {
    token: adminToken,
    body: { approve: true },
  });
  check('审核通过 HTTP 200', audit.http, 200);
  check('审核后状态 ON_SALE', audit.data.status, 'ON_SALE');
  check('前台在售 +1', (await api('GET', '/products?pageSize=1')).data.total, baseline + 1);
  const detail = await api('GET', `/products/${id}`);
  check('详情状态', detail.data.status, 'ON_SALE');
  check('publishedAt 已写入', typeof detail.data.publishedAt, 'string');
  check('viewCount 自增', detail.data.viewCount >= 1, true);
  check('金额格式化', detail.data.price, '88.80');

  // ---------- 10. 上架后可编辑 ----------
  console.log('\n[10] 上架后恢复可编辑');
  const editOnSale = await api('PUT', `/products/${id}`, { token: sellerToken, body: { price: 68.8 } });
  check('HTTP 200', editOnSale.http, 200);
  check('价格已更新', editOnSale.data.price, '68.80');

  // ---------- 11. 清理 ----------
  console.log('\n[11] 清理验收数据');
  for (const pid of cleanup) {
    await prisma.product.update({ where: { id: pid }, data: { status: 'OFF_SHELF', publishedAt: null } });
  }
  console.log(`  已软删 ${cleanup.length} 条验收商品`);
  check('前台恢复基线', (await api('GET', '/products?pageSize=1')).data.total, baseline);

  console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===\n`);
  if (fail > 0) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error('[验收异常]', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
