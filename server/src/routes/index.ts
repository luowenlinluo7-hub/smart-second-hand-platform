import { Router } from 'express';
import { success } from '../utils/response';
import authRouter from './auth';

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

export default router;
