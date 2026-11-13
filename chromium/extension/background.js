// Goat background worker: Tor, Tor windows, translation, settings profiles and
// update checks. Goat's native helper (goat-host) runs Tor and writes
// startup switches; everything else uses normal extension APIs.

import { HOST, TOR_PORT, REPO, PROFILES, LANGUAGES, getSettings, setSetting, shieldSwitches, host, newerVersion, base } from './common.js';
import { translateTab, restoreTab, detectLang, isTranslated } from './translate.js';

const VERSION = chrome.runtime.getManifest().version;

// ------------------------------------------------------------------ state
let torPort = null;
let tor = { state: 'off', progress: 0, error: '' };
let torRetry = null;
const translated = new Map(); // tabId -> 'busy' | 'done'

const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

// A Tor window is a separate Goat instance started by goat-host with Tor as a
// fixed startup proxy (so nothing can bypass it).
let torWindowCache = null;
async function isTorWindow() {
  if (torWindowCache !== null) return torWindowCache;
  // tor.html (the Tor window's start page) sets this flag in the window's
  // throwaway profile.
  const { torInstance } = await chrome.storage.local.get('torInstance');
  if (torInstance) torWindowCache = true;
  return !!torInstance;
}

// WebRTC must never go around Tor.
async function strictWebRTC() {
  return (await isTorWindow()) || (await getSettings()).tor.normal;
}

// Sets the WebRTC policy. Goat's default is left unset on purpose: an extension
// setting beats startup switches, and Tor windows set the strict policy as a
// startup switch.
async function setWebRTC(policy) {
  const api = chrome.privacy.network.webRTCIPHandlingPolicy;
  if (await strictWebRTC()) return api.set({ value: 'disable_non_proxied_udp' });
  if (policy === 'default_public_interface_only') return api.clear({});
  return api.set({ value: policy });
}

// ------------------------------------------------------------------- Tor
const TOR_PROXY = { mode: 'fixed_servers', rules: { singleProxy: { scheme: 'socks5', host: '127.0.0.1', port: TOR_PORT } } };

function setTor(next) {
  tor = { ...tor, ...next };
  send({ type: 'tor', tor });
  badge();
}

function watchTor() {
  if (torPort) return;
  clearTimeout(torRetry);
  try {
    torPort = chrome.runtime.connectNative(HOST);
  } catch (e) {
    setTor({ state: 'error', error: 'Goat helper is missing. Reinstall Goat Browser.' });
    return;
  }
  torPort.onMessage.addListener((m) => {
    if (m && m.type === 'tor') setTor({ state: m.state, progress: m.progress || 0, error: m.error || '' });
  });
  torPort.onDisconnect.addListener(async () => {
    const err = chrome.runtime.lastError;
    torPort = null;
    const s = await getSettings();
    if (s.tor.normal || await isTorWindow()) {
      setTor({ state: 'error', error: err ? 'Goat helper: ' + err.message : 'Goat helper stopped; retrying' });
      torRetry = setTimeout(watchTor, 5000);
    } else {
      setTor({ state: 'off', progress: 0, error: '' });
    }
  });
  torPort.postMessage({ cmd: 'tor-watch' });
}

async function proxyControl() {
  const d = await chrome.proxy.settings.get({ incognito: false });
  return d.levelOfControl; // controllable_by_this_extension | controlled_by_this_extension | controlled_by_other_extensions | not_controllable
}

async function torNormal(on) {
  if (on) {
    const ctl = await proxyControl();
    if (ctl === 'controlled_by_other_extensions') {
      return { error: 'Another extension (probably a VPN) controls the proxy. Turn it off first, then turn Tor on.' };
    }
    if (ctl === 'not_controllable') return { error: 'The proxy is set by policy or a startup switch, so Goat can’t change it.' };
    await chrome.proxy.settings.set({ value: TOR_PROXY, scope: 'regular' });
    // No WebRTC around the proxy while Tor is on.
    await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: 'disable_non_proxied_udp' }).catch(() => {});
    await setSetting('tor', { normal: true });
    watchTor();
  } else {
    await chrome.proxy.settings.clear({ scope: 'regular' });
    await setSetting('tor', { normal: false });
    const s = await getSettings();
    const p = PROFILES[s.profile] || PROFILES.balanced;
    await setWebRTC(p.privacy.webrtc).catch(() => {});
    if (torPort) { torPort.disconnect(); torPort = null; }
    setTor({ state: 'off', progress: 0, error: '' });
  }
  return { ok: true };
}

