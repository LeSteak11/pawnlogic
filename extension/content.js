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
    const pc = p.className.match(/\b([wb])([pnbrqk])\b/), sq = p.className.match(/square-(\d)(\d)/);
    if (!pc || !sq) continue;
    const f = +sq[1] - 1, r = +sq[2] - 1;
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;
    grid[7 - r][f] = pc[1] === "w" ? pc[2].toUpperCase() : pc[2];
  }
  const placement = toPlacement(grid);
  return placement && { placement, flipped: b.classList.contains("flipped") };
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
  return placement && { placement, flipped: black };
}

const readBoard = IS_LICHESS ? readLichess : readChesscom;
let last = "", lastSent = 0, timer;
function push(force) {
  const s = readBoard();
  if (!s) return;
  const key = s.placement + s.flipped;
  if (key === last && !force) return;
  last = key; lastSent = Date.now();
  chrome.runtime.sendMessage(s);
}
new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => push(false), 150); })
  .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style"] });
setInterval(() => push(Date.now() - lastSent > 2000), 1000); // heartbeat so Chess Lab can show "connected"
