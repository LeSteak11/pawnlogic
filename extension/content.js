// Read-only: reports piece placement and board orientation. It never clicks, types or moves anything on the page.
const FILES = "abcdefgh";
function readBoard() {
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
  const flat = grid.flat();
  if (!flat.includes("K") || !flat.includes("k")) return null;
  const placement = grid.map((row) => {
    let s = "", n = 0;
    for (const c of row) { if (c) { if (n) s += n; n = 0; s += c; } else n++; }
    return s + (n || "");
  }).join("/");
  return { placement, flipped: b.classList.contains("flipped") };
}
let last = "", lastSent = 0, timer;
function push(force) {
  const s = readBoard();
  if (!s) return;
  const key = s.placement + s.flipped;
  if (key === last && !force) return;
  last = key; lastSent = Date.now();
  chrome.runtime.sendMessage(s);
}
new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => push(false), 120); })
  .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
setInterval(() => push(Date.now() - lastSent > 2000), 1000); // heartbeat so Chess Lab can show "connected"
