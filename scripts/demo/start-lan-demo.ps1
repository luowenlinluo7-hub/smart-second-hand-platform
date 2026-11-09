#Requires -Version 5.1
<#
.SYNOPSIS
  智能二手交易平台 · 答辩一键演示（局域网主用 + 可选国内公网隧道）

.DESCRIPTION
  在 start-demo.ps1 的离线演示包之上，补齐「让国内教室设备访问」这一步：
    1. 自动申请管理员权限（仅创建防火墙入站规则需要）
    2. 放行单个 TCP 端口（默认 Domain/Private，校园网可加 -AllowPublic）
    3. 按默认路由网卡枚举局域网 IPv4，输出 http://<IP>:<Port>
    4. 可选启动 cpolar / natapp 国内节点隧道，得到 https 公网地址（备用链接）
    5. 启动原有离线演示服务：单端口同源、AI_MOCK=true、本地图片、便携 MySQL
    6. -Cleanup 在答辩后删除本脚本创建的防火墙规则

  主链路（本机 localhost / 局域网）完全离线，公网链接只是备用，
  不要把隧道地址当作唯一演示手段。不修改任何业务代码，不依赖 Vercel / Railway / Cloudinary。

.PARAMETER Port
  页面与接口共用端口，默认 3000（与 start-demo.ps1 一致）

.PARAMETER AllowPublic
  同时放行「公用网络」配置文件。校园网、手机热点常被 Windows 识别为公用网络

.PARAMETER Tunnel
  none（默认）/ cpolar / natapp。启动对应客户端并把本地 $Port 映射为国内公网 https 地址。
  客户端需预先登录：cpolar 用 `cpolar authtoken <token>`，natapp 用同级 config.ini
  或环境变量 NATAPP_AUTHTOKEN。脚本不保存、不传递任何明文 token。

.PARAMETER TunnelExe
  隧道客户端绝对路径。未指定时从 PATH 查找

.PARAMETER PublicUrl
  已保留的固定公网地址（如 https://demo.cpolar.top）。传入后不再从客户端日志提取，
  也可通过环境变量 DEMO_PUBLIC_URL 提供。推荐答辩用固定域名，避免免费版 24 小时刷新。

.PARAMETER Qr
  本机 Python 装有 qrcode + pillow 时，生成访问地址二维码（优先公网地址）并打开

.PARAMETER Cleanup
  删除本脚本创建的防火墙规则后退出，不启动服务

.PARAMETER DryRun
  只检查环境、输出将要执行的操作；不加规则、不启服务、不启隧道、不需要管理员

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\demo\start-lan-demo.ps1 -DryRun

.EXAMPLE
  .\start-lan-demo.bat -Tunnel cpolar -PublicUrl https://demo.cpolar.top -Qr

.EXAMPLE
  .\start-lan-demo.bat
#>
[CmdletBinding()]
param(
  [int]$Port = 3000,
  [switch]$AllowPublic,
  [ValidateSet('none', 'cpolar', 'natapp')]
  [string]$Tunnel = 'none',
  [string]$TunnelExe = '',
  [string]$PublicUrl = '',
  [switch]$Qr,
  [switch]$Cleanup,
  [switch]$DryRun,
  [switch]$NoBrowser,
  [switch]$Rebuild,
  [switch]$Reseed
)

# 不设 Stop：本脚本调用原生 exe，PS 5.1 下 Stop 会把原生 stderr 当成终止错误。
$ErrorActionPreference = 'Continue'

$ruleName = 'SmartSecondHand-LAN-{0}' -f $Port
$demoScript = Join-Path $PSScriptRoot 'start-demo.ps1'

function Write-Step { param([string]$Text) Write-Host ' '; Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Text) Write-Host "    [OK] $Text" -ForegroundColor Green }
function Write-Bad  { param([string]$Text) Write-Host "    [!]  $Text" -ForegroundColor Yellow }
function Write-Note { param([string]$Text) Write-Host "    $Text" -ForegroundColor DarkGray }

