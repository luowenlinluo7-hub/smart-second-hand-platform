import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/ApiError';

// 卖家公开资料：商品详情页的「卖家信息卡」用它
//
// 只暴露公开字段，passwordHash / email / phone 一律不返回。
// 信誉分来自该卖家收到的 VISIBLE 评价，是买家最关心的信任信号。

export interface PublicUserProfile {
  id: string;
  username: string;
  nickname: string | null;
  avatar: string | null;
  createdAt: Date;
  stats: {
    // 在售商品数
    onSaleCount: number;
    // 历史成交（已售出）数
    soldCount: number;
    // 收到的评价数与平均分
    reviewCount: number;
    avgRating: number | null;
  };
}

export const getPublicProfile = async (userId: string): Promise<PublicUserProfile> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, nickname: true, avatar: true, createdAt: true },
  });
  if (!user) {
    throw ApiError.notFound('用户不存在');
  }

  const [onSaleCount, soldCount, reviewAgg, ratingGroups] = await Promise.all([
    prisma.product.count({ where: { sellerId: userId, status: 'ON_SALE' } }),
    prisma.product.count({ where: { sellerId: userId, status: 'SOLD' } }),
    prisma.review.count({ where: { revieweeId: userId, status: 'VISIBLE' } }),
    prisma.review.groupBy({
      by: ['rating'],
      where: { revieweeId: userId, status: 'VISIBLE' },
      _count: { _all: true },
    }),
  ]);

  // 平均分在 JS 侧算：groupBy 无法直接求平均，而评价量级很小，没必要上原生 SQL
  let ratingSum = 0;
  let ratingCount = 0;
  for (const group of ratingGroups) {
    ratingSum += group.rating * group._count._all;
    ratingCount += group._count._all;
  }

  return {
    ...user,
    stats: {
      onSaleCount,
      soldCount,
      reviewCount: reviewAgg,
      avgRating: ratingCount > 0 ? Number((ratingSum / ratingCount).toFixed(1)) : null,
    },
  };
};