// ------------------------------------------------------------- profiles
async function applyPrivacy(p) {
  const n = chrome.privacy.network;
  const w = chrome.privacy.websites;
  const tasks = [
    n.networkPredictionEnabled.set({ value: p.prediction && !(await isTorWindow()) }),
    w.thirdPartyCookiesAllowed.set({ value: p.thirdPartyCookies }),
    w.hyperlinkAuditingEnabled.set({ value: p.hyperlinkAuditing }),
    w.referrersEnabled.set({ value: p.referrers }),
  ];
  tasks.push(setWebRTC(p.webrtc));
  await Promise.allSettled(tasks);
}

async function writeShield(shield) {
  const r = await host({ cmd: 'write-switches', lines: shieldSwitches(shield) });
  return r.error ? { error: r.error } : { restart: !!r.changed };
}

async function applyProfile(name) {
  const p = PROFILES[name];
  if (!p) return { error: 'unknown profile' };
  await applyPrivacy(p.privacy);
  await setSetting('profile', name);
  await chrome.storage.local.set({ shield: { ...p.shield } });
  return writeShield(p.shield);
}

async function setShield(change) {
  const shield = await setSetting('shield', change);
  await setSetting('profile', 'custom');
  return writeShield(shield);
}

// ---------------------------------------------------------- translation
async function translate(tabId) {
  const s = await getSettings();
  translated.set(tabId, 'busy');
  badge(tabId);
  try {
    const r = await translateTab(tabId, s.translate.to, s.translate);
    translated.set(tabId, 'done');
    badge(tabId);
    return r;
  } catch (e) {
    translated.delete(tabId);
    badge(tabId);
    return { error: String(e && e.message || e) };
  }
}

async function showOriginal(tabId) {
  await restoreTab(tabId);
  translated.delete(tabId);
  badge(tabId);
  return { ok: true };
}

const offers = new Map(); // tabId -> detected language
async function checkPage(tabId, url) {
  offers.delete(tabId);
  translated.delete(tabId);
  if (!/^https?:/.test(url || '')) { badge(tabId); return; }
  const s = await getSettings();
  if (!s.translate.offer && !s.translate.auto) return;
  const lang = await detectLang(tabId);
  if (!lang || base(lang) === base(s.translate.to)) { badge(tabId); return; }
  offers.set(tabId, lang);
  badge(tabId);
  if (s.translate.auto) translate(tabId);
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') checkPage(tabId, tab.url);
});
chrome.tabs.onRemoved.addListener((tabId) => { offers.delete(tabId); translated.delete(tabId); });

// --------------------------------------------------------------- updates
async function checkUpdates(force) {
  const s = await getSettings();
  if (!force && !s.updates.auto) return s.updates;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const rel = await res.json();
    const { os } = await chrome.runtime.getPlatformInfo();
    const want = os === 'linux' ? /^GoatBrowser-.*\.AppImage$/i : /^GoatBrowser-[\d.]+-windows-x64\.exe$/i;
    const asset = (rel.assets || []).find((a) => want.test(a.name));
    const next = { lastCheck: Date.now(), latest: rel.tag_name || '', url: (asset && asset.browser_download_url) || rel.html_url || '', page: rel.html_url || '', error: '' };
    const out = await setSetting('updates', next);
    badge();
    return out;
  } catch (e) {
    return setSetting('updates', { lastCheck: Date.now(), error: String(e.message || e) });
  }
}

const updateReady = (u) => u.latest && newerVersion(u.latest, VERSION);

// ----------------------------------------------------------------- badge
async function badge(tabId) {
  const s = await getSettings();
  const torWin = await isTorWindow();
  let text = '';
  let color = '#111111';
  if (torWin || s.tor.normal) {
    text = tor.state === 'on' || torWin && tor.state !== 'error' ? 'TOR' : tor.state === 'error' ? '!' : '…';
    color = '#7d4698';
  } else if (updateReady(s.updates)) {
    text = 'NEW'; color = '#1a7f37';
  }
  await chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
  await chrome.action.setBadgeText({ text }).catch(() => {});
  if (tabId != null) {
    const st = translated.get(tabId);
    const tabText = st === 'busy' ? '…' : st === 'done' ? 'TR' : offers.has(tabId) ? 'Aあ' : null;
    if (tabText) {
      await chrome.action.setBadgeText({ tabId, text: tabText }).catch(() => {});
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#2f6feb' }).catch(() => {});
    } else {
      await chrome.action.setBadgeText({ tabId, text: null }).catch(() => {});
    }
  }
}