function Clear-DuplicateProxyEnv {
  # Windows 环境变量不区分大小写，但部分代理软件 / 终端会同时注入
  # HTTPS_PROXY 与 https_proxy（仅大小写不同）。PowerShell 5.1 的 Start-Process
  # 在构建子进程环境字典时会抛「已添加了具有相同键的项」，导致演示服务启动失败。
  # 这里只在当前进程内移除大写变体，不改系统设置；离线演示本身不需要代理。
  foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY')) {
    try { [Environment]::SetEnvironmentVariable($name, $null, 'Process') } catch { }
  }
}

# 必须在任何 Start-Process 之前执行（包括下面的自提权），否则重复键会让启动直接失败
Clear-DuplicateProxyEnv

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-LanIPv4 {
  # 优先取默认路由所在网卡：手机热点 / 教室 WiFi 场景最准确
  try {
    $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
      Sort-Object RouteMetric | Select-Object -First 1
    if ($route) {
      $ip = Get-NetIPAddress -InterfaceIndex $route.ifIndex -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
        Select-Object -First 1 -ExpandProperty IPAddress
      if ($ip) { return @($ip) }
    }
  } catch { }
  $all = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.IPAddress -ne '0.0.0.0' } |
    Select-Object -ExpandProperty IPAddress
  return @($all)
}

function Resolve-TunnelExe {
  param([string]$Kind)
  if ($TunnelExe) {
    if (Test-Path $TunnelExe) { return (Resolve-Path $TunnelExe).Path }
    Write-Bad "指定的隧道客户端不存在：$TunnelExe"
    return $null
  }
  $cmd = Get-Command $Kind -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  Write-Bad "未在 PATH 中找到 $Kind；请用 -TunnelExe 指定客户端绝对路径"
  Write-Note "也可不加 -Tunnel，改用 -PublicUrl 传入已配置的固定公网地址"
  return $null
}

function Get-CpolarDomainFlag {
  param([string]$Url)
  # `cpolar http <port>` 默认分配随机域名。若已配置固定地址，必须把子域名回传给客户端，
  # 否则窗口打印的固定地址与隧道实际地址不一致，答辩现场会打不开。
  if (-not $Url) { return $null }
  try { $hostName = ([Uri]$Url).Host.ToLowerInvariant() } catch { return $null }
  if (-not $hostName -or $hostName -match '^your-|placeholder|^example\.(com|cn|org)$') { return $null }
  if ($hostName -match '\.cpolar\.[a-z]+$') { return '--subdomain=' + ($hostName -split '\.')[0] }
  return '--hostname=' + $hostName
}

function Start-Tunnel {
  param([string]$Exe, [string]$Kind, [int]$LocalPort, [string]$PublicUrl = '')
  $log = Join-Path $env:TEMP ("smart-second-hand-{0}.log" -f $Kind)
  foreach ($f in @($log, "$log.err")) {
    if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
  }
  if ($Kind -eq 'cpolar') {
    $arguments = @('http')
    $flag = Get-CpolarDomainFlag -Url $PublicUrl
    if ($flag) { $arguments += $flag }
    $arguments += "$LocalPort"
  } else {
    # natapp 的本地端口由官网隧道配置决定，需与 $LocalPort 一致
    $arguments = @('-log=stdout', '-loglevel=INFO')
    if ($env:NATAPP_AUTHTOKEN) {
      $arguments = @("-authtoken=$($env:NATAPP_AUTHTOKEN)") + $arguments
    }
  }
  $p = Start-Process -FilePath $Exe -ArgumentList $arguments -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err" -ErrorAction Stop
  return @{ Process = $p; Log = $log }
}

