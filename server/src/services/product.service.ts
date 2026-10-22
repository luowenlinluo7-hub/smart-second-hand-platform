// ProductStatus 是运行时枚举（用于补齐 counts 全部状态），必须用值导入
import { ProductStatus } from '@prisma/client';
import type { Prisma, ProductCondition } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/ApiError';
import { buildCandidateWhere, CANDIDATE_LIMIT, isWeakResult, rankProducts } from './productRank';

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

// 带相关性排序的检索：AI 搜索与 AI 助手都走这条路径。
// 与 listProducts 的区别是排序不再按时间，而是按「内容相关性 → 热度 → 时间」，
// 并且能识别出「结果较弱」，让上层有机会提示用户放宽条件。
export interface RankedSearchQuery extends ProductListQuery {
  // 需要排除的商品（如已推荐过的，避免反复推同一件）
  excludeIds?: string[];
  // 关键词的等价写法（见 searchSynonyms.expandKeywordVariants）。
  // 传了就用它做「任一命中即相关」，未传则退化为单个 keyword。
  keywords?: string[];
}

export interface RankedSearchResult extends ProductListResult {
  // 结果是否偏弱（命中很少或分数很低），供上层提示
  weak: boolean;
}

export const searchProductsRanked = async (
  query: RankedSearchQuery,
): Promise<RankedSearchResult> => {
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
  if (query.excludeIds && query.excludeIds.length > 0) {
    where.id = { notIn: query.excludeIds };
  }

  // 关键词可以是多个等价写法（品牌中文名展开成英文型号等）。
  // keywords 显式为 [] 表示「不按关键词过滤」，必须与「未传」区分开，
  // 否则会回退到 keyword（可能是一个无意义的填充词）而把结果清空。
  const keywordInput =
    query.keywords !== undefined ? query.keywords : (query.keyword ?? '');
  const keywordWhere = buildCandidateWhere(keywordInput);
  if (keywordWhere) {
    // 用 AND 包住关键词 OR 组，避免和外层条件互相覆盖
    where.AND = [keywordWhere];
  }

  const candidates = await prisma.product.findMany({
    where,
    include: productInclude,
    orderBy: { createdAt: 'desc' },
    take: CANDIDATE_LIMIT,
  });

  const ranked = rankProducts(candidates, keywordInput);
  const list = ranked.map((item) => formatProduct(item.product));

  // 「弱结果」只用来衡量关键词相关性。纯条件查询（如「两千以内」）没有关键词，
  // 命中就是精确的条件匹配，不该被判成弱结果 —— 否则 AI 会误说「符合度不算高」。
  const hasKeyword = Array.isArray(keywordInput)
    ? keywordInput.some((item) => item.trim().length > 0)
    : keywordInput.trim().length > 0;

  // 候选集已在内存里排好序，直接切片即可
  const start = (query.page - 1) * query.pageSize;
  return {
    list: list.slice(start, start + query.pageSize),
    total: list.length,
    page: query.page,
    pageSize: query.pageSize,
    weak: hasKeyword ? isWeakResult(ranked) : false,
  };
};

// ---------- 供 AI 助手使用的读取能力 ----------

// 读取「用户正在关注的商品」。刻意不增加 viewCount ——
// 用户只是问一句「这件成色怎么样」，不该把浏览量算进去。
export const findProductById = async (id: string): Promise<ProductDTO | null> => {
  const row = await prisma.product.findFirst({
    where: { id, status: 'ON_SALE' },
    include: productInclude,
  });
  return row ? formatProduct(row) : null;
};

// 同类在售商品的均价，用于回答「和同类比价格贵吗」
export const averagePriceOfCategory = async (
  categoryId: string,
  excludeId: string,
): Promise<number | null> => {
  const aggregated = await prisma.product.aggregate({
    where: { categoryId, status: 'ON_SALE', id: { not: excludeId } },
    _avg: { price: true },
  });
  const average = aggregated._avg.price;
  return average === null ? null : Number(average);
};

// 某卖家除当前商品外的其他在售商品，用于回答「卖家还卖什么」
export const listSellerOtherProducts = async (
  sellerId: string,
  excludeId: string,
  take: number,
): Promise<ProductDTO[]> => {
  const rows = await prisma.product.findMany({
    where: { sellerId, status: 'ON_SALE', id: { not: excludeId } },
    include: productInclude,
    orderBy: { createdAt: 'desc' },
    take,
  });
  return rows.map(formatProduct);
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
