// 开发环境一键启动：同时跑前后端 dev server（零依赖，不引入 concurrently）
//
// 用法：在项目根目录执行 npm run dev
//   后端 → http://localhost:3000/api/health
//   前端 → http://localhost:5173（已把 /api 代理到 3000）
// 只起其中一个：npm run dev:server / npm run dev:client
//
// 数据库：3306 有 MySQL 就直接用 server/.env；没有则自动起便携实例
// （与 start-demo.bat 共用同一份数据），退出时再把它停掉。
import { execFileSync, spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const ensureDbScript = path.join(root, 'scripts', 'demo', 'ensure-db.ps1')

const COLORS = { server: '\x1b[36m', client: '\x1b[35m', reset: '\x1b[0m', dim: '\x1b[2m', yellow: '\x1b[33m' }

let mysqldStartedByUs = false

/** 探测端口是否有人监听 */
function checkPort(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const done = (result) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, '127.0.0.1')
  })
}

/** 同步调用 ensure-db.ps1，解析它输出的 KEY=VALUE */
function runEnsureDb(args = []) {
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ensureDbScript, ...args],
    { encoding: 'utf8' },
  )
  const result = {}
  for (const line of out.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index > 0) result[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return result
}

const targets = [
  { name: 'server', dir: path.join(root, 'server') },
  { name: 'client', dir: path.join(root, 'client') },
]

const children = []
let shuttingDown = false

// Windows 上 child.kill() 杀不掉 npm 派生出来的子孙进程，必须用 taskkill /T
function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return
  if (isWin) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      child.kill('SIGTERM')
    } catch {
      // 进程已退出，忽略
    }
  }
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) killTree(child)
  if (mysqldStartedByUs) {
    try {
      runEnsureDb(['-Stop'])
      console.log(`${COLORS.dim}便携数据库已停止${COLORS.reset}`)
    } catch {
      // 清理失败不影响退出
    }
  }
  setTimeout(() => process.exit(code), 200)
}

/** 把子进程输出按行加前缀，避免两个服务的日志混在一起分不清 */
function pipeOutput(child, stream, name) {
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      process.stdout.write(`${COLORS[name]}[${name}]${COLORS.reset} ${line}\n`)
    }
  })
}

async function resolveDatabaseUrl() {
  if (await checkPort(3306)) return null // 本机 MySQL 可用，交给 server/.env

  console.log(
    `${COLORS.yellow}[数据库]${COLORS.reset} 3306 没有 MySQL 在监听，正在准备便携实例（与 start-demo.bat 共用数据）...`,
  )
  try {
    const result = runEnsureDb()
    if (result.INFO) console.log(`${COLORS.dim}         ${result.INFO}${COLORS.reset}`)
    if (result.ERROR) throw new Error(result.ERROR)
    if (!result.DATABASE_URL) throw new Error('未拿到 DATABASE_URL')
    mysqldStartedByUs = result.MYSQLD_STARTED === '1'
    console.log(`${COLORS.yellow}[数据库]${COLORS.reset} 已就绪：${result.DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`)
    return result.DATABASE_URL
  } catch (error) {
    console.error(`${COLORS.yellow}[数据库]${COLORS.reset} 准备失败：${error.message}`)
    console.error(
      `${COLORS.dim}         可选做法：docker compose up -d / 启动本机 MySQL80 / 直接双击 start-demo.bat${COLORS.reset}`,
    )
    return null
  }
}

async function main() {
  const databaseUrl = await resolveDatabaseUrl()

  for (const target of targets) {
    // 直接传命令字符串（而不是 args 数组 + shell:true），避免 Node 的 DEP0190 警告
    const child = spawn('npm run dev', {
      cwd: target.dir,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // 用便携实例时，用解析出来的连接串覆盖 server/.env
      env: { ...process.env, ...(target.name === 'server' && databaseUrl ? { DATABASE_URL: databaseUrl } : {}) },
    })
    children.push(child)
    pipeOutput(child, child.stdout, target.name)
    pipeOutput(child, child.stderr, target.name)

    child.on('exit', (code) => {
      if (shuttingDown) return
      console.log(`${COLORS.dim}[${target.name}] 已退出（code=${code}），正在停止另一个服务${COLORS.reset}`)
      shutdown(code ?? 0)
    })
  }

  console.log(
    `\n  后端 → http://localhost:3000/api/health\n  前端 → http://localhost:5173\n  按 Ctrl+C 停止两个服务\n`,
  )
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

main().catch((error) => {
  console.error(error)
  shutdown(1)
})
