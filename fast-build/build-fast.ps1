<#
  Goat Browser - Thorium-style fast Chromium build (Windows x64).

  Builds Electron (Chromium inside) from source with:
    - is_official_build + ThinLTO (Electron release config)
    - AVX2 / FMA / BMI2 code generation (the main Thorium speed-up)
    - no debug symbols (smaller, faster build)
  Then packages Goat Browser with that engine.

  NEEDS: ~120 GB free, 32 GB RAM recommended (16 GB works, slower), 4-10 hours.
  A CPU with AVX2 (Intel Haswell 2013+ / AMD Zen 2017+). The result will NOT
  start on CPUs without AVX2.

  RUN (PowerShell, normal user, NOT admin):
    Set-ExecutionPolicy -Scope Process Bypass
    & "D:\claude d drive\goat\fast-build\build-fast.ps1"

  Re-running is safe: finished steps are skipped.
  This script is untested on your machine. If a step fails, it stops and says which.
#>
param(
  # Chromium cannot build in a path with spaces, so the source tree lives here.
  [string]$Root = "D:\gb",
  [string]$ElectronTag = "v45.2.3",
  [ValidateSet("avx2", "avx", "sse4")] [string]$Cpu = "avx2",
  [string]$GoatDir = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = "Stop"
function Step($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host "`nFAILED: $t" -ForegroundColor Red; exit 1 }

if ($Root -match " ") { Fail "-Root must not contain spaces (Chromium build limitation). Got: $Root" }

# ------------------------------------------------------------------ checks
Step "Checking prerequisites"
foreach ($cmd in "git", "python", "node", "npm") {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "$cmd not found on PATH. Install it first (see README.md)." }
}
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) { Fail "Visual Studio 2022 not found. Install it with 'Desktop development with C++' (see README.md)." }
$vs = & $vswhere -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { Fail "Visual Studio is missing the C++ x64 tools. Add 'Desktop development with C++'." }
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\Include" -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
if (-not $sdk) { Fail "Windows 10/11 SDK not found. Add it in the Visual Studio installer." }
if (-not (Test-Path "${env:ProgramFiles(x86)}\Windows Kits\10\Debuggers\x64\dbghelp.dll")) {
  Fail "SDK 'Debugging Tools for Windows' missing. Settings > Apps > Windows Software Development Kit > Modify > tick Debugging Tools."
}
$drive = (Split-Path -Qualifier $Root).TrimEnd(":")
$free = (Get-PSDrive $drive).Free / 1GB
if ($free -lt 110) { Fail ("Only {0:N0} GB free on {1}:, need ~120 GB." -f $free, $drive) }
Write-Host ("OK: VS at $vs, SDK $($sdk.Name), {0:N0} GB free" -f $free)

$flags = @{
  avx2 = @("/clang:-mavx2", "/clang:-mfma", "/clang:-mbmi2", "/clang:-mf16c", "/clang:-mlzcnt");
  avx  = @("/clang:-mavx");
  sse4 = @("/clang:-msse4.2");
}[$Cpu]
$rustFeat = @{ avx2 = "+avx2,+fma,+bmi2,+f16c,+lzcnt"; avx = "+avx"; sse4 = "+sse4.2" }[$Cpu]

git config --global core.longpaths true
$env:DEPOT_TOOLS_WIN_TOOLCHAIN = "0"
$env:GYP_MSVS_VERSION = "2022"

# --------------------------------------------------------------- build-tools
Step "Installing Electron build-tools"
if (-not (Get-Command e -ErrorAction SilentlyContinue)) { npm install -g @electron/build-tools; if ($LASTEXITCODE) { Fail "npm install @electron/build-tools" } }

$cfgDir = Join-Path $env:USERPROFILE ".electron_build_tools\configs"
$cfg = Join-Path $cfgDir "evm.goat.json"
if (-not (Test-Path $cfg)) {
  Step "Creating build config at $Root (first sync downloads ~30 GB, can take 1-2 hours)"
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  e init goat --root="$Root" --import release --use-https
  if ($LASTEXITCODE) { Fail "e init" }
}
e use goat | Out-Null

