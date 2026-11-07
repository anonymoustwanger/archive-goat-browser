# Goat Browser

A private, fast browser built on Chromium 156 via Electron 45.

**What it's built on:** Electron bundles Chromium (Chrome's open-source engine: Blink for rendering, V8 for JavaScript) plus Node.js. Goat's own code is the toolbar, tabs, folders, settings, ad blocker wiring and privacy rules. Google's services (sync, Safe Browsing, telemetry) are not included.

**app.asar:** in `dist\Goat Browser-win32-x64\resources\`. It's an archive of Goat's code (`src\` plus `node_modules`) that Electron reads at startup. `GoatBrowser.exe` and the DLLs are the Chromium/Electron engine. Updating Goat usually only means replacing `app.asar`.

## Run

- **Ready-made:** `dist\Goat Browser-win32-x64\GoatBrowser.exe`. Windows SmartScreen may warn because the exe is unsigned: choose "More info", then "Run anyway".
- **From source:** `npm install`, then `npm start`. Repackage with `npm run package:win`.
- **Thorium-style fast build:** see `fast-build\README.md`.

Your profile (cookies, settings, open tabs, blocklists) lives in `%APPDATA%\Goat Browser`.

## Features

- **Ad blocker.** Ghostery engine with network and cosmetic filtering. Three levels: Ads only, Standard (ads + trackers), Strict (adds cookie banners and annoyances). Supports custom filter rules and a per-site allowlist. Click the shield in the toolbar for the Goat Shield panel: blocked count, per-site switch, level picker (Ads / Standard / Strict), and links to allowed sites and custom filters.
- **Extensions menu.** New extensions start unpinned, like Chrome. The puzzle button in the toolbar lists your extensions: click one to open it, pin or unpin it from the toolbar (also: right-click a toolbar button, or the Toolbar switch in Settings → Extensions), open its options, or manage extensions.
- **Extension compatibility.** Native messaging works with desktop apps like iCloud Passwords, 1Password and Bitwarden (hosts registered for Chrome, Edge, Chromium or Brave are found). `chrome.privacy`, `chrome.declarativeContent` and `chrome.sidePanel` have safe stand-ins. Patches live in `scripts/patch-extensions.js` and are applied on `npm install`.
- **Extensions.** Install from the Chrome Web Store (Settings → Extensions → "Get extensions"), or load an unpacked folder. Extension buttons sit next to the shield. Most extensions work; a few Chrome APIs (like `chrome.commands`) are missing. Powered by electron-chrome-extensions.
- **Cookies persist.** Logins survive restarts. Third-party cookies are blocked (toggle in Settings). Optional "delete cookies on exit".
- **Cookie manager.** Settings → Cookies. Search, view, edit values, delete a cookie, a whole site, or everything.
- **Proxy.** System, none, manual (HTTP / HTTPS / SOCKS4 / SOCKS5, with bypass list and HTTP proxy login), or PAC URL.
- **Folders (tab groups).** Drag a tab onto the middle of another tab to make a folder. Drop more tabs on a folder or its tabs to add them. Drop on a tab's edge to reorder instead. Click a folder to open or close it, double-click to rename, right-click for color, ungroup, or close. Drag a folder to move it with all its tabs. Folders are restored on restart.
- **Themes.** Settings → Appearance: Goat (default, dark with a hot-pink #ff0064 accent), System, Midnight (the original green), Daylight, Forest, Ocean, Sunset, Grape, Mono, Paper, plus your own. "Create theme" lets you pick five colors with a live preview and a contrast check. Gradients can be turned off. Websites follow the theme's dark or light mode.
- **Home page bookmarks.** Your bookmarks show as tiles on the new tab page. Click **+ Add** to add one, hover a tile and click × to remove it, click a folder tile to open it there.
- **Bookmarks bar.** Click the ☆ in the address bar (or `Ctrl+D`) to bookmark a page. Drag a tab onto the bar to bookmark it. Drag bookmarks to reorder, or onto a folder to file them. Right-click for rename, delete, new folder, or to hide the bar (`Ctrl+Shift+B`). Middle-click opens in a new tab.
- **Title bar.** No separate title bar: minimize, maximize and close sit at the right end of the tab strip and follow the theme. Drag empty tab-strip space to move the window.
- **Animations.** Tabs, folders, toasts, loading bar and pages animate. Settings → Appearance → Animations: Follow system, On, or Off.
- **Private tabs.** `Ctrl+Shift+N`, right-click the + button, or right-click a link. Private tabs share an in-memory session (cookies, storage, cache) that is wiped when the last private tab closes; they're never saved or restored, and extensions don't run in them. Marked with a mask icon and a "Private" badge.
- **Passkeys and security keys.** Settings → Privacy. "Ask first" (default) stops sites from popping up the Windows security-key dialog by themselves and asks before a site can open it. Also "Allow" and "Block".
- **Fingerprint protection.** Standard: common hardware/GPU values, exact OS/CPU client hints stripped, no Battery API. Strict: plus per-site canvas and audio noise. Settings → Privacy.
- **Link cleaning.** Tracking tags (utm_*, fbclid, gclid, msclkid, YouTube/Spotify `si`, and more) are removed from addresses you open.
- **Privacy Sandbox off.** Topics, Protected Audience (FLEDGE), Attribution Reporting and Shared Storage are disabled.
- **Speed.** Background new-tab pages give their memory back after 5 seconds (each costs ~100 MB). Memory saver ends the process of idle background tabs, like Chrome's tab discarding, and reloads them when opened (Settings → Privacy → Performance). Restored tabs load only when opened, so startup is fast. When Windows is low on memory, idle tabs sleep after 5 minutes. Settings → Privacy → Performance shows memory per tab, with Sleep and Close buttons. Connections are warmed up when you focus the address bar or hover a bookmark.
- **Encrypted DNS.** Settings → General: Quad9 (default), Mullvad, Mullvad/AdGuard with ad blocking, Cloudflare, Google, NextDNS, a custom DoH address, or off. Shows whether it's working and warns when a proxy or VPN is doing the lookups instead.
- **Privacy.** DNS over HTTPS, HTTPS-only mode, WebRTC IP-leak protection, generic Chrome user agent, `Sec-GPC` and `DNT` headers, no telemetry, sync, or Google services. Camera, mic, location and notifications always ask.
- **Search.** DuckDuckGo by default, switchable to Brave, Startpage, Google, or Bing.

## Shortcuts

`Ctrl+T` new tab · `Ctrl+Shift+N` private tab · `Ctrl+W` close · `Ctrl+L` address bar · `Ctrl+Tab` / `Ctrl+Shift+Tab` switch · `Ctrl+1…9` jump · `Ctrl+R` / `F5` reload · `Alt+←/→` back/forward · `Ctrl+F` find · `Ctrl+ +/−/0` zoom · `Ctrl+,` settings · `Ctrl+D` bookmark · `Ctrl+Shift+B` bookmarks bar · `Ctrl+Shift+Del` clear data · `F11` fullscreen · `F12` devtools.

## Limits

- Not anonymity. Your ISP still sees which IPs and hostnames (TLS SNI) you connect to. Use a VPN or Tor for that.
- No extensions, bookmarks, history list, or saved passwords yet.
- Chromium can't log in to SOCKS5 proxies that need a password. Use an HTTP(S) proxy for those.

## Testing speed

Goat uses the same engine as Chrome of the same version, so JavaScript and rendering scores should match Chrome. Compare on [browserbench.org](https://browserbench.org/):

- [Speedometer 3.1](https://browserbench.org/Speedometer3.1/): how fast web apps respond. The most useful single number.
- [JetStream 3.0](https://browserbench.org/JetStream3.0/): JavaScript and WebAssembly speed.
- [MotionMark 1.3.2](https://browserbench.org/MotionMark1.3.2/): graphics and animation.

For a fair test: plug in your laptop, close other apps, use one tab, pause the ad blocker (shield → off) and disable extensions, then run each test 3 times in Goat and in Chrome or Edge and compare the middle score. Goat's real-world advantage is on ad-heavy sites, where blocking makes pages load faster and use less memory; benchmarks don't measure that.
