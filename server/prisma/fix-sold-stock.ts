// 修复「多库存商品被误标为已售出」的历史脏数据
//
// 背景：早期下单逻辑无视 Product.stock，无论库存多少都把商品整体置为 SOLD，
// 且 stock 字段从商品创建后从未被扣减。结果卖家设了多件库存的商品，
// 被买走一件后整条从商品列表消失（列表查询只取 status = ON_SALE）。
//
// 判据：status = 'SOLD' 且 stock > 1
//   修复上线后，正常售罄的商品 stock 一定是 0；而本 bug 脏数据的特征是
//   「库存仍是卖家设定的初始值，且 ≥ 2」。seed 演示数据里有 50 个 stock = 1 的
//   历史 SOLD 商品（支撑看板统计与个人主页「已售出」数量），若把判据放宽到
//   stock > 0，会把它们大批恢复上架，直接破坏演示基线。所以只处理 stock > 1。
//
// 重算规则：
//   occupied = 该商品在「未取消」订单中的购买件数之和
//   newStock = max(0, stock - occupied)
//   newStock > 0 → ON_SALE + newStock
//   newStock = 0 → SOLD + 0
//
// 用法：
//   npx tsx prisma/fix-sold-stock.ts          # dry-run，只打印将要修改的内容
//   npx tsx prisma/fix-sold-stock.ts --yes    # 确认后真正写入

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CONFIRMED = process.argv.includes('--yes');

interface FixItem {
  id: string;
  title: string;
  stock: number;
  occupied: number;
  newStock: number;
  newStatus: 'ON_SALE' | 'SOLD';
}

// 只允许连本地库，防止误连线上把自己的演示数据改掉
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

const collect = async (): Promise<FixItem[]> => {
  const products = await prisma.product.findMany({
    where: { status: 'SOLD', stock: { gt: 1 } },
    select: { id: true, title: true, stock: true },
    orderBy: { createdAt: 'asc' },
  });
  if (products.length === 0) return [];

  // 取消的订单不再占用库存，只有其他状态才计入占用
  const occupiedRows = await prisma.orderItem.findMany({
    where: {
      productId: { in: products.map((p) => p.id) },
      order: { status: { not: 'CANCELLED' } },
    },
    select: { productId: true, quantity: true },
  });

  const occupiedByProduct = new Map<string, number>();
  for (const row of occupiedRows) {
    occupiedByProduct.set(row.productId, (occupiedByProduct.get(row.productId) ?? 0) + row.quantity);
  }

  return products.map((product) => {
    const occupied = occupiedByProduct.get(product.id) ?? 0;
    const newStock = Math.max(0, product.stock - occupied);
    return {
      id: product.id,
      title: product.title,
      stock: product.stock,
      occupied,
      newStock,
      newStatus: newStock > 0 ? 'ON_SALE' : 'SOLD',
    };
  });
};

const report = (items: FixItem[]): void => {
  console.log('');
  console.log('待修复商品（status = SOLD 且 stock > 1）：');
  if (items.length === 0) {
    console.log('  未发现需要修复的商品，数据已是正确状态。');
    return;
  }

  for (const item of items) {
    console.log(`  · ${item.title}`);
    console.log(
      `      库存 ${item.stock} - 未取消订单占用 ${item.occupied} = ${item.newStock}  →  ${item.newStatus}`,
    );
  }

  const toOnSale = items.filter((i) => i.newStatus === 'ON_SALE').length;
  console.log('');
  console.log(
    `  合计 ${items.length} 件：恢复在售 ${toOnSale} 件，保持已售出 ${items.length - toOnSale} 件`,
  );
};

const apply = async (items: FixItem[]): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      await tx.product.update({
        where: { id: item.id },
        data: { status: item.newStatus, stock: item.newStock },
      });
    }
  });
  console.log('');
  console.log(`已修复 ${items.length} 件商品。`);
};

const main = async (): Promise<void> => {
  assertLocalDatabase();

  const items = await collect();
  report(items);
  if (items.length === 0) return;

  if (!CONFIRMED) {
    console.log('');
    console.log('（dry-run 模式，未做任何修改。加 --yes 才会真正写入）');
    return;
  }

  await apply(items);

  // 幂等自检：修复后同一条判据不应再命中任何商品
  const rest = await collect();
  console.log(
    rest.length === 0
      ? '复查：无残留脏数据（幂等通过）'
      : `复查：仍有 ${rest.length} 件符合判据，请检查`,
  );
};

main()
  .catch((error: unknown) => {
    console.error('');
    console.error(`修复失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
