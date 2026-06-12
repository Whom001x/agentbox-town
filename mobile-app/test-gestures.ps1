param(
  [string]$Serial = "",
  [string]$OutDir = ".\gesture-shots"
)

$ErrorActionPreference = "Stop"

$adb = Get-Command adb -ErrorAction SilentlyContinue
if (!$adb) {
  $fallback = "C:\Users\Administrator\tools\android-platform-tools\platform-tools\adb.exe"
  if (Test-Path $fallback) {
    $adb = [pscustomobject]@{ Source = $fallback }
  } else {
    throw "adb not found. Install Android platform-tools first."
  }
}

function Invoke-Adb {
  param([string[]]$AdbArgs)
  if ($Serial) {
    & $adb.Source -s $Serial @AdbArgs
  } else {
    & $adb.Source @AdbArgs
  }
}

function Save-Screenshot {
  param([string]$Path)
  $args = @()
  if ($Serial) { $args += @("-s", $Serial) }
  $args += @("exec-out", "screencap", "-p")
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $adb.Source
  $psi.Arguments = ($args | ForEach-Object {
    if ($_ -match "\s") { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join " "
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $process = [System.Diagnostics.Process]::Start($psi)
  $stream = [System.IO.File]::Create($Path)
  try {
    $process.StandardOutput.BaseStream.CopyTo($stream)
  } finally {
    $stream.Dispose()
    $process.WaitForExit()
  }
  if ($process.ExitCode -ne 0) {
    throw "adb screencap failed with exit code $($process.ExitCode)"
  }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$devices = Invoke-Adb @("devices", "-l")
Write-Host $devices
$deviceText = $devices | Out-String
if ($deviceText -notmatch "\sdevice(\s|$)") {
  throw "No authorized Android device. Enable USB debugging or connect with adb pair/connect."
}

Write-Host "Capturing before screenshot..."
Save-Screenshot (Join-Path $OutDir "01-before.png")

Write-Host "Single-finger pan left..."
Invoke-Adb @("shell", "input", "swipe", "1250", "430", "520", "430", "900") | Out-Null
Start-Sleep -Milliseconds 700
Save-Screenshot (Join-Path $OutDir "02-pan-left.png")

Write-Host "Single-finger pan right..."
Invoke-Adb @("shell", "input", "swipe", "520", "430", "1250", "430", "900") | Out-Null
Start-Sleep -Milliseconds 700
Save-Screenshot (Join-Path $OutDir "03-pan-right.png")

Write-Host "Tap zoom buttons as fallback zoom test..."
Invoke-Adb @("shell", "input", "tap", "425", "840") | Out-Null
Start-Sleep -Milliseconds 300
Invoke-Adb @("shell", "input", "tap", "425", "840") | Out-Null
Start-Sleep -Milliseconds 700
Save-Screenshot (Join-Path $OutDir "04-zoom-plus.png")

Write-Host "Attempting two parallel swipes for pinch-out. Device support varies."
Invoke-Adb @("shell", "sh", "-c", "input swipe 900 460 620 460 800 & input swipe 1120 460 1420 460 800 & wait") | Out-Null
Start-Sleep -Milliseconds 900
Save-Screenshot (Join-Path $OutDir "05-pinch-attempt.png")

Write-Host "Done. Screenshots saved to $OutDir"
