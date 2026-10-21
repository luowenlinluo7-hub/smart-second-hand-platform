#Requires -Version 5.1
<#
.SYNOPSIS
  确保有一个可用的数据库（供 npm run dev 使用）

.DESCRIPTION
  按以下顺序找数据库，找到就用，找不到就自己起一个便携实例：
    1. 本机 3306 已在监听 → 直接沿用 server/.env 里的 DATABASE_URL
    2. 否则用随包 / 已装的 MySQL 二进制起便携实例（与 start-demo.bat 共用同一份数据）

  成功时向标准输出打印两行供调用方解析：
    DATABASE_URL=mysql://...
    MYSQLD_STARTED=1|0

.PARAMETER Stop
  停掉便携实例（按数据目录匹配命令行，父子进程一并清理）
#>
[CmdletBinding()]
param(
  [switch]$Stop
)

$ErrorActionPreference = 'Continue'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serverDir = Join-Path $projectRoot 'server'
$runtimeDir = Join-Path $projectRoot 'runtime'
$bundledMysqlBin = Join-Path $runtimeDir 'mysql\bin'
$bundledNode = Join-Path $runtimeDir 'node.exe'
$demoDbName = 'smart_second_hand_demo'

# 便携数据目录必须落在纯 ASCII 路径（中文路径下 mysqld 会静默启动失败）
$asciiPattern = '^[\x20-\x7E]+$'
$demoCandidates = @()
if ($env:LOCALAPPDATA) { $demoCandidates += (Join-Path $env:LOCALAPPDATA 'smart-second-hand-demo') }
if ($env:TEMP) { $demoCandidates += (Join-Path $env:TEMP 'smart-second-hand-demo') }
$demoCandidates += (Join-Path $projectRoot '.demo-db')
$demoDir = $demoCandidates | Where-Object { $_ -match $asciiPattern } | Select-Object -First 1
if (-not $demoDir) { $demoDir = $demoCandidates[$demoCandidates.Count - 1] }
$demoData = Join-Path $demoDir 'data'

function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments = @())
  $output = & $Exe @Arguments 2>&1
  return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = (($output | ForEach-Object { "$_" }) -join "`n") }
}

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

function Stop-PortableMysql {
  # mysqld 在 Windows 上是「监控父进程 + 服务子进程」，父进程被杀时子进程可能刚被派生出来，
  # 单轮枚举会漏。这里做两轮，中间留一点时间让进程树稳定。
  $total = 0
  for ($pass = 1; $pass -le 2; $pass++) {
    $killed = 0
    Get-CimInstance Win32_Process -Filter "Name = 'mysqld.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.CommandLine -and $_.CommandLine -like "*$demoData*") {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $killed++
      }
    }
    $total += $killed
    if ($pass -eq 1) { Start-Sleep -Milliseconds 700 }
  }
  return $total
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

function Find-Mysqld {
  $cmd = Get-Command mysqld.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $found = @()
  foreach ($pf in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $pf) { continue }
    $root = Join-Path $pf 'MySQL'
    if (-not (Test-Path $root)) { continue }
    $found += Get-ChildItem -Path $root -Filter 'mysqld.exe' -Recurse -File -ErrorAction SilentlyContinue
  }
  if ($found.Count -eq 0) { return $null }
  return ($found | Sort-Object FullName -Descending | Select-Object -First 1).FullName
}

if ($Stop) {
  $n = Stop-PortableMysql
  Write-Output "STOPPED=$n"
  exit 0
}

# ---------- 1) 本机 3306 可用就直接用 ----------
if (Test-Port 3306) {
  $url = Get-EnvValue -Path (Join-Path $serverDir '.env') -Key 'DATABASE_URL'
  if ($url) {
    Write-Output "DATABASE_URL=$url"
    Write-Output 'MYSQLD_STARTED=0'
    exit 0
  }
  Write-Output 'ERROR=server/.env 中缺少 DATABASE_URL'
  exit 1
}

# ---------- 2) 起便携实例 ----------
$startedByUs = 0
$dbPort = 3307

