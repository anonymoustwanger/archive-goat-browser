// Shared by the background worker and Goat's pages.

export const HOST = 'com.goat.host';
export const TOR_PORT = 9250; // Goat's own Tor (Tor Browser uses 9150, system Tor 9050)
export const REPO = 'anonymoustwanger/goat-browser';

export const LANGUAGES = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
  nl: 'Dutch', sv: 'Swedish', nb: 'Norwegian', da: 'Danish', fi: 'Finnish', pl: 'Polish',
  cs: 'Czech', sk: 'Slovak', hu: 'Hungarian', ro: 'Romanian', bg: 'Bulgarian', el: 'Greek',
  tr: 'Turkish', ru: 'Russian', uk: 'Ukrainian', ar: 'Arabic', he: 'Hebrew', fa: 'Persian',
  hi: 'Hindi', bn: 'Bengali', ur: 'Urdu', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian',
  ms: 'Malay', zh: 'Chinese (Simplified)', 'zh-TW': 'Chinese (Traditional)', ja: 'Japanese',
  ko: 'Korean', sw: 'Swahili', ca: 'Catalan', ga: 'Irish', et: 'Estonian', lt: 'Lithuanian', lv: 'Latvian',
  sl: 'Slovenian', hr: 'Croatian', sr: 'Serbian', az: 'Azerbaijani', eo: 'Esperanto', tl: 'Tagalog',
};

export const base = (code) => String(code || '').toLowerCase().split(/[-_]/)[0];

export const DEFAULTS = {
  profile: 'balanced',
  tor: { normal: false },
  translate: {
    engine: 'libre', // libre | google
    libreUrl: 'https://libretranslate.com',
    libreKey: '',
    to: base(navigator.language) in LANGUAGES ? base(navigator.language) : 'en',
    offer: true, // badge when a page is in another language
    auto: false, // translate such pages automatically
  },
  shield: { canvas: true, rects: true, measureText: true, pings: true, webgl: true, clientHints: false, systemInfo: false, referrers: false },
  updates: { auto: true, lastCheck: 0, latest: '', url: '' },
};

export async function getSettings() {
  const s = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const out = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    out[k] = v && typeof v === 'object' ? { ...v, ...(s[k] || {}) } : (s[k] ?? v);
  }
  return out;
}

export async function setSetting(key, value) {
  const cur = (await getSettings())[key];
  const next = cur && typeof cur === 'object' && !Array.isArray(cur) ? { ...cur, ...value } : value;
  await chrome.storage.local.set({ [key]: next });
  return next;
}

// Settings profiles. Browser settings apply at once; "shield" items are
// startup switches and apply after a restart.
export const PROFILES = {
  fastest: {
    label: 'Fastest',
    about: 'Preloads pages and keeps everything compatible. Trackers and ads still blocked.',
    privacy: { prediction: true, webrtc: 'default_public_interface_only', thirdPartyCookies: false, hyperlinkAuditing: false, referrers: true },
    shield: { canvas: false, rects: false, measureText: false, pings: true, webgl: false, clientHints: false, systemInfo: false, referrers: false },
  },
  balanced: {
    label: 'Balanced',
    about: 'Fingerprint noise on, third-party cookies off, page preloading on.',
    privacy: { prediction: true, webrtc: 'default_public_interface_only', thirdPartyCookies: false, hyperlinkAuditing: false, referrers: true },
    shield: { canvas: true, rects: true, measureText: true, pings: true, webgl: true, clientHints: false, systemInfo: false, referrers: false },
  },
  private: {
    label: 'Most private',
    about: 'Everything on: no preloading, WebRTC only through a proxy, short referrers, fewer system details. Some sites may break.',
    privacy: { prediction: false, webrtc: 'disable_non_proxied_udp', thirdPartyCookies: false, hyperlinkAuditing: false, referrers: true },
    shield: { canvas: true, rects: true, measureText: true, pings: true, webgl: true, clientHints: true, systemInfo: true, referrers: true },
  },
};

// Startup switches for the shield settings (written to goat\settings.switches).
export function shieldSwitches(shield) {
  const lines = [];
  if (shield.canvas) lines.push('--fingerprinting-canvas-image-data-noise');
  if (shield.rects) lines.push('--fingerprinting-client-rects-noise');
  if (shield.measureText) lines.push('--fingerprinting-canvas-measuretext-noise');
  if (shield.pings) lines.push('--no-pings');
  const features = [];
  if (shield.webgl) features.push('SpoofWebGLInfo');
  if (shield.clientHints) features.push('RemoveClientHints');
  if (shield.systemInfo) features.push('ReducedSystemInfo');
  if (shield.referrers) features.push('MinimalReferrers');
  if (features.length) lines.push('--enable-features=' + features.join(','));
  return lines;
}

// Talks to goat-host (Tor, startup switches, uninstall). Resolves {error} when
// the host isn't installed (e.g. a portable copy).
export function host(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(HOST, msg, (res) => {
        const err = chrome.runtime.lastError;
        resolve(err ? { error: err.message } : res || { error: 'no answer' });
      });
    } catch (e) {
      resolve({ error: String(e && e.message || e) });
    }
  });
}

export function newerVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0; const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

export const $ = (sel, root = document) => root.querySelector(sel);
