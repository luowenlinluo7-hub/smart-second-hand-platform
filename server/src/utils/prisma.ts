import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

// Prisma 单例：所有数据库访问都必须经过它（参数化查询，禁止拼接 SQL）
export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
