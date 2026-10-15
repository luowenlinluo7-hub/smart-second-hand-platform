// 可选的本地数据库直连
//
// 用途：有些「闭环」用 API 验证不了 —— 例如评价接口只写不读（没有任何读取入口），
// 接口返回成功并不等于数据真的落库。这类不变量只能直连数据库核对。
//
// 安全边界：只在目标为本地地址时才允许直连。指向公网时一律拒绝，
// 避免测试脚本拿到远端库的连接串并写入数据。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { baseUrl } = require('./http');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');

const isLocalTarget = () => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(baseUrl);

// 简易 .env 解析：只取 DATABASE_URL，避免为此引入 dotenv
const loadDatabaseUrl = () => {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const envPath = path.join(SERVER_DIR, '.env');
  if (!fs.existsSync(envPath)) return null;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*DATABASE_URL\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
};

// 能否直连数据库；不能则返回原因，供 skip() 说明
const dbUnavailableReason = () => {
  if (!isLocalTarget()) return `目标为远端（${baseUrl}），不直连数据库`;
  if (!loadDatabaseUrl()) return '未找到 DATABASE_URL';
  return null;
};

let cached = null;

// 连接（惰性 + 复用）
const openDb = () => {
  const reason = dbUnavailableReason();
  if (reason) return { prisma: null, reason };
  if (cached) return { prisma: cached, reason: null };

  try {
    // 从 server 的依赖里解析，保证用的是与后端同一个版本的 Client
    const { PrismaClient } = require(path.join(SERVER_DIR, 'node_modules', '@prisma', 'client'));
    process.env.DATABASE_URL = loadDatabaseUrl();
    cached = new PrismaClient();
    return { prisma: cached, reason: null };
  } catch (error) {
    return { prisma: null, reason: `无法加载 @prisma/client：${error.message}` };
  }
};

const closeDb = async () => {
  if (!cached) return;
  await cached.$disconnect();
  cached = null;
};

// 核对某一订单已落库的评价条数
const countReviewsByOrder = async (orderId) => {
  const { prisma, reason } = openDb();
  if (!prisma) return { count: null, reason };
  const count = await prisma.review.count({ where: { orderId } });
  return { count, reason: null };
};

module.exports = { openDb, closeDb, countReviewsByOrder, isLocalTarget, loadDatabaseUrl, dbUnavailableReason };
