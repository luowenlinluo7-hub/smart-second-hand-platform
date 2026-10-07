// 全站统一响应体：{ code, message, data }
// 约定：code === 0 表示成功，非 0 为业务错误码
export interface ApiResponse<T = null> {
  code: number;
  message: string;
  data: T | null;
}

// 业务错误码（与 HTTP 状态码解耦）
export const BizCode = {
  SUCCESS: 0,
  PARAM_ERROR: 40001,
  UNAUTHORIZED: 40100,
  FORBIDDEN: 40300,
  NOT_FOUND: 40400,
  CONFLICT: 40900,
  TOO_MANY_REQUESTS: 42900,
  SERVER_ERROR: 50000,
} as const;

export type BizCodeValue = (typeof BizCode)[keyof typeof BizCode];

// 成功响应
export const success = <T>(data: T, message = 'ok'): ApiResponse<T> => ({
  code: BizCode.SUCCESS,
  message,
  data,
});

// 失败响应
export const failure = (code: number, message: string): ApiResponse<null> => ({
  code,
  message,
  data: null,
});
