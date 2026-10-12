# 答辩演示包打包脚本
#
# 用途：把「便携 Node + 便携 MariaDB + 前端构建产物 + 后端编译产物」组装成一个
#       零环境、零网络、双击即用的离线演示包（放在仓库之外，不进 git）。
#
# 用法（在任意目录执行）：
#   powershell -ExecutionPolicy Bypass -File scripts\demo\build-demo.ps1
#
# 可选参数：
#   -OutDir D:\demo            指定输出目录（必须是纯英文路径！）
#   -SkipDownloads             只使用已缓存的 zip，不联网下载
#   -ReuseDb                   复用已有 data 目录，跳过重新初始化（调试用）
#
# 重要：输出目录绝对不能含中文/空格，否则 MariaDB 无法启动。

[CmdletBinding()]
param(
  [string]$CacheDir = 'F:\demo-build',
  [string]$OutDir   = 'F:\smart-second-hand-demo',
  [int]$DbPort      = 3310,
  [int]$AppPort     = 3210,
  [string]$DbName   = 'smart_second_hand',
  [switch]$SkipDownloads,
  [switch]$ReuseDb
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ---------- 版本与下载地址 ----------
$NodeVersion  = 'v24.21.0'
$MariaVersion = '11.4.13'
$NodeZipName  = "node-$NodeVersion-win-x64.zip"
$MariaZipName = "mariadb-$MariaVersion-winx64.zip"
# nodejs.org 直连；MariaDB 官方 mirror 会 403，改用清华镜像
$NodeUrl  = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
$MariaUrl = "https://mirrors.tuna.tsinghua.edu.cn/mariadb/mariadb-$MariaVersion/winx64-packages/mariadb-$MariaVersion-winx64.zip"

$RepoRoot  = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ServerDir = Join-Path $RepoRoot 'server'
$ClientDir = Join-Path $RepoRoot 'client'

# ---------- 输出辅助 ----------
function Write-Step($msg) { Write-Host ''; Write-Host "==== $msg ====" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "  $msg" }
function Write-Note($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }

function Get-DirSizeMB($path) {
  if (-not (Test-Path $path)) { return 0 }
  $sum = (Get-ChildItem $path -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  if (-not $sum) { return 0 }
  return [math]::Round($sum / 1MB, 1)
}

# ---------- 前置检查 ----------
function Assert-AsciiPath($path) {
  if ($path -notmatch '^[A-Za-z]:[\\/][A-Za-z0-9_\-\\/\.]*$') {
    throw "输出目录必须是纯英文路径（不含中文、空格、特殊字符）：$path"
  }
}

function Test-PortListening($port) {
  $conns = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  return ($null -ne $conns -and @($conns).Count -gt 0)
}

function Wait-Port($port, $timeoutSec, $label) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortListening $port) { return $true }
    Start-Sleep -Milliseconds 700
  }
  Write-Note "$label 在 $timeoutSec 秒内未就绪（端口 $port）"
  return $false
}