// ------------------------------------------------------------------ menus
function menus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'translate', title: 'Translate page', contexts: ['page'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
    chrome.contextMenus.create({ id: 'original', title: 'Show original', contexts: ['page'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
    chrome.contextMenus.create({ id: 'torwindow', title: 'New Tor window', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'settings', title: 'Goat settings', contexts: ['action'] });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'translate' && tab) translate(tab.id);
  else if (info.menuItemId === 'original' && tab) showOriginal(tab.id);
  else if (info.menuItemId === 'torwindow') host({ cmd: 'tor-window' });
  else if (info.menuItemId === 'settings') chrome.runtime.openOptionsPage();
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== 'translate-page' || !tab) return;
  if (await isTranslated(tab.id)) showOriginal(tab.id); else translate(tab.id);
});

// ------------------------------------------------------------- messages
const handlers = {
  async state(msg) {
    const s = await getSettings();
    const tabId = msg.tabId;
    return {
      version: VERSION, settings: s, tor, torWindow: await isTorWindow(),
      proxyControl: await proxyControl().catch(() => ''),
      offer: tabId != null ? offers.get(tabId) || '' : '', translated: tabId != null ? translated.get(tabId) || '' : '',
      update: updateReady(s.updates) ? s.updates : null, languages: LANGUAGES, profiles: PROFILES,
    };
  },
  torNormal: (m) => torNormal(!!m.on),
  torWindow: () => host({ cmd: 'tor-window' }),
  newCircuit: () => host({ cmd: 'newnym' }),
  torWindowReady: async () => {
    await chrome.storage.local.set({ torInstance: true });
    torWindowCache = true;
    await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: 'disable_non_proxied_udp' }).catch(() => {});
    // No DNS prefetching or preconnects outside Tor.
    await chrome.privacy.network.networkPredictionEnabled.set({ value: false }).catch(() => {});
    watchTor(); badge();
    return { ok: true };
  },
  translate: (m) => translate(m.tabId),
  original: (m) => showOriginal(m.tabId),
  applyProfile: (m) => applyProfile(m.name),
  setShield: (m) => setShield(m.change),
  setTranslate: async (m) => ({ translate: await setSetting('translate', m.change) }),
  setUpdates: async (m) => ({ updates: await setSetting('updates', m.change) }),
  checkUpdates: () => checkUpdates(true),
  uninstall: () => host({ cmd: 'uninstall' }),
  helper: () => host({ cmd: 'status' }),
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const h = msg && handlers[msg.type];
  if (!h || sender.id !== chrome.runtime.id) return false;
  Promise.resolve(h(msg)).then(reply, (e) => reply({ error: String(e && e.message || e) }));
  return true;
});

// ---------------------------------------------------------------- startup
async function start() {
  menus();
  const s = await getSettings();
  if (s.tor.normal || await isTorWindow()) watchTor();
  badge();
  chrome.alarms.create('updates', { periodInMinutes: 12 * 60, delayInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'updates') checkUpdates(false); });

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { firstRunDone } = await chrome.storage.local.get('firstRunDone');
  if (!firstRunDone) {
    // Startup switches for Balanced ship with Goat (settings.switches), so the
    // first run only sets browser settings. (This also runs in each new Tor
    // window, which must not rewrite the main settings.)
    await chrome.storage.local.set({ firstRunDone: true, profile: 'balanced', shield: { ...PROFILES.balanced.shield } });
    // Give a Tor window's start page time to identify itself; Tor windows keep
    // their strict settings.
    await new Promise((r) => setTimeout(r, 2500));
    if (!(await isTorWindow())) await applyPrivacy(PROFILES.balanced.privacy);
  }
  if (reason === 'install' || reason === 'update') start();
});
chrome.runtime.onStartup.addListener(start);
start();
