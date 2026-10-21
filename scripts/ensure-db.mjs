// 确保本地有一个可用的数据库，并把连接串写进 server/.env.local
//
// 为什么要有这一层：
//   server/.env 里的 DATABASE_URL 通常指向 localhost:3306，但很多开发机并没有
//   常驻的 MySQL 服务。这个脚本会调用 ensure-db.ps1 准备数据库（3306 可用就直接用，
//   否则起一个便携实例），然后把最终连接串写进 server/.env.local。
//   server 端会优先读 .env.local，因此「在 client / server 目录各自 npm run dev」
//   也能正常工作，不必依赖根目录的启动器。
//
// 用法：
//   node scripts/ensure-db.mjs        // 准备数据库并写 .env.local
//   node scripts/ensure-db.mjs stop   // 停掉便携实例
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(root, 'scripts', 'demo', 'ensure-db.ps1')
const envLocalPath = path.join(root, 'server', '.env.local')

function runPs(args) {
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
    encoding: 'utf8',
  })
  const result = {}
  for (const line of out.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index > 0) result[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return result
}

/** 只更新我们负责的那一行，保留 .env.local 里可能存在的其它自定义变量 */
function writeEnvLocal(databaseUrl) {
  const line = `DATABASE_URL=${databaseUrl}`
  let content = ''
  if (fs.existsSync(envLocalPath)) content = fs.readFileSync(envLocalPath, 'utf8')

  const kept = content
    .split(/\r?\n/)
    .filter((item) => item.trim() && !/^\s*DATABASE_URL\s*=/.test(item))

  const header = '# 由 scripts/ensure-db.mjs 自动生成，请勿手工修改（每次 npm run dev 会重新计算）'
  fs.writeFileSync(envLocalPath, [header, line, ...kept].join('\n') + '\n', 'utf8')
}

const mode = process.argv[2]
if (mode === 'stop') {
  const result = runPs(['-Stop'])
  console.log(`便携实例已停止（${result.STOPPED ?? 0} 个进程）`)
  process.exit(0)
}

const result = runPs([])
if (result.INFO) console.log(`[数据库] ${result.INFO}`)
if (result.ERROR) {
  console.error(`[数据库] 准备失败：${result.ERROR}`)
  process.exit(1)
}
if (!result.DATABASE_URL) {
  console.error('[数据库] 没有拿到 DATABASE_URL')
  process.exit(1)
}

writeEnvLocal(result.DATABASE_URL)
const masked = result.DATABASE_URL.replace(/:[^:@]*@/, ':***@')
console.log(`[数据库] ${masked}`)
if (result.MYSQLD_STARTED === '1') {
  console.log('[数据库] 使用便携实例（停止：node scripts/ensure-db.mjs stop）')
}
