// 管理员数据看板：全部指标都来自真实数据库聚合，无任何硬编码假数据
//
// 关于「按天分组」的实现选择：
//   任务建议用 $queryRaw 写原生 SQL 聚合，但本项目不用，原因有三：
//   1) 项目硬性约束是「数据库必须 Prisma 参数化，禁止拼接 SQL」
//   2) 答辩演示包跑的是 MariaDB，CONVERT_TZ() 依赖预加载的时区表，
//      MySQL 与 MariaDB 行为可能不一致，现场有风险
//   3) 订单量在百级，SQL 侧用 @@index([createdAt]) 裁掉窗口外的数据后，
//      在 JS 侧按本地日期归组完全够用，且口径可读、易核对
//   因此这里只在 SQL 侧做「时间窗口裁剪」，分组交给 JS。

import type { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

// 订单状态的中文名（与前端 OrderListView 的映射保持一致）
const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: '待付款',
  PENDING_SHIPMENT: '待发货',
  SHIPPED: '已发货',
  COMPLETED: '已完成',
  REVIEWED: '已评价',
  CANCELLED: '已取消',
};

// 饼图用的固定顺序：按业务流转顺序排列，避免图例跳来跳去
const ORDER_STATUS_ORDER: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'PENDING_SHIPMENT',
  'SHIPPED',
  'COMPLETED',
  'REVIEWED',
  'CANCELLED',
];

export interface DashboardKpi {
  userCount: number;
  productCount: number;
  orderCount: number;
  // 已付款订单总额，字符串保留两位小数
  gmv: string;
  onSaleCount: number;
  pendingAuditCount: number;
}

export interface DashboardTrend {
  dates: string[];
  gmv: string[];
  orderCount: number[];
}

export interface DashboardOrderStatusItem {
  status: OrderStatus;
  name: string;
  value: number;
}

export interface DashboardCategoryItem {
  name: string;
  value: number;
}

export interface DashboardTopProduct {
  productId: string;
  title: string;
  totalQuantity: number;
  totalAmount: string;
}

export interface DashboardFulfillment {
  // 付款到发货的平均小时数；无样本时为 null
  avgHours: number | null;
  sampleCount: number;
}

