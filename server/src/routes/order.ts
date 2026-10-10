import { Router } from 'express';
import * as orderController from '../controllers/order.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// 订单接口全部需登录
router.use(authenticate);

// 下单
router.post('/', orderController.create);

// 买卖双方列表：必须注册在 /:id 之前，否则 "buyer"/"seller" 会被当成订单 id
router.get('/buyer', orderController.listBuyer);
router.get('/seller', orderController.listSeller);

// 详情与状态流转（参与方校验在 service 层做）
router.get('/:id', orderController.detail);
router.put('/:id/status', orderController.updateStatus);

// 评价（仅买家）
router.post('/:id/reviews', orderController.createReviews);

export default router;