function Read-TunnelUrl {
  param([string]$Log, [string]$Kind, [int]$TimeoutSec = 20)
  # 客户端启动后会把 Forwarding / Tunnel established 地址写到 stdout，
  # 从日志里按域名特征提取，比猜测任何本地管理 API 更可靠。
  for ($i = 0; $i -lt $TimeoutSec; $i++) {
    foreach ($f in @($Log, "$Log.err")) {
      if (-not (Test-Path $f)) { continue }
      $text = Get-Content $f -Raw -ErrorAction SilentlyContinue
      if (-not $text) { continue }
      foreach ($hit in [regex]::Matches($text, 'https://[A-Za-z0-9.-]+')) {
        $value = $hit.Value.TrimEnd('.', '/')
        if ($value -match $Kind) { return $value }
      }
    }
    Start-Sleep -Seconds 1
  }
  return $null
}

function Invoke-ElevatedRelaunch {
  $argStr = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Port $Port"
  if ($AllowPublic) { $argStr += ' -AllowPublic' }
  if ($Tunnel -ne 'none') { $argStr += " -Tunnel $Tunnel" }
  if ($TunnelExe) { $argStr += " -TunnelExe `"$TunnelExe`"" }
  if ($PublicUrl) { $argStr += " -PublicUrl `"$PublicUrl`"" }
  if ($Qr)          { $argStr += ' -Qr' }
  if ($Cleanup)     { $argStr += ' -Cleanup' }
  if ($NoBrowser)   { $argStr += ' -NoBrowser' }
  if ($Rebuild)     { $argStr += ' -Rebuild' }
  if ($Reseed)      { $argStr += ' -Reseed' }
  Write-Host ' '
  Write-Host '  需要管理员权限来创建防火墙规则，正在打开新的提权窗口……' -ForegroundColor Yellow
  Write-Host '  请在新窗口中继续；本窗口可以直接关闭。' -ForegroundColor DarkGray
  Start-Process -FilePath 'powershell.exe' -ArgumentList $argStr -Verb RunAs
}

Write-Host ' '
Write-Host '  ============================================================' -ForegroundColor Yellow
Write-Host '   智能二手交易平台 · 答辩演示启动器' -ForegroundColor Yellow
Write-Host '   单端口同源 / 主链路离线可用 / 无需备案' -ForegroundColor DarkGray
Write-Host '  ============================================================' -ForegroundColor Yellow

# ---------- 权限 ----------
# DryRun 只读，不需要管理员；其余路径都需要。
if (-not $DryRun -and -not (Test-Admin)) {
  Invoke-ElevatedRelaunch
  exit 0
}

if (-not (Test-Path $demoScript)) {
  Write-Host ' '
  Write-Host "  [ERROR] 未找到演示入口：$demoScript" -ForegroundColor Red
  exit 1
}

$profiles = if ($AllowPublic) { @('Domain', 'Private', 'Public') } else { @('Domain', 'Private') }

# ---------- 清理模式 ----------
if ($Cleanup) {
  if ($DryRun) {
    Write-Step 'DryRun：-Cleanup 将删除规则'
    Write-Note "目标规则：$ruleName"
    exit 0
  }
  Write-Step '清理防火墙规则'
  $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if ($existing) {
    Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction Stop
    Write-Ok "已删除规则：$ruleName"
  } else {
    Write-Note "没有找到规则：$ruleName（无需清理）"
  }
  Write-Host ' '
  exit 0
}

# ---------- 防火墙 ----------
Write-Step "放行本机 TCP $Port 入站"
if ($DryRun) {
  Write-Note "[DryRun] 将创建/复用规则 $ruleName，配置文件 $($profiles -join '/')"
} else {
  $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Ok "规则已存在：$ruleName"
    # 旧规则可能只用默认 Domain/Private 创建过；加 -AllowPublic 重跑时补齐配置文件，
    # 否则校园网 / 手机热点被识别为「公用网络」时依然连不上。
    if ($AllowPublic) {
      try {
        Set-NetFirewallRule -DisplayName $ruleName -Profile Domain,Private,Public -ErrorAction Stop | Out-Null
        Write-Ok '已补齐配置文件：Domain/Private/Public'
      } catch {
        Write-Bad "配置文件更新失败：$($_.Exception.Message)"
      }
    }
  } else {
    try {
      New-NetFirewallRule -DisplayName $ruleName `
        -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow `
        -Profile $profiles `
        -Description '答辩局域网演示临时放行；用完执行 -Cleanup 删除' `
        -ErrorAction Stop | Out-Null
      Write-Ok "已放行 TCP $Port（$($profiles -join '/')）"
    } catch {
      Write-Host ' '
      Write-Host "  [ERROR] 防火墙规则创建失败：$($_.Exception.Message)" -ForegroundColor Red
      Write-Host '  可手动在「高级安全 Windows Defender 防火墙」中放行该端口。' -ForegroundColor DarkGray
      exit 1
    }
  }
}

