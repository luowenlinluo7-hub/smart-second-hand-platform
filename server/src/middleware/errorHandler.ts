import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { BizCode, failure } from '../utils/response';

// Prisma 的原始错误信息里带「调用栈片段 + 服务器绝对路径」，
// 例如：Invalid `prisma.product.count()` invocation in F:\xxx\server\src\...:114:20
// 直接回给前端会泄漏内部目录结构（前端会原样显示在 toast 里），
// 因此对外统一换成可读文案，详细信息只写服务端日志。
const isPrismaInternalError = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientInitializationError ||
  err instanceof Prisma.PrismaClientRustPanicError ||
  err instanceof Prisma.PrismaClientUnknownRequestError;

export const prismaUnavailableMessage = (): string =>
  env.NODE_ENV === 'production' ? '数据库暂时不可用' : '数据库暂时不可用（请确认 MySQL 已启动且 DATABASE_URL 正确）';

// 兜底异常在开发模式下会回显 message；仍要抹掉其中的绝对路径
const stripLocalPaths = (text: string): string =>
  text
    .replace(/[A-Za-z]:\\[^\s:]+/g, '<path>')
    .replace(/\/(?:home|Users|var|opt|srv)\/[^\s:]+/g, '<path>')
    .replace(/\s+/g, ' ')
    .trim();

// 供 SSE 等「不走统一错误中间件」的出口复用：
// Prisma 内部错误统一换成可读文案，其余错误只抹掉路径、保留原有语义
// （AI 超时、未配置 Key 这类提示对用户是有意义的，不能一律吞成「服务器内部错误」）
export const toClientMessage = (err: unknown): string => {
  if (isPrismaInternalError(err)) return prismaUnavailableMessage();
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return `数据库操作失败（${err.code}）`;
  }
  return stripLocalPaths(err instanceof Error ? err.message : String(err));
};

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

  // 3) Prisma 连接 / 运行时错误：统一脱敏，避免泄漏绝对路径与内部调用细节
  if (isPrismaInternalError(err)) {
    console.error('[error] Prisma 不可用：', err instanceof Error ? err.message : err);
    res.status(503).json(failure(BizCode.SERVER_ERROR, prismaUnavailableMessage()));
    return;
  }

  // 3) Prisma 已知错误
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      // 连接类错误（P1001 连不上库、P1002 超时、P1017 连接关闭、P2024 连接池耗尽…）：
      // 属于「服务当前不可用」而不是「请求参数有问题」，返回 503 更符合语义，
      // 避免前端把数据库故障当成用户输入错误来处理。
      case 'P1000':
      case 'P1001':
      case 'P1002':
      case 'P1003':
      case 'P1008':
      case 'P1010':
      case 'P1017':
      case 'P2024': {
        console.error(`[error] 数据库连接异常（${err.code}）：`, err.message);
        res.status(503).json(failure(BizCode.SERVER_ERROR, prismaUnavailableMessage()));
        return;
      }
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
        ? stripLocalPaths(err.message)
        : String(err);
  res.status(500).json(failure(BizCode.SERVER_ERROR, message));
};
