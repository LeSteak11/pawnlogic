// Exercise the actual worker and reader with the restored manifest, without
// requiring a logged-in chess account or making moves on a website.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
const background = fs.readFileSync('extension/background.js', 'utf8');
const content = fs.readFileSync('extension/content.js', 'utf8');
for (const permission of ['scripting', 'alarms', 'storage']) assert(manifest.permissions.includes(permission));
for (const block of manifest.content_scripts) {
  for (const match of block.matches) assert(manifest.host_permissions.includes(match), `Reconnect needs host access: ${match}`);
}
const routes = manifest.content_scripts.flatMap(s => s.matches);
let queried;
const injected = [];
// reattach is defined in the same context; capture its requested URL list.
const worker = vm.createContext({
  chrome: {
    runtime: {getManifest: () => manifest, onMessage: {addListener() {}}, onInstalled: {addListener() {}}, onStartup: {addListener() {}}},
    alarms: {create() {}, onAlarm: {addListener() {}}},
    tabs: {query: async filter => {queried = filter.url; return [{id: 42}];}},
    scripting: {executeScript: async request => {injected.push(request);}}
  }
});
vm.runInContext(background, worker);
const reattachDone = worker.reattach();
assert.deepEqual(Array.from(queried), routes);

function readPage(pathname, orientation = 'class', navigateTo = null) {
  const messages = [];
  let heartbeat;
  let now = 10000;
  const location = {hostname: 'www.chess.com', origin: 'https://www.chess.com', pathname};
  const pieces = [
    {className: 'piece wk square-51', classList: {contains: () => false}},
    {className: 'piece bk square-58', classList: {contains: () => false}}
  ];
  for (const piece of pieces) {
    piece.getBoundingClientRect = () => {
      const rank = Number(piece.className.match(/square-\d(\d)/)[1]) - 1;
      return {left: (orientation === 'black' ? 3 : 4) * 100,
        top: (orientation === 'black' ? rank : 7 - rank) * 100, width: 100, height: 100};
    };
  }
  const board = {querySelectorAll: () => pieces, classList: {contains: name => name === 'flipped' && orientation !== 'black'},
    getBoundingClientRect: () => ({left: 0, top: 0, width: orientation === 'class' ? 0 : 800, height: 800})};
  const context = vm.createContext({
    location,
    Date: {now: () => now},
    chrome: {runtime: {id: 'test', getManifest: () => manifest, sendMessage: m => messages.push(m), onMessage: {addListener() {}}}},
    window: {addEventListener() {}, removeEventListener() {}},
    document: {body: {}, querySelector: selector => selector === 'wc-chess-board, chess-board' ? board : null, addEventListener() {}, removeEventListener() {}},
    MutationObserver: class {observe() {} disconnect() {}},
    setInterval(callback) {heartbeat = callback;}, clearInterval() {}, setTimeout() {}, clearTimeout() {}
  });
  vm.runInContext(content, context);
  // Reinjection must reuse the live reader and resend rather than duplicate it.
  vm.runInContext(content, context);
  if (navigateTo) {
    location.pathname = navigateTo;
    context.window.__chessLabSync.resend();
    now += 3000;
    heartbeat();
  }
  return messages;
}
for (const path of ['/play/computer', '/game/computer/123', '/play/online', '/game/', '/game/184987758842']) {
  const messages = readPage(path);
  assert.equal(messages.length, 2, `Initial read + reconnect must report ${path}`);
  assert.equal(messages[0].site, 'chess.com');
  assert.equal(messages[0].flipped, true);
  assert.equal(messages[1].focused, true);
}
assert.equal(readPage('/news').length, 0, 'Do not silently broaden the manifest routes');
assert.equal(readPage('/game/123').length, 2, 'Online game IDs must remain supported');
assert.equal(readPage('/play/online', 'black', '/game/184987758842').length, 4,
  'An injected lobby reader must keep reporting after SPA navigation to a live game');
assert.equal(readPage('/play/online', 'black', '/news').length, 2,
  'Navigating away from game routes must stop reporting');
assert.equal(readPage('/play/online', 'black')[0].flipped, true, 'Detect Black from rendered squares');
assert.equal(readPage('/play/online', 'white')[0].flipped, false, 'Screen geometry wins over a stale flipped class');
reattachDone.then(() => {
  assert.equal(injected.length, 1);
  assert.equal(injected[0].target.tabId, 42);
  assert.equal(injected[0].files[0], 'content.js');
  console.log('Manifest routes, worker startup, reader snapshots and reinjection: PASS');
});
