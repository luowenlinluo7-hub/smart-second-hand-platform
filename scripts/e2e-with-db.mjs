// 本地跑 E2E：先确保数据库可用，再执行测试
//
// CI 里由 workflow 直接注入 DATABASE_URL（见 .github/workflows/ci.yml），
// 这里检测到已有 DATABASE_URL 就跳过准备，原样透传，所以对 CI 无影响。
// 本地没配数据库时，会按 scripts/demo/ensure-db.ps1 的逻辑起便携实例（仅 Windows）。
import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ensureDbScript = path.join(root, 'scripts', 'demo', 'ensure-db.ps1')
const runner = path.join(root, 'scripts', 'e2e', 'run-all.js')

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

let databaseUrl = process.env.DATABASE_URL ?? null

if (!databaseUrl && process.platform === 'win32') {
  try {
    const result = runEnsureDb()
    if (result.INFO) console.log(`[数据库] ${result.INFO}`)
    if (result.DATABASE_URL) {
      databaseUrl = result.DATABASE_URL
      console.log(`[数据库] ${databaseUrl.replace(/:[^:@]*@/, ':***@')}`)
    } else if (result.ERROR) {
      console.error(`[数据库] 准备失败：${result.ERROR}（涉及直连数据库的用例会被跳过）`)
    }
  } catch (error) {
    console.error(`[数据库] 准备过程中出错：${error.message}`)
  }
}

const child = spawn(process.execPath, [runner], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}) },
})

child.on('exit', (code) => process.exit(code ?? 0))