# ---------- 局域网地址 ----------
Write-Step '探测局域网访问地址'
$ips = @(Get-LanIPv4)
if ($ips.Count -eq 0) {
  Write-Bad '未探测到可用的局域网 IPv4，请检查 WiFi / 网线连接'
  $lanUrl = $null
} else {
  $lanUrl = 'http://{0}:{1}' -f $ips[0], $Port
  foreach ($ip in $ips) { Write-Note ('候选地址：http://{0}:{1}' -f $ip, $Port) }
}

# ---------- 避免构建出境外后端地址 ----------
# start-demo.ps1 会在源码比 dist 新时重新构建前端；若当前会话残留 VITE_API_BASE_URL，
# 产物里会注入 Vercel/Railway 后端地址，局域网演示将请求到境外而失败。
if (Test-Path 'Env:\VITE_API_BASE_URL') {
  Remove-Item 'Env:\VITE_API_BASE_URL' -Force
  Write-Note '已清除 VITE_API_BASE_URL（避免前端构建注入境外后端地址）'
}

# ---------- 公网隧道（可选，仅作备用） ----------
$publicUrl = $PublicUrl
if (-not $publicUrl -and $env:DEMO_PUBLIC_URL) { $publicUrl = $env:DEMO_PUBLIC_URL }
if ($publicUrl) { $publicUrl = $publicUrl.TrimEnd('/') }
$tunnelProc = $null
$tunnelLog = $null

if ($Tunnel -ne 'none') {
  Write-Step "启动 $Tunnel 公网隧道（备用链接）"
  $tunnelExePath = Resolve-TunnelExe -Kind $Tunnel
  if ($tunnelExePath) {
    if ($DryRun) {
      Write-Note "[DryRun] 将启动：$tunnelExePath （本地端口 $Port）"
      if ($Tunnel -eq 'cpolar' -and $publicUrl) {
        $flag = Get-CpolarDomainFlag -Url $publicUrl
        if ($flag) { Write-Note "[DryRun] 将附加固定域名参数：$flag" }
      }
      if (-not $publicUrl) { Write-Note '[DryRun] 将尝试从客户端日志提取 https 公网地址' }
    } else {
      try {
        $tunnel = Start-Tunnel -Exe $tunnelExePath -Kind $Tunnel -LocalPort $Port -PublicUrl $publicUrl
        if ($tunnel) {
          $tunnelProc = $tunnel.Process
          $tunnelLog = $tunnel.Log
          if ($publicUrl) {
            Write-Ok "使用固定公网地址：$publicUrl"
          } else {
            $detected = Read-TunnelUrl -Log $tunnelLog -Kind $Tunnel -TimeoutSec 20
            if ($detected) {
              $publicUrl = $detected
              Write-Ok "公网地址：$publicUrl"
            } else {
              Write-Bad '未能自动获取公网地址；请从客户端 / 后台复制后用 -PublicUrl 传入'
              Write-Note "隧道日志：$tunnelLog"
            }
          }
        }
      } catch {
        Write-Bad "隧道启动失败：$($_.Exception.Message)（不影响本机与局域网演示）"
      }
    }
  }
} elseif ($publicUrl) {
  Write-Ok "已配置固定公网地址：$publicUrl"
}

