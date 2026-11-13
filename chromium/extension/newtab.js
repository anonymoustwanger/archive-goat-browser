import { $ } from './common.js';

const { torInstance } = await chrome.storage.local.get('torInstance');
if (torInstance) { $('#tornote').hidden = false; document.title = 'New Tor tab'; }

$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return;
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(q) || (/^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(q) && !q.includes(' '));
  if (looksLikeUrl) location.href = /^[a-z][a-z0-9+.-]*:\/\//i.test(q) ? q : 'https://' + q;
  else chrome.search.query({ text: q, disposition: 'CURRENT_TAB' });
});

const favicon = (url) => {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', url);
  u.searchParams.set('size', '32');
  return u.toString();
};

function tile(node, onFolder) {
  const el = document.createElement(node.url ? 'a' : 'button');
  el.className = 'tile';
  const icon = document.createElement('span');
  icon.className = 'ticon';
  if (node.url) {
    el.href = node.url;
    const img = document.createElement('img');
    img.src = favicon(node.url);
    img.alt = '';
    icon.append(img);
  } else {
    icon.textContent = '📁';
    el.type = 'button';
    el.addEventListener('click', () => onFolder(node));
  }
  const label = document.createElement('span');
  label.className = 'tlabel';
  label.textContent = node.title || (node.url ? new URL(node.url).hostname.replace(/^www\./, '') : 'Folder');
  el.title = node.url ? `${node.title}\n${node.url}` : node.title;
  el.append(icon, label);
  return el;
}

async function openFolder(node) {
  const kids = await chrome.bookmarks.getChildren(node.id);
  $('#foldername').textContent = node.title || 'Folder';
  const box = $('#foldertiles');
  box.textContent = '';
  for (const k of kids) box.append(tile(k, openFolder));
  $('#folder').hidden = false;
}
$('#folderclose').addEventListener('click', () => { $('#folder').hidden = true; });

async function render() {
  const [bar] = await chrome.bookmarks.getChildren('0');
  const items = bar ? await chrome.bookmarks.getChildren(bar.id) : [];
  const box = $('#tiles');
  box.textContent = '';
  for (const b of items.slice(0, 24)) box.append(tile(b, openFolder));
}
chrome.bookmarks.onCreated.addListener(render);
chrome.bookmarks.onRemoved.addListener(render);
chrome.bookmarks.onChanged.addListener(render);
render();
