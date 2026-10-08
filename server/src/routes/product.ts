import { Router } from 'express';
import * as productController from '../controllers/product.controller';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// 公开
router.get('/', productController.list);
router.get('/:id', productController.detail);

// 发布需 SELLER 角色
router.post('/', authenticate, requireRole('SELLER'), productController.create);

// 编辑 / 下架需登录，归属校验在 service 层做
router.put('/:id', authenticate, productController.update);
router.delete('/:id', authenticate, productController.remove);

export default router;