function Wait-PortClosed($port, $timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (-not (Test-PortListening $port)) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# ---------- 1. 准备运行时 ----------
function Get-Runtimes {
  Write-Step '1/9 准备便携运行时（Node + MariaDB）'
  New-Item -ItemType Directory -Path (Join-Path $CacheDir 'zips') -Force | Out-Null

  $nodeZip  = Join-Path $CacheDir "zips\$NodeZipName"
  $mariaZip = Join-Path $CacheDir "zips\$MariaZipName"

  if (-not $SkipDownloads) {
    if (-not (Test-Path $nodeZip)) {
      Write-Info "下载 Node $NodeVersion ..."
      & curl.exe -L --noproxy '*' --fail --silent --show-error -o $nodeZip $NodeUrl
      if ($LASTEXITCODE -ne 0) { throw "Node 下载失败，可手动下载后放到 $nodeZip" }
    }
    if (-not (Test-Path $mariaZip)) {
      Write-Info "下载 MariaDB $MariaVersion ..."
      & curl.exe -L --noproxy '*' --fail --silent --show-error -o $mariaZip $MariaUrl
      if ($LASTEXITCODE -ne 0) { throw "MariaDB 下载失败，可手动下载后放到 $mariaZip" }
    }
  } else {
    if (-not (Test-Path $nodeZip))  { throw "缺少缓存的 $nodeZip（去掉 -SkipDownloads 让它联网下载）" }
    if (-not (Test-Path $mariaZip)) { throw "缺少缓存的 $mariaZip（去掉 -SkipDownloads 让它联网下载）" }
  }

  $nodeRoot  = Join-Path $CacheDir "node\node-$NodeVersion-win-x64"
  $mariaRoot = Join-Path $CacheDir "mariadb\mariadb-$MariaVersion-winx64"

  # 用 tar.exe 解压，比 Expand-Archive 快很多
  if (-not (Test-Path (Join-Path $nodeRoot 'node.exe'))) {
    Write-Info '解压 Node ...'
    New-Item -ItemType Directory -Path (Join-Path $CacheDir 'node') -Force | Out-Null
    & tar.exe -xf $nodeZip -C (Join-Path $CacheDir 'node')
    if ($LASTEXITCODE -ne 0) { throw 'Node 解压失败' }
  }
  if (-not (Test-Path (Join-Path $mariaRoot 'bin\mariadbd.exe'))) {
    Write-Info '解压 MariaDB ...'
    New-Item -ItemType Directory -Path (Join-Path $CacheDir 'mariadb') -Force | Out-Null
    & tar.exe -xf $mariaZip -C (Join-Path $CacheDir 'mariadb')
    if ($LASTEXITCODE -ne 0) { throw 'MariaDB 解压失败' }
  }

  Write-Ok "Node 缓存: $nodeRoot"
  Write-Ok "MariaDB 缓存: $mariaRoot"
  return @{ NodeRoot = $nodeRoot; MariaRoot = $mariaRoot }
}

# ---------- 2. 组装运行时到输出目录 ----------
function New-RuntimeLayout($nodeRoot, $mariaRoot) {
  Write-Step '2/9 组装输出目录（便携 Node + 裁剪后的 MariaDB）'

  if (Test-Path $OutDir) {
    Write-Info "清空已存在的输出目录 $OutDir"
    Remove-Item $OutDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

  # 便携 Node：只需要 node.exe，npm/npx 在演示包里用不到
  $nodeOut = Join-Path $OutDir 'node'
  New-Item -ItemType Directory -Path $nodeOut -Force | Out-Null
  Copy-Item (Join-Path $nodeRoot 'node.exe') (Join-Path $nodeOut 'node.exe') -Force
  Copy-Item (Join-Path $nodeRoot 'LICENSE') (Join-Path $nodeOut 'LICENSE') -Force -ErrorAction SilentlyContinue
  Write-Ok ("node\node.exe  " + [math]::Round((Get-Item (Join-Path $nodeOut 'node.exe')).Length / 1MB, 1) + ' MB')

  # MariaDB：裁剪掉调试符号、静态库、头文件、用不到的命令行工具
  $mariaOut    = Join-Path $OutDir 'mariadb'
  $mariaBinOut = Join-Path $mariaOut 'bin'
  New-Item -ItemType Directory -Path $mariaBinOut -Force | Out-Null

  # 必须保留的可执行文件（其余 exe 全部丢弃）
  #   mariadbd.exe          —— 数据库服务本体（0.01MB 的壳，真实逻辑在 server.dll）
  #   mysqld.exe            —— 与 mariadbd 等价的别名，初始化时 bootstrap 需要它
  #   mariadb.exe           —— 客户端，用于建库/验证
  #   mariadb-admin.exe     —— 用于干净停库 shutdown
  #   mariadb-install-db.exe—— 仅初始化时用，初始化完成后删除
  $keepExe = @('mariadbd.exe', 'mysqld.exe', 'mariadb.exe', 'mariadb-admin.exe', 'mariadb-install-db.exe')

  $srcBin = Join-Path $mariaRoot 'bin'
  foreach ($f in (Get-ChildItem $srcBin -File)) {
    $ext = $f.Extension.ToLower()
    if ($ext -eq '.pdb' -or $ext -eq '.lib') { continue }      # 调试符号/静态库，纯垃圾
    if ($ext -eq '.dll') {                                      # DLL 全保留（含 server.dll 19MB）
      Copy-Item $f.FullName (Join-Path $mariaBinOut $f.Name) -Force
      continue
    }
    if ($keepExe -contains $f.Name.ToLower()) {
      Copy-Item $f.FullName (Join-Path $mariaBinOut $f.Name) -Force
    }
  }
  Copy-Item (Join-Path $mariaRoot 'share') (Join-Path $mariaOut 'share') -Recurse -Force
  # lib\ 里有 5MB 基础库 + 8.3MB plugin，体积小但属于兜底能力，保留以免出现插件缺失告警
  Copy-Item (Join-Path $mariaRoot 'lib') (Join-Path $mariaOut 'lib') -Recurse -Force
  # lib\ 里只有 libmariadb.dll 运行时需要；.lib 是编译期导入库、.pdb 是调试符号，全部丢弃
  Get-ChildItem (Join-Path $mariaOut 'lib') -Recurse -File -Include *.lib, *.pdb -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $mariaRoot 'COPYING') (Join-Path $mariaOut 'COPYING') -Force -ErrorAction SilentlyContinue

  Write-Ok ("mariadb\bin  " + (Get-DirSizeMB $mariaBinOut) + ' MB（已删 pdb/lib/多余工具，共省约 100MB）')
  Write-Ok ("mariadb\share " + (Get-DirSizeMB (Join-Path $mariaOut 'share')) + ' MB')
  Write-Ok ("mariadb\lib   " + (Get-DirSizeMB (Join-Path $mariaOut 'lib')) + ' MB')

  return @{ MariaOut = $mariaOut; MariaBin = $mariaBinOut }
}

# ---------- 3. 写 my.ini ----------
function Write-MyIni($mariaOut) {
  $datadir = (Join-Path $mariaOut 'data').Replace('\', '/')
  $basedir = $mariaOut.Replace('\', '/')

  $ini = @"
# 演示包专用 MariaDB 配置（自动生成，请勿手工修改）
# 只监听本地回环，端口 $DbPort，避免与学校电脑上可能已装的 MySQL(3306) 冲突
[mysqld]
basedir="$basedir"
datadir="$datadir"
port=$DbPort
bind-address=127.0.0.1
skip-name-resolve
default-storage-engine=InnoDB
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
max_allowed_packet=32M
# 演示数据量极小，默认 96MB redo log 纯属浪费，压到 24MB
innodb_log_file_size=24M
log-error="$datadir/error.log"

[client]
port=$DbPort
default-character-set=utf8mb4
"@
  $iniPath = Join-Path $mariaOut 'my.ini'
  [System.IO.File]::WriteAllText($iniPath, $ini, (New-Object System.Text.UTF8Encoding($false)))
  Write-Ok "mariadb\my.ini 已生成（端口 $DbPort）"
}

# ---------- 4. 初始化数据库并灌数据 ----------
function Initialize-Database($mariaOut, $mariaBin) {
  Write-Step '3/9 初始化 MySQL 兼容数据库并灌入演示数据'

  $dataDir  = Join-Path $mariaOut 'data'
  $iniPath  = Join-Path $mariaOut 'my.ini'
  $mariadbd = Join-Path $mariaBin 'mariadbd.exe'
  $installDb = Join-Path $mariaBin 'mariadb-install-db.exe'
  $mysql    = Join-Path $mariaBin 'mariadb.exe'
  $dbAdmin  = Join-Path $mariaBin 'mariadb-admin.exe'

  if ($ReuseDb -and (Test-Path (Join-Path $dataDir 'smart_second_hand'))) {
    Write-Note '-ReuseDb：复用已有 data 目录，跳过初始化'
    return
  }

  if (Test-PortListening $DbPort) {
    throw "端口 $DbPort 已被占用，请先停止占用它的程序（可能是上一次演示包没关干净）"
  }

  if (Test-Path $dataDir) { Remove-Item $dataDir -Recurse -Force }

  Write-Info "初始化 data 目录（约 30 秒）..."
  # 注意：这个老版 mysql_install_db 不支持 --defaults-file，只认 -d/-P/-c 短参数
  # -c 传入 my.ini 作为模板，这样 redo log 一开始就按 24MB 建，省掉启动时的重建
  & $installDb '-d' $dataDir '-P' "$DbPort" '-c' $iniPath 2>&1 |
    Where-Object { $_ -notmatch 'ssl-verify' } | Out-Null
  if (-not (Test-Path (Join-Path $dataDir 'mysql'))) { throw 'data 目录初始化失败' }
  Write-Ok ('data\ 初始化完成  ' + (Get-DirSizeMB $dataDir) + ' MB')

  # 启动数据库
  Write-Info '启动数据库 ...'
  $dbProc = Start-Process -FilePath $mariadbd -ArgumentList "--defaults-file=`"$iniPath`"" -PassThru -WindowStyle Hidden
  if (-not (Wait-Port $DbPort 90 'MariaDB')) {
    throw "MariaDB 启动失败，请看 $dataDir\error.log"
  }
  Write-Ok "数据库已就绪（127.0.0.1:$DbPort，PID $($dbProc.Id)）"

  try {
    # 建库 + 建一个无密码的 root 本机账号（仅回环，演示用）
    & $mysql "--defaults-file=$iniPath" -u root -e "CREATE DATABASE IF NOT EXISTS ``$DbName`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>$null
    if ($LASTEXITCODE -ne 0) { throw '创建数据库失败' }
    Write-Ok "数据库 $DbName 已创建"

    # 迁移 + 种子数据（复用开发目录里的 prisma CLI / tsx）
    $env:DATABASE_URL = "mysql://root@127.0.0.1:$DbPort/$DbName"
    # prisma db seed 会去调 tsx，必须让 node_modules\.bin 在 PATH 里，否则报 "'tsx' is not recognized"
    $env:PATH = (Join-Path $ServerDir 'node_modules\.bin') + ';' + $env:PATH
    $prismaCmd = Join-Path $ServerDir 'node_modules\.bin\prisma.cmd'

    Write-Info '执行 prisma migrate deploy ...'
    Push-Location $ServerDir
    try {
      & $prismaCmd migrate deploy
      if ($LASTEXITCODE -ne 0) { throw 'prisma migrate deploy 失败' }

      Write-Info '执行 seed ...'
      & $prismaCmd db seed
      if ($LASTEXITCODE -ne 0) { throw 'prisma db seed 失败' }
    } finally {
      Pop-Location
    }
    Write-Ok '迁移与演示数据全部就绪'
  } finally {
    # 干净停库，保证 data 文件一致（演示包拷走后可直接启动）
    Write-Info '停库以保证数据文件一致 ...'
    & $dbAdmin "--defaults-file=$iniPath" -u root shutdown 2>$null | Out-Null
    if (-not (Wait-PortClosed $DbPort 30)) {
      Write-Note "数据库未在 30 秒内退出，强制结束 PID $($dbProc.Id)"
      Stop-Process -Id $dbProc.Id -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
    }
    Write-Ok '数据库已干净停止'
  }

  # 初始化完成后就不再需要安装工具了，顺手裁掉
  Remove-Item (Join-Path $mariaBin 'mariadb-install-db.exe') -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $dataDir 'error.log') -Force -ErrorAction SilentlyContinue  # 构建期日志，不用带走
  Write-Ok ('mariadb\data  ' + (Get-DirSizeMB $dataDir) + ' MB（含全部演示数据）')
}

# ---------- 5/6. 构建前端与后端 ----------
function Build-Frontend {
  Write-Step '4/9 构建前端（vite build）'
  Push-Location $ClientDir
  try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
  } finally {
    Pop-Location
  }

  $src = Join-Path $ClientDir 'dist'
  if (-not (Test-Path (Join-Path $src 'index.html'))) { throw '前端构建产物缺少 index.html' }
  Copy-Item $src (Join-Path $OutDir 'client') -Recurse -Force
  Write-Ok ('client\  ' + (Get-DirSizeMB (Join-Path $OutDir 'client')) + ' MB')

  # 确认占位图跟着构建产物一起走了（断网时靠它显示图片）
  $demoCount = @(Get-ChildItem (Join-Path $OutDir 'client\demo') -Filter '*.jpg' -ErrorAction SilentlyContinue).Count
  if ($demoCount -lt 12) { Write-Note "client\demo 只有 $demoCount 张占位图，预期 12 张" }
  else { Write-Ok "$demoCount 张本地占位图已打包（断网也能正常显示）" }
}

