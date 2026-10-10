import type { Request, Response } from 'express';
import { z } from 'zod';
import * as orderService from '../services/order.service';
import { ApiError } from '../utils/ApiError';
import { success } from '../utils/response';
import { imageUrlListSchema } from '../utils/validators';

// ---------- zod 校验 ----------

const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string({ error: '商品 id 不能为空' }).min(1, '商品 id 不能为空'),
        quantity: z.number().int().min(1, '数量至少 1').max(99, '数量最多 99').default(1),
      }),
    )
    .min(1, '订单至少包含一个商品'),
  receiverName: z.string({ error: '请填写收货人' }).trim().min(1, '请填写收货人').max(30, '收货人最多 30 字'),
  receiverPhone: z
    .string({ error: '请填写手机号' })
    .regex(/^1[3-9]\d{9}$/, '手机号格式不正确'),
  receiverAddress: z
    .string({ error: '请填写收货地址' })
    .trim()
    .min(1, '请填写收货地址')
    .max(200, '收货地址最多 200 字'),
  remark: z.string().max(200, '备注最多 200 字').optional(),
});

const orderListQuerySchema = z.object({
  status: z
    .enum(['PENDING_PAYMENT', 'PENDING_SHIPMENT', 'SHIPPED', 'COMPLETED', 'REVIEWED', 'CANCELLED'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

// 允许流转的目标状态：REVIEWED 只能由评价接口触发，不接受直接指定
const updateStatusSchema = z.object({
  status: z.enum(['PENDING_SHIPMENT', 'SHIPPED', 'COMPLETED', 'CANCELLED'], {
    error: '不支持的目标状态',
  }),
});

const createReviewsSchema = z.object({
  reviews: z
    .array(
      z.object({
        productId: z.string().min(1, '商品 id 不能为空'),
        rating: z.number().int().min(1, '评分最低 1 分').max(5, '评分最高 5 分'),
        content: z.string().max(500, '评价内容最多 500 字').optional(),
        images: imageUrlListSchema.optional(),
      }),
    )
    .min(1, '请至少评价一个商品'),
});

// ---------- 控制器 ----------

// POST /api/orders
export const create = async (req: Request, res: Response): Promise<void> => {
  const input = createOrderSchema.parse(req.body);
  const orders = await orderService.createOrder(getUserId(req), input);
  res.status(201).json(success(orders, `下单成功，共生成 ${orders.length} 个订单`));
};

// GET /api/orders/buyer
export const listBuyer = async (req: Request, res: Response): Promise<void> => {
  const query = orderListQuerySchema.parse(req.query);
  const result = await orderService.listBuyerOrders(getUserId(req), query);
  res.json(success(result));
};

// GET /api/orders/seller
export const listSeller = async (req: Request, res: Response): Promise<void> => {
  const query = orderListQuerySchema.parse(req.query);
  const result = await orderService.listSellerOrders(getUserId(req), query);
  res.json(success(result));
};

// GET /api/orders/:id
export const detail = async (req: Request, res: Response): Promise<void> => {
  const order = await orderService.getOrderDetail(String(req.params.id), getUserId(req));
  res.json(success(order));
};

// PUT /api/orders/:id/status
export const updateStatus = async (req: Request, res: Response): Promise<void> => {
  const input = updateStatusSchema.parse(req.body);
  const order = await orderService.updateOrderStatus(
    String(req.params.id),
    getUserId(req),
    input.status,
  );
  res.json(success(order, '订单状态已更新'));
};

// POST /api/orders/:id/reviews
export const createReviews = async (req: Request, res: Response): Promise<void> => {
  const input = createReviewsSchema.parse(req.body);
  const order = await orderService.createReviews(
    String(req.params.id),
    getUserId(req),
    input.reviews,
  );
  res.status(201).json(success(order, '评价成功'));
};

function getUserId(req: Request): string {
  if (!req.user?.userId) {
    throw ApiError.unauthorized();
  }
  return req.user.userId;
}
