// E2E 的断言与报告
//
// 输出约定：
//   [PASS] 用例标题 (12ms)
//   [FAIL] 用例标题 (12ms)
//          └─ 失败原因
// 结尾打印汇总（通过 / 失败 / 跳过 + 总耗时），失败则退出码非 0，便于 CI 使用。
'use strict';

class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

// 与 server/src/utils/response.ts 的 BizCode 保持一致，避免用例里散落魔法数字
const codes = {
  SUCCESS: 0,
  PARAM_ERROR: 40001,
  UNAUTHORIZED: 40100,
  FORBIDDEN: 40300,
  NOT_FOUND: 40400,
  CONFLICT: 40900,
  TOO_MANY_REQUESTS: 42900,
  SERVER_ERROR: 50000,
};

// ---------- 断言 ----------

const fail = (message) => {
  throw new AssertionError(message);
};

// 把响应体的关键信息压缩成一行，便于失败时定位
const brief = (res) => {
  if (!res) return '(无响应)';
  const body = res.text ? res.text.replace(/\s+/g, ' ').slice(0, 300) : '';
  return `HTTP ${res.http} ${body}`;
};

const assert = {
  ok(condition, message) {
    if (!condition) fail(message);
  },

  equal(actual, expected, label) {
    if (actual !== expected) fail(`${label}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  },

  notEqual(actual, unexpected, label) {
    if (actual === unexpected) fail(`${label}：不应等于 ${JSON.stringify(unexpected)}`);
  },

  // 断言 HTTP 状态码
  http(res, expected, label) {
    if (res.http !== expected) {
      fail(`${label}：期望 HTTP ${expected}，实际 ${res.http}（${brief(res)}）`);
    }
  },

  // 断言业务码 + HTTP 状态码
  biz(res, expectedCode, expectedHttp, label) {
    if (expectedHttp !== undefined) assert.http(res, expectedHttp, label);
    const code = res.body ? res.body.code : undefined;
    if (code !== expectedCode) {
      fail(`${label}：期望 code=${expectedCode}，实际 code=${code}（${brief(res)}）`);
    }
  },

  // 全局不变量：响应体必须是 { code, message, data } 三字段
  envelope(res, label) {
    if (!res.body || typeof res.body !== 'object') {
      fail(`${label}：响应体不是 JSON 对象（${brief(res)}）`);
    }
    for (const key of ['code', 'message', 'data']) {
      if (!(key in res.body)) {
        fail(`${label}：响应体缺少字段 "${key}"（${brief(res)}）`);
      }
    }
    if (typeof res.body.code !== 'number') {
      fail(`${label}：code 应为数字，实际 ${typeof res.body.code}`);
    }
    if (typeof res.body.message !== 'string') {
      fail(`${label}：message 应为字符串，实际 ${typeof res.body.message}`);
    }
  },

  // 安全不变量：任何响应都不得泄露密码哈希
  noPasswordHash(res, label) {
    if (res.text && res.text.includes('passwordHash')) {
      fail(`${label}：响应中泄露了 passwordHash（${brief(res)}）`);
    }
  },

  // 分页信封形状
  pageShape(data, label) {
    if (!data || typeof data !== 'object') fail(`${label}：data 不是对象`);
    for (const key of ['list', 'total', 'page', 'pageSize']) {
      if (!(key in data)) fail(`${label}：分页响应缺少字段 "${key}"`);
    }
    if (!Array.isArray(data.list)) fail(`${label}：list 不是数组`);
    if (typeof data.total !== 'number') fail(`${label}：total 不是数字`);
  },

  // 金额必须是两位小数字符串（Prisma Decimal 直接 toString 会丢尾随零）
  money(value, label) {
    const text = String(value);
    if (!/^\d+(\.\d{2})$/.test(text)) {
      fail(`${label}：期望两位小数的金额字符串，实际 ${JSON.stringify(value)}`);
    }
  },

  arrayLength(value, expected, label) {
    if (!Array.isArray(value)) fail(`${label}：不是数组`);
    if (value.length !== expected) fail(`${label}：期望长度 ${expected}，实际 ${value.length}`);
  },
};

// ---------- 报告 ----------

const state = {
  suites: [],
  current: null,
};

const C = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  bold: '\u001b[1m',
};

// 终端不支持颜色时（如被重定向到文件）自动降级
const colorEnabled = process.stdout.isTTY !== false;
const paint = (text, color) => (colorEnabled ? `${color}${text}${C.reset}` : text);

const beginSuite = (name) => {
  state.current = { name, cases: [], startedAt: Date.now() };
  state.suites.push(state.current);
  console.log('');
  console.log(paint(`══ ${name}`, C.bold));
};

const endSuite = () => {
  if (!state.current) return;
  state.current.elapsedMs = Date.now() - state.current.startedAt;
  state.current = null;
};

// 记录一条用例结果（failures 里可以放多个失败原因）
const record = (title, passed, ms, detail, skipped = false) => {
  const item = { title, passed, ms, detail, skipped };
  if (state.current) state.current.cases.push(item);
  const tag = skipped
    ? paint('[SKIP]', C.yellow)
    : passed
      ? paint('[PASS]', C.green)
      : paint('[FAIL]', C.red);
  console.log(`  ${tag} ${title} ${paint(`(${ms}ms)`, C.dim)}`);
  if (!passed && detail) {
    for (const line of String(detail).split('\n')) {
      console.log(`         ${paint('└─', C.red)} ${line}`);
    }
  }
};

// 执行一条用例：同步或异步都可以
const test = async (title, fn) => {
  const startedAt = Date.now();
  try {
    await fn();
    record(title, true, Date.now() - startedAt);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    record(title, false, Date.now() - startedAt, detail);
  }
};

// 明确跳过的用例（例如会消耗 AI 额度的破坏性验证）
const skip = (title, reason) => {
  record(title, true, 0, reason, true);
};

// 汇总所有 suite 的结果并打印报告
const summarize = () => {
  console.log('');
  console.log(paint('══════════════════════════════════════════════', C.bold));
  console.log(paint('  E2E 汇总报告', C.bold));
  console.log(paint('══════════════════════════════════════════════', C.bold));

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const suite of state.suites) {
    const passed = suite.cases.filter((c) => c.passed && !c.skipped).length;
    const failed = suite.cases.filter((c) => !c.passed).length;
    const skipped = suite.cases.filter((c) => c.skipped).length;
    totalPassed += passed;
    totalFailed += failed;
    totalSkipped += skipped;

    const status =
      failed > 0 ? paint('FAIL', C.red) : paint('PASS', C.green);
    console.log(
      `  ${status}  ${suite.name.padEnd(28)} 通过 ${String(passed).padStart(2)}  失败 ${String(failed).padStart(2)}` +
        `${skipped ? `  跳过 ${skipped}` : ''}  ${paint(`${suite.elapsedMs}ms`, C.dim)}`,
    );
  }

  const totalMs = state.suites.reduce((sum, s) => sum + (s.elapsedMs || 0), 0);

  console.log(paint('──────────────────────────────────────────────', C.dim));
  console.log(
    `  合计：${paint(`${totalPassed} 通过`, C.green)}` +
      `，${totalFailed > 0 ? paint(`${totalFailed} 失败`, C.red) : '0 失败'}` +
      `${totalSkipped ? `，${totalSkipped} 跳过` : ''}` +
      `，总耗时 ${(totalMs / 1000).toFixed(1)}s`,
  );
  if (totalFailed > 0) {
    console.log('');
    console.log(paint('  失败用例：', C.red));
    for (const suite of state.suites) {
      for (const c of suite.cases) {
        if (!c.passed) console.log(`    · [${suite.name}] ${c.title}`);
      }
    }
  }
  console.log('');

  return { totalPassed, totalFailed, totalSkipped, exitCode: totalFailed > 0 ? 1 : 0 };
};

module.exports = { assert, codes, AssertionError, beginSuite, endSuite, test, skip, summarize, state, paint, C };
