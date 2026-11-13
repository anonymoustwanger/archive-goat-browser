import { $ } from './common.js';

const ask = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const tabId = tab && tab.id;
const webPage = !!(tab && /^https?:/.test(tab.url || ''));

function torLine(t) {
  if (t.state === 'on') return 'Connected to Tor.';
  if (t.state === 'starting') return `Connecting to Tor… ${Math.round(t.progress || 0)}%`;
  if (t.state === 'error') return t.error || 'Tor stopped.';
  return '';
}

function showTor(st) {
  const t = st.tor;
  if (st.torWindow) {
    $('#torwin').hidden = false;
    $('#tor').hidden = true;
    const line = torLine(t);
    $('#torwinText').textContent = t.state === 'on' || !line ? 'Everything in this window goes through Tor. Nothing is saved after you close it.' : line;
    $('#torwinText').className = t.state === 'error' ? 'err' : 'muted';
    $('#torwinBar').hidden = t.state !== 'starting';
    $('#torwinBar i').style.width = `${t.progress || 0}%`;
    return;
  }
  const on = st.settings.tor.normal;
  $('#torToggle').checked = on;
  $('#circuit').hidden = !(on && t.state === 'on');
  $('#torBar').hidden = !(on && t.state === 'starting');
  $('#torBar i').style.width = `${t.progress || 0}%`;
  const line = on ? torLine(t) : '';
  $('#torText').textContent = line || (st.proxyControl === 'controlled_by_other_extensions' ? 'A VPN extension controls the proxy right now.' : 'Send this browser’s traffic through Tor.');
  $('#torText').className = on && t.state === 'error' ? 'err' : 'muted';
}

async function render() {
  const st = await ask('state', { tabId });
  $('#version').textContent = st.version;
  showTor(st);

  const lang = st.offer && (st.languages[st.offer] || st.languages[st.offer.split('-')[0]] || st.offer);
  const to = st.languages[st.settings.translate.to] || st.settings.translate.to;
  $('#translate').disabled = !webPage || st.translated === 'busy';
  $('#translate').textContent = st.translated === 'busy' ? 'Translating…' : st.translated === 'done' ? 'Translate again' : 'Translate';
  $('#original').hidden = st.translated !== 'done';
  $('#trText').textContent = !webPage ? 'Open a website to translate it.'
    : lang ? `This page looks like ${lang}. Translate to ${to}.` : `Translate this page to ${to}.`;

  $('#update').hidden = !st.update;
  if (st.update) $('#updateText').textContent = `Goat ${st.update.latest.replace(/^v/, '')} is out (you have ${st.version}).`;
  window.__update = st.update;
}

$('#torToggle').addEventListener('change', async (e) => {
  const r = await ask('torNormal', { on: e.target.checked });
  if (r && r.error) { $('#torText').textContent = r.error; $('#torText').className = 'err'; e.target.checked = false; return; }
  render();
});
$('#torWindow').addEventListener('click', async () => {
  const r = await ask('torWindow');
  if (r && r.error) { $('#torText').textContent = 'Couldn’t open a Tor window: ' + r.error; $('#torText').className = 'err'; return; }
  window.close();
});
for (const id of ['#circuit', '#circuit2']) {
  $(id).addEventListener('click', async (e) => {
    const r = await ask('newCircuit');
    e.target.textContent = r && r.ok ? 'New circuit ✓' : 'Failed';
    setTimeout(() => { e.target.textContent = 'New circuit'; }, 1500);
  });
}
$('#translate').addEventListener('click', async () => {
  $('#translate').disabled = true;
  $('#translate').textContent = 'Translating…';
  const r = await ask('translate', { tabId });
  if (r && r.error) { $('#trText').textContent = r.error; $('#trText').className = 'err'; $('#translate').disabled = false; $('#translate').textContent = 'Try again'; return; }
  render();
});
$('#original').addEventListener('click', async () => { await ask('original', { tabId }); render(); });
$('#getUpdate').addEventListener('click', () => { if (window.__update) chrome.tabs.create({ url: window.__update.url || window.__update.page }); window.close(); });
$('#settings').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });
$('#privateWin').addEventListener('click', () => { chrome.windows.create({ incognito: true }); window.close(); });

chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'tor') render(); });
render();
