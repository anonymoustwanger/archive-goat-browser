# Goat Browser: notes for Claude Code

Private, fast desktop browser for Windows built on Electron 45 (Chromium 156). Owner runs it from
`dist\Goat Browser-win32-x64\GoatBrowser.exe`. Current version: see `package.json`.

## Working with the owner
- Keep replies short: answer or next action first, no recap. Go longer only when asked to explain.
- Owner is not a developer. Give click-by-click steps, not jargon. Say what was tested and what wasn't.
- After a change, rebuild and tell them to fully close and reopen Goat.

## Commands
- `npm install`: installs deps and runs `scripts/patch-extensions.js` (postinstall). Required before anything else.
- `npm start`: build the toolbar preload bundle, then run Goat from source.
- `npm run build`: re-apply library patches + bundle `src/ui/preload.js` to `src/ui/preload.bundle.js` (esbuild).
- `npm run package:win`: build and package to `dist\Goat Browser-win32-x64\`. Updating an existing install
  usually only needs the new `resources\app.asar` copied over.
- `fast-build\build-fast.ps1`: Thorium-style AVX2/ThinLTO Electron build (untested, ~120 GB, hours).

## Layout
- `src/main.js`: everything in the main process. Sections are marked with `// ---- name` banners:
  settings (defaults + validation in `applySettings`), web requests (HTTPS-only, tracking-param strip,
  3rd-party cookie block, client-hint strip), ad blocker (Ghostery, levels ads/standard/strict, allowlist,
  custom rules), appearance/themes (built-in `THEMES` + custom themes from 5 colors), DNS (`DNS_PROVIDERS`,
  `applyDns`, `dnsStatus`), proxy, permissions, tabs (lazy restore, discard via `forcefullyCrashRenderer`,
  memory saver, new-tab pages discarded after 5 s in background), tab groups ("folders"), bookmarks
  (`bookmarks.json`), memory/task list, fingerprint seed, extensions (electron-chrome-extensions +
  Chrome Web Store, pin list `settings.extensions.pinned`), popover panels (ad blocker panel, extensions
  menu), window (frameless, `titleBarOverlay` controls in the tab strip), lifecycle.
- `src/ui/`: toolbar (tabs, folders, address bar, bookmarks bar). `ui.js` talks to main via `window.goat`.
  `preload.js` is bundled (it imports `electron-chrome-extensions/browser-action`).
- `src/panel/`: popovers rendered as separate WebContentsViews (`adblock.*`, `extensions.*`).
- `src/pages/`: internal `goat://` pages (newtab, settings, error, sleep). `static/themes.css` holds all
  theme + motion + gradient tokens shared by every surface.
- `src/pages-preload.js`: exposes `window.goat` only to `goat://newtab` and `goat://settings`; main
  re-checks the sender URL (`fromPage`).
- `src/fp-preload.js`: fingerprint shield (standard/strict) for http(s) frames.
- `scripts/patch-extensions.js`: idempotent string patches to `electron-chrome-extensions` (native
  messaging framing/UTF-8/Windows registry lookup for iCloud Passwords etc., chrome.privacy /
  declarativeContent / sidePanel stand-ins, toolbar right-click items, popup sizing). If the library is
  upgraded and a patch no longer matches, the script throws with the patch name: update it.

## Profile data (owner's PC)
`%APPDATA%\Goat Browser\`: `settings.json`, `tabs.json`, `bookmarks.json`, `blocklists\`, `Extensions\`,
`Partitions\goat` (cookies/storage, session partition `persist:goat`).

## Testing notes
- Headless tests: `xvfb-run electron <test.js>` where the test sets `userData`, requires `src/main.js`
  with `GOAT_TEST=1` (exposes `global.__goat` hooks at the bottom of main.js).
- Extension service-worker preloads only run with the Chromium sandbox ON. `--no-sandbox` makes MV3
  extensions look broken (no chrome.webNavigation etc.). Test extensions as a non-root user without
  `--no-sandbox`.
- Quitting: `will-quit` hard-exits after saving, because electron-chrome-extensions can hang shutdown.

## Known gaps / ideas
- iCloud Passwords: compatibility fixes are in, but it hasn't been confirmed with the real iCloud app.
- Not verified on real Windows: titlebar buttons in the tab strip, top-edge clicks when maximized.
- Ideas offered but not built: one-click "Route through Tor" proxy preset, history page, saved
  passwords, side panel support, chrome.commands.
- DNS only hides lookups; IP hiding needs a VPN/Tor (explained to owner).
