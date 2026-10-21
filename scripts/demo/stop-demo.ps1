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

# 1) 占用端口的 node 进程
$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($item in $listeners) {
  $proc = Get-Process -Id $item.OwningProcess -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'node') {
    Stop-Process -Id $proc.Id -Force
    Write-Host "已停止 node 进程（端口 $Port，PID $($proc.Id)）" -ForegroundColor Green
    $stopped++
  }
}

# 2) 演示用便携 mysqld（按命令行里的数据目录匹配，避免误杀本机服务）
$mysqldProcs = Get-CimInstance Win32_Process -Filter "Name = 'mysqld.exe'" -ErrorAction SilentlyContinue
foreach ($p in $mysqldProcs) {
  if ($p.CommandLine -and $p.CommandLine -like "*$demoData*") {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "已停止便携 MySQL（PID $($p.ProcessId)）" -ForegroundColor Green
    $stopped++
  }
}

if ($stopped -eq 0) {
  Write-Host '没有发现需要停止的演示进程' -ForegroundColor Yellow
} else {
  Write-Host "共清理 $stopped 个进程" -ForegroundColor Green
}
