# Goat Browser 5 (Chromium)

Goat 5 is real Chromium (ungoogled-chromium 157), not Electron, so every Chrome extension works the same as in Chrome: Proton VPN, iCloud Passwords, password managers, everything.

## What's in it

- **Goat branding:** name, icons, its own install folder (`%LOCALAPPDATA%\Goat Browser`) and taskbar identity.
- **Privacy:** no Google services (ungoogled-chromium), third-party cookies blocked, HTTPS-only, fingerprint noise (canvas, layout, text, WebGL), no link pings.
- **Ad blocker:** uBlock Origin Lite, built in.
- **Goat button** (the goat in the toolbar):
  - Tor on/off for normal windows.
  - **New Tor window:** a separate window that always uses Tor and is deleted when closed.
  - New circuit, translate page, private window and settings.
- **Translation:** LibreTranslate by default, or Google. Optional offer or auto-translate. Shortcut Alt+Shift+T.
- **Privacy profiles:** Fastest / Balanced / Most private, plus single switches.
- **Update checker:** checks GitHub releases twice a day.
- **Chromium itself:** profiles (each its own taskbar window), tab groups (folders), private windows, themes and the Web Store.
- **Installer** with a setup screen. Uninstall from Windows Settings → Apps, or Goat settings → Uninstall.
- **Linux:** `GoatBrowser-<version>-x86_64.AppImage` with the same features. Your profile is in `~/.config/goat-browser`.

## How it's built (GitHub does it all)

1. **Chromium base:** Actions → "Chromium base" → Run workflow. For Linux, also run "Chromium base (Linux)"; both can run at the same time. It compiles Goat's Chromium in stages and takes about a day. When done it publishes a pre-release named `base-<version>`. This is only needed again for a new Chromium version or when `patches/`, `brand.py` or `hook.py` change.
2. **Goat release:** push a tag like `v5.0.0` (GitHub Desktop: History → right-click the commit → Create Tag, then Push). This takes about 10 minutes. It publishes `GoatBrowserSetup-5.0.0.exe` and `GoatBrowser-5.0.0-x86_64.AppImage` as the latest release.

The repository must be public, because private repositories don't get enough free build minutes.

## Files

| Path | What |
| -- | -- |
| `patches/goat-default-switches.patch` | Small C++ change. At startup Goat reads `goat\switches.txt` and `goat\settings.switches`, which load the built-in extensions and apply the privacy switches. |
| `brand.py` | Renames Chromium to Goat Browser in names, strings (translations kept) and icons. |
| `hook.py`, `hook_linux.py` | Add the patch and `brand.py` to the ungoogled-chromium Windows and Linux builds. |
| `extension/` | The Goat extension: toolbar button, settings page, new tab page, Tor window page. |
| `host/goat-host.py` | The same helper for Linux. |
| `linux/` | The AppImage launcher, desktop entry and startup switches. |
| `host/GoatHost.cs` | goat-host.exe, which runs Tor, opens Tor windows, saves startup switches and starts the uninstaller. |
| `scripts/fetch-tor.sh` | Downloads the Tor Expert Bundle and checks its signature. |
| `installer/goat-setup.nsi` | The setup screen. It runs Chromium's installer, then adds `goat\`. |
| `switches.txt`, `settings.switches`, `initial_preferences`, `host-manifest.json` | Shipped settings. |

## Install layout

```
%LOCALAPPDATA%\Goat Browser\Application\chrome.exe
%LOCALAPPDATA%\Goat Browser\Application\goat\   ext\goat, ext\ubol, tor\, goat-host.exe, *.switches
%LOCALAPPDATA%\Goat Browser\User Data\          your profiles
%LOCALAPPDATA%\Goat Browser\Tor\                Tor's state and logs
```
