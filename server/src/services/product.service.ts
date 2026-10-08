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

// 发布：发布即上架（status=ON_SALE），sellerId 取当前登录用户
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
      status: 'ON_SALE',
      sellerId,
      publishedAt: new Date(),
    },
    include: productInclude,
  });
  return formatProduct(product);
};

// 校验商品归属：非本人（sellerId !== userId）一律 403，防越权
const assertOwnership = async (id: string, userId: string): Promise<void> => {
  const product = await prisma.product.findUnique({ where: { id }, select: { sellerId: true } });
  if (!product) {
    throw ApiError.notFound('商品不存在');
  }
  if (product.sellerId !== userId) {
    throw ApiError.forbidden('无权操作该商品');
  }
};

// 编辑：仅商品归属者可改
export const updateProduct = async (
  id: string,
  userId: string,
  input: ProductUpdateInput,
): Promise<ProductDTO> => {
  await assertOwnership(id, userId);
  const product = await prisma.product.update({
    where: { id },
    data: input,
    include: productInclude,
  });
  return formatProduct(product);
};

// 下架：软删，置 OFF_SHELF；仅商品归属者可操作
export const removeProduct = async (id: string, userId: string): Promise<void> => {
  await assertOwnership(id, userId);
  await prisma.product.update({
    where: { id },
    data: { status: 'OFF_SHELF' },
  });
};
