import type { Request, Response } from 'express';
import { z } from 'zod';
import * as productService from '../services/product.service';
import { success } from '../utils/response';

// ---------- zod 校验 ----------

const adminListQuerySchema = z.object({
  status: z
    .enum(['DRAFT', 'PENDING_REVIEW', 'ON_SALE', 'SOLD', 'OFF_SHELF', 'REJECTED'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// 审核：approve=true 通过；approve=false 驳回且 rejectReason 必填
const auditSchema = z
  .object({
    approve: z.boolean({ error: 'approve 必须为布尔值' }),
    rejectReason: z.string().trim().max(200, '驳回原因最多 200 字').optional(),
  })
  .refine((data) => data.approve || (data.rejectReason && data.rejectReason.length > 0), {
    message: '驳回时必须填写原因',
    path: ['rejectReason'],
  });

// ---------- 控制器 ----------

// GET /api/admin/products（审核队列，可选按 status 过滤）
export const listProducts = async (req: Request, res: Response): Promise<void> => {
  const query = adminListQuerySchema.parse(req.query);
  const result = await productService.listAdminProducts({
    status: query.status,
    page: query.page,
    pageSize: query.pageSize,
  });
  res.json(success(result));
};

// PATCH /api/admin/products/:id/audit
export const audit = async (req: Request, res: Response): Promise<void> => {
  const input = auditSchema.parse(req.body);
  const product = await productService.auditProduct(
    String(req.params.id),
    input.approve,
    input.rejectReason,
  );
  res.json(success(product, input.approve ? '审核通过，已上架' : '已驳回'));
};
