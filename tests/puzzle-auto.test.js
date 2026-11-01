const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('app/static/app.js', 'utf8');
async function scenario(mode, turn, stale = false) {
  let callback, refreshed = 0, notice = '';
  const ctx = vm.createContext({
    S: {puzzle: true, epoch: 1, puzzlePlacement: 'target', puzzleFlipped: false},
    puzzleFollowFen: 'old w - - 0 1', puzzleAutoTimer: null,
    $: () => ({checked: true, value: 'w'}),
    setTimeout: fn => { callback = fn; },
    api: async () => {
      if (stale) ctx.S.epoch++;
      return {mode, plies: [{fen: `target ${turn} - - 0 1`}]};
    },
    clearPuzzleRecommendation: message => { notice = message; },
    refresh: async () => { refreshed++; },
  });
  const start = source.indexOf('function schedulePuzzleReply()');
  vm.runInContext(source.slice(start, source.indexOf("$('#puzzle-engine').value", start)), ctx);
  ctx.schedulePuzzleReply();
  await callback();
  return {refreshed, notice, ctx};
}
(async () => {
  assert.equal((await scenario('append', 'b')).refreshed, 0, 'Do not search after our own move');
  assert.equal((await scenario('append', 'w')).refreshed, 1, 'Search after opponent reply');
  const jump = await scenario('reset', 'w');
  assert.equal(jump.refreshed, 0);
  assert.equal(jump.ctx.puzzleFollowFen, null, 'Unknown jumps require a fresh manual anchor');
  assert.equal((await scenario('append', 'w', true)).refreshed, 0, 'Discard stale transitions');
  console.log('Puzzle auto-analysis: own move, reply, jump, stale response PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
