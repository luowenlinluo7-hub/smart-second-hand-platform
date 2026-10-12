/**
 * 智能二手交易平台 · 答辩离线演示包启动器
 *
 * 做的事情：
 *   1) 启动包内自带的便携 MariaDB（端口 3310，只监听本机）
 *   2) 等数据库就绪
 *   3) 启动后端服务（它同时托管前端构建产物，所以只需要一个端口 3210）
 *   4) 等应用就绪后自动打开浏览器
 *   5) 退出时干净地停掉数据库，避免数据文件损坏
 *
 * 全程不依赖系统里装没装 Node / MySQL，也不联网。
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const SERVER_DIR = path.join(ROOT, 'server');
const MARIA_DIR = path.join(ROOT, 'mariadb');
const MARIA_BIN = path.join(MARIA_DIR, 'bin');
const MY_INI = path.join(MARIA_DIR, 'my.ini');
const RUN_DIR = path.join(ROOT, 'run');

// ---------- 读取 server/.env，拿到端口和数据库端口（保持单一数据源） ----------
function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const envFile = readEnvFile(path.join(SERVER_DIR, '.env'));
const APP_PORT = Number(envFile.PORT || 3210);
const DB_PORT = (() => {
  const m = /:(\d+)\//.exec(envFile.DATABASE_URL || '');
  return m ? Number(m[1]) : 3310;
})();
const APP_URL = `http://localhost:${APP_PORT}`;

// ---------- 小工具 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isPortOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(800);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

async function waitPort(port, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    await sleep(500);
  }
  console.error(`  [x] ${label} 在 ${Math.round(timeoutMs / 1000)} 秒内没有就绪（端口 ${port}）`);
  return false;
}

function log(msg) {
  console.log(msg);
}

function writePids(entries) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RUN_DIR, 'pids.txt'),
    entries.map(([name, pid]) => `${name} ${pid}`).join('\n'),
    'utf8'
  );
}

// ---------- 资源检查 ----------
function preflight() {
  const required = [
    [path.join(ROOT, 'node', 'node.exe'), 'Node 运行时'],
    [path.join(MARIA_BIN, 'mariadbd.exe'), 'MariaDB 服务'],
    [path.join(MARIA_BIN, 'mariadb-admin.exe'), 'MariaDB 管理工具'],
    [MY_INI, 'MariaDB 配置'],
    [path.join(MARIA_DIR, 'data', 'mysql'), '数据库数据目录'],
    [path.join(SERVER_DIR, 'dist', 'index.js'), '后端构建产物'],
    [path.join(ROOT, 'client', 'index.html'), '前端构建产物'],
  ];
  const missing = required.filter(([p]) => !fs.existsSync(p));
  if (missing.length > 0) {
    console.error('');
    console.error('  [x] 演示包不完整，缺少以下文件：');
    for (const [, name] of missing) console.error(`      - ${name}`);
    console.error('');
    console.error('  请确认整个文件夹是从 U 盘完整拷贝出来的（没有漏掉子目录）。');
    return false;
  }

  // MariaDB 在含中文/空格的路径下容易启动失败，提前给出人话提示
  if (!/^[\x20-\x7e]*$/.test(ROOT)) {
    console.error('');
    console.error('  [x] 演示包所在的路径含有中文或特殊字符：');
    console.error(`      ${ROOT}`);
    console.error('');
    console.error('  数据库无法在这种路径下启动。请把整个文件夹移动到纯英文路径，例如：');
    console.error('      D:\\demo');
    return false;
  }
  return true;
}

// ---------- 主流程 ----------
let dbProc = null;
let appProc = null;
let shuttingDown = false;

function shutdownDatabase() {
  const admin = path.join(MARIA_BIN, 'mariadb-admin.exe');
  if (!fs.existsSync(admin)) return;
  try {
    const r = spawnSync(admin, [`--defaults-file=${MY_INI}`, '-u', 'root', 'shutdown'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 20000,
    });
    if (r.status === 0) log('  [OK] 数据库已干净关闭');
  } catch {
    /* 关不掉也没关系，下面会强制清理 */
  }
}

