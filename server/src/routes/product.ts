import { Router } from 'express';
import * as productController from '../controllers/product.controller';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// 公开
router.get('/', productController.list);

// 我的商品：必须放在 /:id 之前，否则 "mine" 会被 /:id 当成商品 id 匹配
router.get('/mine', authenticate, productController.mine);

router.get('/:id', productController.detail);

// 发布需 SELLER 角色
router.post('/', authenticate, requireRole('SELLER'), productController.create);

// 编辑 / 下架 / 重新上架需登录，归属校验在 service 层做
router.put('/:id', authenticate, productController.update);
router.delete('/:id', authenticate, productController.remove);
router.post('/:id/relist', authenticate, productController.relist);

export default router;
