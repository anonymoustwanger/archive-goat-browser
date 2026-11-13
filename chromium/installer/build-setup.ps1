# Builds GoatBrowserSetup.exe (the installer with the version list) on Windows.
# Usage: pwsh chromium/installer/build-setup.ps1 -Out <folder>
param([Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebView2Version = '1.0.2903.40'

# WebView2 SDK (only its DLLs are embedded; the browser part comes with Windows)
$pkg = Join-Path $env:RUNNER_TEMP "webview2"
if (-not (Test-Path "$pkg\lib")) {
  New-Item -ItemType Directory -Force $pkg | Out-Null
  Invoke-WebRequest "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$WebView2Version" -OutFile "$pkg\wv2.zip"
  Expand-Archive "$pkg\wv2.zip" "$pkg\nupkg" -Force
  New-Item -ItemType Directory -Force "$pkg\lib" | Out-Null
  $netlib = Get-ChildItem "$pkg\nupkg\lib" -Directory | Where-Object { $_.Name -like 'net4*' } | Sort-Object Name | Select-Object -Last 1
  Copy-Item "$($netlib.FullName)\Microsoft.Web.WebView2.Core.dll", "$($netlib.FullName)\Microsoft.Web.WebView2.WinForms.dll" "$pkg\lib\"
  Copy-Item "$pkg\nupkg\runtimes\win-x64\native\WebView2Loader.dll" "$pkg\lib\"
}

$res = @()
foreach ($f in Get-ChildItem "$here\ui" -File) { $res += "/resource:$($f.FullName),ui/$($f.Name)" }
foreach ($f in Get-ChildItem "$pkg\lib" -File) { $res += "/resource:$($f.FullName),lib/$($f.Name)" }

New-Item -ItemType Directory -Force $Out | Out-Null
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /langversion:5 /platform:x64 /target:winexe /optimize+ "/win32icon:$here\goat.ico" `
  "/out:$Out\GoatBrowserSetup.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll `
  "/r:$pkg\lib\Microsoft.Web.WebView2.Core.dll" "/r:$pkg\lib\Microsoft.Web.WebView2.WinForms.dll" `
  @res "$here\GoatSetup.cs"
if ($LASTEXITCODE -ne 0) { throw "csc failed" }
Get-Item "$Out\GoatBrowserSetup.exe" | Format-List Name, Length
