import { BizCode } from './response';

// 业务异常：由 errorHandler 统一捕获并转成 { code, message, data } 响应
export class ApiError extends Error {
  readonly httpStatus: number;
  readonly code: number;

  constructor(httpStatus: number, code: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
    this.code = code;
  }

  static badRequest(message = '请求参数有误') {
    return new ApiError(400, BizCode.PARAM_ERROR, message);
  }

  static unauthorized(message = '未登录或登录已过期') {
    return new ApiError(401, BizCode.UNAUTHORIZED, message);
  }

  static forbidden(message = '没有操作权限') {
    return new ApiError(403, BizCode.FORBIDDEN, message);
  }

  static notFound(message = '资源不存在') {
    return new ApiError(404, BizCode.NOT_FOUND, message);
  }

  static conflict(message = '当前状态不允许该操作') {
    return new ApiError(409, BizCode.CONFLICT, message);
  }
}
