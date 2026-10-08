// Read-only: reports piece placement and board orientation for computer games. It never clicks, types or moves anything.
const IS_LICHESS = location.hostname === "lichess.org";

function toPlacement(grid) { // grid[0] = rank 8
  const flat = grid.flat();
  if (!flat.includes("K") || !flat.includes("k")) return null;
  return grid.map((row) => {
    let s = "", n = 0;
    for (const c of row) { if (c) { if (n) s += n; n = 0; s += c; } else n++; }
    return s + (n || "");
  }).join("/");
}

function readChesscom() {
  const b = document.querySelector("wc-chess-board, chess-board");
  if (!b) return null;
  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const p of b.querySelectorAll(".piece")) {
    if (p.classList.contains("dragging")) return null; // mid-drag: wait for the drop
    const pc = p.className.match(/\b([wb])([pnbrqk])\b/), sq = p.className.match(/square-(\d)(\d)/);
    if (!pc || !sq) continue;
    const f = +sq[1] - 1, r = +sq[2] - 1;
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;
    if (grid[7 - r][f]) return null; // two pieces on one square = capture still animating: skip this frame
    grid[7 - r][f] = pc[1] === "w" ? pc[2].toUpperCase() : pc[2];
  }
  const placement = toPlacement(grid);
  const opp = document.querySelector('.player-top [data-test-element="user-tagline-username"], #board-layout-player-top .user-username-component, .player-top .user-username-component');
  return placement && { placement, flipped: b.classList.contains("flipped"), opponent: opp ? opp.textContent.trim().slice(0, 60) : "" };
}

// Lichess: only games against Stockfish ("Stockfish level N"); pieces are positioned by pixel offsets.
const LETTER = { pawn: "p", knight: "n", bishop: "b", rook: "r", queen: "q", king: "k" };
function readLichess() {
  const top = document.querySelector(".ruser-top");
  if (!top || !/^\s*Stockfish level \d/i.test(top.textContent)) return null;
  const board = document.querySelector("cg-board"), wrap = document.querySelector(".cg-wrap");
  if (!board || !wrap) return null;
  const size = board.getBoundingClientRect().width / 8;
  if (!size) return null;
  const black = wrap.classList.contains("orientation-black");
  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const p of board.querySelectorAll("piece")) {
    if (p.classList.contains("dragging")) return null; // being dragged: wait (animating pieces fail the on-square check below)
    if (p.classList.contains("ghost") || p.classList.contains("fading")) continue;
    const m = (p.style.transform || "").match(/translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/);
    const kind = (p.className.match(/\b(pawn|knight|bishop|rook|queen|king)\b/) || [])[1];
    const white = p.classList.contains("white");
    if (!m || !kind || (!white && !p.classList.contains("black"))) continue;
    const cx = +m[1] / size, cy = +m[2] / size, col = Math.round(cx), row = Math.round(cy);
    if (Math.abs(cx - col) > 0.2 || Math.abs(cy - row) > 0.2 || col < 0 || col > 7 || row < 0 || row > 7) return null;
    const file = black ? 7 - col : col, rankFromTop = black ? 7 - row : row;
    grid[rankFromTop][file] = white ? LETTER[kind].toUpperCase() : LETTER[kind];
  }
  const placement = toPlacement(grid);
  return placement && { placement, flipped: black, opponent: top.textContent.trim().replace(/\s+/g, " ").slice(0, 60) };
}

// Clocks: bottom = your side, top = the opponent. Seconds, or null when the game has no clock.
function clockSecs(el) {
  const m = el && el.textContent.trim().match(/^(?:(\d+):)?(\d+):(\d+)(?:[.,](\d))?$/);
  return m ? (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +m[4] / 10 : 0) : null;
}
function readClocks() {
  const q = (s) => document.querySelector(s);
  return IS_LICHESS
    ? { my_clock: clockSecs(q(".rclock-bottom .time")), opp_clock: clockSecs(q(".rclock-top .time")) }
    : { my_clock: clockSecs(q(".clock-bottom .clock-time-monospace, .clock-bottom")), opp_clock: clockSecs(q(".clock-top .clock-time-monospace, .clock-top")) };
}

const readBoard = IS_LICHESS ? readLichess : readChesscom;
const SITE = IS_LICHESS ? "lichess" : "chess.com";
let last = "", lastClock = "", lastSent = 0, timer = null;
function push(force, focused = false) {
  const s = readBoard();
  if (!s) return;
  const key = s.placement + s.flipped, clk = readClocks(), ck = clk.my_clock + "|" + clk.opp_clock;
  if (key === last && !force && !(ck !== lastClock && Date.now() - lastSent > 900)) return; // clocks: about once a second
  last = key; lastClock = ck; lastSent = Date.now();
  chrome.runtime.sendMessage({ ...s, ...clk, site: SITE, focused });
}
// Read soon after the board changes, but never let a busy page (clocks, animations) starve the read.
new MutationObserver(() => { if (!timer) timer = setTimeout(() => { timer = null; push(false); }, 60); })
  .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style"] });
setInterval(() => push(Date.now() - lastSent > 2000), 1000); // heartbeat so Chess Lab can show "connected"
// Switching to this tab makes it the game Chess Lab follows.
const claim = () => { if (document.visibilityState === "visible") push(true, true); };
window.addEventListener("focus", claim);
document.addEventListener("visibilitychange", claim);