function Build-Backend {
  Write-Step '5/9 构建后端（tsc）并准备生产依赖'
  Push-Location $ServerDir
  try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw '后端编译失败' }
  } finally {
    Pop-Location
  }

  $serverOut = Join-Path $OutDir 'server'
  New-Item -ItemType Directory -Path $serverOut -Force | Out-Null
  Copy-Item (Join-Path $ServerDir 'dist') (Join-Path $serverOut 'dist') -Recurse -Force
  # 演示包不需要 sourcemap；它还会把开发机的绝对路径写进产物里
  Get-ChildItem (Join-Path $serverOut 'dist') -Recurse -File -Filter '*.js.map' -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path (Join-Path $serverOut 'uploads') -Force | Out-Null
  Write-Ok ('server\dist  ' + (Get-DirSizeMB (Join-Path $serverOut 'dist')) + ' MB')

  # 生产依赖：用 npm ci --omit=dev 装一棵干净的依赖树，而不是把开发依赖一起搬过去
  $stage = Join-Path $CacheDir 'prod-stage'
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  Copy-Item (Join-Path $ServerDir 'package.json') $stage -Force
  if (Test-Path (Join-Path $ServerDir 'package-lock.json')) {
    Copy-Item (Join-Path $ServerDir 'package-lock.json') $stage -Force
  }

  Write-Info '安装生产依赖（跳过 tsx/nodemon/typescript/prisma CLI）...'
  Push-Location $stage
  try {
    $env:PRISMA_SKIP_POSTINSTALL_GENERATE = 'true'
    # --legacy-peer-deps：@prisma/client 的 peer 依赖是 prisma CLI(90MB)，演示包运行时不需要
    & npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { throw '生产依赖安装失败' }
  } finally {
    Pop-Location
    Remove-Item Env:\PRISMA_SKIP_POSTINSTALL_GENERATE -ErrorAction SilentlyContinue
  }

  Copy-Item (Join-Path $stage 'node_modules') (Join-Path $serverOut 'node_modules') -Recurse -Force

  # Prisma Client 的运行时代码 + Windows 原生查询引擎（dev 目录里已生成好，直接复用）
  $gen = Join-Path $ServerDir 'node_modules\.prisma'
  if (-not (Test-Path (Join-Path $gen 'client\query_engine-windows.dll.node'))) {
    throw '未找到已生成的 Prisma Client，请先在 server 目录执行 npm run prisma:generate'
  }
  $dstPrisma = Join-Path $serverOut 'node_modules\.prisma'
  if (Test-Path $dstPrisma) { Remove-Item $dstPrisma -Recurse -Force }
  Copy-Item $gen $dstPrisma -Recurse -Force

  if (-not (Test-Path (Join-Path $dstPrisma 'client\query_engine-windows.dll.node'))) {
    throw 'Prisma 查询引擎复制失败'
  }
  $prismaCli = Join-Path $serverOut 'node_modules\prisma'
  if (Test-Path $prismaCli) { Write-Note 'prisma CLI 仍在依赖树中（体积较大，但不影响运行）' }
  Write-Ok ('server\node_modules  ' + (Get-DirSizeMB (Join-Path $serverOut 'node_modules')) + ' MB')
}

