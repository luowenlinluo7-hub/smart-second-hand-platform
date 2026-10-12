# 生成演示占位图（本地绘制，不依赖外网素材，保证断网可显示）
# 用法: powershell -File scripts/demo/make-placeholders.ps1
Add-Type -AssemblyName System.Drawing

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$out = Join-Path $root 'client\public\demo'
New-Item -ItemType Directory -Force -Path $out | Out-Null

# 暖橙主色系 + 辅助色，呼应前端设计规范的主色 #ff6b35
$palette = @(
  '#ff6b35', '#f7931e', '#e8833a', '#d97742',
  '#4a90d9', '#3d7ebd', '#50b68a', '#3f9e77',
  '#9b59b6', '#e74c3c', '#16a085', '#c0392b'
)

$font = New-Object System.Drawing.Font('Microsoft YaHei', 34, [System.Drawing.FontStyle]::Bold)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0, 0, 640, 480)
$softBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(38, 255, 255, 255))

for ($i = 0; $i -lt $palette.Count; $i++) {
  $n = $i + 1
  $bmp = New-Object System.Drawing.Bitmap(640, 480)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

  $g.Clear([System.Drawing.ColorTranslator]::FromHtml($palette[$i]))

  # 右下角淡色圆形装饰，避免整图过于单调
  $g.FillEllipse($softBrush, 340, 220, 440, 440)

  $g.DrawString("商品演示图 $n", $font, [System.Drawing.Brushes]::White, $rect, $fmt)

  $file = Join-Path $out "p$n.jpg"
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $g.Dispose()
  $bmp.Dispose()
}

$font.Dispose()
$fmt.Dispose()
$softBrush.Dispose()

$files = Get-ChildItem $out -Filter 'p*.jpg'
$size = [math]::Round((($files | Measure-Object Length -Sum).Sum) / 1KB, 1)
Write-Output ("已生成 " + $files.Count + " 张占位图，共 " + $size + " KB -> " + $out)