function forceKill(proc, label) {
  if (!proc || proc.exitCode !== null || proc.killed) return;
  try {
    proc.kill();
    log(`  [OK] 已结束${label}`);
  } catch {
    /* ignore */
  }
}

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('');
  log(`==== 正在停止演示环境（${reason}）====`);
  forceKill(appProc, '后端服务');
  shutdownDatabase();
  await sleep(600);
  forceKill(dbProc, '数据库进程');
  log('  已全部停止，可以直接关闭这个窗口。');
  log('');
  process.exit(0);
}

async function main() {
  log('');
  log('============================================================');
  log('   智能二手交易平台 · 本地演示环境');
  log('============================================================');
  log('');

  if (!preflight()) {
    await sleep(1500);
    process.exit(1);
  }

  if (await isPortOpen(DB_PORT)) {
    console.error('');
    console.error(`  [x] 端口 ${DB_PORT} 已被占用，说明可能已经有一个演示环境在运行。`);
    console.error('      请先双击「停止演示.bat」，或重启电脑后再试。');
    await sleep(1500);
    process.exit(1);
  }
  if (await isPortOpen(APP_PORT)) {
    console.error('');
    console.error(`  [x] 端口 ${APP_PORT} 已被占用。请关闭占用它的程序后重试。`);
    await sleep(1500);
    process.exit(1);
  }

  // ---- 1. 启动数据库 ----
  log(`[1/3] 正在启动数据库（端口 ${DB_PORT}）...`);
  dbProc = spawn(path.join(MARIA_BIN, 'mariadbd.exe'), [`--defaults-file=${MY_INI}`], {
    cwd: MARIA_DIR,
    stdio: 'ignore',
    windowsHide: true,
  });
  dbProc.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`  [x] 数据库进程意外退出（代码 ${code}）`);
      console.error(`      详情见 ${path.join(MARIA_DIR, 'data', 'error.log')}`);
      shutdown('数据库异常退出');
    }
  });

  if (!(await waitPort(DB_PORT, 90000, '数据库'))) {
    await shutdown('数据库启动失败');
    return;
  }
  log('      [OK] 数据库已就绪');

  // ---- 2. 启动后端（同源托管前端） ----
  log('[2/3] 正在启动应用服务...');
  writePids([
    ['mariadb', dbProc.pid],
    ['launcher', process.pid],
  ]);

  appProc = spawn(process.execPath, [path.join(SERVER_DIR, 'dist', 'index.js')], {
    cwd: SERVER_DIR, // dotenv 会从 cwd 读取 server/.env
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: false,
  });
  appProc.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`  [x] 应用服务意外退出（代码 ${code}）`);
      shutdown('应用异常退出');
    }
  });

  if (!(await waitPort(APP_PORT, 60000, '应用服务'))) {
    await shutdown('应用启动失败');
    return;
  }

  // ---- 3. 打开浏览器 ----
  log('[3/3] 正在打开浏览器...');
  spawn('cmd', ['/c', 'start', '', APP_URL], { stdio: 'ignore', windowsHide: true, detached: true }).unref();

  log('');
  log(`  地址：${APP_URL}`);
  log('');
  log('------------------------------------------------------------');
  log('  演示账号（详见「使用说明.txt」）：');
  log('    管理员   admin@example.com       / Admin@123456');
  log('    卖家     seller_li@example.com   / Seller@123456');
  log('    买家     zhang@example.com       / User@123456');
  log('    买家     wang@example.com        / User@123456');
  log('------------------------------------------------------------');
  log('');
  log('  停止演示：在本窗口按 Ctrl+C，或双击「停止演示.bat」');
  log('');
  log('  以下为服务运行日志：');
  log('');
}

process.on('SIGINT', () => shutdown('Ctrl+C'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('窗口关闭'));

main().catch(async (err) => {
  console.error('');
  console.error('  [x] 启动过程出错：' + (err && err.message ? err.message : String(err)));
  await shutdown('启动出错');
});
