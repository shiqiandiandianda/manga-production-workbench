param([Parameter(Mandatory=$true)][string]$ImagePath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$timer = [Diagnostics.Stopwatch]::StartNew()
$failureCode = 'unavailable'
$bitmap = $null
$stream = $null
try {
    if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'Windows PowerShell 5 is required for local OCR.' }
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $storageFile = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
    $fileMode = [Windows.Storage.FileAccessMode,Windows.Storage,ContentType=WindowsRuntime]
    $randomStream = [Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
    $bitmapDecoder = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
    $softwareBitmap = [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
    $pixelFormat = [Windows.Graphics.Imaging.BitmapPixelFormat,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
    $alphaMode = [Windows.Graphics.Imaging.BitmapAlphaMode,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
    $ocrEngine = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
    $ocrResult = [Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
    $languageType = [Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
    $asyncTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
        $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    if (!$asyncTask) { throw 'The Windows Runtime async bridge is unavailable.' }
    function Wait-WinRT($Operation, [Type]$ResultType) {
        $task = $asyncTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
        return $task.GetAwaiter().GetResult()
    }
    $language = [Activator]::CreateInstance($languageType, @('zh-Hans-CN'))
    if (!$ocrEngine::IsLanguageSupported($language)) { throw 'The local zh-Hans-CN OCR language pack is not installed.' }
    $engine = $ocrEngine::TryCreateFromLanguage($language)
    if (!$engine) { throw 'The local zh-Hans-CN OCR engine could not be created.' }
    $failureCode = 'failed'
    $file = Wait-WinRT ($storageFile::GetFileFromPathAsync($ImagePath)) $storageFile
    $stream = Wait-WinRT ($file.OpenAsync($fileMode::Read)) $randomStream
    $decoder = Wait-WinRT ($bitmapDecoder::CreateAsync($stream)) $bitmapDecoder
    $bitmap = Wait-WinRT ($decoder.GetSoftwareBitmapAsync($pixelFormat::Bgra8, $alphaMode::Ignore)) $softwareBitmap
    if ($bitmap.PixelWidth -gt $ocrEngine::MaxImageDimension -or $bitmap.PixelHeight -gt $ocrEngine::MaxImageDimension) {
        throw 'The image exceeds the local OCR MaxImageDimension.'
    }
    # Exactly one OCR invocation; never request a user-language or cloud fallback.
    $result = Wait-WinRT ($engine.RecognizeAsync($bitmap)) $ocrResult
    $lines = @($result.Lines | ForEach-Object {
        [ordered]@{
            text = [string]$_.Text
            words = @($_.Words | ForEach-Object {
                [ordered]@{
                    text = [string]$_.Text
                    box = @([double]$_.BoundingRect.X, [double]$_.BoundingRect.Y,
                            [double]$_.BoundingRect.Width, [double]$_.BoundingRect.Height)
                }
            })
        }
    })
    $timer.Stop()
    $output = [ordered]@{
        engine = 'Windows.Media.Ocr'
        language = 'zh-Hans-CN'
        width = [int]$bitmap.PixelWidth
        height = [int]$bitmap.PixelHeight
        text = [string]$result.Text
        lines = $lines
        durationMs = [Math]::Round($timer.Elapsed.TotalMilliseconds, 2)
    }
    [Console]::Out.WriteLine(($output | ConvertTo-Json -Depth 8 -Compress))
} catch {
    $errorOutput = @{error = @{code = $failureCode; message = $_.Exception.Message}}
    [Console]::Error.WriteLine(($errorOutput | ConvertTo-Json -Depth 4 -Compress))
    if ($failureCode -eq 'unavailable') { exit 2 }
    exit 1
} finally {
    if ($bitmap) { $bitmap.Dispose() }
    if ($stream) { $stream.Dispose() }
}
