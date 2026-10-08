import type { Request, Response } from 'express';
import { z } from 'zod';
import * as productService from '../services/product.service';
import { ApiError } from '../utils/ApiError';
import { success } from '../utils/response';

// ---------- zod 校验规则 ----------

const productBodySchema = z.object({
  title: z.string({ error: '标题不能为空' }).trim().min(1, '标题不能为空').max(100, '标题最多 100 字'),
  description: z.string().max(2000, '描述最多 2000 字').optional(),
  price: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v > 0, '价格必须大于 0'),
  originalPrice: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v >= 0, '原价必须大于等于 0')
    .optional(),
  images: z.array(z.string().url('图片必须是合法 URL')).max(9, '最多 9 张图片').default([]),
  condition: z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR']).default('GOOD'),
  categoryId: z.string({ error: '请选择分类' }).min(1, '请选择分类'),
  stock: z.number().int().min(1, '库存至少 1').max(999, '库存最多 999').default(1),
});

// 编辑用：所有字段纯 optional、无 default，未传字段保持原值（避免 default 覆盖已有数据）
const productUpdateSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(100, '标题最多 100 字').optional(),
  description: z.string().max(2000, '描述最多 2000 字').optional(),
  price: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v > 0, '价格必须大于 0')
    .optional(),
  originalPrice: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v >= 0, '原价必须大于等于 0')
    .optional(),
  images: z.array(z.string().url('图片必须是合法 URL')).max(9, '最多 9 张图片').optional(),
  condition: z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR']).optional(),
  categoryId: z.string().min(1, '请选择分类').optional(),
  stock: z.number().int().min(1, '库存至少 1').max(999, '库存最多 999').optional(),
});

const listQuerySchema = z.object({
  categoryId: z.string().optional(),
  condition: z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR']).optional(),
  priceMin: z.coerce.number().nonnegative().optional(),
  priceMax: z.coerce.number().nonnegative().optional(),
  keyword: z.string().trim().max(50, '关键词最多 50 字').optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------- 控制器 ----------

// GET /api/products
export const list = async (req: Request, res: Response): Promise<void> => {
  const query = listQuerySchema.parse(req.query);
  const result = await productService.listProducts({
    categoryId: query.categoryId,
    condition: query.condition,
    priceMin: query.priceMin,
    priceMax: query.priceMax,
    keyword: query.keyword,
    page: query.page,
    pageSize: query.pageSize,
  });
  res.json(success(result));
};

// GET /api/products/:id
export const detail = async (req: Request, res: Response): Promise<void> => {
  const product = await productService.getProduct(String(req.params.id));
  res.json(success(product));
};

// POST /api/products（需 SELLER）
export const create = async (req: Request, res: Response): Promise<void> => {
  const input = productBodySchema.parse(req.body);
  const sellerId = getUserId(req);
  const product = await productService.createProduct(sellerId, {
    title: input.title,
    description: input.description,
    price: String(input.price),
    originalPrice: input.originalPrice !== undefined ? String(input.originalPrice) : undefined,
    images: input.images,
    condition: input.condition,
    categoryId: input.categoryId,
    stock: input.stock,
  });
  res.status(201).json(success(product, '发布成功'));
};

// PUT /api/products/:id（需本人）
export const update = async (req: Request, res: Response): Promise<void> => {
  const input = productUpdateSchema.parse(req.body);
  const userId = getUserId(req);
  const product = await productService.updateProduct(String(req.params.id), userId, {
    title: input.title,
    description: input.description,
    price: input.price !== undefined ? String(input.price) : undefined,
    originalPrice: input.originalPrice !== undefined ? String(input.originalPrice) : undefined,
    images: input.images,
    condition: input.condition,
    categoryId: input.categoryId,
    stock: input.stock,
  });
  res.json(success(product, '更新成功'));
};

// DELETE /api/products/:id（需本人，软删下架）
export const remove = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  await productService.removeProduct(String(req.params.id), userId);
  res.json(success(null, '已下架'));
};

function getUserId(req: Request): string {
  if (!req.user?.userId) {
    throw ApiError.unauthorized();
  }
  return req.user.userId;
}
