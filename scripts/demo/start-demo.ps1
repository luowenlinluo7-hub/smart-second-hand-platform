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

# 随包携带的便携运行时（由 scripts/demo/prepare-runtime.ps1 生成）。
# 学校电脑可能既没装 Node 也没装 MySQL，这时全靠它。
$runtimeDir = Join-Path $projectRoot 'runtime'
$bundledNode = Join-Path $runtimeDir 'node.exe'
$bundledMysqlBin = Join-Path $runtimeDir 'mysql\bin'

$script:mysqldProc = $null
$script:serverProc = $null
$script:skipCleanup = $false

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

# Windows 会为 Hyper-V / WSL 预留成段端口（本机实测排除 3316-3415、3416-3515 等多段）。
# 落在保留区内的端口「看起来没人监听，但 mysqld 绑不上」，必须先排除掉。
function Get-ReservedPortRanges {
  $ranges = @()
  $res = Invoke-Native -Exe 'netsh' -Arguments @('int', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp')
  foreach ($line in ($res.Output -split "`n")) {
    if ($line -match '^\s*(\d{2,5})\s+(\d{2,5})\s*\*?\s*$') {
      $ranges += , @([int]$Matches[1], [int]$Matches[2])
    }
  }
  return $ranges
}

function Test-PortUsable {
  param([int]$Port, $ReservedRanges)
  if (Test-Port $Port) { return $false }
  if ($ReservedRanges) {
    foreach ($range in $ReservedRanges) {
      if ($Port -ge $range[0] -and $Port -le $range[1]) { return $false }
    }
  }
  return $true
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

# 源码比产物新就需要重建：否则改了代码再启动演示，跑的还是旧 dist（很难察觉）
function Test-NeedsBuild {
  param([string]$SrcDir, [string[]]$Patterns, [string]$OutputFile)
  if (-not (Test-Path $OutputFile)) { return $true }
  $outTime = (Get-Item $OutputFile).LastWriteTimeUtc
  $newer = Get-ChildItem -Path $SrcDir -Recurse -File -Include $Patterns -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTimeUtc -gt $outTime } |
    Select-Object -First 1
  return [bool]$newer
}

# ---------- 清理 ----------

function Stop-Demo-Processes {
  # 检测到「已有一套在运行」而提前返回时，绝不能清理：
  # 那套服务正在用这个数据库，杀掉 mysqld 会让它变成 P1001。
  if ($script:skipCleanup) { return }

  if ($script:serverProc -and -not $script:serverProc.HasExited) {
    Stop-Process -Id $script:serverProc.Id -Force -ErrorAction SilentlyContinue
  }

  # mysqld 在 Windows 上会派生一个子进程（父进程负责监控、子进程才是真正监听的服务），
  # 只停父进程会把子进程留在后台。因此按「数据目录」匹配命令行，父子一并清理。
  $killed = 0
  $targets = Get-CimInstance Win32_Process -Filter "Name = 'mysqld.exe'" -ErrorAction SilentlyContinue
  foreach ($proc in $targets) {
    if ($proc.CommandLine -and $proc.CommandLine -like "*$demoData*") {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
      $killed++
    }
  }
  if ($killed -gt 0) { Write-Note "便携数据库已停止（$killed 个进程）" }
}

# ---------- 主流程 ----------

function Start-Demo {
  Write-Host ''
  Write-Host '  智能二手交易平台 · 离线演示启动器' -ForegroundColor Yellow
  Write-Note "项目目录：$projectRoot"

  Write-Step '检查运行环境'
  if (Test-Path $bundledNode) {
    $nodeExe = $bundledNode
    $nodeVer = Invoke-Native -Exe $nodeExe -Arguments @('-v')
    if ($nodeVer.ExitCode -ne 0) { throw "随包的 node.exe 无法运行：$($nodeVer.Output)" }
    Write-Ok ("Node " + $nodeVer.Output.Trim() + "（随包携带，无需安装）")
  } else {
    $nodeCheck = Invoke-Native -Exe 'node' -Arguments @('-v')
    if ($nodeCheck.ExitCode -ne 0) {
      throw '未找到 Node.js。请运行 scripts/demo/prepare-runtime.ps1 打包便携运行时，或在本机安装 Node 20+。'
    }
    $nodeExe = 'node'
    Write-Ok ("Node " + $nodeCheck.Output.Trim())
  }

  # npm 只在「需要重新构建」时才用得上；随包运行时里没有 npm，因此构建产物必须预先准备好
  $npmCmd = Get-Command npm -ErrorAction SilentlyContinue

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

  # Windows 保留端口段（Hyper-V / WSL 会占掉成段端口），选端口时必须跳过
  $reservedRanges = Get-ReservedPortRanges
  if ($reservedRanges.Count -gt 0) {
    Write-Note ("系统保留端口段：" + (($reservedRanges | ForEach-Object { "$($_[0])-$($_[1])" }) -join '、'))
  }

  # 端口占用：先判断是不是本程序已经在跑
  while (Test-Port $Port) {
    if (Wait-HttpOk -Url "http://127.0.0.1:$Port/api/health" -TimeoutSec 2) {
      $script:skipCleanup = $true
      Write-Ok "演示服务已在运行：http://localhost:$Port（不重复启动）"
      Write-Note '停止方式：双击 stop-demo.bat，或关闭原来那个启动窗口'
      Write-Note "注意：3000 端口被它占着，此时再跑 npm run dev 会端口冲突"
      if (-not $NoBrowser) { Start-Process "http://localhost:$Port" }
      return
    }
    $Port++
    Write-Warn2 "端口被占用，改用 $Port"
  }

  # 再跳过系统保留段（这类端口没人监听，但绑不上）
  while (-not (Test-PortUsable -Port $Port -ReservedRanges $reservedRanges)) {
    $Port++
    Write-Warn2 "端口落在系统保留区，改用 $Port"
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

    $mysqldExe = $null
    $mysqlSource = ''
    if (Test-Path (Join-Path $bundledMysqlBin 'mysqld.exe')) {
      if ((Join-Path $runtimeDir 'mysql') -match $asciiPattern) {
        $mysqldExe = Join-Path $bundledMysqlBin 'mysqld.exe'
        $mysqlSource = '随包携带'
      } else {
        # 项目放在含中文的路径（如 F:\二手app\...）时，以该路径当 basedir 会让 mysqld
        # 在启动阶段静默失败（退出码 1、无日志）。因此把随包 MySQL 复制到 ASCII 目录再用，
        # 只复制一次，之后靠标记文件判断是否需要更新。
        $mysqlCache = Join-Path $demoDir 'mysql'
        $marker = Join-Path $mysqlCache '.source'
        $srcInfo = Get-Item (Join-Path $bundledMysqlBin 'mysqld.exe')
        $stamp = "$($srcInfo.Length)-$($srcInfo.LastWriteTimeUtc.Ticks)"
        $needCopy = $true
        if ((Test-Path (Join-Path $mysqlCache 'bin\mysqld.exe')) -and (Test-Path $marker)) {
          if ((Get-Content $marker -Raw).Trim() -eq $stamp) { $needCopy = $false }
        }
        if ($needCopy) {
          Write-Note '项目路径含中文，先把随包 MySQL 复制到 ASCII 目录（仅首次，约 95 MB）...'
          if (Test-Path $mysqlCache) { Remove-Item -Recurse -Force $mysqlCache }
          New-Item -ItemType Directory -Path $mysqlCache -Force | Out-Null
          Copy-Item (Join-Path $runtimeDir 'mysql\*') $mysqlCache -Recurse -Force
          [System.IO.File]::WriteAllText($marker, $stamp)
        }
        $mysqldExe = Join-Path $mysqlCache 'bin\mysqld.exe'
        $mysqlSource = '随包携带（已复制到 ASCII 目录）'
      }
    } else {
      $mysqldExe = Find-Mysqld
      $mysqlSource = '本机安装'
    }
    if (-not $mysqldExe) {
      throw '未找到 mysqld.exe。请运行 scripts/demo/prepare-runtime.ps1 打包便携运行时，或在本机安装 MySQL 8 / 启动 MySQL80 服务。'
    }
    $mysqlBin = Split-Path $mysqldExe -Parent
    $mysqlBase = Split-Path $mysqlBin -Parent
    $mysqlAdmin = Join-Path $mysqlBin 'mysqladmin.exe'
    $mysqlCli = Join-Path $mysqlBin 'mysql.exe'
    Write-Ok "MySQL 二进制：$mysqlSource（$mysqlBin）"

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
      while (-not (Test-PortUsable -Port $dbPort -ReservedRanges $reservedRanges)) { $dbPort++ }
      $dbLog = Join-Path $demoDir 'mysqld.log'

      # Windows 会为 Hyper-V / WSL 保留成段的端口（本机实测排除 3316-3415、3416-3515 等），
      # 落在保留区里的端口「看起来空闲、实际绑不上」。因此启动后若进程秒退就换下一个端口重试，
      # 比预先解析 netsh 更简单，也能顺带覆盖其它偶发绑定失败。
      $ready = $false
      $maxAttempts = 8
      for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        # 路径含空格，参数必须整体带引号传给 Start-Process
        # 只监听本机回环：便携实例用 root 空密码，绝不能暴露到局域网
        # （mysqld 默认 bind-address 是 *，即监听所有网卡）
        $argStr = "--basedir=`"$mysqlBase`" --datadir=`"$demoData`" --port=$dbPort --bind-address=127.0.0.1 --skip-log-bin --log-error=`"$dbLog`""
        $script:mysqldProc = Start-Process -FilePath $mysqldExe -ArgumentList $argStr -PassThru -WindowStyle Hidden

        for ($i = 0; $i -lt 60; $i++) {
          Start-Sleep -Milliseconds 500
          $ping = Invoke-Native -Exe $mysqlAdmin -Arguments @('-h', '127.0.0.1', '-P', "$dbPort", '-u', 'root', 'ping')
          if ($ping.Output -match 'alive') { $ready = $true; break }
          if ($script:mysqldProc.HasExited) { break }
        }

        if ($ready) { break }

        # 进程已退出：多半是端口绑不上，换下一个候选端口
        if ($attempt -lt $maxAttempts) {
          $failedPort = $dbPort
          $dbPort++
          while (-not (Test-PortUsable -Port $dbPort -ReservedRanges $reservedRanges)) { $dbPort++ }
          Write-Warn2 "端口 $failedPort 启动失败（可能被系统保留），改用 $dbPort 重试"
        }
      }

      if (-not $ready) {
        if (Test-Path $dbLog) { Get-Content $dbLog -Tail 20 | ForEach-Object { Write-Note $_ } }
        throw "便携 MySQL 未能就绪（已尝试 $maxAttempts 个端口，最后一次为 $dbPort）"
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
  # 不依赖 npm / npx：直接让 node 执行 Prisma CLI 与 tsx，
  # 这样在「只带了便携 node.exe、没装 Node」的机器上也能跑。
  $prismaCli = Join-Path $serverDir 'node_modules\prisma\build\index.js'
  $tsxCli = Join-Path $serverDir 'node_modules\tsx\dist\cli.mjs'

  Write-Step '同步数据库结构'
  $env:DATABASE_URL = $dbUrl
  if (-not (Test-Path $prismaCli)) { throw "缺少 Prisma CLI：$prismaCli（node_modules 不完整？）" }
  Push-Location $serverDir
  try {
    $migrate = Invoke-Native -Exe $nodeExe -Arguments @($prismaCli, 'migrate', 'deploy')
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
    $countResult = Invoke-Native -Exe $nodeExe -Arguments @('-e', $countScript)
  } finally {
    Pop-Location
  }
  $productCount = -1
  if ($countResult.ExitCode -eq 0 -and $countResult.Output.Trim() -match '^-?\d+$') {
    $productCount = [int]$countResult.Output.Trim()
  }

  if ($Reseed -or $productCount -le 0) {
    Write-Note '正在灌入演示数据（约 10 秒）...'
    if (-not (Test-Path $tsxCli)) { throw "缺少 tsx：$tsxCli（node_modules 不完整？）" }
    Push-Location $serverDir
    try {
      $seedResult = Invoke-Native -Exe $nodeExe -Arguments @($tsxCli, 'prisma\seed.ts')
    } finally {
      Pop-Location
    }
    if ($seedResult.ExitCode -ne 0) {
      Write-Host $seedResult.Output -ForegroundColor DarkGray
      throw '灌入演示数据失败'
    }
    Write-Ok '演示数据准备完成'
  } else {
    Write-Ok "已有 $productCount 件商品，跳过灌数据（需要重置请加 -Reseed）"
  }

  # ---------- 构建 ----------
  $clientDist = Join-Path $clientDir 'dist'
  $serverDist = Join-Path $serverDir 'dist'

  if ($Rebuild -or (Test-NeedsBuild -SrcDir (Join-Path $clientDir 'src') -Patterns @('*.ts','*.vue','*.css') -OutputFile (Join-Path $clientDist 'index.html'))) {
    if (-not $npmCmd) {
      throw 'client/dist 缺失或已过期，但当前机器没有 npm 无法构建。请在有 Node 的开发机上重新打包（prepare-runtime.ps1 会顺带构建）。'
    }
    Write-Step '构建前端（约 10 秒）'
    Invoke-Npm -WorkDir $clientDir -Arguments 'run build'
    Write-Ok '前端构建完成'
  } else {
    Write-Ok '前端 dist 是最新的，跳过构建'
  }

  if ($Rebuild -or (Test-NeedsBuild -SrcDir (Join-Path $serverDir 'src') -Patterns @('*.ts') -OutputFile (Join-Path $serverDist 'index.js'))) {
    if (-not $npmCmd) {
      throw 'server/dist 缺失或已过期，但当前机器没有 npm 无法构建。请在有 Node 的开发机上重新打包（prepare-runtime.ps1 会顺带构建）。'
    }
    Write-Step '构建后端（约 5 秒）'
    Invoke-Npm -WorkDir $serverDir -Arguments 'run build'
    Write-Ok '后端构建完成'
  } else {
    Write-Ok '后端 dist 是最新的，跳过构建'
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

  $script:serverProc = Start-Process -FilePath $nodeExe -ArgumentList 'dist/index.js' `
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
