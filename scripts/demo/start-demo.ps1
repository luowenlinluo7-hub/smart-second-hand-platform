#Requires -Version 5.1
<#
.SYNOPSIS
  智能二手交易平台 · 答辩演示一键启动（完全离线）

.DESCRIPTION
  在没有外网、没有 Docker、没有管理员权限的机器上，双击 start-demo.bat 即可跑起整套系统。

  做的事：
    1. 准备数据库：优先复用本机 3306 上的 MySQL；
       若 3306 未监听，则用已安装的 MySQL 二进制在项目内 .demo-db 起便携实例
       （不需要管理员权限，不需要 Docker 服务）
    2. 执行 Prisma 迁移；数据库为空时自动灌入演示数据（seed 本身幂等）
    3. 缺失时构建前端 dist 与后端 dist
    4. 后端同源托管前端 dist：一个端口同时提供页面与 /api，无跨域、无代理
    5. 强制 AI_MOCK=true、清空 Cloudinary 凭据 → 全程零外网请求

.PARAMETER Port
  页面与接口共用端口，默认 3000

.PARAMETER Rebuild
  强制重新构建前后端

.PARAMETER Reseed
  强制重灌演示数据

.PARAMETER NoBrowser
  不自动打开浏览器
#>
[CmdletBinding()]
param(
  [int]$Port = 3000,
  [switch]$Rebuild,
  [switch]$Reseed,
  [switch]$NoBrowser
)

# 注意：不设 Stop。本脚本大量调用原生 exe，PS 5.1 下 Stop 会把原生命令的
# stderr 输出当成终止错误抛出（例如数据库尚未就绪时的 mysqladmin ping）。
# 因此改为「显式检查退出码 + 主动 throw」。
$ErrorActionPreference = 'Continue'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$clientDir = Join-Path $projectRoot 'client'
$serverDir = Join-Path $projectRoot 'server'

# 便携数据库目录：必须落在纯 ASCII 路径下。
# 实测教训：datadir 位于含中文的路径（如 F:\二手app\...）时，mysqld --initialize 会成功，
# 但随后启动静默失败（退出码 1、无任何日志）。这是 MySQL for Windows 的老问题。
$asciiPattern = '^[\x20-\x7E]+$'
$demoCandidates = @()
if ($env:LOCALAPPDATA) { $demoCandidates += (Join-Path $env:LOCALAPPDATA 'smart-second-hand-demo') }
if ($env:TEMP) { $demoCandidates += (Join-Path $env:TEMP 'smart-second-hand-demo') }
$demoCandidates += (Join-Path $projectRoot '.demo-db')
$demoDir = $demoCandidates | Where-Object { $_ -match $asciiPattern } | Select-Object -First 1
if (-not $demoDir) { $demoDir = $demoCandidates[$demoCandidates.Count - 1] }

$demoData = Join-Path $demoDir 'data'
$demoDbName = 'smart_second_hand_demo'

$script:mysqldProc = $null
$script:serverProc = $null

# ---------- 输出 ----------

function Write-Step {
  param([string]$Text)
  Write-Host ''
  Write-Host "==> $Text" -ForegroundColor Cyan
}

function Write-Ok {
  param([string]$Text)
  Write-Host "    [OK] $Text" -ForegroundColor Green
}

function Write-Note {
  param([string]$Text)
  Write-Host "    $Text" -ForegroundColor DarkGray
}

function Write-Warn2 {
  param([string]$Text)
  Write-Host "    [!] $Text" -ForegroundColor Yellow
}

# ---------- 原生命令封装 ----------

# 统一调用原生 exe：把 stderr 合并进返回值，不触发 PS 的 NativeCommandError
function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string[]]$Arguments = @()
  )
  $output = & $Exe @Arguments 2>&1
  $code = $LASTEXITCODE
  $text = ($output | ForEach-Object { "$_" }) -join "`n"
  return [pscustomobject]@{ ExitCode = $code; Output = $text }
}

# ---------- 探针 ----------

function Test-Port {
  param([int]$Port)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(400)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Wait-HttpOk {
  param([string]$Url, [int]$TimeoutSec = 60)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing
      if ($resp.StatusCode -eq 200) { return $true }
    } catch {
      Start-Sleep -Milliseconds 400
    }
  }
  return $false
}

function Get-EnvValue {
  param([string]$Path, [string]$Key)
  if (-not (Test-Path $Path)) { return $null }
  foreach ($line in Get-Content $Path -Encoding UTF8) {
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*)$") {
      $value = $Matches[1].Trim()
      if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }
  return $null
}

