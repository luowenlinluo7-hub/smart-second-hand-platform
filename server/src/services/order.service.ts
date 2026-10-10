import { Prisma, type OrderStatus } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { prisma } from '../utils/prisma';

// 订单出参：含明细快照与买卖双方信息
const orderInclude = {
  items: true,
  buyer: { select: { id: true, username: true, nickname: true, avatar: true } },
  seller: { select: { id: true, username: true, nickname: true, avatar: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

// 对外出参：金额序列化为字符串（Decimal 尾随零会被归一化，必须 toFixed(2)）
export type OrderDTO = Omit<OrderWithRelations, 'totalAmount' | 'items'> & {
  totalAmount: string;
  items: (Omit<OrderWithRelations['items'][number], 'price' | 'subtotal'> & {
    price: string;
    subtotal: string;
  })[];
};

export interface OrderListResult {
  list: OrderDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateOrderInput {
  items: { productId: string; quantity: number }[];
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  remark?: string;
}

export interface OrderListQuery {
  status?: OrderStatus;
  page: number;
  pageSize: number;
}

const formatOrder = (order: OrderWithRelations): OrderDTO => ({
  ...order,
  totalAmount: order.totalAmount.toFixed(2),
  items: order.items.map((item) => ({
    ...item,
    price: item.price.toFixed(2),
    subtotal: item.subtotal.toFixed(2),
  })),
});

// 对外订单号：yyyyMMddHHmmss + 4 位随机（不暴露内部 cuid）
const generateOrderNo = (): string => {
  const d = new Date();
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${ts}${pad(Math.floor(Math.random() * 10000), 4)}`;
};

// 从 Json 图片字段安全取出首图
const firstImage = (images: Prisma.JsonValue): string | null => {
  if (!Array.isArray(images)) return null;
  const first = images[0];
  return typeof first === 'string' ? first : null;
};

// 下单：按卖家拆单，事务内保证「校验 → 建单 → 扣商品状态」原子性
export const createOrder = async (
  buyerId: string,
  input: CreateOrderInput,
): Promise<OrderDTO[]> => {
  // 同一商品去重累加数量（前端可能重复提交）
  const merged = new Map<string, number>();
  for (const item of input.items) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  }
  const productIds = [...merged.keys()];

  return prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        title: true,
        price: true,
        images: true,
        stock: true,
        status: true,
        sellerId: true,
      },
    });

    if (products.length !== productIds.length) {
      throw ApiError.badRequest('部分商品不存在');
    }

    // 校验：必须在售且有货
    for (const product of products) {
      if (product.status !== 'ON_SALE') {
        throw ApiError.conflict(`商品「${product.title}」已下架或已售出`);
      }
      const quantity = merged.get(product.id) ?? 0;
      if (product.stock < quantity) {
        throw ApiError.conflict(`商品「${product.title}」库存不足`);
      }
    }

    // 按卖家分组 → 每个卖家一个订单
    const groups = new Map<string, typeof products>();
    for (const product of products) {
      const list = groups.get(product.sellerId) ?? [];
      list.push(product);
      groups.set(product.sellerId, list);
    }

    const created: OrderDTO[] = [];

    for (const [sellerId, groupProducts] of groups) {
      let total = new Prisma.Decimal(0);
      const itemData = groupProducts.map((product) => {
        const quantity = merged.get(product.id) ?? 1;
        const price = new Prisma.Decimal(product.price);
        const subtotal = price.mul(quantity);
        total = total.add(subtotal);

        return {
          productId: product.id,
          title: product.title, // 下单快照，商品后续改价不影响历史订单
          image: firstImage(product.images),
          price,
          quantity,
          subtotal,
        };
      });

      const order = await tx.order.create({
        data: {
          orderNo: generateOrderNo(),
          buyerId,
          sellerId,
          totalAmount: total,
          receiverName: input.receiverName,
          receiverPhone: input.receiverPhone,
          receiverAddress: input.receiverAddress,
          remark: input.remark,
          items: { create: itemData },
        },
        include: orderInclude,
      });

      created.push(formatOrder(order));
    }

    // 扣减商品状态：二手商品默认单件，下单后置 SOLD
    await tx.product.updateMany({
      where: { id: { in: productIds } },
      data: { status: 'SOLD' },
    });

    return created;
  });
};

// 买家 / 卖家订单列表（复用同一查询，仅过滤字段不同）
const listOrders = async (
  where: Prisma.OrderWhereInput,
  query: OrderListQuery,
): Promise<OrderListResult> => {
  const scoped: Prisma.OrderWhereInput = query.status
    ? { ...where, status: query.status }
    : where;

  const [total, rows] = await Promise.all([
    prisma.order.count({ where: scoped }),
    prisma.order.findMany({
      where: scoped,
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return { list: rows.map(formatOrder), total, page: query.page, pageSize: query.pageSize };
};

export const listBuyerOrders = (buyerId: string, query: OrderListQuery): Promise<OrderListResult> =>
  listOrders({ buyerId }, query);

export const listSellerOrders = (
  sellerId: string,
  query: OrderListQuery,
): Promise<OrderListResult> => listOrders({ sellerId }, query);

// 订单详情：仅买卖双方可见
export const getOrderDetail = async (id: string, userId: string): Promise<OrderDTO> => {
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) {
    throw ApiError.notFound('订单不存在');
  }
  if (order.buyerId !== userId && order.sellerId !== userId) {
    throw ApiError.forbidden('无权查看该订单');
  }
  return formatOrder(order);
};

// 状态机：谁能在什么状态下流转到哪
const TRANSITIONS: {
  to: OrderStatus;
  actor: 'BUYER' | 'SELLER';
  from: OrderStatus;
  timestampField: 'paidAt' | 'shippedAt' | 'completedAt' | 'cancelledAt';
}[] = [
  { from: 'PENDING_PAYMENT', to: 'PENDING_SHIPMENT', actor: 'BUYER', timestampField: 'paidAt' },
  { from: 'SHIPPED', to: 'COMPLETED', actor: 'BUYER', timestampField: 'completedAt' },
  { from: 'PENDING_PAYMENT', to: 'CANCELLED', actor: 'BUYER', timestampField: 'cancelledAt' },
  { from: 'PENDING_SHIPMENT', to: 'SHIPPED', actor: 'SELLER', timestampField: 'shippedAt' },
];

// 状态流转：严格校验「参与方 + 角色 + 前置状态」，前端传什么都不能越权
export const updateOrderStatus = async (
  id: string,
  userId: string,
  targetStatus: OrderStatus,
): Promise<OrderDTO> => {
  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, buyerId: true, sellerId: true, status: true },
  });
  if (!order) {
    throw ApiError.notFound('订单不存在');
  }

  const isBuyer = order.buyerId === userId;
  const isSeller = order.sellerId === userId;
  if (!isBuyer && !isSeller) {
    throw ApiError.forbidden('无权操作该订单');
  }

  const actor = isBuyer ? 'BUYER' : 'SELLER';
  const rule = TRANSITIONS.find(
    (t) => t.from === order.status && t.to === targetStatus && t.actor === actor,
  );
  if (!rule) {
    // 状态不匹配 或 角色不对（如买家想发货）
    const allowed = TRANSITIONS.filter(
      (t) => t.from === order.status && t.actor === actor,
    ).map((t) => t.to);
    if (allowed.length === 0) {
      throw ApiError.forbidden(
        isBuyer ? '当前状态下买家不能执行该操作' : '当前状态下卖家不能执行该操作',
      );
    }
    throw ApiError.conflict(`订单当前状态为 ${order.status}，不能变更为 ${targetStatus}`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.order.update({
      where: { id },
      data: { status: targetStatus, [rule.timestampField]: new Date() },
      include: orderInclude,
    });

    // 取消订单：商品回滚为在售，避免商品被永久锁死
    if (targetStatus === 'CANCELLED') {
      await tx.product.updateMany({
        where: { id: { in: result.items.map((i) => i.productId) } },
        data: { status: 'ON_SALE' },
      });
    }

    return result;
  });

  return formatOrder(updated);
};

// 评价：仅买家、订单已完成时才可评；按商品逐条建 Review，订单转 REVIEWED
export const createReviews = async (
  orderId: string,
  buyerId: string,
  reviews: { productId: string; rating: number; content?: string; images?: string[] }[],
): Promise<OrderDTO> => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, buyerId: true, sellerId: true, status: true, items: true },
  });
  if (!order) {
    throw ApiError.notFound('订单不存在');
  }
  if (order.buyerId !== buyerId) {
    throw ApiError.forbidden('只有买家可以评价该订单');
  }
  if (order.status === 'REVIEWED') {
    throw ApiError.conflict('该订单已评价');
  }
  if (order.status !== 'COMPLETED') {
    throw ApiError.conflict('订单完成后才能评价');
  }

  const productIds = new Set(order.items.map((i) => i.productId));
  for (const review of reviews) {
    if (!productIds.has(review.productId)) {
      throw ApiError.badRequest('评价中包含不属于该订单的商品');
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.review.createMany({
      data: reviews.map((review) => ({
        orderId,
        productId: review.productId,
        reviewerId: buyerId,
        revieweeId: order.sellerId,
        rating: review.rating,
        content: review.content,
        images: review.images ?? [],
      })),
    });

    return tx.order.update({
      where: { id: orderId },
      data: { status: 'REVIEWED', reviewedAt: new Date() },
      include: orderInclude,
    });
  });

  return formatOrder(updated);
};
