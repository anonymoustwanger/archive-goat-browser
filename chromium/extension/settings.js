import { $ } from './common.js';

const ask = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });
const SHIELD = [
  ['canvas', 'Canvas noise', 'Adds tiny changes to canvas images so they can’t identify you.'],
  ['rects', 'Layout noise', 'Slightly changes element sizes reported to scripts.'],
  ['measureText', 'Text measure noise', 'Slightly changes text sizes reported to scripts.'],
  ['webgl', 'Hide graphics card', 'Sites see a generic WebGL renderer name.'],
  ['pings', 'Block link pings', 'Stops sites from tracking which links you click.'],
  ['clientHints', 'Remove client hints', 'Sends fewer details about your device. A few sites may act oddly.'],
  ['systemInfo', 'Fewer system details', 'Reports 2 CPU cores and less about your system.'],
  ['referrers', 'Short referrers', 'Other sites only see the site you came from, not the page.'],
];

function restartNote(r, el) {
  if (r && r.error) { el.textContent = 'Couldn’t save startup settings: ' + r.error; el.className = 'note err'; return; }
  if (r && r.restart) { el.textContent = 'Saved. Restart Goat to finish applying it.'; el.className = 'note ok'; }
}

async function render() {
  const st = await ask('state');
  const s = st.settings;
  $('#version').textContent = st.version;

  // profiles
  const box = $('#profiles');
  box.textContent = '';
  for (const [name, p] of Object.entries(st.profiles)) {
    const b = document.createElement('button');
    b.className = s.profile === name ? 'on' : '';
    b.innerHTML = '<b></b><small></small>';
    b.querySelector('b').textContent = p.label;
    b.querySelector('small').textContent = p.about;
    b.addEventListener('click', async () => {
      const r = await ask('applyProfile', { name });
      await render();
      restartNote(r, $('#profileNote'));
    });
    box.append(b);
  }
  if (s.profile === 'custom') $('#profileNote').textContent = 'Custom: you changed the shield below.';

  // shield
  const sh = $('#shield');
  sh.textContent = '';
  for (const [key, title, about] of SHIELD) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = '<div class="grow"><b></b><small></small></div><label class="switch"><input type="checkbox"><span></span></label>';
    row.querySelector('b').textContent = title;
    row.querySelector('small').textContent = about;
    const input = row.querySelector('input');
    input.checked = !!s.shield[key];
    input.addEventListener('change', async () => {
      const r = await ask('setShield', { change: { [key]: input.checked } });
      restartNote(r, $('#shieldNote'));
      render();
    });
    sh.append(row);
  }

  // tor
  $('#torNormal').checked = s.tor.normal;
  $('#torNormal').disabled = st.torWindow;
  $('#torNote').textContent = st.tor.state === 'error' ? st.tor.error : '';
  $('#torNote').className = 'note err';

  // translation
  const to = $('#to');
  if (!to.options.length) {
    for (const [code, name] of Object.entries(st.languages).sort((a, b) => a[1].localeCompare(b[1]))) to.add(new Option(name, code));
  }
  to.value = s.translate.to;
  $('#engine').value = s.translate.engine;
  $('#libreUrl').value = s.translate.libreUrl;
  $('#libreKey').value = s.translate.libreKey;
  $('#offer').checked = s.translate.offer;
  $('#auto').checked = s.translate.auto;
  for (const el of document.querySelectorAll('[data-libre]')) el.hidden = s.translate.engine !== 'libre';

  // updates
  $('#autoUpdate').checked = s.updates.auto;
  const u = s.updates;
  $('#updateStatus').textContent = st.update ? `Goat ${u.latest.replace(/^v/, '')} is ready to download.`
    : u.error ? `Last check failed: ${u.error}`
      : u.lastCheck ? `Up to date. Last checked ${new Date(u.lastCheck).toLocaleString()}.` : 'Not checked yet.';
}

$('#torNormal').addEventListener('change', async (e) => {
  const r = await ask('torNormal', { on: e.target.checked });
  if (r && r.error) { $('#torNote').textContent = r.error; e.target.checked = false; }
});
$('#torWindow').addEventListener('click', async () => {
  const r = await ask('torWindow');
  $('#torNote').textContent = r && r.error ? 'Couldn’t open a Tor window: ' + r.error : '';
});

const tr = (key, value) => ask('setTranslate', { change: { [key]: value } }).then(render);
$('#to').addEventListener('change', (e) => tr('to', e.target.value));
$('#engine').addEventListener('change', (e) => tr('engine', e.target.value));
$('#libreUrl').addEventListener('change', (e) => tr('libreUrl', e.target.value.trim()));
$('#libreKey').addEventListener('change', (e) => tr('libreKey', e.target.value.trim()));
$('#offer').addEventListener('change', (e) => tr('offer', e.target.checked));
$('#auto').addEventListener('change', (e) => tr('auto', e.target.checked));

$('#autoUpdate').addEventListener('change', (e) => ask('setUpdates', { change: { auto: e.target.checked } }).then(render));
$('#checkNow').addEventListener('click', async () => {
  $('#checkNow').disabled = true;
  $('#updateStatus').textContent = 'Checking…';
  await ask('checkUpdates');
  $('#checkNow').disabled = false;
  render();
});

for (const el of document.querySelectorAll('[data-open]')) {
  el.addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: el.dataset.open }); });
}

$('#uninstall').addEventListener('click', async () => {
  const r = await ask('uninstall');
  if (r && r.error) $('#helper').textContent = /linux/i.test(navigator.userAgent) ? r.error : 'Couldn’t start the uninstaller: ' + r.error + '. Use Windows Settings → Apps instead.';
});

ask('helper').then((r) => {
  $('#helper').textContent = r && r.ok ? `Goat helper ${r.version} · ${r.torInstalled ? 'Tor ' + (r.torVersion || 'included') : 'Tor missing (reinstall Goat)'}`
    : 'Goat helper not found (Tor and startup settings need it). Reinstall Goat to fix this.';
});

chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'tor') render(); });
render();
