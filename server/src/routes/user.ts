import { Router } from 'express';
import * as userController from '../controllers/user.controller';

const router = Router();

// 公开接口：商品详情页的卖家信息卡需要它，未登录也应能看
router.get('/:id/profile', userController.profile);

export default router;