# 找 mysqld.exe：先看 PATH，再扫 Program Files
function Find-Mysqld {
  $cmd = Get-Command mysqld.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $found = @()
  foreach ($pf in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $pf) { continue }
    $mysqlRoot = Join-Path $pf 'MySQL'
    if (-not (Test-Path $mysqlRoot)) { continue }
    $found += Get-ChildItem -Path $mysqlRoot -Filter 'mysqld.exe' -Recurse -File -ErrorAction SilentlyContinue
  }
  if ($found.Count -eq 0) { return $null }
  return ($found | Sort-Object FullName -Descending | Select-Object -First 1).FullName
}

function Invoke-Npm {
  param([string]$WorkDir, [string]$Arguments)
  Push-Location $WorkDir
  try {
    $result = Invoke-Native -Exe 'cmd' -Arguments @('/c', "npm $Arguments 2>&1")
  } finally {
    Pop-Location
  }
  if ($result.ExitCode -ne 0) {
    Write-Host $result.Output -ForegroundColor DarkGray
    throw "npm $Arguments 失败（退出码 $($result.ExitCode)）"
  }
}

# ---------- 清理 ----------

function Stop-Demo-Processes {
  if ($script:serverProc -and -not $script:serverProc.HasExited) {
    Stop-Process -Id $script:serverProc.Id -Force -ErrorAction SilentlyContinue
  }
  if ($script:mysqldProc -and -not $script:mysqldProc.HasExited) {
    Stop-Process -Id $script:mysqldProc.Id -Force -ErrorAction SilentlyContinue
    Write-Note '便携数据库已停止'
  }
}

# ---------- 主流程 ----------

