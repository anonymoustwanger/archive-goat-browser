'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// <browser-action-list> element for extension toolbar buttons. This file is
// bundled to preload.bundle.js (npm run build) because sandboxed preloads
// can't require npm modules.
const { injectBrowserAction } = require('electron-chrome-extensions/browser-action');

injectBrowserAction();

// Extensions menu: open an extension's popup (or fire its onClicked) the same
// way a toolbar button does, anchored to the extensions button.
ipcRenderer.on('ext-activate', (_e, extensionId, tabId, rect) => {
  const r = rect || { x: 0, y: 0, width: 0, height: 0 };
  ipcRenderer.invoke('crx-msg-remote', 'persist:goat', 'browserAction.activate', {
    eventType: 'click', extensionId, tabId, alignment: 'bottom left',
    anchorRect: { x: r.x, y: r.y, width: r.width, height: r.height },
  }).catch(() => {});
});

const OUT = new Set(['navigate', 'new-tab', 'close-tab', 'activate', 'back', 'forward',
  'reload', 'stop', 'settings', 'tor-settings', 'tor-toggle', 'tor-menu', 'translate', 'translate-menu', 'shield', 'focus-page', 'find', 'find-stop',
  'tab-menu', 'group-menu', 'group-toggle', 'group-rename', 'move-tab',
  'merge-tabs', 'move-group', 'add-to-group',
  'bm-open', 'bm-star', 'bm-menu', 'bm-bar-menu', 'bm-folder', 'bm-overflow', 'bm-move', 'bm-rename', 'bm-add-tab', 'preconnect', 'ext-menu', 'new-tab-menu', 'app-menu']);
const IN = new Set(['state', 'focus-address', 'find-open', 'find-close', 'find-result', 'toast', 'rename-group', 'appearance', 'bm-rename-start']);

contextBridge.exposeInMainWorld('goat', {
  platform: process.platform,
  send: (channel, ...args) => { if (OUT.has(channel)) ipcRenderer.send(channel, ...args); },
  on: (channel, fn) => { if (IN.has(channel)) ipcRenderer.on(channel, (_e, ...args) => fn(...args)); },
});
