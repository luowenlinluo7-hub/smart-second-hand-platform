// 开发环境一键启动：同时跑前后端 dev server（零依赖，不引入 concurrently）
//
// 用法：在项目根目录执行 npm run dev
//   后端 → http://localhost:3000/api/health
//   前端 → http://localhost:5173（已把 /api 代理到 3000）
// 只起其中一个：npm run dev:server / npm run dev:client
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'

const COLORS = { server: '\x1b[36m', client: '\x1b[35m', reset: '\x1b[0m', dim: '\x1b[2m' }

/** 探测端口是否有人监听（用来提前提示数据库没起来） */
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
  setTimeout(() => process.exit(code), 300)
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

async function main() {
  const dbUp = await checkPort(3306)
  if (!dbUp) {
    console.log(
      `\x1b[33m[提示]\x1b[0m 3306 端口没有 MySQL 在监听，后端会因为 P1001 连不上数据库。\n` +
        `       可选做法：\n` +
        `         1) docker compose up -d      （用 Docker 起 MySQL）\n` +
        `         2) 启动本机 MySQL80 服务\n` +
        `         3) 只想演示界面的话，直接双击 start-demo.bat（自带便携数据库）\n`,
    )
  }

  for (const target of targets) {
    // 直接传命令字符串（而不是 args 数组 + shell:true），避免 Node 的 DEP0190 警告
    const child = spawn('npm run dev', {
      cwd: target.dir,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
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
