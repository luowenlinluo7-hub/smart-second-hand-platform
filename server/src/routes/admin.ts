import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// 管理员接口全部需 ADMIN 角色
// （dashboard 也挂在这个 router 下，因此自动获得同样的鉴权，不需要重复声明）
router.use(authenticate, requireRole('ADMIN'));

// 数据看板
router.get('/dashboard', adminController.dashboard);
// 商品审核队列
router.get('/products', adminController.listProducts);
// 审核通过 / 驳回
router.patch('/products/:id/audit', adminController.audit);

export default router;
