import { Router } from 'express';
import * as categoryController from '../controllers/category.controller';

const router = Router();

// 公开：分类列表（商品筛选用）
router.get('/', categoryController.list);

export default router;
