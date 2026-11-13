#!/usr/bin/env node
'use strict';
// Compatibility patches for electron-chrome-extensions, applied after npm install
// (and before every build). Each patch is idempotent and fails loudly if the
// library changed so much that a patch no longer applies.
//
// Native messaging (password managers such as iCloud Passwords, 1Password, Bitwarden desktop):
//   - messages are framed properly (large or split messages, several per chunk)
//   - UTF-8 length is used when sending (non-ASCII text broke the stream)
//   - Windows: hosts registered for Chrome, Edge, Chromium or Brave are found,
//     localized `reg` output is parsed, relative host paths are resolved,
//     and Chrome's --parent-window argument is passed
//   - one-shot sendNativeMessage hosts are closed after replying
// Missing extension APIs are filled in with safe stand-ins:
//   chrome.privacy, chrome.declarativeContent, chrome.sidePanel
// The toolbar right-click menu gets Goat's items (pin/unpin, manage, remove).
// Extension popups: no scrollbars from rounding, one paint per resize, correct
// position on maximized/frameless windows, kept inside the window.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'node_modules', 'electron-chrome-extensions', 'dist');
const MARK = '/* goat-compat */';

function patchFile(file, edits) {
  const p = path.join(root, file);
  let s = fs.readFileSync(p, 'utf8');
  let changed = false;
  for (const [name, from, to, marker] of edits) {
    if (s.includes(to)) continue; // already applied
    if (marker && s.includes(marker)) continue; // applied, then changed by a later edit
    if (!s.includes(from)) throw new Error(`patch-extensions: "${name}" no longer matches ${file}. Update scripts/patch-extensions.js.`);
    s = s.replace(from, to);
    changed = true;
  }
  if (!changed) return false;
  if (!s.startsWith(MARK)) s = MARK + '\n' + s;
  fs.writeFileSync(p, s);
  return true;
}

