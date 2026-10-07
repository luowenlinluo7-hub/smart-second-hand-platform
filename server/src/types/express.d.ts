import type { JwtPayload } from '../utils/jwt';

// 扩展 Express.Request，让 req.user 具备类型
declare global {
  namespace Express {
    interface Request {
      /** 由 authenticate 中间件注入的登录用户信息 */
      user?: JwtPayload;
    }
  }
}

export {};
