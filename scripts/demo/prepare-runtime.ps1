#Requires -Version 5.1
<#
.SYNOPSIS
  生成 runtime/ 便携运行时（便携 Node + 精简 MySQL）

.DESCRIPTION
  为了在「完全没装 Node、也没装 MySQL」的电脑上演示，本脚本把运行时打包进项目：

    runtime/
      node.exe                  便携 Node（约 88 MB），直接运行无需安装
      mysql/bin/                精简 MySQL（约 62 MB）：mysqld / mysql / mysqladmin + 依赖 DLL
      mysql/share/              错误信息与字符集（约 10 MB）
      vcruntime140*.dll         可选：VC++ 运行库，防止目标机器缺少
      msvcp140.dll

  在**有 Node 和 MySQL 的开发机**上执行一次即可；产物约 160 MB，已加入 .gitignore。
  拷贝演示包时必须把 runtime/ 和 client/dist、server/dist、node_modules 一起带走。
#>
[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = 'Continue'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtimeDir = Join-Path $projectRoot 'runtime'
$mysqlOut = Join-Path $runtimeDir 'mysql'
$clientDir = Join-Path $projectRoot 'client'
$serverDir = Join-Path $projectRoot 'server'

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

function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments = @())
  $output = & $Exe @Arguments 2>&1
  $code = $LASTEXITCODE
  return [pscustomobject]@{ ExitCode = $code; Output = (($output | ForEach-Object { "$_" }) -join "`n") }
}

function Find-NodeExe {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
    if (Test-Path $p) { return $p }
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

if ((Test-Path $runtimeDir) -and -not $Force) {
  Write-Host "runtime/ 已存在。要重新生成请加 -Force" -ForegroundColor Yellow
  exit 0
}
if (Test-Path $runtimeDir) { Remove-Item -Recurse -Force $runtimeDir }

Write-Host ''
Write-Host '  生成便携运行时' -ForegroundColor Yellow
Write-Note "输出目录：$runtimeDir"

# ---------- 便携 Node ----------
Write-Step '复制 Node 运行时'
$nodeSrc = Find-NodeExe
if (-not $nodeSrc) { throw '未找到 node.exe，请先安装 Node 20+' }
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
Copy-Item $nodeSrc (Join-Path $runtimeDir 'node.exe') -Force
$ver = Invoke-Native -Exe (Join-Path $runtimeDir 'node.exe') -Arguments @('-v')
if ($ver.ExitCode -ne 0) { throw '复制后的 node.exe 无法运行' }
Write-Ok "node.exe（$($ver.Output.Trim())）"

# ---------- 便携 MySQL ----------
Write-Step '复制 MySQL 运行时（精简）'
$mysqldSrc = Find-Mysqld
if (-not $mysqldSrc) { throw '未找到 mysqld.exe，请先安装 MySQL 8' }
$mysqlBinSrc = Split-Path $mysqldSrc -Parent
$mysqlBaseSrc = Split-Path $mysqlBinSrc -Parent
Write-Note "来源：$mysqlBaseSrc"

New-Item -ItemType Directory -Path (Join-Path $mysqlOut 'bin') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $mysqlOut 'share') -Force | Out-Null

# 只带运行必需的三个可执行文件（mysqlsh / mysqlrouter / 各种 debug 版一概不要）
foreach ($exe in @('mysqld.exe', 'mysql.exe', 'mysqladmin.exe')) {
  $p = Join-Path $mysqlBinSrc $exe
  if (-not (Test-Path $p)) { throw "缺少 $exe" }
  Copy-Item $p (Join-Path $mysqlOut "bin\$exe") -Force
}

# 依赖 DLL：排除 debug 版、mysqlrouter 组件、harness 与性能采样库
$dlls = Get-ChildItem -Path $mysqlBinSrc -Filter '*.dll' -File |
  Where-Object { $_.Name -notmatch 'debug|mysqlrouter|harness|xpprof' }
foreach ($dll in $dlls) { Copy-Item $dll.FullName (Join-Path $mysqlOut "bin\$($dll.Name)") -Force }
Write-Ok "可执行文件 3 个，依赖 DLL $($dlls.Count) 个"

$shareSrc = Join-Path $mysqlBaseSrc 'share'
if (-not (Test-Path $shareSrc)) { throw '缺少 share 目录（错误信息与字符集），无法启动 mysqld' }
Copy-Item (Join-Path $shareSrc '*') (Join-Path $mysqlOut 'share') -Recurse -Force
Write-Ok 'share 目录（errmsg / charsets）'

# VC++ 运行库：目标机器可能没装，就近放一份（微软允许 app-local 部署）
$vcCount = 0
foreach ($dll in @('vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll')) {
  $p = Join-Path $env:SystemRoot "System32\$dll"
  if (Test-Path $p) {
    Copy-Item $p (Join-Path $mysqlOut "bin\$dll") -Force
    Copy-Item $p (Join-Path $runtimeDir $dll) -Force
    $vcCount++
  }
}
if ($vcCount -gt 0) { Write-Ok "VC++ 运行库 $vcCount 个（备用）" } else { Write-Note '未找到 VC++ 运行库，跳过（目标机可能已安装）' }

# ---------- 构建产物 ----------
Write-Step '确认构建产物'
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not (Test-Path (Join-Path $clientDir 'dist\index.html'))) {
  if (-not $npmCmd) { throw 'client/dist 缺失，且当前机器没有 npm 无法构建' }
  Write-Note '构建前端...'
  Push-Location $clientDir
  $r = Invoke-Native -Exe 'cmd' -Arguments @('/c', 'npm run build 2>&1')
  Pop-Location
  if ($r.ExitCode -ne 0) { throw "前端构建失败`n$($r.Output)" }
}
Write-Ok 'client/dist 就绪'

if (-not (Test-Path (Join-Path $serverDir 'dist\index.js'))) {
  if (-not $npmCmd) { throw 'server/dist 缺失，且当前机器没有 npm 无法构建' }
  Write-Note '构建后端...'
  Push-Location $serverDir
  $r = Invoke-Native -Exe 'cmd' -Arguments @('/c', 'npm run build 2>&1')
  Pop-Location
  if ($r.ExitCode -ne 0) { throw "后端构建失败`n$($r.Output)" }
}
Write-Ok 'server/dist 就绪'

# ---------- 汇总 ----------
$nodeMb = [math]::Round((Get-Item (Join-Path $runtimeDir 'node.exe')).Length / 1MB, 1)
$mysqlMb = [math]::Round((Get-ChildItem (Join-Path $mysqlOut 'bin'), (Join-Path $mysqlOut 'share') -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)

Write-Host ''
Write-Host '  ------------------------------------------------' -ForegroundColor Yellow
Write-Host '   便携运行时生成完成' -ForegroundColor Green
Write-Host "     node.exe        $nodeMb MB" -ForegroundColor Gray
Write-Host "     mysql（精简）   $mysqlMb MB" -ForegroundColor Gray
Write-Host "     合计            $([math]::Round($nodeMb + $mysqlMb,1)) MB" -ForegroundColor Gray
Write-Host ''
Write-Host '   拷贝演示包时必须带上：' -ForegroundColor Gray
Write-Host '     runtime/  client/dist/  server/dist/  client/node_modules/  server/node_modules/  server/.env' -ForegroundColor Gray
Write-Host '  ------------------------------------------------' -ForegroundColor Yellow
Write-Host ''
