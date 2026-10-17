import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { BizCode, failure } from '../utils/response';

// 全局统一错误处理：必须放在所有路由之后注册
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // 1) 业务异常
  if (err instanceof ApiError) {
    res.status(err.httpStatus).json(failure(err.code, err.message));
    return;
  }

  // 2) zod 参数校验失败
  if (err instanceof ZodError) {
    const message = err.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    res.status(400).json(failure(BizCode.PARAM_ERROR, message));
    return;
  }

  // 3) Prisma 已知错误
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        const target = Array.isArray(err.meta?.target)
          ? err.meta.target.join(', ')
          : '唯一字段';
        res.status(409).json(failure(BizCode.CONFLICT, `字段已存在：${target}`));
        return;
      }
      case 'P2025':
        res.status(404).json(failure(BizCode.NOT_FOUND, '记录不存在'));
        return;
      case 'P2003':
        res.status(400).json(failure(BizCode.PARAM_ERROR, '关联数据不存在'));
        return;
      // 事务死锁 / 写冲突：属于并发竞争，按 409 语义返回，避免落到「数据库操作失败」的 400
      case 'P2034':
        res.status(409).json(failure(BizCode.CONFLICT, '操作冲突，请刷新后重试'));
        return;
      default:
        res.status(400).json(failure(BizCode.PARAM_ERROR, `数据库操作失败（${err.code}）`));
        return;
    }
  }

  // 4) express.json() 解析失败
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json(failure(BizCode.PARAM_ERROR, '请求体不是合法的 JSON'));
    return;
  }

  // 5) 兜底：未预期异常
  console.error('[error] 未处理异常：', err);
  const message =
    env.NODE_ENV === 'production'
      ? '服务器内部错误'
      : err instanceof Error
        ? err.message
        : String(err);
  res.status(500).json(failure(BizCode.SERVER_ERROR, message));
};