# ---------- 可选二维码 ----------
$qrTarget = if ($publicUrl) { $publicUrl } else { $lanUrl }
if ($Qr -and $qrTarget -and -not $DryRun) {
  $py = Get-Command python -ErrorAction SilentlyContinue
  if ($py) {
    $null = & $py.Source -c 'import qrcode; from PIL import Image' 2>$null
    if ($LASTEXITCODE -eq 0) {
      $qrPath = Join-Path $env:TEMP 'smart-second-hand-demo-qr.png'
      $null = & $py.Source -c 'import sys, qrcode; qrcode.make(sys.argv[1]).save(sys.argv[2])' $qrTarget $qrPath 2>$null
      if (Test-Path $qrPath) {
        Start-Process $qrPath
        Write-Ok "二维码已生成（$qrTarget）：$qrPath"
      }
    } else {
      Write-Bad '未检测到 qrcode/pillow；可执行 pip install "qrcode[pil]" 后重跑（不影响演示）'
    }
  } else {
    Write-Bad '未检测到 Python；二维码为可选功能，不影响演示'
  }
}

# ---------- 输出访问信息 ----------
Write-Host ' '
Write-Host '  ------------------------------------------------------------' -ForegroundColor Yellow
Write-Host "   本机访问：   http://localhost:$Port   ← 答辩主用" -ForegroundColor Green
if ($lanUrl) {
  Write-Host "   教室访问：   $lanUrl" -ForegroundColor Green
} else {
  Write-Host '   教室访问：   未探测到局域网地址' -ForegroundColor Yellow
}
if ($publicUrl) {
  Write-Host "   公网备用：   $publicUrl" -ForegroundColor Green
} else {
  Write-Host '   公网备用：   未启用（-Tunnel 或 -PublicUrl 可开启）' -ForegroundColor DarkGray
}
Write-Host '   演示账号：   admin@example.com / Admin@123456（管理员）' -ForegroundColor Gray
Write-Host '                seller_li@example.com / Seller@123456（卖家）' -ForegroundColor Gray
Write-Host '                zhang@example.com / User@123456（买家）' -ForegroundColor Gray
Write-Host '   AI 模式：    本地规则（AI_MOCK=true），断网可用、不消耗额度' -ForegroundColor Gray
Write-Host '  ------------------------------------------------------------' -ForegroundColor Yellow
Write-Note '公网链接仅作备用：依赖笔记本在线、教室出口网与服务商节点，不要作为唯一演示手段。'
Write-Note '手机/同学设备需与本机连同一 WiFi；校园网若有 AP 隔离，改用手机热点。'
if (-not $AllowPublic) { Write-Note '若无法访问，重跑时加 -AllowPublic（公用网络配置文件）。' }
Write-Note '答辩结束后执行：.\start-defense-demo.bat -Cleanup（或 .\start-lan-demo.bat -Cleanup）'

if ($DryRun) {
  Write-Step 'DryRun 完成：未创建规则、未启动服务、未启动隧道'
  Write-Note "将要启动：scripts\demo\start-demo.ps1 -Port $Port"
  if ($Tunnel -ne 'none') {
    if ($publicUrl) { Write-Note "隧道模式：$Tunnel；固定公网地址：$publicUrl" }
    else { Write-Note "隧道模式：$Tunnel；公网地址将从客户端日志提取" }
  }
  Write-Host ' '
  exit 0
}

# ---------- 启动服务（阻塞，直到 Ctrl+C） ----------
# 隧道已先行启动；本地端口此刻尚未监听，客户端会在服务就绪后自动恢复转发。
Write-Step '启动离线演示服务'
try {
  & $demoScript -Port $Port -NoBrowser:$NoBrowser -Rebuild:$Rebuild -Reseed:$Reseed
} finally {
  if ($tunnelProc -and -not $tunnelProc.HasExited) {
    Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue
    Write-Ok "已停止 $Tunnel 隧道进程"
  }
  if ($tunnelLog) { Write-Note "隧道日志保留在：$tunnelLog" }
  Write-Host ' '
  Write-Note '演示服务已退出。防火墙规则仍在，记得用 -Cleanup 清理。'
}
