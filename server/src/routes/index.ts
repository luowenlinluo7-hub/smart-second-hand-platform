import { Router } from 'express';
import { success } from '../utils/response';
import adminRouter from './admin';
import aiRouter from './ai';
import authRouter from './auth';
import categoryRouter from './category';
import orderRouter from './order';
import productRouter from './product';
import uploadRouter from './upload';
import userRouter from './user';

// /api 下的路由总入口，后续模块（auth / products / orders ...）都在此挂载
const router = Router();

// 健康检查：不鉴权、不依赖数据库，用于探活与部署自检
router.get('/health', (_req, res) => {
  res.json(
    success({
      status: 'ok',
      service: 'smart-second-hand-server',
      uptime: Number(process.uptime().toFixed(3)),
      timestamp: new Date().toISOString(),
    }),
  );
});

// 用户认证
router.use('/auth', authRouter);
// 分类
router.use('/categories', categoryRouter);
// 商品
router.use('/products', productRouter);
// 用户公开资料（卖家信息卡）
router.use('/users', userRouter);
// 订单
router.use('/orders', orderRouter);
// 图片上传
router.use('/upload', uploadRouter);
// AI 自然语言搜索（自带限流）
router.use('/ai', aiRouter);
// 管理员
router.use('/admin', adminRouter);

export default router;
