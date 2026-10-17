import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/ApiError';

// ---------- 出参类型 ----------

export interface ReviewReviewer {
  id: string;
  username: string;
  nickname: string | null;
  avatar: string | null;
}

export interface ReviewDTO {
  id: string;
  rating: number;
  content: string | null;
  images: Prisma.JsonValue;
  createdAt: Date;
  reviewer: ReviewReviewer;
}

export interface ReviewSummary {
  // 平均分，保留 1 位小数；无评价时为 null，避免前端显示 0.0 造成误解
  avgRating: number | null;
  count: number;
  // 各星级数量，键为 1~5，用于渲染分布条
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

export interface ReviewListResult {
  list: ReviewDTO[];
  total: number;
  page: number;
  pageSize: number;
  summary: ReviewSummary;
}

// ---------- 查询 ----------

// 评价人只暴露公开字段，禁止带出 email / phone / passwordHash
const reviewerSelect = {
  id: true,
  username: true,
  nickname: true,
  avatar: true,
} as const;

// 商品评价列表：只返回 VISIBLE 的评价
// 被管理员隐藏的评价仍然计入 total 之外 —— 用户看不到，就不该占位
export const listProductReviews = async (
  productId: string,
  query: { page: number; pageSize: number },
): Promise<ReviewListResult> => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) {
    throw ApiError.notFound('商品不存在');
  }

  const where: Prisma.ReviewWhereInput = { productId, status: 'VISIBLE' };

  const [total, rows, groups] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      include: { reviewer: { select: reviewerSelect } },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    // 星级分布用于「好评率 / 分布条」，与分页无关，所以单独聚合
    prisma.review.groupBy({
      by: ['rating'],
      where,
      _count: { _all: true },
    }),
  ]);

  const distribution: ReviewSummary['distribution'] = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let ratingSum = 0;
  for (const group of groups) {
    const key = String(group.rating) as keyof ReviewSummary['distribution'];
    if (key in distribution) {
      distribution[key] = group._count._all;
      ratingSum += group.rating * group._count._all;
    }
  }

  return {
    list: rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      content: row.content,
      images: row.images,
      createdAt: row.createdAt,
      reviewer: row.reviewer,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    summary: {
      avgRating: total > 0 ? Number((ratingSum / total).toFixed(1)) : null,
      count: total,
      distribution,
    },
  };
};
