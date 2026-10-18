import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { BizCode, failure } from '../utils/response';

// 登录 / 注册的暴力破解与批量注册防护。
//
// 关键设计：skipSuccessfulRequests = true —— 只统计**失败**的尝试。
// 这样正常的连续登录（包括 E2E 里几十次成功登录）不会把用户自己拦在门外，
// 而「同一个 IP 反复试密码」这种真实攻击会在第 N 次失败后被挡下。
//
// 两个接口分开配置：登录是安全敏感点（严格），注册更多是防刷（宽松）。
// 上限可用环境变量调整（E2E 连跑时可临时调大）。
const createAuthLimiter = (limit: number, message: string) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    // 返回结构与全站一致，前端拦截器可以直接读出 message
    handler: (_req, res) => {
      res.status(429).json(failure(BizCode.TOO_MANY_REQUESTS, message));
    },
  });

export const loginLimiter = createAuthLimiter(
  env.AUTH_RATE_LIMIT_MAX,
  '登录失败次数过多，请 15 分钟后再试',
);

export const registerLimiter = createAuthLimiter(
  env.REGISTER_RATE_LIMIT_MAX,
  '注册请求过于频繁，请 15 分钟后再试',
);
