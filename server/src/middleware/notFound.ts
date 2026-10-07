import type { RequestHandler } from 'express';
import { BizCode, failure } from '../utils/response';

// 404 兜底：所有未匹配的请求都返回统一响应体
export const notFoundHandler: RequestHandler = (req, res) => {
  res
    .status(404)
    .json(failure(BizCode.NOT_FOUND, `接口不存在：${req.method} ${req.originalUrl}`));
};
