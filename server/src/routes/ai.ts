import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as aiController from '../controllers/ai.controller';
import { BizCode, failure } from '../utils/response';

// AI 接口限流：每分钟 10 次 / IP，防止脚本刷爆模型额度
const aiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // 命中限流时同样返回统一信封，前端拦截器可直接展示 message
  handler: (_req, res) => {
    res
      .status(429)
      .json(failure(BizCode.TOO_MANY_REQUESTS, 'AI 搜索请求过于频繁，请稍后再试'));
  },
});

const router = Router();

// 整个 AI 模块都受限流保护
router.use(aiLimiter);

// 公开接口：未登录用户也能体验，成本由限流兜底
router.post('/search', aiController.search);
router.post('/parse', aiController.parse);
// AI 导购助手（SSE 流式，同样受限流保护）
router.post('/chat', aiController.chat);

export default router;
