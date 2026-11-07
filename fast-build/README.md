# Fast build (Thorium-style)

`build-fast.ps1` compiles Chromium (inside Electron) for your CPU, then packages Goat Browser with it. This is what makes Thorium fast: AVX2/FMA code generation plus official-build optimizations (ThinLTO). Expect roughly 5–15% faster JavaScript and rendering than the normal build.

## You need

- A CPU with AVX2 (Intel 2013+, AMD Ryzen). Check: run `coreinfo` or look up your CPU model.
- About 120 GB free on D:, 16–32 GB RAM, and 4–10 hours.
- **Visual Studio 2022** (Community is free) with the "Desktop development with C++" workload, plus the "Windows 11 SDK" component.
- **Windows SDK Debugging Tools**: Settings → Apps → "Windows Software Development Kit" → Modify → tick "Debugging Tools for Windows".
- **Git**, **Python 3**, **Node.js 22+** on PATH.

## Run

Open PowerShell (not as admin):

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& "D:\claude d drive\goat\fast-build\build-fast.ps1"
```

Options:

- `-Root D:\gb`: where the ~100 GB Chromium source tree goes. The path must have no spaces.
- `-Cpu avx2|avx|sse4`: pick `avx` or `sse4` for older CPUs.

When it finishes, the fast browser is in `dist-fast\Goat Browser-win32-x64\GoatBrowser.exe`. If a step fails, the script says which; fix that and re-run. Finished steps are skipped, and the build resumes where it stopped.

Tip: add `D:\gb` to Windows Defender exclusions first. Scanning slows the build a lot.

## Status

This script hasn't been run on your PC yet. Chromium's build changes often, so the compiler-flag patch step may need adjusting for newer versions.
