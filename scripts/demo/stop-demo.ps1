#Requires -Version 5.1
<#
.SYNOPSIS
  智能二手交易平台 · 停止演示环境

.DESCRIPTION
  正常情况下关闭启动窗口即可自动清理。只有在窗口被强杀、端口仍被占用时才需要本脚本。
  只清理两样东西：占用演示端口的 node 进程、使用演示数据目录的便携 mysqld 进程。
  不会碰本机 MySQL80 服务，也不会碰其他 node 进程。
#>
[CmdletBinding()]
param(
  [int]$Port = 3000
)

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

# 与 start-demo.ps1 保持同一套目录选择逻辑（见该脚本内的说明）
$asciiPattern = '^[\x20-\x7E]+$'
$demoCandidates = @()
if ($env:LOCALAPPDATA) { $demoCandidates += (Join-Path $env:LOCALAPPDATA 'smart-second-hand-demo') }
if ($env:TEMP) { $demoCandidates += (Join-Path $env:TEMP 'smart-second-hand-demo') }
$demoCandidates += (Join-Path $projectRoot '.demo-db')
$demoDir = $demoCandidates | Where-Object { $_ -match $asciiPattern } | Select-Object -First 1
if (-not $demoDir) { $demoDir = $demoCandidates[$demoCandidates.Count - 1] }

$demoData = Join-Path $demoDir 'data'
$stopped = 0
$failed = @()

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# start-demo.ps1 是以管理员权限启动服务的，普通权限的 Stop-Process 会报
# 「Access is denied」。这里先尝试直接停，确实停不掉再自提权重跑一次。
function Stop-DemoProcess {
  param([int]$TargetId, [string]$Label)
  $proc = Get-Process -Id $TargetId -ErrorAction SilentlyContinue
  if (-not $proc) { return $true }
  try {
    Stop-Process -Id $TargetId -Force -ErrorAction Stop
    Write-Host "已停止 $Label（PID $TargetId）" -ForegroundColor Green
    return $true
  } catch {
    Write-Host "无法停止 $Label（PID $TargetId）：$($_.Exception.Message)" -ForegroundColor DarkYellow
    return $false
  }
}

# 1) 占用端口的 node 进程
$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($item in $listeners) {
  $proc = Get-Process -Id $item.OwningProcess -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'node') {
    if (Stop-DemoProcess -TargetId $proc.Id -Label "node 进程（端口 $Port）") {
      $stopped++
    } else {
      $failed += $proc.Id
    }
  }
}

# 2) 演示用便携 mysqld（按命令行里的数据目录匹配，避免误杀本机服务）
$mysqldProcs = Get-CimInstance Win32_Process -Filter "Name = 'mysqld.exe'" -ErrorAction SilentlyContinue
foreach ($p in $mysqldProcs) {
  if ($p.CommandLine -and $p.CommandLine -like "*$demoData*") {
    if (Stop-DemoProcess -TargetId $p.ProcessId -Label '便携 MySQL') {
      $stopped++
    } else {
      $failed += $p.ProcessId
    }
  }
}

# 3) 有进程停不掉：自提权重跑（服务是管理员权限启动的，普通权限杀不掉）
if ($failed.Count -gt 0 -and -not (Test-Admin)) {
  $idList = $failed -join ','
  Write-Host ''
  Write-Host "  需要管理员权限才能停止这些进程（PID $idList）。" -ForegroundColor Yellow
  Write-Host '  正在打开提权窗口，请在新窗口点「是」……' -ForegroundColor Yellow
  $argStr = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Port $Port"
  try {
    Start-Process -FilePath 'powershell.exe' -ArgumentList $argStr -Verb RunAs -Wait -ErrorAction Stop
    Write-Host '  提权窗口已结束，请重新运行一次本脚本确认端口已释放。' -ForegroundColor Green
  } catch {
    Write-Host '  提权被取消或失败。请右键「以管理员身份运行」后重试。' -ForegroundColor Red
  }
  exit 0
}

if ($stopped -eq 0 -and $failed.Count -eq 0) {
  Write-Host '没有发现需要停止的演示进程' -ForegroundColor Yellow
} elseif ($failed.Count -gt 0) {
  Write-Host "仍有 $($failed.Count) 个进程未能停止（PID $($failed -join ',')），请以管理员身份运行本脚本。" -ForegroundColor Red
  exit 1
} else {
  Write-Host "共清理 $stopped 个进程" -ForegroundColor Green
}
