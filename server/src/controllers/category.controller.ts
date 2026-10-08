import type { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success } from '../utils/response';

// GET /api/categories：返回启用中的分类，按 sortOrder 升序
export const list = async (_req: Request, res: Response): Promise<void> => {
  const categories = await prisma.category.findMany({
    where: { status: 'ENABLED' },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, slug: true, icon: true, sortOrder: true, status: true },
  });
  res.json(success(categories));
};
