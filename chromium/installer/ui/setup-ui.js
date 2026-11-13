'use strict';
// Goat Browser setup screen. Runs in WebView2 inside GoatBrowserSetup.exe
// (GoatSetup.cs); talks to it with chrome.webview messages.
const $ = (id) => document.getElementById(id);
const host = window.chrome && window.chrome.webview;
const send = (type, extra) => host && host.postMessage(JSON.stringify(Object.assign({ type }, extra || {})));

let info = { installed: null, versions: [] };
let lastAction = null;

function show(id) { for (const s of document.querySelectorAll('.step')) s.hidden = s.id !== id; }

// Version compare: "5.10.0" > "5.9.2"
function cmp(a, b) {
  const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}
const mb = (n) => `${Math.max(1, Math.round(n / 1048576))} MB`;

function chosen() { return info.versions.find((v) => v.version === $('o-version').value); }

function describe() {
  const v = chosen();
  const go = $('w-go');
  if (!v) { go.disabled = true; return; }
  go.disabled = false;
  const note = $('v-note');
  note.className = '';
  if (!info.installed) {
    $('w-title').textContent = 'Install Goat Browser';
    $('w-sub').textContent = 'Private, fast, and yours. Takes about a minute.';
    go.textContent = 'Install';
    note.textContent = `${mb(v.size)} download.`;
    return;
  }
  const c = cmp(v.version, info.installed);
  $('w-title').textContent = c > 0 ? 'Update Goat Browser' : c === 0 ? 'Reinstall Goat Browser' : 'Go back to an older Goat';
  $('w-sub').textContent = c > 0 ? `Version ${info.installed} → ${v.version}. Your tabs, cookies and settings are kept.`
    : c === 0 ? `Reinstall version ${v.version}. Your tabs, cookies and settings are kept.`
      : `Version ${info.installed} → ${v.version}.`;
  go.textContent = c > 0 ? 'Update' : c === 0 ? 'Reinstall' : 'Go back';
  if (c < 0) {
    note.textContent = 'Older versions may reset your bookmarks, history and logins. Close Goat first.';
    note.className = 'warn';
  } else {
    note.textContent = `${mb(v.size)} download. You have ${info.installed}.`;
  }
}

function fillVersions() {
  const sel = $('o-version');
  sel.textContent = '';
  for (const v of info.versions) {
    const o = document.createElement('option');
    o.value = v.version;
    o.textContent = v.latest ? `${v.version} (newest)` : v.version;
    sel.append(o);
  }
  sel.disabled = !info.versions.length;
  describe();
}

function doInstall() {
  const v = chosen();
  if (!v) return;
  lastAction = doInstall;
  const c = info.installed ? cmp(v.version, info.installed) : 1;
  $('p-title').textContent = !info.installed ? 'Installing…' : c > 0 ? 'Updating…' : c === 0 ? 'Reinstalling…' : 'Going back…';
  $('p-step').textContent = 'Getting ready…';
  $('p-bar').style.width = '0%';
  $('p-pct').textContent = '0%';
  show('s-work');
  send('install', { version: v.version, desktop: $('o-desktop').checked, makeDefault: $('o-default').checked });
}

function loadVersions() {
  lastAction = loadVersions;
  $('v-note').textContent = 'Looking for versions…';
  $('v-note').className = '';
  $('w-go').disabled = true;
  show('s-welcome');
  send('versions');
}

if (host) {
  host.addEventListener('message', (e) => {
    const m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    if (m.type === 'versions') {
      info = m;
      fillVersions();
    } else if (m.type === 'progress') {
      $('p-step').textContent = m.step;
      $('p-bar').style.width = m.pct + '%';
      $('p-pct').textContent = m.pct + '%';
    } else if (m.type === 'done') {
      const was = info.installed;
      info.installed = m.version;
      $('d-title').textContent = !was ? 'Goat Browser is ready' : cmp(m.version, was) > 0 ? 'Goat Browser is updated' : `Goat Browser ${m.version} is installed`;
      $('d-sub').textContent = !was ? 'Find it in the Start menu any time.' : `You're on version ${m.version}.`;
      show('s-done');
    } else if (m.type === 'error') {
      $('e-msg').textContent = m.message;
      show('s-error');
    }
  });
}

// Dragging the window by its title bar
$('bar').addEventListener('mousedown', (e) => { if (e.button === 0 && !e.target.closest('button')) send('drag'); });
$('min').onclick = () => send('minimize');
$('x').onclick = () => send('close');
$('w-cancel').onclick = () => send('close');
$('d-close').onclick = () => send('close');
$('e-close').onclick = () => send('close');
$('d-open').onclick = () => send('launch');
$('w-go').onclick = doInstall;
$('o-version').onchange = describe;
$('e-retry').onclick = () => (lastAction ? lastAction() : loadVersions());
document.addEventListener('contextmenu', (e) => e.preventDefault());

const dark = matchMedia('(prefers-color-scheme: dark)');
const theme = () => { document.documentElement.dataset.theme = dark.matches ? 'midnight' : 'daylight'; };
dark.addEventListener('change', theme);
theme();
loadVersions();
