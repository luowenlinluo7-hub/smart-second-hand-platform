// server 的 dev 启动包装：先准备好数据库，再用解析出的连接串启动 nodemon
//
// 为什么需要这一层：
//   直接 `npm run dev`（nodemon + tsx）只会读 server/.env，而那里通常写死了
//   localhost:3306。开发机上如果没有常驻 MySQL，接口就会全部 P1001。
//   在这里显式把 DATABASE_URL 注入子进程环境，最直观也最可靠：
//     - 不依赖 dotenv 的加载顺序（@prisma/client 会在 import 阶段就读环境变量）
//     - 不需要改用户的 .env 文件
//     - 与 start-demo.bat 使用同一套数据库准备逻辑（scripts/demo/ensure-db.ps1）
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = path.join(root, 'server')
const ensureDbScript = path.join(root, 'scripts', 'demo', 'ensure-db.ps1')
const isWin = process.platform === 'win32'

function runEnsureDb() {
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ensureDbScript], {
    encoding: 'utf8',
  })
  const result = {}
  for (const line of out.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index > 0) result[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return result
}

// 读 server/.env 里手工写死的 DATABASE_URL（作为兜底，保证行为不会比原来更差）
function readEnvDatabaseUrl() {
  const envPath = path.join(serverDir, '.env')
  if (!fs.existsSync(envPath)) return null
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[1].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    return value
  }
  return null
}

let databaseUrl = process.env.DATABASE_URL ?? null

if (!databaseUrl) {
  try {
    const result = runEnsureDb()
    if (result.INFO) console.log(`[数据库] ${result.INFO}`)
    if (result.DATABASE_URL) {
      databaseUrl = result.DATABASE_URL
      console.log(`[数据库] ${databaseUrl.replace(/:[^:@]*@/, ':***@')}`)
      if (result.MYSQLD_STARTED === '1') {
        console.log('[数据库] 使用便携实例（停止：node scripts/ensure-db.mjs stop）')
      }
    } else if (result.ERROR) {
      console.error(`[数据库] 准备失败：${result.ERROR}`)
      console.error('[数据库] 将退回 server/.env 里的配置，接口可能因连不上库而报错')
    }
  } catch (error) {
    console.error(`[数据库] 准备过程中出错：${error.message}`)
  }
}

if (!databaseUrl) databaseUrl = readEnvDatabaseUrl()

const child = spawn(isWin ? 'npx nodemon' : 'npx nodemon', {
  cwd: serverDir,
  shell: true,
  stdio: 'inherit',
  env: { ...process.env, ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}) },
})

child.on('exit', (code) => process.exit(code ?? 0))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  })
}
