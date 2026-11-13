import { $ } from './common.js';

const ask = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });

function show(t) {
  $('#bar').style.width = `${t.state === 'on' ? 100 : t.progress || 0}%`;
  if (t.state === 'on') {
    $('#status').textContent = 'Connected.';
    location.replace('newtab.html');
  } else if (t.state === 'error') {
    $('#status').textContent = t.error || 'Tor stopped.';
    $('#status').className = 'err';
  } else {
    $('#status').textContent = `Connecting to Tor… ${Math.round(t.progress || 0)}%`;
    $('#status').className = '';
  }
}

chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'tor') show(m.tor); });
await ask('torWindowReady');
show((await ask('state')).tor);