// ------------------------------------------------------------ main process
const mainEdits = [
  ['native messaging debug log', 'var d7 = (0, import_debug7.default)("electron-chrome-extensions:nativeMessaging");',
    'var d7 = ((dbg) => (...args) => { dbg(...args); try { process.emit("goat-debug", "[native messaging] " + require("util").format(...args)); } catch (e) { /* ignore */ } })((0, import_debug7.default)("electron-chrome-extensions:nativeMessaging"));'],
  ['registry default value', `      const resultLine = lines.find(
        (line) => key ? line.includes(key) : line.includes("(Default)")
      );`, `      // "(Default)" is localized by Windows ("(Standard)", "(Par défaut)"...), so match the type.
      const resultLine = lines.find(
        (line) => key ? line.includes(key) : /\\sREG_(EXPAND_)?SZ\\s/.test(line)
      );`],
  ['windows search paths', `        readRegistryKey("HKLM", \`Software\\\\Google\\\\Chrome\\\\NativeMessagingHosts\\\\\${application}\`),
        readRegistryKey("HKCU", \`Software\\\\Google\\\\Chrome\\\\NativeMessagingHosts\\\\\${application}\`)
      ])).map((result) => result.status === "fulfilled" ? result.value : void 0).filter(Boolean);`,
  `        ...["Google\\\\Chrome", "Chromium", "Microsoft\\\\Edge", "BraveSoftware\\\\Brave-Browser"].flatMap((vendor) => [
          readRegistryKey("HKCU", \`Software\\\\\${vendor}\\\\NativeMessagingHosts\\\\\${application}\`),
          readRegistryKey("HKLM", \`Software\\\\\${vendor}\\\\NativeMessagingHosts\\\\\${application}\`),
          readRegistryKey("HKLM", \`Software\\\\WOW6432Node\\\\\${vendor}\\\\NativeMessagingHosts\\\\\${application}\`)
        ])
      ])).map((result) => result.status === "fulfilled" ? result.value : void 0).filter(Boolean);
      searchPaths.push(path2.join(import_electron6.app.getPath("userData"), "NativeMessagingHosts", appJson));`],
  ['resolve relative host path', `      if (isValidConfig(config)) {
        d7("read config in %s", filePath, config);`, `      if (isValidConfig(config)) {
        if (!path2.isAbsolute(config.path)) config.path = path2.resolve(path2.dirname(filePath), config.path);
        d7("read config in %s", filePath, config);`],
  ['allow hosts that cannot be stat-ed', `    if (!isFile) {
      this.destroy();
      return;
    }`, `    if (!isFile && !import_node_fs2.existsSync(config.path) && process.platform !== "win32") {
      // Windows Store apps (like iCloud) live in WindowsApps, which can't be stat-ed but can be run.
      this.destroy();
      return;
    }`],
  ['parent-window argument', `    this.process = (0, import_node_child_process.spawn)(config.path, [extensionUrl], {
      shell: false
    });`, `    const hostArgs = [extensionUrl];
    if (process.platform === "win32") {
      let hwnd = "0";
      try {
        const w = import_electron6.BaseWindow.getFocusedWindow() || import_electron6.BaseWindow.getAllWindows()[0];
        const h = w && w.getNativeWindowHandle();
        if (h) hwnd = (h.length >= 8 ? h.readBigUInt64LE(0) : BigInt(h.readUInt32LE(0))).toString();
      } catch {}
      hostArgs.push(\`--parent-window=\${hwnd}\`);
    }
    this.process = (0, import_node_child_process.spawn)(config.path, hostArgs, {
      shell: /\\.(bat|cmd)$/i.test(config.path),
      windowsHide: true,
      cwd: path2.dirname(config.path)
    });`],
  ['framed receive', `    this.receive = (data) => {
      const length = data.readUInt32LE(0);
      const message = JSON.parse(data.subarray(4, 4 + length).toString());
      d7("receive: %s", message);
      if (this.keepAlive && this.sender) {
        this.sender.send(\`crx-native-msg-\${this.connectionId}\`, message);
      } else {
        this.resolveResponse?.(message);
      }
    };`, `    this.inbox = Buffer.alloc(0);
    this.receive = (data) => {
      // stdout chunks don't line up with messages: buffer and split on the 4-byte length prefix.
      this.inbox = this.inbox.length ? Buffer.concat([this.inbox, data]) : data;
      while (this.inbox.length >= 4) {
        const length = this.inbox.readUInt32LE(0);
        if (this.inbox.length < 4 + length) break;
        const raw = this.inbox.subarray(4, 4 + length);
        this.inbox = this.inbox.subarray(4 + length);
        let message;
        try { message = JSON.parse(raw.toString("utf8")); } catch (err) { d7("bad message", err); continue; }
        d7("receive: %s", message);
        if (this.keepAlive && this.sender) {
          this.sender.send(\`crx-native-msg-\${this.connectionId}\`, message);
        } else if (this.resolveResponse) {
          const resolve = this.resolveResponse;
          this.resolveResponse = void 0;
          resolve(message);
          setImmediate(() => this.destroy());
          return;
        }
      }
    };`],
  ['utf8 send length', `    const message = JSON.stringify(json);
    const buffer = Buffer.alloc(4 + message.length);
    buffer.writeUInt32LE(message.length, 0);
    buffer.write(message, 4);
    this.process.stdin.write(buffer);`, `    const message = Buffer.from(JSON.stringify(json), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(message.length, 0);
    if (this.process && this.process.stdin.writable) this.process.stdin.write(Buffer.concat([header, message]));`],
  ['toolbar menu: readable name', `    append({
      label: extension.name,
      click: () => {`, `    append({
      label: this.ctx.goatName ? this.ctx.goatName(extension) : extension.name,
      click: () => {`],
  ['toolbar menu: browser items', `    menu.popup({
      x: Math.floor(anchorRect.x),
      y: Math.floor(anchorRect.y + anchorRect.height)
    });`, `    // Let the browser add its own items (pin/unpin, manage, remove).
    this.ctx.emit("goat-action-context-menu", { extension, append, appendSeparator });
    menu.popup({
      x: Math.floor(anchorRect.x),
      y: Math.floor(anchorRect.y + anchorRect.height)
    });`],
  ['permissions: host pattern matching', `      const hasOrigins = permissions.origins ? permissions.origins.every((origin) => currentPermissions.origins.includes(origin)) : true;`, `      // goat: like Chrome, a granted pattern covers narrower ones ("https://*/" covers "https://account.proton.me/*").
      const goatParse = (p) => { if (p === "<all_urls>") return { all: true }; const m = /^(\\*|[a-z-]+):\\/\\/([^/]*)(\\/.*)?$/i.exec(String(p)); return m ? { scheme: m[1].toLowerCase(), host: m[2].toLowerCase() } : null; };
      const goatCovers = (g, r) => {
        if (!g || !r) return false;
        if (g.all) return true;
        if (r.all) return false;
        const schemeOk = g.scheme === r.scheme || (g.scheme === "*" && /^(https?|wss?)$/.test(r.scheme));
        const hostOk = g.host === "*" || g.host === r.host || (g.host.startsWith("*.") && (r.host === g.host.slice(2) || r.host.endsWith(g.host.slice(1))));
        return schemeOk && hostOk;
      };
      const hasOrigins = permissions.origins ? permissions.origins.every((origin) => currentPermissions.origins.includes(origin) || currentPermissions.origins.some((g) => goatCovers(goatParse(g), goatParse(origin)))) : true;`],
  ['popup sizing and position', "  setSize(rect) {\n    if (!this.browserWindow || !this.parent) return;\n    const width = Math.floor(\n      Math.min(_PopupView.BOUNDS.maxWidth, Math.max(rect.width || 0, _PopupView.BOUNDS.minWidth))\n    );\n    const height = Math.floor(\n      Math.min(_PopupView.BOUNDS.maxHeight, Math.max(rect.height || 0, _PopupView.BOUNDS.minHeight))\n    );\n    const size = { width, height };\n    d(`setSize`, size);\n    this.emit(\"will-resize\", size);\n    this.browserWindow?.setBounds({\n      ...this.browserWindow.getBounds(),\n      ...size\n    });\n    this.emit(\"resized\");\n  }\n  updatePosition() {\n    if (!this.browserWindow || !this.parent) return;\n    const winBounds = this.parent.getBounds();\n    const winContentBounds = this.parent.getContentBounds();\n    const nativeTitlebarHeight = winBounds.height - winContentBounds.height;\n    const viewBounds = this.browserWindow.getBounds();\n    let x = winBounds.x + this.anchorRect.x + this.anchorRect.width - viewBounds.width;\n    let y = winBounds.y + nativeTitlebarHeight + this.anchorRect.y + this.anchorRect.height + _PopupView.POSITION_PADDING;\n    if (this.alignment?.includes(\"right\")) x = winBounds.x + this.anchorRect.x;\n    if (this.alignment?.includes(\"top\"))\n      y = winBounds.y + nativeTitlebarHeight - viewBounds.height + this.anchorRect.y - _PopupView.POSITION_PADDING;\n    x = Math.floor(x);\n    y = Math.floor(y);\n    const position = { x, y };\n    d(`updatePosition`, position);\n    this.emit(\"will-move\", position);\n    this.browserWindow.setBounds({\n      ...this.browserWindow.getBounds(),\n      ...position\n    });\n    this.emit(\"moved\");\n  }", "  setSize(rect) {\n    // goat: round up (rounding down made popups show scrollbars or cut off a pixel),\n    // keep the popup inside the window, and apply size + position in ONE setBounds\n    // so Windows doesn't paint a half-moved popup.\n    if (!this.browserWindow || !this.parent) return;\n    const content = this.parent.getContentBounds();\n    const maxH = Math.max(_PopupView.BOUNDS.minHeight, Math.min(_PopupView.BOUNDS.maxHeight, content.height - (this.anchorRect.y + this.anchorRect.height) - 12));\n    const width = Math.ceil(Math.min(_PopupView.BOUNDS.maxWidth, Math.max(rect.width || 0, _PopupView.BOUNDS.minWidth)));\n    const height = Math.ceil(Math.min(maxH, Math.max(rect.height || 0, _PopupView.BOUNDS.minHeight)));\n    this.size = { width, height };\n    d(`setSize`, this.size);\n    this.emit(\"will-resize\", this.size);\n    this.applyBounds();\n    this.emit(\"resized\");\n  }\n  updatePosition() {\n    if (!this.browserWindow || !this.parent) return;\n    this.applyBounds();\n    this.emit(\"moved\");\n  }\n  applyBounds() {\n    if (!this.browserWindow || this.browserWindow.isDestroyed() || !this.parent) return;\n    const size = this.size || this.browserWindow.getBounds();\n    // Content bounds, not window bounds: correct for frameless/maximized windows\n    // (a maximized window's bounds include ~8 px of invisible border on Windows).\n    const content = this.parent.getContentBounds();\n    let x = content.x + this.anchorRect.x + this.anchorRect.width - size.width;\n    let y = content.y + this.anchorRect.y + this.anchorRect.height + _PopupView.POSITION_PADDING;\n    if (this.alignment?.includes(\"right\")) x = content.x + this.anchorRect.x;\n    if (this.alignment?.includes(\"top\")) y = content.y + this.anchorRect.y - size.height - _PopupView.POSITION_PADDING;\n    x = Math.round(Math.max(content.x + 4, Math.min(x, content.x + content.width - size.width - 4)));\n    y = Math.round(y);\n    const next = { x, y, width: size.width, height: size.height };\n    const cur = this.browserWindow.getBounds();\n    if (cur.x === next.x && cur.y === next.y && cur.width === next.width && cur.height === next.height) return;\n    this.emit(\"will-move\", { x, y });\n    this.browserWindow.setBounds(next);\n  }", "// goat: round up (rounding down made popups show scrollbars or cut off a pixel)"],
  ['popup: steady size, no moves during clicks', `    this.browserWindow.on("closed", this.destroy);
    this.parent.once("closed", this.destroy);`, `    this.browserWindow.on("closed", this.destroy);
    this.parent.once("closed", this.destroy);
    // goat: popups jumped around while you used them: a scrollbar flashed in whenever the
    // content grew (changing the width, and with it the popup's position), and each change
    // moved the window. On Windows a window that moves under the cursor between mouse down
    // and mouse up loses the click. So: no scrollbar while the content fits, batch size
    // changes, and never move the popup while a mouse button is held down.
    this.goatMouseDown = false;
    this.goatOverflowKey = null;
    const goatWc = this.browserWindow.webContents;
    const goatRelease = () => { this.goatMouseDown = false; clearTimeout(this.goatDownTimer); if (this.goatPending) this.applyBounds(); };
    goatWc.on("before-mouse-event", (_e, m) => {
      if (m.type === "mouseDown") { this.goatMouseDown = true; clearTimeout(this.goatDownTimer); this.goatDownTimer = setTimeout(goatRelease, 2000); }
      else if (m.type === "mouseUp") goatRelease();
    });
    this.browserWindow.on("blur", goatRelease);
    goatWc.on("dom-ready", () => {
      this.goatOverflowKey = null;
      goatWc.insertCSS("html { overflow: hidden !important; }").then((k) => { this.goatOverflowKey = k; }).catch(() => {});
    });`],
  ['popup: scroll only when needed', `    const width = Math.ceil(Math.min(_PopupView.BOUNDS.maxWidth, Math.max(rect.width || 0, _PopupView.BOUNDS.minWidth)));
    const height = Math.ceil(Math.min(maxH, Math.max(rect.height || 0, _PopupView.BOUNDS.minHeight)));
    this.size = { width, height };`, `    let width = Math.ceil(Math.min(_PopupView.BOUNDS.maxWidth, Math.max(rect.width || 0, _PopupView.BOUNDS.minWidth)));
    const height = Math.ceil(Math.min(maxH, Math.max(rect.height || 0, _PopupView.BOUNDS.minHeight)));
    // goat: content taller than the popup can be: allow scrolling again; otherwise keep it hidden.
    const goatWc = this.browserWindow.webContents;
    if ((rect.height || 0) > maxH && this.goatOverflowKey && this.goatOverflowKey !== "off") { goatWc.removeInsertedCSS(this.goatOverflowKey).catch(() => {}); this.goatOverflowKey = "off"; }
    else if ((rect.height || 0) <= maxH && this.goatOverflowKey === "off") { this.goatOverflowKey = null; goatWc.insertCSS("html { overflow: hidden !important; }").then((k) => { this.goatOverflowKey = k; }).catch(() => {}); }
    // Small width wobbles (scrollbar-sized) after the popup is shown don't resize it.
    if (this.size && !this.hidden && width < this.size.width && this.size.width - width <= 20) width = this.size.width;
    this.size = { width, height };`],
  ['popup: batch moves, wait for mouse up', `  applyBounds() {
    if (!this.browserWindow || this.browserWindow.isDestroyed() || !this.parent) return;
    const size = this.size || this.browserWindow.getBounds();`, `  applyBounds() {
    if (!this.browserWindow || this.browserWindow.isDestroyed() || !this.parent) return;
    if (this.goatMouseDown) { this.goatPending = true; return; } // goat: wait until the click is done
    if (!this.hidden && !this.goatFlush) {
      // goat: visible popup: apply size/position changes at most once per frame.
      this.goatPending = true;
      if (!this.goatTimer) this.goatTimer = setTimeout(() => { this.goatTimer = null; this.goatFlush = true; try { this.applyBounds(); } finally { this.goatFlush = false; } }, 16);
      return;
    }
    this.goatPending = false;
    const size = this.size || this.browserWindow.getBounds();`],
];