if (-not (Test-Port $dbPort)) {
  $mysqldExe = $null
  if (Test-Path (Join-Path $bundledMysqlBin 'mysqld.exe')) {
    if ((Join-Path $runtimeDir 'mysql') -match $asciiPattern) {
      $mysqldExe = Join-Path $bundledMysqlBin 'mysqld.exe'
    } else {
      # 项目在中文路径下：把随包 MySQL 复制到 ASCII 目录再用
      $mysqlCache = Join-Path $demoDir 'mysql'
      $marker = Join-Path $mysqlCache '.source'
      $srcInfo = Get-Item (Join-Path $bundledMysqlBin 'mysqld.exe')
      $stamp = "$($srcInfo.Length)-$($srcInfo.LastWriteTimeUtc.Ticks)"
      $needCopy = $true
      if ((Test-Path (Join-Path $mysqlCache 'bin\mysqld.exe')) -and (Test-Path $marker)) {
        if ((Get-Content $marker -Raw).Trim() -eq $stamp) { $needCopy = $false }
      }
      if ($needCopy) {
        Write-Output 'INFO=首次把随包 MySQL 复制到 ASCII 目录（约 95 MB）'
        if (Test-Path $mysqlCache) { Remove-Item -Recurse -Force $mysqlCache }
        New-Item -ItemType Directory -Path $mysqlCache -Force | Out-Null
        Copy-Item (Join-Path $runtimeDir 'mysql\*') $mysqlCache -Recurse -Force
        [System.IO.File]::WriteAllText($marker, $stamp)
      }
      $mysqldExe = Join-Path $mysqlCache 'bin\mysqld.exe'
    }
  } else {
    $mysqldExe = Find-Mysqld
  }

  if (-not $mysqldExe) {
    Write-Output 'ERROR=未找到 mysqld.exe，请运行 scripts/demo/prepare-runtime.ps1 或安装 MySQL 8'
    exit 1
  }

  $mysqlBin = Split-Path $mysqldExe -Parent
  $mysqlBase = Split-Path $mysqlBin -Parent
  $mysqlAdmin = Join-Path $mysqlBin 'mysqladmin.exe'
  $mysqlCli = Join-Path $mysqlBin 'mysql.exe'

  if (-not (Test-Path $demoDir)) { New-Item -ItemType Directory -Path $demoDir -Force | Out-Null }
  if (-not (Test-Path (Join-Path $demoData 'mysql'))) {
    Write-Output 'INFO=初始化便携数据库（约 5 秒）'
    $init = Invoke-Native -Exe $mysqldExe -Arguments @('--initialize-insecure', "--basedir=$mysqlBase", "--datadir=$demoData")
    if ($init.ExitCode -ne 0) {
      Write-Output "ERROR=初始化便携数据库失败: $($init.Output)"
      exit 1
    }
  }

  # 系统保留端口段要跳过（Hyper-V / WSL 会占掉成段端口）
  $reserved = @()
  $res = Invoke-Native -Exe 'netsh' -Arguments @('int', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp')
  foreach ($line in ($res.Output -split "`n")) {
    if ($line -match '^\s*(\d{2,5})\s+(\d{2,5})\s*\*?\s*$') { $reserved += , @([int]$Matches[1], [int]$Matches[2]) }
  }
  $usable = {
    param([int]$p)
    if (Test-Port $p) { return $false }
    foreach ($r in $reserved) { if ($p -ge $r[0] -and $p -le $r[1]) { return $false } }
    return $true
  }
  while (-not (& $usable $dbPort)) { $dbPort++ }

  $dbLog = Join-Path $demoDir 'mysqld.log'
  $argStr = "--basedir=`"$mysqlBase`" --datadir=`"$demoData`" --port=$dbPort --bind-address=127.0.0.1 --skip-log-bin --log-error=`"$dbLog`""
  $proc = Start-Process -FilePath $mysqldExe -ArgumentList $argStr -PassThru -WindowStyle Hidden
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    $ping = Invoke-Native -Exe $mysqlAdmin -Arguments @('-h', '127.0.0.1', '-P', "$dbPort", '-u', 'root', 'ping')
    if ($ping.Output -match 'alive') { $ready = $true; break }
    if ($proc.HasExited) { break }
  }
  if (-not $ready) {
    Write-Output 'ERROR=便携 MySQL 未能启动（端口可能被系统保留）'
    exit 1
  }
  $startedByUs = 1

  $create = Invoke-Native -Exe $mysqlCli -Arguments @(
    '-h', '127.0.0.1', '-P', "$dbPort", '-u', 'root',
    '-e', "CREATE DATABASE IF NOT EXISTS $demoDbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  )
  if ($create.ExitCode -ne 0) {
    Write-Output "ERROR=创建数据库失败: $($create.Output)"
    exit 1
  }
} else {
  # 已在跑的便携实例（可能是 start-demo.bat 开的）：沿用，不算我们启动
  $mysqlBin = Split-Path (Find-Mysqld) -Parent
  if (-not (Test-Path (Join-Path $mysqlBin 'mysql.exe'))) {
    $mysqlBin = Join-Path $demoDir 'mysql\bin'
  }
}

$dbUrl = "mysql://root:@127.0.0.1:$dbPort/$demoDbName"

# ---------- 3) 结构 + 演示数据 ----------
$nodeExe = if (Test-Path $bundledNode) { $bundledNode } else { 'node' }
$prismaCli = Join-Path $serverDir 'node_modules\prisma\build\index.js'
$tsxCli = Join-Path $serverDir 'node_modules\tsx\dist\cli.mjs'
$env:DATABASE_URL = $dbUrl

Push-Location $serverDir
try {
  $migrate = Invoke-Native -Exe $nodeExe -Arguments @($prismaCli, 'migrate', 'deploy')
  if ($migrate.ExitCode -ne 0) {
    Write-Output "ERROR=数据库迁移失败: $($migrate.Output)"
    exit 1
  }
  $countScript = "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.product.count().then(c=>{console.log(c);return p.`$disconnect()}).catch(()=>{console.log('-1')})"
  $count = Invoke-Native -Exe $nodeExe -Arguments @('-e', $countScript)
  $productCount = -1
  if ($count.ExitCode -eq 0 -and $count.Output.Trim() -match '^-?\d+$') { $productCount = [int]$count.Output.Trim() }
  if ($productCount -le 0) {
    Write-Output 'INFO=灌入演示数据（约 10 秒）'
    $seed = Invoke-Native -Exe $nodeExe -Arguments @($tsxCli, 'prisma\seed.ts')
    if ($seed.ExitCode -ne 0) {
      Write-Output "ERROR=灌入演示数据失败: $($seed.Output)"
      exit 1
    }
  }
} finally {
  Pop-Location
}

Write-Output "DATABASE_URL=$dbUrl"
Write-Output "MYSQLD_STARTED=$startedByUs"
exit 0
