// 验证「并发下单同一件商品」只会成功一单（TX-2 的 CAS 乐观锁）
// 用法：node scripts/verify-cas.mjs
// 说明：会创建一件临时商品并**在结束时清理**（订单 + 商品），不污染演示数据。
import { PrismaClient } from '@prisma/client';

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3000/api';
const prisma = new PrismaClient();

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

const login = async (account, password) => (await api('POST', '/auth/login', { body: { account, password } })).data?.token;

const receiver = { receiverName: '并发测试', receiverPhone: '13800138000', receiverAddress: '测试地址' };

let productId = null;

const main = async () => {
  const seller = await login('seller_li', 'Seller@123456');
  const admin = await login('admin', 'Admin@123456');
  const buyerA = await login('user_zhang', 'User@123456');
  const buyerB = await login('user_wang', 'User@123456');
  if (!seller || !admin || !buyerA || !buyerB) throw new Error('演示账号登录失败，请确认已执行 npm run seed');

  // 1) 卖家发布 → 管理员审核通过 → 得到一件 ON_SALE 商品
  const created = await api('POST', '/products', {
    token: seller,
    body: {
      title: '【并发验证】CAS 乐观锁测试商品',
      description: '验证完成后自动删除',
      price: 66.6,
      images: ['https://picsum.photos/seed/cas/640/480'],
      condition: 'GOOD',
      categoryId: 'seed-cat-phone',
      stock: 1,
    },
  });
  productId = created.data.id;
  const audited = await api('PATCH', `/admin/products/${productId}/audit`, {
    token: admin,
    body: { approve: true },
  });
  console.log(`商品已上架: ${productId}  status=${audited.data?.status}`);

  // 2) 两个买家**同时**下单同一件商品
  const body = { items: [{ productId, quantity: 1 }], ...receiver };
  const [ra, rb] = await Promise.all([
    api('POST', '/orders', { token: buyerA, body }),
    api('POST', '/orders', { token: buyerB, body }),
  ]);

  const results = [
    { who: '买家A', http: ra.http, code: ra.code, message: ra.message },
    { who: '买家B', http: rb.http, code: rb.code, message: rb.message },
  ];
  results.forEach((r) => console.log(`  ${r.who}: HTTP ${r.http}  code=${r.code}  ${r.message ?? ''}`));

  const success = results.filter((r) => r.code === 0).length;
  const conflict = results.filter((r) => r.code === 40900).length;

  // 3) 断言
  let pass = true;
  const check = (name, ok) => {
    console.log(`  ${ok ? '✅' : '❌'} ${name}`);
    if (!ok) pass = false;
  };
  check('恰好一单成功', success === 1);
  check('另一单被 40900 拒绝', conflict === 1);

  // 4) 数据库核对：商品只有一张有效订单
  const orders = await prisma.order.count({ where: { items: { some: { productId } } } });
  check('数据库中该商品只有 1 张订单', orders === 1);

  return pass;
};

const cleanup = async () => {
  if (!productId) return;
  const orders = await prisma.order.findMany({
    where: { items: { some: { productId } } },
    select: { id: true },
  });
  if (orders.length) {
    await prisma.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
  }
  await prisma.product.deleteMany({ where: { id: productId } });
  console.log(`已清理：订单 ${orders.length} 条 / 商品 1 件`);
};

main()
  .then(async (pass) => {
    await cleanup();
    console.log(pass ? '\n结论：CAS 生效，并发下单不会一物多卖 ✅' : '\n结论：仍有问题 ❌');
    if (!pass) process.exitCode = 1;
  })
  .catch(async (error) => {
    console.error('[验证异常]', error);
    await cleanup().catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
