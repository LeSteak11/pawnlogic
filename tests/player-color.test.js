const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('app/static/app.js', 'utf8');
const nodes = new Map();
const requests = [];
const context = vm.createContext({
  $: selector => {
    if (!nodes.has(selector)) nodes.set(selector, {checked: true, value: '', textContent: '', className: ''});
    return nodes.get(selector);
  },
  store: {get: (_key, fallback) => fallback, set() {}},
  S: {orient: 'white', cursor: 0, plies: [], startFen: 'start', viewing: null, st: {turn: 'black'}},
  E: {on: false}, START: 'start', drawBoard() {}, buildPalette() {}, renderStatus() {}, renderMoves() {}, analyse() {},
  renderRecHead() {}, updateClock() {}, renderBanner() {}, refresh() {},
  api: async (_url, body) => {requests.push(body); return {mode: 'reset', color: 'white', fen: 'reset'};},
  newGame(fen) {context.S.startFen = fen;},
  setTimeout() {}, requestSyncReconnect() {}
});
const colorStart = source.indexOf('let playerColor =');
vm.runInContext(source.slice(colorStart, source.indexOf('$("#only-mine").checked', colorStart)), context);
vm.runInContext(source.slice(source.indexOf('let syncSeq ='), source.indexOf('$("#sync-on").checked = store.get')), context);
(async () => {
  context.choosePlayerColor('black');
  for (let seq = 1; seq <= 3; seq++) {
    await context.syncTick({connected: true, placement: 'start', flipped: false, site: 'chess.com', seq});
    assert.equal(context.S.orient, 'black', 'Heartbeat and resets must retain the manual color');
    assert.equal(requests.at(-1).flipped, true, 'Position reconstruction must use the selected color');
  }
  assert.equal(nodes.get('#player-color').value, 'black');
  context.choosePlayerColor('auto');
  assert.equal(context.S.orient, 'white', 'Auto explicitly restores extension orientation');
  nodes.get('#btn-flip').onclick();
  await context.syncTick({connected: true, placement: 'start', flipped: false, site: 'chess.com', seq: 4});
  assert.equal(context.S.orient, 'black', 'Flip must remain in effect during auto-sync');
  console.log('Manual color, Flip, sync heartbeats, resets and Auto restoration: PASS');
})().catch(error => {console.error(error); process.exitCode = 1;});
