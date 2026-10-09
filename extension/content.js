// Read-only: reports piece placement and orientation on the pages allowed by the manifest.
// It never clicks, types or moves anything.
// Wrapped so Chess Lab's "Reconnect" can inject it again into an open tab without doubling up.
(() => {
const alive = () => { try { return !!chrome.runtime.id; } catch { return false; } };
if (window.__chessLabSync && window.__chessLabSync.alive()) { window.__chessLabSync.resend(); return; }
const IS_LICHESS = location.hostname === "lichess.org";
const GAME_URLS = chrome.runtime.getManifest().content_scripts.flatMap((s) => s.matches);
function allowedPage() {
  // Match the manifest's URL globs, including SPA navigation after injection.
  // Do not impose a second, narrower hard-coded list of Chess.com routes.
  return GAME_URLS.some((pattern) => {
    const expression = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp("^" + expression + "$").test(location.origin + location.pathname);
  });
}

function toPlacement(grid) { // grid[0] = rank 8
  const flat = grid.flat();
  if (!flat.includes("K") || !flat.includes("k")) return null;
  return grid.map((row) => {
    let s = "", n = 0;
    for (const c of row) { if (c) { if (n) s += n; n = 0; s += c; } else n++; }
    return s + (n || "");
  }).join("/");
}

function chesscomFlipped(board) {
  // Board class names vary between Chess.com's layouts. The actual screen
  // positions of known squares provide an independent orientation signal.
  const bounds = board.getBoundingClientRect();
  let white = 0, black = 0;
  if (bounds.width > 0 && bounds.height > 0) {
    for (const piece of board.querySelectorAll(".piece")) {
      const square = piece.className.match(/square-([1-8])([1-8])/);
      if (!square || piece.classList.contains("dragging")) continue;
      const rect = piece.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const f = +square[1] - 1, r = +square[2] - 1;
      const x = ((rect.left + rect.width / 2 - bounds.left) / bounds.width) * 8 - .5;
      const y = ((rect.top + rect.height / 2 - bounds.top) / bounds.height) * 8 - .5;
      if (Math.abs(x - f) < .35 && Math.abs(y - (7 - r)) < .35) white++;
      if (Math.abs(x - (7 - f)) < .35 && Math.abs(y - r) < .35) black++;
    }
  }
  if (black >= 2 && black > white) return true;
  if (white >= 2 && white > black) return false;
  return board.classList.contains("flipped");
}

function readChesscom() {
  if (!allowedPage()) return null;
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
  return placement && { placement, flipped: chesscomFlipped(b), opponent: opp ? opp.textContent.trim().slice(0, 60) : "" };
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

const readBoard = IS_LICHESS ? readLichess : readChesscom;
const SITE = IS_LICHESS ? "lichess" : "chess.com";
let last = "", lastSent = 0, timer = null;
function push(force, focused = false) {
  const s = readBoard();
  if (!s) return;
  const key = s.placement + s.flipped;
  if (key === last && !force) return;
  last = key; lastSent = Date.now();
  if (!alive()) return stop(); // extension was reloaded: this copy retires (a fresh one gets injected)
  try { chrome.runtime.sendMessage({ ...s, site: SITE, focused }); } catch { stop(); }
}
// Read soon after the board changes, but never let a busy page (clocks, animations) starve the read.
const mo = new MutationObserver(() => { if (!timer) timer = setTimeout(() => { timer = null; push(false); }, 60); });
mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style"] });
const beat = setInterval(() => push(Date.now() - lastSent > 2000), 1000); // heartbeat so Chess Lab can show "connected"
function stop() { mo.disconnect(); clearInterval(beat); window.removeEventListener("focus", claim); document.removeEventListener("visibilitychange", claim); }
// Switching to this tab makes it the game Chess Lab follows.
const claim = () => { if (document.visibilityState === "visible") push(true, true); };
window.addEventListener("focus", claim);
document.addEventListener("visibilitychange", claim);
chrome.runtime.onMessage.addListener((m) => { if (m && m.cmd === "resend") push(true, true); }); // Chess Lab asked for a fresh snapshot
window.__chessLabSync = { alive, resend: () => push(true, true) };
push(true);
})();