# Add Thorium-style GN args (idempotent).
$json = Get-Content $cfg -Raw | ConvertFrom-Json
$want = @("symbol_level = 0", "blink_symbol_level = 0", "v8_symbol_level = 0", "enable_nacl = false",
          "use_thin_lto = true", "is_official_build = true", "chrome_pgo_phase = 0")
$gnArgs = [System.Collections.ArrayList]@($json.gen.args)
foreach ($a in $want) { if ($gnArgs -notcontains $a) { [void]$gnArgs.Add($a) } }
$json.gen.args = $gnArgs
$json | ConvertTo-Json -Depth 20 | Set-Content $cfg -Encoding UTF8

# -------------------------------------------------------------------- source
if (-not (Test-Path "$Root\src\electron\.git")) {
  Step "Downloading Chromium + Electron source (long)"
  e sync
  if ($LASTEXITCODE) { Fail "e sync (first)" }
}
Step "Checking out Electron $ElectronTag"
Push-Location "$Root\src\electron"
git fetch --tags origin
git checkout -f $ElectronTag
if ($LASTEXITCODE) { Pop-Location; Fail "git checkout $ElectronTag" }
Pop-Location
e sync
if ($LASTEXITCODE) { Fail "e sync ($ElectronTag)" }

# ------------------------------------------------------- CPU-tuned compile
Step "Patching compiler flags for $Cpu"
$gn = "$Root\src\build\config\compiler\BUILD.gn"
$src = Get-Content $gn -Raw
$marker = "# goat-fast-build"
if ($src -notmatch [regex]::Escape($marker)) {
  $flagList = ($flags | ForEach-Object { "`"$_`"" }) -join ", "
  $block = @"

  $marker
  if (is_win && current_cpu == "x64") {
    cflags += [ $flagList ]
    rustflags += [ "-Ctarget-feature=$rustFeat" ]
  }
"@
  $re = [regex]'config\("compiler"\) \{\r?\n(?:[ ]+\w+ = \[\]\r?\n)+'
  if (-not $re.IsMatch($src)) { Fail "Could not find config(""compiler"") in BUILD.gn. Chromium layout changed; patch by hand." }
  $src = $re.Replace($src, { param($m) $m.Value + $block }, 1)
  Set-Content $gn $src -NoNewline -Encoding UTF8
  Write-Host "Patched $gn"
} else { Write-Host "Already patched" }

# --------------------------------------------------------------------- build
Step "Building Electron (4-10 hours). Close heavy apps. Progress shows [done/total]."
e build electron:electron_dist_zip
if ($LASTEXITCODE) { Fail "e build. Re-run the script to resume where it stopped." }

$zip = "$Root\src\out\Release\dist.zip"
if (-not (Test-Path $zip)) { Fail "Build finished but $zip is missing." }

# ------------------------------------------------------------------ package
Step "Packaging Goat Browser with the fast engine"
$zipDir = Join-Path $GoatDir "fast-build\engine"
New-Item -ItemType Directory -Force -Path $zipDir | Out-Null
$ver = $ElectronTag.TrimStart("v")
Copy-Item $zip (Join-Path $zipDir "electron-v$ver-win32-x64.zip") -Force
Push-Location $GoatDir
if (-not (Test-Path node_modules)) { npm install; if ($LASTEXITCODE) { Pop-Location; Fail "npm install" } }
npx electron-packager . "Goat Browser" --platform=win32 --arch=x64 --out=dist-fast --overwrite --asar `
  --icon=build/icon.ico --ignore=^/dist --ignore=^/build --ignore=^/fast-build --executable-name=GoatBrowser `
  --electron-version=$ver --electron-zip-dir="$zipDir"
if ($LASTEXITCODE) { Pop-Location; Fail "electron-packager" }
Pop-Location

Step "Done"
Write-Host "Fast build: $GoatDir\dist-fast\Goat Browser-win32-x64\GoatBrowser.exe" -ForegroundColor Green
Write-Host "Source tree kept at $Root (delete it to free ~100 GB; keep it to rebuild faster)."