export interface DashboardData {
  kpi: DashboardKpi;
  trend: DashboardTrend;
  orderStatus: DashboardOrderStatusItem[];
  categoryShare: DashboardCategoryItem[];
  topProducts: DashboardTopProduct[];
  fulfillment: DashboardFulfillment;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

// 本地日期键，用于分桶。刻意不用 toISOString()（那是 UTC，会跨日错位）
const dayKey = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Prisma Decimal → 两位小数字符串。
// 不能直接 toString()，否则会丢掉尾随零（1899.00 会变成 "1899"）
const money = (value: Prisma.Decimal | null | undefined): string =>
  value ? value.toFixed(2) : '0.00';

export const getDashboard = async (days: number): Promise<DashboardData> => {
  // 今天零点，再往前推 days-1 天 —— 保证分桶覆盖「今天」这一整天
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const since = new Date(startOfToday);
  since.setDate(since.getDate() - (days - 1));

  const [
    userCount,
    productCount,
    onSaleCount,
    pendingAuditCount,
    orderCount,
    paidAggregate,
    trendOrders,
    statusGroups,
    categories,
    topGroups,
    shippedOrders,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.product.count(),
    prisma.product.count({ where: { status: 'ON_SALE' } }),
    // 待审核数：管理员最关心的待办量，放在 KPI 区
    prisma.product.count({ where: { status: 'PENDING_REVIEW' } }),
    prisma.order.count(),
    // GMV 只统计已付款订单：paidAt 非空即 PENDING_SHIPMENT / SHIPPED / COMPLETED / REVIEWED
    // 未付款（PENDING_PAYMENT）与已取消（CANCELLED）不计入
    prisma.order.aggregate({
      where: { paidAt: { not: null } },
      _sum: { totalAmount: true },
    }),
    // 趋势：SQL 侧按时间窗口裁剪（走 @@index([createdAt])），分组在 JS 做
    prisma.order.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, totalAmount: true, paidAt: true },
    }),
    prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.category.findMany({
      select: { name: true, _count: { select: { products: true } } },
      orderBy: { sortOrder: 'asc' },
    }),
    // 高价值商品 Top 5：按成交额（subtotal 求和）降序。
    // 二手商品单件交易，quantity 恒为 1，按销量排没有区分度，故用成交额。
    prisma.orderItem.groupBy({
      by: ['productId'],
      _sum: { subtotal: true, quantity: true },
      orderBy: { _sum: { subtotal: 'desc' } },
      take: 5,
    }),
    // 履约时长：付款到发货的间隔
    prisma.order.findMany({
      where: { paidAt: { not: null }, shippedAt: { not: null } },
      select: { paidAt: true, shippedAt: true },
    }),
  ]);

  // ---------- 趋势分桶 ----------
  const buckets = new Map<string, { gmv: number; orderCount: number }>();
  for (let i = 0; i < days; i += 1) {
    // 用 setDate 逐日回退，避免直接用毫秒累加在夏令时下偏移
    const d = new Date(startOfToday);
    d.setDate(d.getDate() - (days - 1 - i));
    buckets.set(dayKey(d), { gmv: 0, orderCount: 0 });
  }

  for (const order of trendOrders) {
    const bucket = buckets.get(dayKey(order.createdAt));
    if (!bucket) continue;
    bucket.orderCount += 1;
    // 口径：按下单日期归组；只有已付款的才累计金额
    if (order.paidAt) bucket.gmv += Number(order.totalAmount);
  }

  const trend: DashboardTrend = {
    dates: [...buckets.keys()].map((key) => key.slice(5)),
    gmv: [...buckets.values()].map((b) => b.gmv.toFixed(2)),
    orderCount: [...buckets.values()].map((b) => b.orderCount),
  };

  // ---------- 订单状态分布（补齐没出现过的状态，保证图例稳定）----------
  const statusCountMap = new Map(statusGroups.map((g) => [g.status, g._count._all]));
  const orderStatus: DashboardOrderStatusItem[] = ORDER_STATUS_ORDER.map((status) => ({
    status,
    name: ORDER_STATUS_LABELS[status],
    value: statusCountMap.get(status) ?? 0,
  }));

  // ---------- 分类占比（过滤掉 0，避免饼图出现空扇区）----------
  const categoryShare: DashboardCategoryItem[] = categories
    .map((c) => ({ name: c.name, value: c._count.products }))
    .filter((item) => item.value > 0);

  // ---------- 高价值商品 Top 5 ----------
  // groupBy 只返回 productId，标题要再查一次；
  // 且 findMany 不保证顺序，必须按聚合结果的顺序重排
  const topIds = topGroups.map((g) => g.productId);
  const topProducts = topIds.length
    ? await prisma.product.findMany({
        where: { id: { in: topIds } },
        select: { id: true, title: true },
      })
    : [];
  const titleMap = new Map(topProducts.map((p) => [p.id, p.title]));

  const topRanked: DashboardTopProduct[] = topGroups.map((g) => ({
    productId: g.productId,
    title: titleMap.get(g.productId) ?? '（商品已删除）',
    totalQuantity: g._sum.quantity ?? 0,
    totalAmount: money(g._sum.subtotal),
  }));

  // ---------- 履约时长 ----------
  const durations = shippedOrders
    .filter((o): o is { paidAt: Date; shippedAt: Date } => !!o.paidAt && !!o.shippedAt)
    .map((o) => (o.shippedAt.getTime() - o.paidAt.getTime()) / (60 * 60 * 1000));

  const avgHours = durations.length
    ? Math.round((durations.reduce((sum, h) => sum + h, 0) / durations.length) * 10) / 10
    : null;

  return {
    kpi: {
      userCount,
      productCount,
      orderCount,
      gmv: money(paidAggregate._sum.totalAmount),
      onSaleCount,
      pendingAuditCount,
    },
    trend,
    orderStatus,
    categoryShare,
    topProducts: topRanked,
    fulfillment: { avgHours, sampleCount: durations.length },
  };
};

export { ORDER_STATUS_LABELS };
