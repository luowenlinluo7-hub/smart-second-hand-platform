import jwt from 'jsonwebtoken';
import { env } from '../config/env';

// JWT 载荷：只放非敏感标识，禁止放密码等字段
export interface JwtPayload {
  userId: string;
  role: string;
}

// 签发 token
export const signToken = (payload: JwtPayload): string =>
  jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });

// 校验 token；失败时抛出的异常由调用方转换为 ApiError
export const verifyToken = (token: string): JwtPayload => {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === 'string') {
    throw new Error('token 载荷格式不正确');
  }
  return { userId: String(decoded.userId), role: String(decoded.role) };
};