// ------------------------------------------------------------ extension preload
const SHIMS = `
      // goat: stand-ins for APIs Electron doesn't implement, so extensions that
      // call them keep running instead of throwing at startup.
      class GoatLocalEvent {
        constructor() { this.listeners = new Set(); }
        addListener(cb) { this.listeners.add(cb); }
        removeListener(cb) { this.listeners.delete(cb); }
        hasListener(cb) { return this.listeners.has(cb); }
        hasListeners() { return this.listeners.size > 0; }
        dispatch(...args) { for (const cb of this.listeners) { try { cb(...args); } catch (e) { console.error(e); } } }
      }
      const goatHasPermission = (name) => (manifest.permissions || []).includes(name) || (manifest.optional_permissions || []).includes(name);
      const goatCallback = (args, value) => {
        const cb = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
        if (cb) { setTimeout(() => cb(value), 0); return void 0; }
        return Promise.resolve(value);
      };
      // chrome.privacy: Goat has no built-in password or autofill manager, so these
      // read as off and are always controllable by the extension.
      const goatSetting = (initial) => {
        let value = initial;
        let controlled = false;
        const onChange = new GoatLocalEvent();
        const state = () => ({ value, levelOfControl: controlled ? "controlled_by_this_extension" : "controllable_by_this_extension" });
        return {
          get: (...args) => goatCallback(args, state()),
          set: (details, ...rest) => { if (details && "value" in details) value = details.value; controlled = true; onChange.dispatch(state()); return goatCallback(rest, void 0); },
          clear: (...args) => { controlled = false; value = initial; onChange.dispatch(state()); return goatCallback(args, void 0); },
          onChange,
        };
      };
      // chrome.runtime.onMessageExternal: messages from websites listed in the extension's
      // "externally_connectable" (e.g. Proton VPN's sign-in page). Goat delivers them from main.
      if (manifest.externally_connectable && apiDefinitions.runtime) {
        const goatRuntimeDef = apiDefinitions.runtime;
        apiDefinitions.runtime = {
          ...goatRuntimeDef,
          factory: (base) => {
            const rt = goatRuntimeDef.factory(base);
            const listeners = new Set();
            let wired = false;
            const wire = () => {
              if (wired) return;
              wired = true;
              new ExtensionEvent("goat.runtime.messageExternal").addListener((message, sender, requestId) => {
                const reply = invokeExtension2("goat.runtime.externalReply");
                let done = false;
                const send = (r) => { if (done) return; done = true; reply(requestId, r === void 0 ? null : r); };
                let pending = false;
                for (const cb of listeners) {
                  try {
                    const ret = cb(message, sender, send);
                    if (ret === true) pending = true;
                    else if (ret && typeof ret.then === "function") { pending = true; ret.then(send, (e) => send({ error: String(e && e.message || e) })); }
                  } catch (e) { console.error(e); }
                }
                if (!pending) send(void 0);
              });
            };
            rt.onMessageExternal = {
              addListener(cb) { listeners.add(cb); wire(); },
              removeListener(cb) { listeners.delete(cb); },
              hasListener(cb) { return listeners.has(cb); },
              hasListeners() { return listeners.size > 0; },
            };
            if (!rt.onConnectExternal) rt.onConnectExternal = new GoatLocalEvent();
            return rt;
          },
        };
      }
      Object.assign(apiDefinitions, {
        privacy: {
          shouldInject: () => goatHasPermission("privacy"),
          factory: (base) => base || {
            services: {
              passwordSavingEnabled: goatSetting(false), autofillEnabled: goatSetting(false),
              autofillAddressEnabled: goatSetting(false), autofillCreditCardEnabled: goatSetting(false),
              searchSuggestEnabled: goatSetting(false), spellingServiceEnabled: goatSetting(false),
              translationServiceEnabled: goatSetting(false), alternateErrorPagesEnabled: goatSetting(false),
              safeBrowsingEnabled: goatSetting(false), safeBrowsingExtendedReportingEnabled: goatSetting(false),
            },
            network: { networkPredictionEnabled: goatSetting(true), webRTCIPHandlingPolicy: goatSetting("disable_non_proxied_udp") },
            websites: {
              thirdPartyCookiesAllowed: goatSetting(false), hyperlinkAuditingEnabled: goatSetting(false),
              referrersEnabled: goatSetting(true), doNotTrackEnabled: goatSetting(true), protectedContentEnabled: goatSetting(true),
              topicsEnabled: goatSetting(false), fledgeEnabled: goatSetting(false), adMeasurementEnabled: goatSetting(false),
            },
            IPHandlingPolicy: { DEFAULT: "default", DEFAULT_PUBLIC_AND_PRIVATE_INTERFACES: "default_public_and_private_interfaces", DEFAULT_PUBLIC_INTERFACE_ONLY: "default_public_interface_only", DISABLE_NON_PROXIED_UDP: "disable_non_proxied_udp" },
          },
        },
        declarativeContent: {
          shouldInject: () => goatHasPermission("declarativeContent"),
          factory: (base) => base || {
            PageStateMatcher: class { constructor(o) { Object.assign(this, o); } },
            ShowAction: class {}, ShowPageAction: class {}, SetIcon: class { constructor(o) { Object.assign(this, o); } },
            RequestContentScript: class { constructor(o) { Object.assign(this, o); } },
            onPageChanged: {
              addRules: (rules, cb) => { if (cb) setTimeout(() => cb(rules || []), 0); },
              removeRules: (ids, cb) => { const f = typeof ids === "function" ? ids : cb; if (f) setTimeout(f, 0); },
              getRules: (ids, cb) => { const f = typeof ids === "function" ? ids : cb; if (f) setTimeout(() => f([]), 0); },
              addListener() {}, removeListener() {}, hasListener: () => false,
            },
          },
        },
        // chrome.proxy: handled by Goat's main process (session.setProxy).
        proxy: {
          shouldInject: () => goatHasPermission("proxy"),
          factory: (base) => {
            const onChange = new ExtensionEvent("goat.proxy.onChange");
            return {
              ...(base || {}),
              settings: {
                get: invokeExtension2("goat.proxy.get"),
                set: invokeExtension2("goat.proxy.set"),
                clear: invokeExtension2("goat.proxy.clear"),
                onChange,
              },
              onProxyError: new ExtensionEvent("goat.proxy.onProxyError"),
            };
          },
        },
        // chrome.webRequest: Electron doesn't pass proxy logins to extensions, so Goat
        // forwards them to onAuthRequired listeners (VPN extensions like Proton VPN need this).
        webRequest: {
          shouldInject: () => goatHasPermission("webRequest"),
          factory: (base) => {
            const names = ["onBeforeRequest", "onBeforeSendHeaders", "onSendHeaders", "onHeadersReceived", "onResponseStarted", "onBeforeRedirect", "onCompleted", "onErrorOccurred"];
            const api = { ...(base || {}) };
            for (const n of names) if (!api[n]) api[n] = new GoatLocalEvent();
            const authListeners = new Map();
            let bridged = false;
            const bridge = () => {
              if (bridged) return;
              bridged = true;
              new ExtensionEvent("goat.proxyAuth").addListener(async (details) => {
                const reply = invokeExtension2("goat.proxy.authReply");
                let answered = false;
                const send = (resp) => { if (answered) return; answered = true; reply(details.requestId, resp || {}); };
                for (const [cb, extra] of authListeners) {
                  try {
                    if ((extra || []).includes("asyncBlocking")) { cb(details, send); }
                    else { const r = await cb(details); if (r) { send(r); return; } }
                  } catch (e) { console.error(e); }
                }
                setTimeout(() => send({}), 25000);
              });
            };
            api.onAuthRequired = {
              addListener(cb, _filter, extra) { authListeners.set(cb, extra || []); bridge(); },
              removeListener(cb) { authListeners.delete(cb); },
              hasListener(cb) { return authListeners.has(cb); },
              hasListeners() { return authListeners.size > 0; },
            };
            api.handlerBehaviorChanged = (...a) => goatCallback(a, void 0);
            if (!api.MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES) api.MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES = 20;
            return api;
          },
        },
        idle: {
          shouldInject: () => goatHasPermission("idle"),
          factory: (base) => base || {
            queryState: (_s, ...a) => goatCallback(a, "active"),
            setDetectionInterval: () => {},
            getAutoLockDelay: (...a) => goatCallback(a, 0),
            onStateChanged: new GoatLocalEvent(),
          },
        },
        sidePanel: {
          shouldInject: () => goatHasPermission("sidePanel"),
          factory: (base) => base || {
            setOptions: (...a) => goatCallback(a, void 0), getOptions: (...a) => goatCallback(a, { enabled: false }),
            setPanelBehavior: (...a) => goatCallback(a, void 0), getPanelBehavior: (...a) => goatCallback(a, { openPanelOnActionClick: false }),
            open: () => Promise.reject(new Error("Side panels aren't supported in Goat Browser yet.")),
          },
        },
      });
`;

const preloadEdits = [
  ['api shims', `      Object.keys(apiDefinitions).forEach((key) => {
        const apiName = key;`, SHIMS + `      Object.keys(apiDefinitions).forEach((key) => {
        const apiName = key;`],
];

const changed = patchFile('cjs/index.js', mainEdits); // Goat loads the CommonJS build
// An older version of Goat's shims may already be in the file: take it out first, so
// re-running this script after the shims change replaces them instead of adding a copy.
{
  const pp = path.join(root, 'chrome-extension-api.preload.js');
  const cur = fs.readFileSync(pp, 'utf8');
  if (!cur.includes(SHIMS) || cur.split("goat: stand-ins for APIs Electron doesn't implement").length > 2) {
    const cleaned = cur.replace(/\n {6}\/\/ goat: stand-ins for APIs Electron doesn't implement[\s\S]*?(?= {6}Object\.keys\(apiDefinitions\)\.forEach)/g, '\n');
    if (cleaned !== cur) fs.writeFileSync(pp, cleaned);
  }
}
const changedPreload = patchFile('chrome-extension-api.preload.js', preloadEdits);
console.log(`patch-extensions: ${changed || changedPreload ? 'applied' : 'already applied'}`);
