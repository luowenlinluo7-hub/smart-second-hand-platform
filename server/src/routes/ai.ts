import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as aiController from '../controllers/ai.controller';
import { BizCode, failure } from '../utils/response';

// AI 接口限流：搜索类每分钟 10 次 / IP，防止脚本刷爆模型额度
const searchLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // 命中限流时同样返回统一信封，前端拦截器可直接展示 message
  handler: (_req, res) => {
    res.status(429).json(failure(BizCode.TOO_MANY_REQUESTS, 'AI 请求过于频繁，请稍后再试'));
  },
});

// 对话接口单独计数：
// 用户每发一条消息就是一次请求，一轮问答会自然地用掉多次。
// 若与搜索共用同一个 10 次/分钟的桶，正常对话几下就会被限流。
const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json(failure(BizCode.TOO_MANY_REQUESTS, 'AI 对话过于频繁，请稍后再试'));
  },
});

const router = Router();

// 公开接口：未登录用户也能体验，成本由限流兜底
router.post('/search', searchLimiter, aiController.search);
router.post('/parse', searchLimiter, aiController.parse);
// AI 导购助手（SSE 流式，独立限流桶）
router.post('/chat', chatLimiter, aiController.chat);

export default router;
