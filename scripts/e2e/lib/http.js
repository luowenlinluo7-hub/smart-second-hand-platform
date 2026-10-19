// E2E 的 HTTP 封装
//
// 只用 Node 20+ 内置的全局 fetch，不引入任何测试框架或 HTTP 客户端，
// 保持 E2E 零依赖 —— 这样在学校的答辩机上也能直接跑。
'use strict';

const DEFAULT_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS || 20000);

// 被测服务地址：默认本地，可用 BASE_URL 指向公网（Railway / Vercel）
const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

class HttpError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'HttpError';
    this.detail = detail;
  }
}

// 单次请求：返回 { http, body, text, ms, headers }
const request = async (method, path, options = {}) => {
  const { token, body, form, timeoutMs = DEFAULT_TIMEOUT_MS, raw = false } = options;

  const headers = {};
  // form 为 FormData 时交给 fetch 自己带 boundary，绝不能手动设 Content-Type
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason =
      error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? `请求超时（${timeoutMs}ms）`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new HttpError(`${method} ${path} 请求失败：${reason}`, { method, path, reason });
  }

  const text = await response.text();
  const ms = Date.now() - startedAt;

  // SSE 等非 JSON 响应：原文返回，交给调用方自己解析
  if (raw) {
    return { http: response.status, headers: response.headers, text, body: null, ms };
  }

  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // 解析失败不算致命：交给断言层判断（例如返回了 HTML 错误页）
  }

  return {
    http: response.status,
    headers: response.headers,
    text,
    body: parsed,
    ms,
  };
};

const api = {
  baseUrl,
  get: (path, options) => request('GET', path, options),
  post: (path, options) => request('POST', path, options),
  put: (path, options) => request('PUT', path, options),
  patch: (path, options) => request('PATCH', path, options),
  delete: (path, options) => request('DELETE', path, options),

  // multipart 上传：files 为 [{ name, content, type }]，用内置 FormData + Blob，
  // 依然零依赖。用于覆盖 /api/upload 的存储驱动切换。
  upload: (path, options = {}) => {
    const form = new FormData();
    for (const file of options.files ?? []) {
      form.append(
        'files',
        new Blob([file.content], { type: file.type }),
        file.name,
      );
    }
    return request('POST', path, { token: options.token, form, timeoutMs: options.timeoutMs });
  },

  // 登录并取回 { token, user }；失败直接抛错，避免后续用例连锁误报
  login: async (account, password) => {
    const res = await request('POST', '/api/auth/login', { body: { account, password } });
    if (res.http !== 200 || !res.body || res.body.code !== 0 || !res.body.data) {
      throw new HttpError(`登录失败（${account}）：HTTP ${res.http} ${res.text.slice(0, 200)}`);
    }
    return res.body.data;
  },
};

module.exports = { api, request, baseUrl, HttpError, DEFAULT_TIMEOUT_MS };