# ---------- 7. 演示用 .env ----------
function Write-DemoEnv {
  Write-Step '6/9 生成演示环境配置 server\.env'
  $serverOut = Join-Path $OutDir 'server'

  $envText = @"
# 演示包专用环境变量（自动生成）
# 注意：本配置仅供本机演示，root 无密码 + 仅监听 127.0.0.1，切勿用于生产环境
NODE_ENV=production
PORT=$AppPort

# 数据库：指向包内自带的便携 MariaDB（端口 $DbPort 避开系统 MySQL 的 3306）
DATABASE_URL="mysql://root@127.0.0.1:$DbPort/$DbName"

# 前端由本服务同源托管，因此 CORS 只需要放行自己
CORS_ORIGIN="http://localhost:$AppPort,http://127.0.0.1:$AppPort"

# 演示用密钥（仅本机演示，真实部署请更换）
JWT_SECRET="demo-only-secret-not-for-production-0123456789abcdef"
JWT_EXPIRES_IN="7d"

# 上传目录固定到包内，避免受工作目录影响
UPLOAD_DIR="__UPLOAD_DIR__"

# 前端构建产物目录（由本服务托管，实现同源访问）
CLIENT_DIST="__CLIENT_DIST__"
"@

  # 用绝对路径写入，运行时与 cwd 无关
  $envText = $envText.Replace('__UPLOAD_DIR__', (Join-Path $serverOut 'uploads'))
  $envText = $envText.Replace('__CLIENT_DIST__', (Join-Path $OutDir 'client'))
  $envText = $envText.Replace('\', '/')

  [System.IO.File]::WriteAllText((Join-Path $serverOut '.env'), $envText, (New-Object System.Text.UTF8Encoding($false)))
  Write-Ok 'server\.env 已生成'
}

# ---------- 8. 启动器与说明 ----------
function Copy-Launchers {
  Write-Step '7/9 写入启动器与使用说明'

  $files = @('launcher.js', '启动演示.bat', '停止演示.bat', '使用说明.txt')
  foreach ($f in $files) {
    $src = Join-Path $PSScriptRoot $f
    if (-not (Test-Path $src)) { throw "缺少模板文件：$src" }
    Copy-Item $src (Join-Path $OutDir $f) -Force
  }
  Write-Ok ($files -join '、')
}

# ---------- 9. 校验 ----------
function Test-Package {
  Write-Step '8/9 校验交付包'

  $mustExist = @(
    'launcher.js', '启动演示.bat', '停止演示.bat', '使用说明.txt',
    'node\node.exe',
    'mariadb\bin\mariadbd.exe', 'mariadb\bin\mariadb.exe', 'mariadb\bin\mariadb-admin.exe',
    'mariadb\bin\server.dll', 'mariadb\my.ini', 'mariadb\data\smart_second_hand',
    'server\dist\index.js', 'server\node_modules\.prisma\client\query_engine-windows.dll.node',
    'server\.env', 'client\index.html'
  )
  $missing = @()
  foreach ($rel in $mustExist) {
    if (-not (Test-Path (Join-Path $OutDir $rel))) { $missing += $rel }
  }
  if ($missing.Count -gt 0) { throw ("交付包缺少文件：`n  " + ($missing -join "`n  ")) }
  Write-Ok '必需文件齐全'

  # 确认没有外链图片（断网不能裂图）
  $picsum = Get-ChildItem $OutDir -Recurse -File -Include *.js -ErrorAction SilentlyContinue |
    Select-String -Pattern 'picsum\.photos' -List -ErrorAction SilentlyContinue
  if ($picsum) { Write-Note '前端产物中仍残留 picsum.photos 外链，断网会裂图' }
  else { Write-Ok '未发现 picsum.photos 外链' }

  # 确认我们自己编译的产物里没有写死开发机的绝对路径（Prisma 生成文件里的元数据不影响运行）
  $abs = Get-ChildItem @((Join-Path $OutDir 'server\dist'), (Join-Path $OutDir 'client')) -Recurse -File -Include *.js,*.css,*.html -ErrorAction SilentlyContinue |
    Select-String -Pattern '二手app' -List -ErrorAction SilentlyContinue
  if ($abs) {
    Write-Note '构建产物中出现开发机的仓库路径：'
    foreach ($m in $abs) { Write-Note ('    ' + $m.Path.Replace($OutDir, '')) }
  } else { Write-Ok '构建产物中无开发机绝对路径残留' }

  # 裁剪后不该再出现这些大块头
  $leftover = @()
  foreach ($p in @(Get-ChildItem (Join-Path $OutDir 'mariadb') -Recurse -File -Include *.pdb, *.lib -ErrorAction SilentlyContinue)) { $leftover += $p.Name }
  if ($leftover.Count -gt 0) { Write-Note ("MariaDB 目录仍有 " + $leftover.Count + ' 个 pdb/lib 未裁剪') }
  else { Write-Ok 'MariaDB 调试符号已清理干净' }
}

# ---------- main ----------
Write-Host ''
Write-Host '智能二手交易平台 · 答辩离线演示包打包' -ForegroundColor White
Write-Host "输出目录: $OutDir" -ForegroundColor Gray

Assert-AsciiPath $OutDir

$rt = Get-Runtimes
$layout = New-RuntimeLayout $rt.NodeRoot $rt.MariaRoot
Write-MyIni $layout.MariaOut
Initialize-Database $layout.MariaOut $layout.MariaBin
Build-Frontend
Build-Backend
Write-DemoEnv
Copy-Launchers
Test-Package

Write-Step '9/9 打包完成'
$total = Get-DirSizeMB $OutDir
Write-Host ''
Write-Host "  交付目录 : $OutDir" -ForegroundColor Green
Write-Host "  总体积   : $total MB" -ForegroundColor Green
Write-Host ''
Write-Host '  下一步：把整个目录拷贝到 U 盘，在学校电脑上双击「启动演示.bat」' -ForegroundColor Yellow
Write-Host '  （提醒：目标路径必须是纯英文，例如 D:\demo）' -ForegroundColor Yellow
Write-Host ''

exit 0
