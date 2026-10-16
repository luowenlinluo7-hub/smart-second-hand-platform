// E2E 全量入口
//
// 用法：
//   npm run test:e2e                                   # 跑本地 http://localhost:3000
//   BASE_URL=https://api.example.com npm run test:e2e   # 跑远端
//   E2E_KEEP_DATA=1 npm run test:e2e                   # 保留本次创建的测试数据（默认会清理）
//   E2E_RATE_LIMIT=1 npm run test:e2e                  # 额外验证 AI 限流 429
//   E2E_FRONTEND_URL=http://localhost:5173 npm run test:e2e  # 顺带校验站内图片可访问
//
// 设计原则：零依赖（只用 Node 内置能力），因此在没有 npm install 的机器上也能运行。
'use strict';

const { api, baseUrl, HttpError } = require('./lib/http');
const { context } = require('./lib/context');
const { beginSuite, endSuite, test, summarize, paint, C } = require('./lib/reporter');
const { cleanup } = require('./lib/cleanup');

// 按依赖顺序执行：product 依赖 auth 创建卖家，order 依赖 product 创建商品
const SUITES = [
  { name: '1. 用户模块', module: './suites/auth' },
  { name: '2. 商品模块', module: './suites/product' },
  { name: '3. 订单模块', module: './suites/order' },
  { name: '4. AI 模块', module: './suites/ai' },
  { name: '5. 管理员看板', module: './suites/dashboard' },
];

// 启动前探测：服务没起来时给出可操作的提示，而不是抛 20 个连接错误
const preflight = async () => {
  try {
    const res = await api.get('/api/health', { timeoutMs: 5000 });
    if (res.http !== 200 || !res.body || res.body.code !== 0) {
      return `健康检查未通过：HTTP ${res.http} ${res.text.slice(0, 200)}`;
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

// 用 seed 演示账号换取 token
const loginSeeds = async () => {
  const pairs = [
    ['admin', context.seed.admin],
    ['seller', context.seed.seller],
    ['buyer', context.seed.buyer],
    ['buyer2', context.seed.buyer2],
  ];

  for (const [key, account] of pairs) {
    const data = await api.login(account.account, account.password);
    context.tokens[key] = data.token;
  }
};

const main = async () => {
  console.log('');
  console.log(paint('智能二手交易平台 · 逻辑闭环 E2E', C.bold));
  console.log(paint(`目标服务：${baseUrl}`, C.dim));
  console.log(paint(`本次运行标识：${context.runId}`, C.dim));
  // 默认清理，这里提前告知，避免用户以为数据被永久留下（或反之）
  if (process.env.E2E_KEEP_DATA === '1') {
    console.log(paint('E2E_KEEP_DATA=1：本次创建的测试数据将被保留', C.yellow));
  } else {
    console.log(paint('结束后将自动清理本次创建的测试数据（E2E_KEEP_DATA=1 可保留）', C.dim));
  }

  // ---------- 前置检查 ----------
  beginSuite('0. 环境前置检查');
  await test('后端服务可访问且 /api/health 返回 ok', async () => {
    const problem = await preflight();
    if (problem) {
      throw new Error(
        `${problem}\n      请先启动后端：cd server && npm run dev` +
          `\n      若后端不在本地，请设置 BASE_URL 指向实际地址`,
      );
    }
  });

  await test('seed 演示账号可登录（admin / seller / buyer）', async () => {
    try {
      await loginSeeds();
    } catch (error) {
      if (error instanceof HttpError) {
        throw new Error(
          `${error.message}\n      请先初始化数据库：cd server && npx prisma migrate deploy && npm run seed`,
        );
      }
      throw error;
    }
  });
  endSuite();

  // 前置失败就没必要继续：后续 suite 全部依赖 token
  const preflightFailed = require('./lib/reporter').state.suites.some(
    (s) => s.cases.some((c) => !c.passed),
  );
  if (preflightFailed) {
    console.log('');
    console.log(paint('  前置检查未通过，已跳过后续用例。', C.red));
    const result = summarize();
    process.exit(result.exitCode);
  }

  // ---------- 依次执行各 suite ----------
  for (const suite of SUITES) {
    beginSuite(suite.name);
    try {
      // eslint-disable-next-line global-require
      await require(suite.module).run();
    } catch (error) {
      // suite 在 test() 之外抛错（例如取分类失败）时也要如实记录，不能静默跳过
      await test(`${suite.name} 执行中断`, () => {
        throw error;
      });
    }
    endSuite();
  }

  // ---------- 数据披露 ----------
  const created = context.describeCreated();
  console.log('');
  console.log(paint('本次运行创建的测试数据：', C.bold));
  for (const line of created) console.log(`  · ${line}`);
  const cleanupResult = await cleanup();
  if (cleanupResult.ran) {
    const r = cleanupResult.removed;
    console.log(
      paint(
        `  已清理：评价 ${r.reviews} / 订单 ${r.orders} / 商品 ${r.products} / 用户 ${r.users}`,
        C.green,
      ),
    );
  } else {
    console.log(paint(`  未清理：${cleanupResult.reason}`, C.yellow));
    console.log(
      paint('  （测试数据会影响数据看板的聚合数字，可执行 npm run db:clean-e2e 单独清理）', C.dim),
    );
  }

  const result = summarize();
  process.exit(result.exitCode);
};

main().catch((error) => {
  console.error('');
  console.error(paint(`E2E 运行器异常退出：${error instanceof Error ? error.stack : error}`, C.red));
  process.exit(1);
});
