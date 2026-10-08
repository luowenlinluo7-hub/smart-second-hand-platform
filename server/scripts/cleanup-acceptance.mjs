// 清理验收过程中产生的临时商品（仅本地开发用）
// 用法：node scripts/cleanup-acceptance.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 验收脚本创建的临时商品标题前缀
const TITLE_PREFIXES = ['【验收】', '【验收2】', '【自测】'];

try {
  const targets = await prisma.product.findMany({
    where: { OR: TITLE_PREFIXES.map((p) => ({ title: { startsWith: p } })) },
    select: { id: true, title: true, status: true, orderItems: { select: { id: true } } },
  });

  if (targets.length === 0) {
    console.log('[cleanup] 没有需要清理的验收商品');
  } else {
    for (const t of targets) {
      if (t.orderItems.length > 0) {
        console.log(`[cleanup] 跳过（已被订单引用，不能删除）：${t.title}`);
        continue;
      }
      await prisma.product.delete({ where: { id: t.id } });
      console.log(`[cleanup] 已删除：${t.title}（原状态 ${t.status}）`);
    }
  }

  const remaining = await prisma.product.count();
  console.log(`[cleanup] 当前商品总数：${remaining}`);
} catch (error) {
  console.error('[cleanup] 失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