function Start-Demo {
  Write-Host ''
  Write-Host '  智能二手交易平台 · 离线演示启动器' -ForegroundColor Yellow
  Write-Note "项目目录：$projectRoot"

  Write-Step '检查运行环境'
  $nodeCheck = Invoke-Native -Exe 'node' -Arguments @('-v')
  if ($nodeCheck.ExitCode -ne 0) { throw '未找到 Node.js，请先安装 Node 20+' }
  Write-Ok ("Node " + $nodeCheck.Output.Trim())

  foreach ($pair in @(@('client', (Join-Path $clientDir 'node_modules')), @('server', (Join-Path $serverDir 'node_modules')))) {
    if (-not (Test-Path $pair[1])) {
      throw "$($pair[0])/node_modules 不存在。离线环境下无法 npm install，请拷入完整依赖目录。"
    }
  }
  Write-Ok '前后端依赖已存在'

  $envPath = Join-Path $serverDir '.env'
  if (-not (Test-Path $envPath)) {
    throw '缺少 server/.env，请先复制 .env.example 为 server/.env 并填写 JWT_SECRET'
  }
  Write-Ok 'server/.env 已存在'

  # 端口占用：先判断是不是本程序已经在跑
  while (Test-Port $Port) {
    if (Wait-HttpOk -Url "http://127.0.0.1:$Port/api/health" -TimeoutSec 2) {
      Write-Warn2 "端口 $Port 上已有一套服务在运行，直接打开页面"
      if (-not $NoBrowser) { Start-Process "http://localhost:$Port" }
      return
    }
    $Port++
    Write-Warn2 "端口被占用，改用 $Port"
  }

  # ---------- 数据库 ----------
  $dbUrl = $null
  $dbPort = 0

  if (Test-Port 3306) {
    Write-Step '复用本机 MySQL（3306）'
    $dbUrl = Get-EnvValue -Path $envPath -Key 'DATABASE_URL'
    if (-not $dbUrl) { throw 'server/.env 中缺少 DATABASE_URL' }
    Write-Ok '已连接本机 MySQL 服务'
  } else {
    Write-Step '本机 MySQL 服务未运行，改用项目内便携实例（不需要管理员权限）'
    Write-Note "数据目录：$demoData"

    $mysqldExe = Find-Mysqld
    if (-not $mysqldExe) {
      throw '未找到 mysqld.exe。请安装 MySQL 8，或手动启动 MySQL80 服务后重试。'
    }
    $mysqlBin = Split-Path $mysqldExe -Parent
    $mysqlBase = Split-Path $mysqlBin -Parent
    $mysqlAdmin = Join-Path $mysqlBin 'mysqladmin.exe'
    $mysqlCli = Join-Path $mysqlBin 'mysql.exe'
    Write-Ok "MySQL 二进制：$mysqlBin"

    if (-not (Test-Path $demoDir)) { New-Item -ItemType Directory -Path $demoDir -Force | Out-Null }

    if (-not (Test-Path (Join-Path $demoData 'mysql'))) {
      Write-Note '初始化数据目录（仅首次，约 5 秒）...'
      $init = Invoke-Native -Exe $mysqldExe -Arguments @(
        '--initialize-insecure',
        "--basedir=$mysqlBase",
        "--datadir=$demoData"
      )
      if ($init.ExitCode -ne 0) {
        Write-Host $init.Output -ForegroundColor DarkGray
        throw '初始化便携数据库失败'
      }
      Write-Ok '数据目录初始化完成'
    } else {
      Write-Ok '数据目录已存在，跳过初始化'
    }

    # 上次异常退出可能留下实例，先尝试复用 3307
    $reused = $false
    if (Test-Port 3307) {
      $ping = Invoke-Native -Exe $mysqlAdmin -Arguments @('-h', '127.0.0.1', '-P', '3307', '-u', 'root', 'ping')
      if ($ping.Output -match 'alive') {
        $dbPort = 3307
        $reused = $true
        # 复用上次遗留的实例：也纳入退出清理，避免它一直挂在后台占 180MB
        $owner = Get-NetTCPConnection -LocalPort 3307 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($owner) { $script:mysqldProc = Get-Process -Id $owner.OwningProcess -ErrorAction SilentlyContinue }
        Write-Ok '复用已在运行的便携实例（3307）'
      }
    }

    if (-not $reused) {
      $dbPort = 3307
      while (Test-Port $dbPort) { $dbPort++ }
      $dbLog = Join-Path $demoDir 'mysqld.log'
      # 路径含空格，参数必须整体带引号传给 Start-Process
      # 只监听本机回环：便携实例用 root 空密码，绝不能暴露到局域网
      # （mysqld 默认 bind-address 是 *，即监听所有网卡）
      $argStr = "--basedir=`"$mysqlBase`" --datadir=`"$demoData`" --port=$dbPort --bind-address=127.0.0.1 --skip-log-bin --log-error=`"$dbLog`""
      $script:mysqldProc = Start-Process -FilePath $mysqldExe -ArgumentList $argStr -PassThru -WindowStyle Hidden

      $ready = $false
      for ($i = 0; $i -lt 180; $i++) {
        Start-Sleep -Milliseconds 500
        $ping = Invoke-Native -Exe $mysqlAdmin -Arguments @('-h', '127.0.0.1', '-P', "$dbPort", '-u', 'root', 'ping')
        if ($ping.Output -match 'alive') { $ready = $true; break }
      }
      if (-not $ready) {
        if (Test-Path $dbLog) { Get-Content $dbLog -Tail 20 | ForEach-Object { Write-Note $_ } }
        throw "便携 MySQL 未能在 90 秒内就绪（端口 $dbPort）"
      }
      Write-Ok "便携实例已就绪（端口 $dbPort）"
    }

    $create = Invoke-Native -Exe $mysqlCli -Arguments @(
      '-h', '127.0.0.1', '-P', "$dbPort", '-u', 'root',
      '-e', "CREATE DATABASE IF NOT EXISTS $demoDbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    )
    if ($create.ExitCode -ne 0) {
      Write-Host $create.Output -ForegroundColor DarkGray
      throw '创建演示数据库失败'
    }
    Write-Ok "数据库 $demoDbName 可用"

    $dbUrl = "mysql://root:@127.0.0.1:$dbPort/$demoDbName"
  }

  # ---------- 迁移与演示数据 ----------
  Write-Step '同步数据库结构'
  $env:DATABASE_URL = $dbUrl
  Push-Location $serverDir
  try {
    $migrate = Invoke-Native -Exe 'cmd' -Arguments @('/c', 'npx prisma migrate deploy 2>&1')
  } finally {
    Pop-Location
  }
  if ($migrate.ExitCode -ne 0) {
    Write-Host $migrate.Output -ForegroundColor DarkGray
    throw '数据库迁移失败'
  }
  Write-Ok '迁移已应用'

  Write-Step '检查演示数据'
  $countScript = "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.product.count().then(c=>{console.log(c);return p.`$disconnect()}).catch(()=>{console.log('-1')})"
  Push-Location $serverDir
  try {
    $countResult = Invoke-Native -Exe 'node' -Arguments @('-e', $countScript)
  } finally {
    Pop-Location
  }
  $productCount = -1
  if ($countResult.ExitCode -eq 0 -and $countResult.Output.Trim() -match '^-?\d+$') {
    $productCount = [int]$countResult.Output.Trim()
  }

  if ($Reseed -or $productCount -le 0) {
    Write-Note '正在灌入演示数据（约 10 秒）...'
    Invoke-Npm -WorkDir $serverDir -Arguments 'run seed'
    Write-Ok '演示数据准备完成'
  } else {
    Write-Ok "已有 $productCount 件商品，跳过灌数据（需要重置请加 -Reseed）"
  }

  # ---------- 构建 ----------
  $clientDist = Join-Path $clientDir 'dist'
  $serverDist = Join-Path $serverDir 'dist'

  if ($Rebuild -or -not (Test-Path (Join-Path $clientDist 'index.html'))) {
    Write-Step '构建前端（约 10 秒）'
    Invoke-Npm -WorkDir $clientDir -Arguments 'run build'
    Write-Ok '前端构建完成'
  } else {
    Write-Ok '前端 dist 已存在，跳过构建'
  }

  if ($Rebuild -or -not (Test-Path (Join-Path $serverDist 'index.js'))) {
    Write-Step '构建后端（约 5 秒）'
    Invoke-Npm -WorkDir $serverDir -Arguments 'run build'
    Write-Ok '后端构建完成'
  } else {
    Write-Ok '后端 dist 已存在，跳过构建'
  }

  # ---------- 启动 ----------
  Write-Step '启动服务'

  # 强制离线：本地规则 AI + 本地磁盘存图
  $env:AI_MOCK = 'true'
  $env:CLOUDINARY_CLOUD_NAME = ''
  $env:CLOUDINARY_API_KEY = ''
  $env:CLOUDINARY_API_SECRET = ''
  $env:PORT = "$Port"
  $env:CORS_ORIGIN = "http://localhost:$Port"
  $env:CLIENT_DIST = $clientDist

  if (-not (Test-Path $demoDir)) { New-Item -ItemType Directory -Path $demoDir -Force | Out-Null }
  $srvOut = Join-Path $demoDir 'server.out.log'
  $srvErr = Join-Path $demoDir 'server.err.log'

  $script:serverProc = Start-Process -FilePath 'node' -ArgumentList 'dist/index.js' `
    -WorkingDirectory $serverDir -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $srvOut -RedirectStandardError $srvErr

  if (-not (Wait-HttpOk -Url "http://127.0.0.1:$Port/api/health" -TimeoutSec 60)) {
    Write-Host ''
    Write-Host '后端启动失败，日志如下：' -ForegroundColor Red
    if (Test-Path $srvErr) { Get-Content $srvErr -Tail 30 | ForEach-Object { Write-Note $_ } }
    if (Test-Path $srvOut) { Get-Content $srvOut -Tail 30 | ForEach-Object { Write-Note $_ } }
    throw '健康检查未通过'
  }
  Write-Ok "后端已就绪：http://localhost:$Port"

  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
    if ($health.data.imageDriver) { Write-Ok "imageDriver = $($health.data.imageDriver)" }
  } catch { }

  if (-not $NoBrowser) { Start-Process "http://localhost:$Port" }

  Write-Host ''
  Write-Host '  ------------------------------------------------' -ForegroundColor Yellow
  Write-Host "   访问地址：http://localhost:$Port" -ForegroundColor Green
  Write-Host '   演示账号：' -ForegroundColor Gray
  Write-Host '     admin      / Admin@123456    管理员（看板、审核）' -ForegroundColor Gray
  Write-Host '     seller_li  / Seller@123456   卖家' -ForegroundColor Gray
  Write-Host '     user_zhang / User@123456     买家' -ForegroundColor Gray
  Write-Host '   AI：本地规则模式（AI_MOCK=true），断网可用' -ForegroundColor Gray
  Write-Host '   停止：在本窗口按 Ctrl+C，或直接关闭窗口' -ForegroundColor Gray
  Write-Host '  ------------------------------------------------' -ForegroundColor Yellow
  Write-Host ''

  Wait-Process -Id $script:serverProc.Id
}

try {
  Start-Demo
} catch {
  Write-Host ''
  Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  Stop-Demo-Processes
}
