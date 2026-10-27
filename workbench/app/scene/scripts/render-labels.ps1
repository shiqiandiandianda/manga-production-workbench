param([Parameter(Mandatory=$true)][string]$InputFile,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$labelSpec=Get-Content -LiteralPath $InputFile -Raw -Encoding UTF8 | ConvertFrom-Json
$labelSize=[single]$labelSpec.fontSize
$labelFont=[Drawing.Font]::new('Microsoft YaHei',$labelSize,[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Pixel)
$labelFormat=[Drawing.StringFormat]::new()
$labelFormat.FormatFlags=[Drawing.StringFormatFlags]::LineLimit
$labelBrush=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(190,15,23,18))
try {
  for($labelIndex=0;$labelIndex -lt $labelSpec.labels.Count;$labelIndex++){
    $labelText=[string]$labelSpec.labels[$labelIndex]
    $labelMeasureBitmap=[Drawing.Bitmap]::new(1,1)
    $labelMeasureGraphics=[Drawing.Graphics]::FromImage($labelMeasureBitmap)
    $labelTextWidth=[int]$labelSpec.maxWidth-24
    $labelMeasured=$labelMeasureGraphics.MeasureString($labelText,$labelFont,$labelTextWidth,$labelFormat)
    $labelMeasureGraphics.Dispose()
    $labelMeasureBitmap.Dispose()
    $labelWidth=[Math]::Min([int]$labelSpec.maxWidth,[int][Math]::Ceiling($labelMeasured.Width)+24)
    $labelHeight=[int][Math]::Ceiling($labelMeasured.Height)+16
    $labelBitmap=[Drawing.Bitmap]::new($labelWidth,$labelHeight,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $labelGraphics=[Drawing.Graphics]::FromImage($labelBitmap)
    try {
      $labelGraphics.Clear([Drawing.Color]::Transparent)
      $labelGraphics.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit
      $labelGraphics.FillRectangle($labelBrush,0,0,$labelWidth,$labelHeight)
      $labelRectangle=[Drawing.RectangleF]::new(12,8,$labelWidth-24,$labelHeight-16)
      $labelGraphics.DrawString($labelText,$labelFont,[Drawing.Brushes]::White,$labelRectangle,$labelFormat)
      $labelBitmap.Save((Join-Path $OutputDirectory ('label-'+$labelIndex+'.png')),[Drawing.Imaging.ImageFormat]::Png)
    } finally {$labelGraphics.Dispose();$labelBitmap.Dispose()}
  }
} finally {$labelFont.Dispose();$labelFormat.Dispose();$labelBrush.Dispose()}
