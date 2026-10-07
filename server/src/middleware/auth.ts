import type { RequestHandler } from 'express';
import type { UserRole } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { verifyToken } from '../utils/jwt';

// 解析 Authorization: Bearer <token>，把登录信息挂到 req.user
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(ApiError.unauthorized());
    return;
  }

  try {
    req.user = verifyToken(header.slice('Bearer '.length).trim());
    next();
  } catch {
    next(ApiError.unauthorized('token 无效或已过期'));
  }
};

// 角色校验，必须注册在 authenticate 之后
export const requireRole =
  (...roles: UserRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    if (!roles.includes(req.user.role as UserRole)) {
      next(ApiError.forbidden('当前角色无权访问该接口'));
      return;
    }
    next();
  };
