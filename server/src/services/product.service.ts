// ProductStatus 是运行时枚举（用于补齐 counts 全部状态），必须用值导入
import { ProductStatus } from '@prisma/client';
import type { Prisma, ProductCondition } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/ApiError';

// 详情 / 列表出参：包含卖家与分类的嵌套信息
const productInclude = {
  seller: {
    select: { id: true, username: true, nickname: true, avatar: true },
  },
  category: {
    select: { id: true, name: true, slug: true },
  },
} satisfies Prisma.ProductInclude;

export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

// 对外出参：price / originalPrice 序列化为字符串，避免 Decimal 尾随零丢失
export type ProductDTO = Omit<ProductWithRelations, 'price' | 'originalPrice'> & {
  price: string;
  originalPrice: string | null;
};

export interface ProductListResult {
  list: ProductDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProductListQuery {
  categoryId?: string;
  condition?: ProductCondition;
  priceMin?: number;
  priceMax?: number;
  keyword?: string;
  page: number;
  pageSize: number;
}

// 卖家「我的商品」查询：status 不传则返回全部状态
export interface MyProductListQuery {
  sellerId: string;
  status?: ProductStatus;
  page: number;
  pageSize: number;
}

// 卖家商品状态计数，供前端 Tab 显示角标
export type ProductStatusCounts = Record<ProductStatus, number>;

export interface MyProductListResult extends ProductListResult {
  counts: ProductStatusCounts;
}

export interface ProductCreateInput {
  title: string;
  description?: string;
  price: string;
  originalPrice?: string;
  images: string[];
  condition: ProductCondition;
  categoryId: string;
  stock: number;
}

export interface ProductUpdateInput {
  title?: string;
  description?: string;
  price?: string;
  originalPrice?: string;
  images?: string[];
  condition?: ProductCondition;
  categoryId?: string;
  stock?: number;
}

// 金额出参统一 toFixed(2)，避免 Decimal 序列化时尾随零丢失
const formatProduct = (p: ProductWithRelations): ProductDTO => ({
  ...p,
  price: p.price.toFixed(2),
  originalPrice: p.originalPrice ? p.originalPrice.toFixed(2) : null,
});

// 列表：Prisma 动态 where 查询，只返回在售商品，按创建时间倒序
export const listProducts = async (query: ProductListQuery): Promise<ProductListResult> => {
  const where: Prisma.ProductWhereInput = { status: 'ON_SALE' };

  if (query.categoryId) {
    where.categoryId = query.categoryId;
  }
  if (query.condition) {
    where.condition = query.condition;
  }
  if (query.priceMin !== undefined || query.priceMax !== undefined) {
    where.price = {
      ...(query.priceMin !== undefined ? { gte: query.priceMin } : {}),
      ...(query.priceMax !== undefined ? { lte: query.priceMax } : {}),
    };
  }
  if (query.keyword) {
    // 关键词模糊匹配标题或描述
    where.OR = [
      { title: { contains: query.keyword } },
      { description: { contains: query.keyword } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return { list: rows.map(formatProduct), total, page: query.page, pageSize: query.pageSize };
};

// 卖家「我的商品」：返回该卖家全部状态的商品（含草稿 / 待审核 / 驳回），
// 并附带各状态数量，避免前端为了显示 Tab 角标再发 5 次请求
export const listMyProducts = async (
  query: MyProductListQuery,
): Promise<MyProductListResult> => {
  const where: Prisma.ProductWhereInput = { sellerId: query.sellerId };
  if (query.status) {
    where.status = query.status;
  }

  const [total, rows, grouped] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.product.groupBy({
      by: ['status'],
      where: { sellerId: query.sellerId },
      _count: { _all: true },
    }),
  ]);

  // groupBy 只返回出现过的状态，这里补齐全部枚举，保证前端取值不用判空
  const counts = Object.fromEntries(
    Object.values(ProductStatus).map((status) => [status, 0]),
  ) as ProductStatusCounts;
  for (const item of grouped) {
    counts[item.status] = item._count._all;
  }

  return { list: rows.map(formatProduct), total, page: query.page, pageSize: query.pageSize, counts };
};

// 详情：viewCount 自增 1 后返回
export const getProduct = async (id: string): Promise<ProductDTO> => {
  const exists = await prisma.product.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    throw ApiError.notFound('商品不存在');
  }

  const updated = await prisma.product.update({
    where: { id },
    data: { viewCount: { increment: 1 } },
    include: productInclude,
  });
  return formatProduct(updated);
};

// 发布：进入待审核（PENDING_REVIEW），审核通过后由管理员置 ON_SALE
// 注意：publishedAt 表示「上架时间」，只有真正上架时才写入，发布时保持 null
export const createProduct = async (
  sellerId: string,
  input: ProductCreateInput,
): Promise<ProductDTO> => {
  const product = await prisma.product.create({
    data: {
      title: input.title,
      description: input.description,
      price: input.price,
      originalPrice: input.originalPrice,
      images: input.images,
      condition: input.condition,
      categoryId: input.categoryId,
      stock: input.stock,
      status: 'PENDING_REVIEW',
      sellerId,
    },
    include: productInclude,
  });
  return formatProduct(product);
};

// 校验商品归属：非本人（sellerId !== userId）一律 403，防越权
// 返回当前状态，供调用方做进一步的状态机校验
const assertOwnership = async (
  id: string,
  userId: string,
): Promise<{ sellerId: string; status: ProductStatus }> => {
  const product = await prisma.product.findUnique({
    where: { id },
    select: { sellerId: true, status: true },
  });
  if (!product) {
    throw ApiError.notFound('商品不存在');
  }
  if (product.sellerId !== userId) {
    throw ApiError.forbidden('无权操作该商品');
  }
  return product;
};

// 编辑：仅商品归属者可改
// 规则：已售出 / 审核中的商品不允许随意改价改描述，避免绕过审核与影响历史订单
export const updateProduct = async (
  id: string,
  userId: string,
  input: ProductUpdateInput,
): Promise<ProductDTO> => {
  const current = await assertOwnership(id, userId);
  if (current.status === 'SOLD') {
    throw ApiError.conflict('商品已售出，不能再编辑');
  }
  if (current.status === 'PENDING_REVIEW') {
    throw ApiError.conflict('商品正在审核中，请等待审核结果');
  }

  const product = await prisma.product.update({
    where: { id },
    data: input,
    include: productInclude,
  });
  return formatProduct(product);
};

// 下架：软删，置 OFF_SHELF；仅商品归属者可操作
export const removeProduct = async (id: string, userId: string): Promise<void> => {
  const current = await assertOwnership(id, userId);
  if (current.status === 'SOLD') {
    throw ApiError.conflict('商品已售出，不能下架');
  }

  await prisma.product.update({
    where: { id },
    data: { status: 'OFF_SHELF', publishedAt: null },
  });
};

// 重新上架：下架 / 被驳回的商品重新进入待审核，保持审核流一致
export const relistProduct = async (id: string, userId: string): Promise<ProductDTO> => {
  const current = await assertOwnership(id, userId);
  if (current.status !== 'OFF_SHELF' && current.status !== 'REJECTED') {
    throw ApiError.conflict('仅下架或被驳回的商品可以重新上架');
  }

  const product = await prisma.product.update({
    where: { id },
    data: { status: 'PENDING_REVIEW', publishedAt: null, rejectReason: null },
    include: productInclude,
  });
  return formatProduct(product);
};

// 管理员：审核队列分页（不传 status 返回全部，传则过滤），含卖家信息
export const listAdminProducts = async (query: {
  status?: ProductStatus;
  page: number;
  pageSize: number;
}): Promise<ProductListResult> => {
  const where: Prisma.ProductWhereInput = query.status ? { status: query.status } : {};

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return { list: rows.map(formatProduct), total, page: query.page, pageSize: query.pageSize };
};

// 管理员审核：仅允许对 PENDING_REVIEW 状态执行
export const auditProduct = async (
  id: string,
  approve: boolean,
  rejectReason?: string,
): Promise<ProductDTO> => {
  const current = await prisma.product.findUnique({ where: { id }, select: { status: true } });
  if (!current) {
    throw ApiError.notFound('商品不存在');
  }
  if (current.status !== 'PENDING_REVIEW') {
    throw ApiError.conflict('该商品不在待审核状态');
  }

  const product = await prisma.product.update({
    where: { id },
    data: approve
      ? { status: 'ON_SALE', publishedAt: new Date(), rejectReason: null }
      : { status: 'REJECTED', publishedAt: null, rejectReason: rejectReason ?? '不符合发布规范' },
    include: productInclude,
  });
  return formatProduct(product);
};
