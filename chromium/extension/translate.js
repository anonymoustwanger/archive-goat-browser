// Page translation. Text is collected in Goat's isolated world (the page's
// scripts can't see it), translated by the chosen service from the background
// worker, and written back. "Show original" restores the exact text.

import { base } from './common.js';

// ---- these run inside the page (isolated world) ----
function collect() {
  const S = window.__goatTr || (window.__goatTr = { nodes: [], orig: new Map(), attrs: [], done: new WeakSet() });
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'KBD', 'SAMP', 'VAR', 'SVG', 'MATH', 'TEMPLATE', 'IFRAME']);
  const out = [];
  const ok = (el) => {
    for (let e = el; e; e = e.parentElement) {
      if (SKIP.has(e.tagName) || e.isContentEditable || e.getAttribute('translate') === 'no' || (e.classList && e.classList.contains('notranslate'))) return false;
    }
    return true;
  };
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && out.length < 600; n = walker.nextNode()) {
    if (S.done.has(n)) continue;
    const t = n.nodeValue;
    if (!t || t.trim().length < 2 || !/\p{L}/u.test(t)) continue;
    if (!ok(n.parentElement)) continue;
    S.done.add(n);
    const id = S.nodes.push(n) - 1;
    S.orig.set(id, t);
    out.push([id, t.trim()]);
  }
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label],input[type=submit][value],input[type=button][value]')) {
    if (out.length >= 650) break;
    for (const a of ['placeholder', 'title', 'aria-label', 'value']) {
      const v = el.getAttribute(a);
      if (!v || (a === 'value' && !/^(submit|button)$/i.test(el.type)) || (el.__goatTrA && el.__goatTrA[a]) || !/\p{L}/u.test(v) || !ok(el)) continue;
      (el.__goatTrA = el.__goatTrA || {})[a] = v;
      const id = S.attrs.push([el, a, v]) - 1;
      out.push(['a' + id, v.trim()]);
    }
  }
  return out;
}

function apply(pairs) {
  const S = window.__goatTr;
  if (!S) return 0;
  let n = 0;
  for (const [id, t] of pairs) {
    if (typeof id === 'string' && id[0] === 'a') {
      const r = S.attrs[Number(id.slice(1))];
      if (r) { r[0].setAttribute(r[1], t); n++; }
      continue;
    }
    const node = S.nodes[id];
    const o = S.orig.get(id);
    if (!node || o == null) continue;
    node.nodeValue = o.match(/^\s*/)[0] + t + o.match(/\s*$/)[0];
    n++;
  }
  document.documentElement.dataset.goatTranslated = '1';
  return n;
}

function restore() {
  const S = window.__goatTr;
  if (!S) return 0;
  S.nodes.forEach((node, id) => { if (node && S.orig.has(id)) node.nodeValue = S.orig.get(id); });
  for (const [el, a, v] of S.attrs) { el.setAttribute(a, v); if (el.__goatTrA) delete el.__goatTrA[a]; }
  delete window.__goatTr;
  delete document.documentElement.dataset.goatTranslated;
  return 1;
}

function pageLang() {
  const h = document.documentElement;
  return (h.getAttribute('lang') || h.getAttribute('xml:lang') || (document.querySelector('meta[http-equiv="content-language" i]') || {}).content || '').trim();
}

// ---- background side ----
async function run(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func, args });
  return r && r.result;
}

export async function detectLang(tabId) {
  let lang = '';
  try { lang = await chrome.tabs.detectLanguage(tabId); } catch { /* not available */ }
  if (!lang || lang === 'und') {
    try { lang = await run(tabId, pageLang); } catch { lang = ''; }
  }
  return lang || '';
}

async function libre(texts, to, cfg) {
  const url = String(cfg.libreUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) throw new Error('Set your LibreTranslate address in Goat settings.');
  const target = base(to) === 'zh' ? (to === 'zh-TW' ? 'zt' : 'zh') : base(to);
  const res = await fetch(`${url}/translate`, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, source: 'auto', target, format: 'text', api_key: cfg.libreKey || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || `LibreTranslate answered ${res.status}`;
    if ((res.status === 400 || res.status === 403) && /key/i.test(msg)) throw new Error(`${msg}. Add an API key or switch service in Goat settings.`);
    throw new Error(msg);
  }
  const arr = Array.isArray(data.translatedText) ? data.translatedText : [data.translatedText];
  const det = Array.isArray(data.detectedLanguage) ? data.detectedLanguage[0] : data.detectedLanguage;
  return { out: arr.map((s) => String(s || '')), src: (det && det.language) || '' };
}

async function google(texts, to) {
  const tl = to === 'zh' ? 'zh-CN' : to;
  const body = new URLSearchParams({ q: texts.map((t) => t.replace(/\s*\n\s*/g, ' ')).join('\n') }).toString();
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t`, {
    method: 'POST', body, credentials: 'omit', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'The translation service is rate-limiting this IP (common over Tor). Try again or use a new Tor circuit.' : `Translation service answered ${res.status}`);
  const data = await res.json();
  const joined = (data[0] || []).map((c) => (c && c[0]) || '').join('');
  let out = joined.split('\n');
  if (out.length !== texts.length) {
    if (texts.length === 1) out = [joined.trim()];
    else { out = []; for (const t of texts) out.push((await google([t], to)).out[0]); }
  }
  return { out: out.map((s) => s.trim()), src: data[2] || '' };
}

export async function translateTab(tabId, to, cfg) {
  const pieces = await run(tabId, collect);
  if (!pieces || !pieces.length) return { count: 0, src: '' };
  let src = '';
  let count = 0;
  let batch = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    const texts = batch.map((p) => p[1]);
    const r = cfg.engine === 'google' ? await google(texts, to) : await libre(texts, to, cfg);
    src = src || r.src;
    count += await run(tabId, apply, [batch.map((p, i) => [p[0], r.out[i] || p[1]])]);
    batch = []; size = 0;
  };
  for (const p of pieces) {
    const t = p[1].slice(0, 3000);
    if (size + t.length > 3500) await flush();
    batch.push([p[0], t]); size += t.length + 1;
  }
  await flush();
  return { count, src };
}

export async function restoreTab(tabId) {
  try { await run(tabId, restore); } catch { /* page gone */ }
}

export async function isTranslated(tabId) {
  try { return await run(tabId, () => document.documentElement.dataset.goatTranslated === '1'); } catch { return false; }
}
