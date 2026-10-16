// 清理测试残留数据（E2E 自动化跑出来的用户 / 商品 / 订单 / 评价）
//
// 设计原则：**只删可识别的测试数据，绝不整库清空**。
//   - 只匹配 email 以 e2e- 开头、title 含 E2E 的记录
//   - 删除前先断言这些 id 里没有 seed- 前缀（seed 数据是演示基线，碰不得）
//   - 只允许连本地库，防止误连线上
//
// 用法：
//   npx tsx prisma/clean-test-data.ts            # 只打印将要删除的内容（dry-run）
//   npx tsx prisma/clean-test-data.ts --yes      # 确认后真正删除
//
// 说明：E2E 结束时会自动调用同一套清理逻辑，因此这里用 --yes 手动跑主要用于
// 「之前遗留的脏数据」或「答辩前清场」。

import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const CONFIRMED = process.argv.includes('--yes');

// 测试数据的识别规则，集中在一处便于核对
const E2E_EMAIL_PREFIX = 'e2e-';
const E2E_TITLE_MARK = 'E2E';
const SEED_ID_PREFIX = 'seed-';

interface Plan {
  users: { id: string; email: string; role: string }[];
  products: { id: string; title: string; status: string }[];
  orders: { id: string; orderNo: string; status: string }[];
  reviews: { id: string; orderId: string }[];
}

// 是否指向本地库。非本地一律拒绝执行，避免误删线上数据。
const assertLocalDatabase = (): void => {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) {
    throw new Error('拒绝执行：未读到 DATABASE_URL（应在 server/.env 中配置）');
  }
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(url);
  if (!isLocal) {
    throw new Error(
      `拒绝执行：DATABASE_URL 指向的不是本地库（${url.replace(/:\/\/[^@]*@/, '://***@')}）`,
    );
  }
};

const collect = async (): Promise<Plan> => {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: E2E_EMAIL_PREFIX } },
    select: { id: true, email: true, role: true },
  });
  const userIds = users.map((u) => u.id);

  // 两个来源取并集：标题含标记的，或卖家是测试用户的
  const products = await prisma.product.findMany({
    where: {
      OR: [
        { title: { contains: E2E_TITLE_MARK } },
        ...(userIds.length ? [{ sellerId: { in: userIds } }] : []),
      ],
    },
    select: { id: true, title: true, status: true },
  });
  const productIds = products.map((p) => p.id);

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        ...(userIds.length ? [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] : []),
      ],
    },
    select: { id: true, orderNo: true, status: true },
  });
  const orderIds = orders.map((o) => o.id);

  const reviews = await prisma.review.findMany({
    where: {
      OR: [
        ...(userIds.length ? [{ reviewerId: { in: userIds } }] : []),
        ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
      ],
    },
    select: { id: true, orderId: true },
  });

  // 安全断言：任何 seed- 开头的记录都不允许出现在待删集合里
  const straySeed = [
    ...users.filter((u) => u.id.startsWith(SEED_ID_PREFIX)).map((u) => `user ${u.id}`),
    ...products.filter((p) => p.id.startsWith(SEED_ID_PREFIX)).map((p) => `product ${p.id}`),
    ...orders.filter((o) => o.id.startsWith(SEED_ID_PREFIX)).map((o) => `order ${o.id}`),
  ];
  if (straySeed.length > 0) {
    throw new Error(`安全断言失败：待删集合里出现了 seed 数据 → ${straySeed.join(', ')}`);
  }

  return { users, products, orders, reviews };
};

const report = (plan: Plan): void => {
  const { users, products, orders, reviews } = plan;
  console.log('');
  console.log('将要删除的测试数据：');

  console.log(`  用户 ${users.length} 个`);
  for (const u of users) console.log(`    · ${u.email}  [${u.role}]`);

  console.log(`  商品 ${products.length} 件`);
  for (const p of products) console.log(`    · [${p.status}] ${p.title}`);

  console.log(`  订单 ${orders.length} 条`);
  for (const o of orders) console.log(`    · ${o.orderNo}  [${o.status}]`);

  console.log(`  评价 ${reviews.length} 条`);

  const total = users.length + products.length + orders.length + reviews.length;
  if (total === 0) {
    console.log('');
    console.log('  未发现测试残留，数据库已是干净状态。');
  }
};

const remove = async (plan: Plan): Promise<void> => {
  const userIds = plan.users.map((u) => u.id);
  const productIds = plan.products.map((p) => p.id);
  const orderIds = plan.orders.map((o) => o.id);
  const reviewIds = plan.reviews.map((r) => r.id);

  // 顺序必须遵守外键依赖：
  //   Review  → Order 是 Cascade，但 Review 还引用 Product / User（restrict），
  //             所以评价必须显式先删，不能指望级联。
  //   OrderItem → Product 是 restrict，所以订单必须先于商品删除。
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (reviewIds.length) {
      await tx.review.deleteMany({ where: { id: { in: reviewIds } } });
    }
    if (orderIds.length) {
      // OrderItem / 剩余 Review 由 onDelete: Cascade 一并清除
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (productIds.length) {
      await tx.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (userIds.length) {
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  console.log('');
  console.log(
    `已删除：评价 ${reviewIds.length} / 订单 ${orderIds.length} / 商品 ${productIds.length} / 用户 ${userIds.length}`,
  );
};

// 打印当前基线，便于删除后对比
const printBaseline = async (label: string): Promise<void> => {
  const [users, products, orders, reviews] = await Promise.all([
    prisma.user.count(),
    prisma.product.count(),
    prisma.order.count(),
    prisma.review.count(),
  ]);
  console.log(`  ${label}：用户 ${users} / 商品 ${products} / 订单 ${orders} / 评价 ${reviews}`);
};

const main = async (): Promise<void> => {
  assertLocalDatabase();
  await printBaseline('清理前');

  const plan = await collect();
  report(plan);

  const total = plan.users.length + plan.products.length + plan.orders.length + plan.reviews.length;
  if (total === 0) {
    return;
  }

  if (!CONFIRMED) {
    console.log('');
    console.log('（dry-run 模式，未做任何修改。加 --yes 才会真正删除）');
    return;
  }

  await remove(plan);
  console.log('');
  await printBaseline('清理后');
};

main()
  .catch((error: unknown) => {
    console.error('');
    console.error(`清理失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
