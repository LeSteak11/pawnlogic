"use strict";
const $ = (s) => document.querySelector(s);
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

async function api(path, body, method) {
  const r = await fetch(path, body === undefined && !method ? {} : {
    method: method || "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `Request failed (${r.status})`);
  return data;
}
let toastTimer;
function toast(msg, err) {
  const t = $("#toast"); t.textContent = msg; t.className = "show" + (err ? " err" : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ""), err ? 4000 : 2200);
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- game state ---------- */
const S = {
  startFen: START, plies: [], cursor: 0, orient: "white", st: null, analysis: null, viewing: null,
  pick: -1, opts: null, optsFen: null, recIdx: 0, gameId: null, gameFinal: false, live: { site: "", opponent: "" }, // auto-save record for the game in progress
};
const fenAt = (i) => (i === 0 ? S.startFen : S.plies[i - 1].fen);
const curFen = () => fenAt(S.cursor);

function parseFen(fen) {
  const grid = [];
  for (const row of fen.split(" ")[0].split("/")) {
    const r = [];
    for (const ch of row) { if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) r.push(null); else r.push(ch); }
    grid.push(r);
  }
  return grid; // grid[0] = rank 8
}
const sqName = (f, r) => "abcdefgh"[f] + (r + 1);

/* ---------- board ---------- */
let selected = null;
const PIECE_FILE = { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "P" };
// "me" is the side drawn as cream pieces; the other side is always the dark steel set.
function boardSvg(fen, { flip = false, last = null, selected = null, legal = [], arrow = null, me = "white" } = {}) {
  const grid = parseFen(fen);
  let svg = `<svg viewBox="-4 0 84 84" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ah" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#4fae78"/></marker></defs>`;
  const pos = (f, r) => (flip ? [(7 - f) * 10, r * 10] : [f * 10, (7 - r) * 10]);
  svg += `<rect x="0" y="0" width="80" height="80" rx="2" class="bframe"/>`;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const [x, y] = pos(f, r), name = sqName(f, r), dark = (f + r) % 2 === 0;
    svg += `<rect x="${x}" y="${y}" width="10" height="10" class="${dark ? "sd" : "sl"}" data-sq="${name}"/>`;
    if (last && (last.slice(0, 2) === name || last.slice(2, 4) === name)) svg += `<rect x="${x + .4}" y="${y + .4}" width="9.2" height="9.2" rx="1" class="hl" pointer-events="none"/>`;
    if (selected === name) svg += `<rect x="${x + .4}" y="${y + .4}" width="9.2" height="9.2" rx="1" class="sel" pointer-events="none"/>`;
    const p = grid[7 - r][f];
    if (p) {
      const white = p === p.toUpperCase(), mine = (white ? "white" : "black") === me;
      svg += `<image href="/static/pieces/${mine ? "w" : "b"}${PIECE_FILE[p.toLowerCase()]}.svg" x="${x + .35}" y="${y + .35}" width="9.3" height="9.3" class="${mine ? "pm" : "po"}" pointer-events="none"/>`;
    }
  }
  for (let i = 0; i < 8; i++) {
    svg += `<text x="${i * 10 + 5}" y="83" text-anchor="middle" class="coord" pointer-events="none">${"abcdefgh"[flip ? 7 - i : i]}</text>`;
    svg += `<text x="-2" y="${i * 10 + 6.2}" text-anchor="middle" class="coord" pointer-events="none">${flip ? i + 1 : 8 - i}</text>`;
  }
  if (selected) for (const u of legal) if (u.startsWith(selected)) {
    const [x, y] = pos("abcdefgh".indexOf(u[2]), +u[3] - 1);
    svg += `<circle cx="${x + 5}" cy="${y + 5}" r="1.7" class="dot-legal" pointer-events="none"/>`;
  }
  if (arrow) {
    const [x1, y1] = pos("abcdefgh".indexOf(arrow[0]), +arrow[1] - 1), [x2, y2] = pos("abcdefgh".indexOf(arrow[2]), +arrow[3] - 1);
    svg += `<line x1="${x1 + 5}" y1="${y1 + 5}" x2="${x2 + 5}" y2="${y2 + 5}" stroke="#4fae78" stroke-opacity=".85" stroke-width="1.3" marker-end="url(#ah)" pointer-events="none"/>`;
  }
  return svg + "</svg>";
}
function drawBoard() {
  if (E.on) {
    $("#board").innerHTML = boardSvg(gridFen(), { flip: S.orient === "black", me: S.orient, selected: E.sel ? sqName(E.sel[0], 7 - E.sel[1]) : null });
    return;
  }
  const best = pickedCand();
  $("#board").innerHTML = boardSvg(curFen(), {
    flip: S.orient === "black", me: S.orient, last: S.cursor > 0 ? S.plies[S.cursor - 1].uci : null, selected,
    legal: S.st ? S.st.legal : [], arrow: best ? best.uci : null,
  });
}

/* ---------- free board editor ---------- */
const E = { on: false, grid: null, tool: "move", sel: null, turn: "w", castle: { K: true, Q: true, k: true, q: true } };
const OUTLINE = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙" };
function gridFen() {
  const place = E.grid.map((row) => {
    let o = "", n = 0;
    for (const c of row) { if (c) { if (n) o += n; n = 0; o += c; } else n++; }
    return o + (n || "");
  }).join("/");
  const g = (r, f) => E.grid[r][f];
  let c = "";
  if (E.castle.K && g(7, 4) === "K" && g(7, 7) === "R") c += "K";
  if (E.castle.Q && g(7, 4) === "K" && g(7, 0) === "R") c += "Q";
  if (E.castle.k && g(0, 4) === "k" && g(0, 7) === "r") c += "k";
  if (E.castle.q && g(0, 4) === "k" && g(0, 0) === "r") c += "q";
  return `${place} ${E.turn} ${c || "-"} - 0 1`;
}
function buildPalette() {
  const btn = (tool, inner, cls, title) => `<button data-tool="${tool}" class="${cls || ""}" title="${title || tool}">${inner}</button>`;
  const row = (own) => Object.keys(OUTLINE).map((k) => {
    const white = (S.orient === "white") === own;
    return btn(white ? k : k.toLowerCase(), `<img src="/static/pieces/${own ? "w" : "b"}${k}.svg" class="${own ? "pm" : "po"}" alt="${k}">`, "pc", `${own ? "Your" : "Opponent's"} ${PIECE_NAMES[k.toLowerCase()]}`);
  }).join("");
  $("#ed-palette").innerHTML = btn("move", "✥ Move", "tl") + btn("x", "✖ Erase", "tl") + row(true) + row(false);
  markTool();
}
function markTool() { document.querySelectorAll("#ed-palette button").forEach((b) => b.classList.toggle("active", b.dataset.tool === E.tool)); }
function startEdit() {
  const f = curFen().split(" ");
  E.on = true; E.grid = parseFen(curFen()).map((r) => r.slice()); E.sel = null; E.tool = "move";
  E.turn = f[1] || "w";
  for (const k of "KQkq") E.castle[k] = (f[2] || "").includes(k);
  $("#editor").classList.remove("hidden"); $("#move-form").classList.add("hidden");
  $("#ed-turn").value = E.turn;
  document.querySelectorAll("#ed-castle input").forEach((i) => (i.checked = E.castle[i.dataset.c]));
  buildPalette(); drawBoard();
}
function stopEdit() { E.on = false; $("#editor").classList.add("hidden"); $("#move-form").classList.remove("hidden"); drawBoard(); }
function editClick(sq) {
  const f = "abcdefgh".indexOf(sq[0]), r = 8 - +sq[1];
  if (E.tool === "x") E.grid[r][f] = null;
  else if (E.tool === "move") {
    if (E.sel) {
      const [sf, sr] = E.sel;
      if (!(sf === f && sr === r)) { E.grid[r][f] = E.grid[sr][sf]; E.grid[sr][sf] = null; }
      E.sel = null;
    } else if (E.grid[r][f]) E.sel = [f, r];
  } else E.grid[r][f] = E.tool;
  drawBoard();
}
$("#btn-edit").onclick = () => (E.on ? stopEdit() : startEdit());
$("#ed-palette").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { E.tool = b.dataset.tool; E.sel = null; markTool(); drawBoard(); } });
$("#ed-turn").onchange = (e) => (E.turn = e.target.value);
$("#ed-castle").addEventListener("change", (e) => (E.castle[e.target.dataset.c] = e.target.checked));
$("#ed-clear").onclick = () => { E.grid = Array.from({ length: 8 }, () => Array(8).fill(null)); E.sel = null; drawBoard(); };
$("#ed-start").onclick = () => { E.grid = parseFen(START).map((r) => r.slice()); E.turn = "w"; E.sel = null; for (const k of "KQkq") E.castle[k] = true; $("#ed-turn").value = "w"; document.querySelectorAll("#ed-castle input").forEach((i) => (i.checked = true)); drawBoard(); };
$("#ed-cancel").onclick = stopEdit;
$("#ed-done").onclick = async () => {
  const fen = gridFen();
  try {
    await api("/api/state", { fen });
    if (S.plies.length && !confirm("Applying this position starts a fresh game from it (the move list is cleared). Continue?")) return;
    stopEdit(); newGame(fen); toast("Position set");
  } catch (err) { toast(err.message, true); }
};

$("#board").addEventListener("click", (e) => {
  const sq = e.target.dataset && e.target.dataset.sq;
  if (sq && E.on) return editClick(sq);
  if (!sq || !S.st || S.st.over) return;
  const grid = parseFen(curFen()), piece = grid[8 - +sq[1]]["abcdefgh".indexOf(sq[0])];
  if (selected && selected !== sq) {
    const base = selected + sq;
    const uci = S.st.legal.includes(base) ? base : S.st.legal.includes(base + "q") ? base + "q" : null;
    if (uci) { selected = null; return playText(uci); }
  }
  const mine = piece && (piece === piece.toUpperCase()) === (S.st.turn === "white");
  selected = mine && selected !== sq ? sq : null;
  drawBoard();
});

/* ---------- position / render ---------- */
async function refresh(now = false) {
  selected = null; S.pick = -1;
  S.st = await api("/api/state", { fen: curFen() });
  drawBoard(); renderStatus(); renderMoves(); updateSaveForm(); renderClockWarn();
  analyse(now);
}
const cap = (w) => w[0].toUpperCase() + w.slice(1);
function renderStatus() {
  const st = S.st, side = cap(st.turn);
  let text, cls = "";
  if (st.over) { text = `Game over · ${st.result}${st.reason ? " (" + st.reason + ")" : ""}`; cls = "over"; }
  else if (S.viewing) text = `${side} to move`;
  else if (st.turn === S.orient) { text = `Your move · ${side}`; cls = "mine"; }
  else { text = `Opponent's move · ${side}`; cls = "opp"; }
  if (st.check && !st.over) text += " · Check!";
  $("#turn-chip").innerHTML = `<span class="dot ${st.turn}"></span>${esc(text)}`;
  $("#turn-chip").className = "chip " + cls;
  renderRecHead();
}
function renderRecHead() {
  if (!S.st) return;
  let t, c = "";
  if (S.st.over) t = "Game over";
  else if (S.viewing) t = `Best move for ${cap(S.st.turn)}`;
  else if (S.st.turn === S.orient) { t = "Your best move"; c = "mine"; }
  else t = $("#only-mine").checked ? "Opponent's turn" : "Best move for your opponent";
  $("#rec-head").textContent = t; $("#rec-head").className = "rec-head " + c;
}
function renderMoves() { drawMoveList(); persistDraft(); scheduleAutosave(); }
function drawMoveList() {
  const el = $("#movelist"), n = S.plies.length;
  const mv = Math.ceil(n / 2);
  $("#moves-count").textContent = n ? `· ${mv} move${mv === 1 ? "" : "s"}` : "";
  $("#moves-note").textContent = n && S.cursor < n ? `Viewing move ${Math.ceil(S.cursor / 2) || 0} of ${Math.ceil(n / 2)}. Press End (or ⏭) to return to the latest position.` : "";
  if (!n) {
    el.className = "movelist empty"; el.innerHTML = "No moves yet. They appear here as the game is played.";
    renderAccuracy([]); renderLastGrade(); return;
  }
  el.className = "movelist";
  const first = S.startFen.split(" ")[1] === "b" ? 1 : 0, startNo = +S.startFen.split(" ")[5] || 1;
  const you = S.viewing ? "" : S.orient;
  let h = `<div></div><div class="mh">White${you === "white" ? " (you)" : ""}</div><div class="mh">Black${you === "black" ? " (you)" : ""}</div>`;
  if (first) h += `<div class="n">${startNo}.</div><div class="m skip">…</div>`;
  const grades = S.plies.map((_, i) => gradePly(i + 1));
  S.plies.forEach((p, i) => {
    const idx = i + first, white = idx % 2 === 0;
    if (white) h += `<div class="n">${startNo + idx / 2}.</div>`;
    const who = you ? ((white ? "white" : "black") === you ? " mine" : " opp") : "";
    const g = grades[i];
    h += `<div class="m${who}${S.cursor === i + 1 ? " cur" : ""}${i === n - 1 ? " last" : ""}" data-i="${i + 1}"${g ? ` title="${g.grade} (−${g.loss.toFixed(1)}%)"` : ""}>${esc(p.san)}${g ? `<i class="gd ${gcls(g.grade)}"></i>` : ""}</div>`;
  });
  el.innerHTML = h;
  const cur = el.querySelector(".cur"); if (cur) cur.scrollIntoView({ block: "nearest" });
  renderAccuracy(grades); renderLastGrade(grades);
}
$("#movelist").addEventListener("click", (e) => { if (e.target.dataset.i) go(+e.target.dataset.i); });

function go(i) {
  i = Math.max(0, Math.min(S.plies.length, i));
  if (i === S.cursor) return;
  S.cursor = i; refresh();
}
$("#nav-start").onclick = () => go(0);
$("#nav-prev").onclick = () => go(S.cursor - 1);
$("#nav-next").onclick = () => go(S.cursor + 1);
$("#nav-end").onclick = () => go(S.plies.length);
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select") || $("#tab-analyze").classList.contains("hidden")) return;
  if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); cyclePick(e.key === "ArrowDown" ? 1 : -1); }
  else if (e.key === "Enter" && !e.target.matches("button, summary, a")) { const c = pickedCand(); if (c) playText(c.uci); }
  else if (e.key === "ArrowLeft") go(S.cursor - 1);
  else if (e.key === "ArrowRight") go(S.cursor + 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(S.plies.length);
  else if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key) && !e.ctrlKey && !e.metaKey) $("#move-input").focus();
});

$("#btn-flip").onclick = () => { S.orient = S.orient === "white" ? "black" : "white"; $("#f-color").value = S.orient; drawBoard(); S.st && analyse(); };
$("#f-color").onchange = (e) => { S.orient = e.target.value; drawBoard(); S.st && analyse(); };
$("#only-mine").checked = store.get("cl_onlymine", true);
$("#only-mine").onchange = (e) => { store.set("cl_onlymine", e.target.checked); S.analysis = null; analyse(); };
$("#btn-undo").onclick = () => {
  if (!S.plies.length || S.cursor === 0) return;
  S.plies = S.plies.slice(0, S.cursor - 1); S.cursor = S.plies.length; refresh();
};
$("#btn-reset").onclick = () => newGame(START);
function newGame(fen, plies = [], viewing = null) {
  flushAutosave();
  S.gameId = null; S.gameFinal = false; gameNo++;
  S.startFen = fen; S.plies = plies; S.cursor = plies.length; S.viewing = viewing; S.analysis = null;
  renderBanner(); refresh();
}

async function playText(text) {
  if (E.on) return;
  if (!S.st || S.st.over) return toast("The game is over — undo or reset.", true);
  try {
    const p = await api("/api/move", { fen: curFen(), text });
    S.plies = S.plies.slice(0, S.cursor); S.plies.push(p); S.cursor = S.plies.length;
    S.viewing = null; renderBanner();
    refresh();
  } catch (err) { toast(err.message, true); }
}
$("#move-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const inp = $("#move-input"), t = inp.value.trim(); inp.value = "";
  if (t) playText(t);
  else { const b = pickedCand(); if (b) playText(b.uci); else toast("No recommendation yet."); }
});
$("#move-input").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.target.value = ""; e.target.blur(); }
  else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.target.value) { e.preventDefault(); cyclePick(e.key === "ArrowDown" ? 1 : -1); }
});

/* ---------- analysis ---------- */
let aborter = null, aTimer = null;
const bestCand = () => (S.analysis && S.analysis.fen === curFen() && S.analysis.candidates ? S.analysis.candidates[0] : null);
const pickedCand = () => (S.opts && S.optsFen === curFen() ? (S.opts[S.pick >= 0 && S.pick < S.opts.length ? S.pick : S.recIdx] || S.opts[0]).c : null);
function analyse(now = false) {
  if (E.on) return;
  clearTimeout(aTimer);
  if (aborter) aborter.abort();
  if (S.st.over) { S.analysis = { fen: curFen(), candidates: [] }; renderAnalysis(false); return; }
  if ($("#only-mine").checked && !S.viewing && S.st.turn !== S.orient) {
    S.analysis = { fen: curFen(), candidates: null, waiting: true };
    clearRec("Waiting…", "Your recommendation appears once the opponent has moved.");
    renderRecHead(); drawBoard(); return;
  }
  renderAnalysis(true);
  aTimer = setTimeout(async () => {
    const fen = curFen(), ctl = aborter = new AbortController();
    const t0 = performance.now();
    const watchdog = setTimeout(() => ctl.abort("timeout"), 10000); // never sit on "Calculating"
    try {
      for (let tries = 0; ; tries++) {
        const r = await fetch("/api/analyse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fen, multipv: wantsMore() ? 5 : undefined, time_ms: thinkMs() }), signal: ctl.signal });
        const d = await r.json();
        if (!r.ok) throw new Error(d.detail);
        if (fen !== curFen()) return;
        if (d.superseded) { if (tries < 3) continue; throw new Error("Engine busy — try again"); } // cancelled by another request: ask again
        S.analysis = { ...d, fen, secs: (performance.now() - t0) / 1000 };
        if (d.candidates && d.candidates.length) EV.set(fen, d.candidates);
        renderAnalysis(false); drawBoard(); drawMoveList();
        return;
      }
    } catch (err) {
      if (ctl.signal.reason === "timeout" && fen === curFen()) return analyse(true); // stuck request: start over
      if (err.name === "AbortError") return;
      $("#best-move").textContent = "Engine error"; $("#best-info").textContent = err.message;
    } finally { clearTimeout(watchdog); }
  }, now ? 0 : 120); // the short wait only batches quick arrow-key stepping
}
const PIECE_NAMES = { p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King" };
const pov = () => (S.viewing ? "white" : S.orient);
const cpFor = (score, side) => (side === "white" ? score.cp : -score.cp);
const isMate = (score) => Math.abs(score.cp) >= 9000;
const mateIn = (score) => score.text.replace(/[^0-9]/g, "");
function tone(score) { const v = cpFor(score, pov()); return v > 30 ? "good" : v < -30 ? "bad" : "even"; }
function evalText(score) {
  const v = cpFor(score, pov());
  return isMate(score) ? (v > 0 ? "+" : "-") + "M" + mateIn(score) : (v >= 0 ? "+" : "") + (v / 100).toFixed(2);
}
function evalWords(score) {
  const p = pov(), viewing = !!S.viewing;
  const [a, b] = viewing ? [cap(p), cap(p === "white" ? "black" : "white")] : ["you", "your opponent"];
  const v = cpFor(score, p);
  if (isMate(score)) return `Forced mate in ${mateIn(score)} for ${v > 0 ? a : b}`;
  const abs = Math.abs(v);
  if (abs < 30) return "Equal position";
  const w = abs < 100 ? "Slightly better" : abs < 250 ? "Better" : abs < 500 ? "Clearly better" : "Winning";
  return `${w} for ${v > 0 ? a : b}`;
}
function moveDesc(c) {
  const from = c.uci.slice(0, 2), to = c.uci.slice(2, 4);
  const pc = parseFen(curFen())[8 - +from[1]]["abcdefgh".indexOf(from[0])];
  if (!pc) return "";
  if (c.san.startsWith("O-O")) return c.san.startsWith("O-O-O") ? "Castle queenside" : "Castle kingside";
  let extra = "";
  if (c.san.includes("x")) extra += " (captures)";
  if (c.uci.length > 4) extra += `, promotes to ${PIECE_NAMES[c.uci[4]]}`;
  if (c.san.includes("#")) extra += ", checkmate"; else if (c.san.includes("+")) extra += ", check";
  return `${PIECE_NAMES[pc.toLowerCase()]} ${from} → ${to}${extra}`;
}
/* ---------- win chance, move grades, accuracy (all from analysis we already have; no extra engine work) ---------- */
const EV = new Map(); // fen -> engine candidates, so played moves can be graded
const winPct = (score, side) => (isMate(score) ? (cpFor(score, side) > 0 ? 100 : 0) : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cpFor(score, side))) - 1));
const gradeOf = (loss) => (loss <= 0.5 ? "Best" : loss < 2 ? "Excellent" : loss < 5 ? "Good" : loss < 10 ? "Inaccuracy" : loss < 15 ? "Mistake" : "Blunder");
const gcls = (g) => "g-" + g.toLowerCase();
const sideOf = (fen) => (fen.split(" ")[1] === "w" ? "white" : "black");
function winColor(p) { // muted red -> amber -> green
  const stops = [[0, [216, 112, 106]], [35, [216, 112, 106]], [50, [199, 166, 86]], [65, [91, 182, 131]], [100, [91, 182, 131]]];
  let i = 1; while (i < stops.length - 1 && p > stops[i][0]) i++;
  const [p0, c0] = stops[i - 1], [p1, c1] = stops[i], t = p1 === p0 ? 0 : Math.min(1, Math.max(0, (p - p0) / (p1 - p0)));
  return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * t)).join(",")})`;
}
function gradePly(i) { // i = 1-based ply; null when the position before it was never analysed
  const before = EV.get(fenAt(i - 1)), ply = S.plies[i - 1];
  if (!before || !ply) return null;
  const mover = sideOf(fenAt(i - 1)), best = winPct(before[0].score, mover);
  let after = before.find((c) => c.uci === ply.uci), win;
  if (after) win = winPct(after.score, mover);
  else if ((after = EV.get(fenAt(i)))) win = winPct(after[0].score, mover);
  else if (i < S.plies.length && (after = EV.get(fenAt(i + 1)))) win = winPct(after[0].score, mover); // after their reply: close enough
  else return null;
  const loss = Math.max(0, best - win);
  return { mover, loss, grade: ply.uci === before[0].uci ? "Best" : gradeOf(loss) };
}
function renderAccuracy(grades) {
  const acc = { white: [], black: [] };
  grades.forEach((g) => g && acc[g.mover].push(Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * g.loss) - 3.1669))));
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) + "%" : "—");
  const you = S.viewing ? null : S.orient, other = you === "white" ? "black" : "white";
  $("#acc").textContent = !acc.white.length && !acc.black.length ? "" : you
    ? `Accuracy · you ${avg(acc[you])} · opp ${avg(acc[other])}` : `Accuracy · White ${avg(acc.white)} · Black ${avg(acc.black)}`;
}
function renderLastGrade(grades) {
  const el = $("#last-grade"), g = grades && S.cursor ? grades[S.cursor - 1] : null;
  if (!g) { el.innerHTML = ""; return; }
  const who = S.viewing ? cap(g.mover) + "'s" : g.mover === S.orient ? "Your" : "Opponent's";
  el.innerHTML = `${who} last move: <b class="${gcls(g.grade)}">${g.grade}</b>${g.loss >= 0.5 ? ` (−${g.loss.toFixed(g.loss < 10 ? 1 : 0)}%)` : ""}`;
}
function renderWin(score) {
  $("#winbox").classList.toggle("stale", !score);
  if (!score) return;
  const side = pov(), p = winPct(score, side), col = winColor(p);
  $("#win-pct").textContent = isMate(score) ? `Mate in ${mateIn(score)}` : Math.round(p) + "%";
  $("#win-pct").style.color = col;
  $("#win-label").textContent = isMate(score) ? (p > 50 ? (S.viewing ? `for ${cap(side)}` : "for you") : (S.viewing ? `against ${cap(side)}` : "against you"))
    : S.viewing ? `win chance (${cap(side)})` : "win chance (you)";
  $("#win-fill").style.width = p + "%"; $("#win-fill").style.background = col;
  $("#evalfill").style.height = p + "%";
}
/* ---------- play style + opening book (pick among the engine's good moves; the engine itself is unchanged) ---------- */
const STYLES = { balanced: "Balanced", aggressive: "Aggressive", solid: "Solid", simple: "Simple" };
const PREF = { style: store.get("cl_style", "balanced"), cost: store.get("cl_style_cost", 3), ops: store.get("cl_openings", { white: "", e4: "", d4: "" }),
  blitz: store.get("cl_blitz", false), level: store.get("cl_level", 0) };
// Strength: 0 = Max (always the best). Lower levels deliberately recommend weaker options; grading stays full strength.
const LEVELS = [{ name: "Max", win: 0 }, { name: "2200", win: 4 }, { name: "1800", win: 8 }, { name: "1500", win: 14 }, { name: "1200", win: 22 }];
const effStyle = () => (PREF.blitz && PREF.style === "balanced" ? "simple" : PREF.style); // blitz leans to quick, clear moves
const effCost = () => (PREF.blitz ? Math.min(PREF.cost, 2) : PREF.cost);
const wantsMore = () => effStyle() !== "balanced" || PREF.level > 0; // choosing among options needs 5 of them
function hash01(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; }
const normSan = (s) => s.replace(/[+#!?]/g, "");
const sqXY = (s) => ["abcdefgh".indexOf(s[0]), +s[1] - 1];
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
function findKing(g, ch) { for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if (g[r][f] === ch) return [f, 7 - r]; return null; }
function moveFeatures(c, fen, mover, win) {
  const g = parseFen(fen), me = mover === "white", from = c.uci.slice(0, 2), to = c.uci.slice(2, 4);
  const [ff, fr] = sqXY(from), [tf, tr] = sqXY(to), pc = g[7 - fr][ff] || "", type = pc.toLowerCase();
  const target = g[7 - tr][tf] || "", eK = findKing(g, me ? "k" : "K"), oK = findKing(g, me ? "K" : "k");
  const san = c.san, f = {};
  f.check = /[+#]/.test(san);
  f.castle = san.startsWith("O-O");
  f.capture = san.includes("x");
  const reply = c.pv[1] ? normSan(c.pv[1]).replace(/=[QRBN]$/, "") : "";
  f.trade = f.capture && reply.includes("x") && reply.endsWith(to);
  f.queenTrade = f.trade && (type === "q" || target.toLowerCase() === "q");
  f.closer = !!eK && type !== "k" && type !== "p" && cheb([tf, tr], eK) <= 3 && cheb([tf, tr], eK) < cheb([ff, fr], eK);
  f.pawnStorm = type === "p" && !!eK && Math.abs(tf - eK[0]) <= 2 && !f.capture && (me ? tr >= 3 : tr <= 4);
  f.shieldPush = type === "p" && !!oK && (oK[0] <= 2 || oK[0] >= 6) && Math.abs(ff - oK[0]) <= 1 && !f.capture;
  f.develop = (type === "n" || type === "b") && fr === (me ? 0 : 7) && S.cursor < 24;
  f.retreat = type !== "p" && (me ? tr < fr : tr > fr);
  f.ahead = win >= 60;
  return f;
}
const BONUS = {
  aggressive: { check: 2, closer: 1.5, pawnStorm: 1, capture: 1, queenTrade: -2, retreat: -1, castle: 0.5 },
  solid: { castle: 3, develop: 1.5, trade: 0.5, aheadTrade: 1.5, aheadQueenTrade: 1, shieldPush: -2, pawnStorm: -1 },
  simple: { trade: 2, queenTrade: 2, castle: 1, develop: 1, capture: 0.5, pawnStorm: -1, shieldPush: -1 },
};
const FEATURE_WORDS = { check: "gives check", closer: "brings a piece at their king", pawnStorm: "pushes pawns at their king", capture: "captures",
  castle: "castles your king", develop: "develops a piece", trade: "trades pieces", aheadTrade: "trades while ahead", queenTrade: "trades queens",
  aheadQueenTrade: "trades queens while ahead" };
function styleScore(style, f) {
  const B = BONUS[style] || {}, hits = [];
  let s = 0;
  const add = (k, on) => { if (on && B[k]) { s += B[k]; if (B[k] > 0) hits.push(k); } };
  for (const k of ["check", "closer", "pawnStorm", "capture", "castle", "develop", "trade", "queenTrade", "shieldPush", "retreat"]) add(k, f[k]);
  add("aheadTrade", f.trade && f.ahead); add("aheadQueenTrade", f.queenTrade && f.ahead);
  if (hits.includes("trade") && hits.includes("capture")) hits.splice(hits.indexOf("capture"), 1);
  return { s, hits };
}
// Returns { idx, why } — which engine candidate the chosen style recommends.
function stylePick(info, fen, mover) {
  if (PREF.level > 0 && info.length > 1) { // weaker on purpose: stable per position, varied across positions
    const L = LEVELS[PREF.level], target = hash01(fen + PREF.level) * L.win;
    let idx = 0; info.forEach((o, i) => { if (o.loss <= L.win && Math.abs(o.loss - target) < Math.abs(info[idx].loss - target)) idx = i; });
    return { idx, why: `Level ${L.name} pick` + (info[idx].loss >= 0.5 ? ` (−${info[idx].loss.toFixed(1)}% vs best)` : "") };
  }
  const style = effStyle();
  if (style === "balanced" || info.length < 2) return { idx: 0, why: "" };
  let best = { idx: 0, val: -Infinity, hits: [] };
  info.forEach((o, i) => {
    if (o.loss > effCost()) return;
    const { s, hits } = styleScore(style, moveFeatures(o.c, fen, mover, o.w));
    const val = s - o.loss * 0.3;
    if (val > best.val + 1e-9) best = { idx: i, val, hits };
  });
  const name = (PREF.blitz ? "⚡ " : "") + STYLES[style], o = info[best.idx], what = best.hits.map((k) => FEATURE_WORDS[k]).slice(0, 2).join(", ");
  return { idx: best.idx, why: best.idx === 0 ? `${name}: the engine's best already fits${what ? ` (${what})` : ""}` : `${name} pick: ${what || "fits the style"} (−${o.loss.toFixed(1)}% vs engine best)` };
}
function repertoireFor() {
  if (S.viewing || S.startFen !== START) return null;
  const hist = S.plies.slice(0, S.cursor).map((p) => normSan(p.san));
  let key;
  if (S.orient === "white") key = PREF.ops.white && OPENINGS.white[PREF.ops.white];
  else if (hist[0] === "e4") key = PREF.ops.e4 && OPENINGS.e4[PREF.ops.e4];
  else if (hist[0] === "d4") key = PREF.ops.d4 && OPENINGS.d4[PREF.ops.d4];
  return key ? { rep: key, hist } : null;
}
// { san, uci, name, moveNo } when the game is still in your chosen line and it's your move; { left, name, moveNo } just after leaving it.
function bookInfo() {
  const r = repertoireFor();
  if (!r || !S.st || S.st.over) return null;
  const { rep, hist } = r, lines = rep.lines.map((l) => l.split(" "));
  const next = lines.filter((l) => l.length > hist.length && hist.every((m, i) => l[i] === m)).map((l) => l[hist.length]);
  if (next.length) {
    if (S.st.turn !== S.orient) return null;
    const san = next[0], uci = sanToUci(san);
    return uci ? { san, uci, name: rep.name, moveNo: Math.floor(hist.length / 2) + 1 } : null;
  }
  let k = 0; for (const l of lines) { let i = 0; while (i < hist.length && l[i] === hist[i]) i++; k = Math.max(k, i); }
  return k > 0 && hist.length - k <= 2 ? { left: true, name: rep.name, moveNo: Math.floor(k / 2) + 1 } : null;
}
function sanToUci(san) { // resolve SAN against the legal moves we already have
  if (!S.st) return null;
  const legal = S.st.legal, white = S.st.turn === "white";
  if (san.startsWith("O-O")) { const u = (white ? "e1" : "e8") + (san === "O-O-O" ? (white ? "c1" : "c8") : (white ? "g1" : "g8")); return legal.includes(u) ? u : null; }
  const m = normSan(san).match(/^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(=[QRBN])?$/);
  if (!m) return null;
  const [, piece = "P", df, dr, dest, promo] = m, g = parseFen(curFen());
  const hits = legal.filter((u) => {
    if (u.slice(2, 4) !== dest) return false;
    const pc = g[8 - +u[1]]["abcdefgh".indexOf(u[0])];
    if (!pc || pc.toUpperCase() !== piece) return false;
    if (df && u[0] !== df) return false;
    if (dr && u[1] !== dr) return false;
    return promo ? u[4] === promo[1].toLowerCase() : u.length === 4;
  });
  return hits.length === 1 ? hits[0] : null;
}
function cyclePick(d) {
  const n = (S.opts || []).length;
  if (n < 2 || S.optsFen !== curFen()) return;
  S.pick = ((S.pick < 0 ? S.recIdx : S.pick) + d + n) % n;
  renderAnalysis(false); drawBoard();
}
function clearRec(big, sub) {
  $("#best-move").textContent = big; $("#best-desc").textContent = sub || "";
  $("#best-eval").textContent = ""; $("#best-eval").className = ""; $("#best-info").textContent = "";
  $("#cands").innerHTML = ""; renderWin(null);
}
function renderAnalysis(busy) {
  const a = S.analysis, ok = a && a.fen === curFen() && a.candidates;
  renderRecHead();
  const book = bookInfo();
  if (!ok && !(book && book.uci)) { S.opts = null; return busy ? clearRec("…", "Calculating") : undefined; }
  if (ok && !a.candidates.length) { S.opts = null; return clearRec("—", S.st.over ? "The game is over." : "No legal move."); }
  const mover = S.st.turn, cands = ok ? a.candidates : [], top = cands.length ? winPct(cands[0].score, mover) : null;
  let info = cands.map((c, i) => { const w = winPct(c.score, mover), loss = Math.max(0, top - w); return { c, w, loss, grade: i === 0 ? "Best" : gradeOf(loss) }; });
  let rec = stylePick(info, curFen(), mover);
  if (book && book.uci) { // your opening: the book move leads, graded by the engine when it's one of its options
    const at = info.findIndex((o) => o.c.uci === book.uci);
    const bo = at >= 0 ? info.splice(at, 1)[0] : { c: { uci: book.uci, san: book.san, pv: [book.san], score: null }, w: null, loss: null, grade: null };
    bo.book = true; info.unshift(bo);
    rec = { idx: 0, why: `Book: ${book.name}, move ${book.moveNo}` + (bo.loss != null && bo.loss >= 5 ? ` (engine prefers ${cands[0].san}, −${bo.loss.toFixed(0)}%)` : "") };
  }
  S.opts = info; S.optsFen = curFen(); S.recIdx = rec.idx;
  const pick = S.pick >= 0 && S.pick < info.length ? S.pick : rec.idx, p = info[pick].c;
  const only = info.length > 1 && cands.length > 1 && winPct(cands[0].score, mover) - winPct(cands[1].score, mover) >= 10;
  $("#best-move").textContent = p.san;
  $("#best-desc").textContent = moveDesc(p) + (pick === rec.idx && rec.why ? ` · ${rec.why}` : "");
  if (p.score) { $("#best-eval").textContent = `${evalText(p.score)}  ${evalWords(p.score)}`; $("#best-eval").className = "evtag " + tone(p.score); }
  else { $("#best-eval").textContent = "Book move · engine still thinking"; $("#best-eval").className = "evtag even"; }
  $("#best-info").textContent = ok ? `Depth ${a.depth} · ${a.secs.toFixed(1)}s · scores shown from ${S.viewing ? "White's" : "your"} side` : "";
  renderWin(cands.length ? cands[0].score : null);
  const left = book && book.left ? `<div class="booknote">Opponent left the ${esc(book.name)} at move ${book.moveNo}: engine${effStyle() !== "balanced" ? ` + ${STYLES[effStyle()]}` : ""} from here</div>` : "";
  $("#cands").innerHTML = left + `<div class="candhead">Move options <span>↑ ↓ to switch · Enter to play</span></div>` + info.map((o, i) => {
    const { c, w, grade } = o, engineTop = !o.book && c === cands[0];
    const tags = (i === rec.idx ? `<span class="tag rec-tag">Recommended</span>` : "") + (o.book ? `<span class="tag book-tag">Book</span>` : "")
      + (engineTop && i !== rec.idx ? `<span class="tag eng-tag">Engine #1</span>` : "") + (engineTop && only ? `<span class="tag only-tag">Only move</span>` : "");
    return `<div class="cand${i === pick ? " on" : ""}" data-i="${i}">
      <div class="ctop"><span class="rk">${i + 1}</span><b>${esc(c.san)}</b>${tags}
        <span class="spacer"></span>${grade ? `<span class="grade ${gcls(grade)}">${grade}</span>` : ""}<span class="cw">${w == null ? "…" : Math.round(w) + "%"}</span></div>
      <div class="cbar"><i style="width:${w || 0}%;background:${w == null ? "transparent" : winColor(w)}"></i></div>
      <div class="cdesc">${esc(moveDesc(c))} <span class="pv">${esc(c.pv.slice(1, 4).join(" "))}</span></div>
    </div>`;
  }).join("");
}
$("#cands").addEventListener("click", (e) => { const c = e.target.closest(".cand"); if (c) { S.pick = +c.dataset.i; renderAnalysis(false); drawBoard(); } });
$("#cands").addEventListener("dblclick", (e) => { const c = e.target.closest(".cand"), m = pickedCand(); if (c && m) playText(m.uci); });

/* ---------- import ---------- */
$("#btn-import").onclick = async () => {
  try {
    const d = await api("/api/import", { text: $("#import-text").value });
    newGame(d.start_fen, d.plies);
    const h = d.headers || {};
    if (h.White || h.Black) toast(`Loaded ${h.White || "?"} vs ${h.Black || "?"} (${d.plies.length} moves)`);
    else toast("Position loaded");
    $("#import-text").value = ""; $("#import-card").open = false;
  } catch (err) { toast(err.message, true); }
};

/* ---------- save ---------- */
let wasOver = false;
function updateSaveForm() {
  const sc = $("#save-card"), n = S.plies.length;
  $("#save-sum").textContent = n ? `· ${Math.ceil(n / 2)} moves` + (S.st.over ? ` · ${S.st.result}` : "") + (S.gameId ? " · auto-saved ✓" : "") : "· nothing to save yet";
  if (S.st.over && !wasOver && !S.viewing) sc.open = true;
  if (!n) sc.open = false;
  wasOver = S.st.over;
  $("#save-card").classList.toggle("hidden", !!S.viewing);
  const auto = $("#f-result").querySelector('[value="auto"]');
  auto.disabled = !(S.st && S.st.over && S.cursor === S.plies.length);
  if (auto.disabled && $("#f-result").value === "auto") $("#f-result").value = "win";
  else if (!auto.disabled) $("#f-result").value = "auto";
}
$("#btn-save").onclick = async () => {
  if (!S.plies.length) return toast("Nothing to save: no moves yet.", true);
  const body = {
    start_fen: S.startFen, ucis: S.plies.map((p) => p.uci), clocks: S.plies.map((p) => p.clk ?? null), opponent: $("#f-opp").value, my_color: $("#f-color").value,
    source: $("#f-source").value, result: $("#f-result").value, notes: $("#f-notes").value,
    id: S.gameId, site: S.live.site,
  };
  try {
    const r = await api("/api/games", body);
    S.gameId = r.id; S.gameFinal = true; clearTimeout(asTimer); // your saved result stands; auto-save leaves it alone
    store.set("cl_form", { opponent: body.opponent, source: body.source });
    $("#f-notes").value = ""; clearDraft();
    toast(`Saved (${r.result}). It's in History.`);
    loadOpponents();
  } catch (err) { toast(err.message, true); }
};
async function loadOpponents() {
  try { $("#opp-list").innerHTML = (await api("/api/opponents")).map((o) => `<option value="${esc(o)}">`).join(""); } catch {}
}
function renderBanner() {
  const b = $("#banner");
  if (!S.viewing) return b.classList.add("hidden");
  const g = S.viewing;
  b.classList.remove("hidden");
  b.innerHTML = `Viewing saved game vs <b>${esc(g.opponent || "?")}</b> · ${esc(g.result)} <span class="spacer"></span>
    <a class="btn" href="/api/games/${g.id}/pgn" download>Export PGN</a><button id="b-new">New game</button>`;
  $("#b-new").onclick = () => newGame(START);
}

/* ---------- unsaved-game draft (survives closing the window) ---------- */
function persistDraft() {
  if (S.viewing) return;
  store.set("cl_draft", S.plies.length ? { startFen: S.startFen, ucis: S.plies.map((p) => p.uci), clocks: S.plies.map((p) => p.clk ?? null), orient: S.orient, cursor: S.cursor, gameId: S.gameId, gameFinal: S.gameFinal, live: S.live } : null);
}

/* ---------- auto-save: every game (4+ plies) is kept in History and updated as moves come in ---------- */
let asTimer = null, asPending = null, asBusy = false, gameNo = 0;
function autosaveSnapshot() {
  if (S.viewing || S.gameFinal || E.on || S.plies.length < 4) return null;
  return { id: S.gameId, start_fen: S.startFen, ucis: S.plies.map((p) => p.uci), clocks: S.plies.map((p) => p.clk ?? null), my_color: S.orient, source: "assisted",
    opponent: S.live.opponent || $("#f-opp").value, site: S.live.site, game: gameNo };
}
function scheduleAutosave() {
  const snap = autosaveSnapshot();
  if (!snap) return;
  asPending = snap; clearTimeout(asTimer); asTimer = setTimeout(runAutosave, 700);
}
function flushAutosave() { clearTimeout(asTimer); if (asPending) runAutosave(); }
async function runAutosave() {
  if (asBusy) { asTimer = setTimeout(runAutosave, 200); return; } // one write at a time, so a game never gets two records
  const snap = asPending; asPending = null;
  if (!snap) return;
  asBusy = true;
  try {
    const r = await api("/api/games/live", snap);
    if (snap.game === gameNo && !S.gameFinal) { S.gameId = r.id; persistDraft(); if (S.st) updateSaveForm(); }
    if (asPending && asPending.game === snap.game) asPending.id = r.id;
  } catch {} finally { asBusy = false; }
}
function clearDraft() { store.set("cl_draft", null); }

/* ---------- tabs ---------- */
function showTab(t) {
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  for (const id of ["analyze", "history", "dashboard", "experiments"]) $("#tab-" + id).classList.toggle("hidden", id !== t);
  if (t === "history") loadHistory(true);
  if (t === "dashboard") loadDash();
  if (t === "experiments") loadExperiments();
  else clearTimeout(expTimer);
}
document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

/* ---------- history ---------- */
const PAGE = 50; let hOffset = 0, hTimer;
const fmtDate = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const resLabel = (o, r) => (o ? `<span class="res-${o}">${{ win: "Win", loss: "Loss", draw: "Draw" }[o]}</span>` : esc(r === "*" ? "Unfinished" : r));
async function loadHistory(reset) {
  if (reset) { hOffset = 0; $("#h-table tbody").innerHTML = ""; }
  const q = encodeURIComponent($("#h-search").value.trim()), s = $("#h-source").value;
  const d = await api(`/api/games?q=${q}&source=${s}&limit=${PAGE}&offset=${hOffset}`);
  $("#h-table tbody").insertAdjacentHTML("beforeend", d.games.map((g) =>
    `<tr data-id="${g.id}" style="cursor:pointer"><td>${fmtDate(g.created_at)}</td><td>${esc(g.opponent || "—")}</td><td>${resLabel(g.outcome, g.result)}</td>
     <td>${g.my_color || "—"}</td><td>${Math.ceil(g.plies / 2)}</td><td>${g.source}${g.site ? " · " + esc(g.site) : ""}${g.ended ? `<div class="muted tiny">${esc(g.ended)}</div>` : ""}</td><td class="muted">${esc(g.engine_label || "—")}</td>
     <td><a href="/api/games/${g.id}/pgn" download title="Export PGN">PGN</a> · <a href="#" data-del="${g.id}">delete</a></td></tr>`).join(""));
  hOffset += d.games.length;
  $("#h-empty").classList.toggle("hidden", d.total > 0);
  $("#h-more").classList.toggle("hidden", hOffset >= d.total);
  $("#h-count").textContent = d.total ? `Showing ${hOffset} of ${d.total}` : "";
}
$("#h-search").addEventListener("input", () => { clearTimeout(hTimer); hTimer = setTimeout(() => loadHistory(true), 200); });
$("#h-source").onchange = () => loadHistory(true);
$("#h-more").onclick = () => loadHistory(false);
$("#h-table tbody").addEventListener("click", async (e) => {
  const del = e.target.dataset.del;
  if (del) {
    e.preventDefault();
    if (confirm("Delete this game permanently?")) { await api(`/api/games/${del}`, undefined, "DELETE"); loadHistory(true); }
    return;
  }
  if (e.target.closest("a")) return;
  const tr = e.target.closest("tr"); if (!tr) return;
  try {
    const g = await api(`/api/games/${tr.dataset.id}`);
    S.orient = g.my_color || "white"; $("#f-color").value = S.orient;
    newGame(g.start_fen, g.plies, g); S.cursor = 0; refresh();
    showTab("analyze");
  } catch (err) { toast(err.message, true); }
});

/* ---------- dashboard ---------- */
let dSource = "";
document.querySelectorAll("#d-source button").forEach((b) => (b.onclick = () => {
  dSource = b.dataset.s; document.querySelectorAll("#d-source button").forEach((x) => x.classList.toggle("active", x === b)); loadDash();
}));
const wldBar = (r) => { const n = r.w + r.l + r.d || 1; return `<div class="bar"><i class="w" style="width:${100 * r.w / n}%"></i><i class="d" style="width:${100 * r.d / n}%"></i><i class="l" style="width:${100 * r.l / n}%"></i></div>`; };
function groupTable(title, rows, note) {
  if (!rows.length) return "";
  return `<div class="card"><div class="label">${title}</div><table><thead><tr><th></th><th>Games</th><th>W</th><th>D</th><th>L</th><th></th></tr></thead><tbody>` +
    rows.map((r) => `<tr><td>${esc(r.k)}</td><td>${r.n}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${wldBar(r)}</td></tr>`).join("") +
    `</tbody></table>${note ? `<div class="muted" style="font-size:12px;margin-top:6px">${note}</div>` : ""}</div>`;
}
function sparkline(trend) {
  if (trend.length < 2) return `<div class="muted">Trend appears after a couple of scored games.</div>`;
  let w = 0, pts = [];
  trend.forEach((o, i) => { if (o === "win") w++; pts.push(100 * w / (i + 1)); });
  const W = 600, H = 120, step = W / (pts.length - 1);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(H - p * H / 100).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:120px"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--line)" stroke-dasharray="4"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/></svg>
  <div class="muted" style="font-size:12px">Cumulative win % over your last ${pts.length} scored games (now ${pts[pts.length - 1].toFixed(0)}%; dashed line = 50%)</div>`;
}
async function loadDash() {
  const d = await api(`/api/stats?source=${dSource}`), t = d.totals, bs = d.by_source;
  const tile = (v, l) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $("#dash").innerHTML =
    `<div class="tiles">${tile(t.games, "Games recorded")}${tile(t.wins, "Wins")}${tile(t.losses, "Losses")}${tile(t.draws, "Draws")}${tile(t.win_pct === null ? "—" : t.win_pct + "%", "Win %")}</div>
     <div class="muted" style="margin:-4px 0 12px">All games — assisted: ${bs.assisted || 0} · independent: ${bs.independent || 0} · experiments: ${bs.experiment || 0}. Win % = wins ÷ scored games (draws count as non-wins). Unfinished games and experiments aren't scored.</div>
     <div class="card"><div class="label">Performance trend</div>${sparkline(d.trend)}</div>
     <div class="dgrid">${groupTable("By opponent", d.by_opponent)}${groupTable("By color", d.by_color)}${groupTable("By engine configuration", d.by_engine)}</div>
     <div class="card tablecard"><div class="label pad" style="margin:0">Recent games</div><table><tbody>${d.recent.map((g) =>
       `<tr><td>${fmtDate(g.created_at)}</td><td>${esc(g.opponent || "—")}</td><td>${resLabel(g.outcome, g.result)}</td><td>${g.my_color || "—"}</td><td>${g.source}</td><td class="muted">${esc(g.engine_label || "—")}</td></tr>`).join("") ||
       `<tr><td class="muted">No games yet.</td></tr>`}</tbody></table></div>`;
}

/* ---------- experiments ---------- */
let expTimer, expSel = null;
const CFG_FIELDS = [["mode", "Limit by", "select"], ["time_ms", "Time/move (ms)"], ["depth", "Depth"], ["skill_level", "Skill (0–20)"], ["elo", "Elo cap (blank = none)"], ["threads", "Threads"], ["hash_mb", "Hash (MB)"]];
const CFG_DEFAULT = {
  A: { time_ms: 100, depth: 8, skill_level: 20, elo: "", threads: 1, hash_mb: 64 },
  B: { time_ms: 100, depth: 8, skill_level: 20, elo: 1800, threads: 1, hash_mb: 64 },
};
function cfgBox(k) {
  return `<div class="card"><div class="label">Engine ${k}</div><div class="formgrid">` + CFG_FIELDS.map(([f, l, t]) => t === "select"
    ? `<label>${l}<select id="x-${k}-${f}"><option value="time">Time per move</option><option value="depth">Depth</option></select></label>`
    : `<label>${l}<input id="x-${k}-${f}" type="number" value="${CFG_DEFAULT[k][f]}"></label>`).join("") + `</div></div>`;
}
function buildExpForm() {
  const f = $("#exp-form");
  if (f.dataset.built) return;
  f.dataset.built = 1;
  f.innerHTML = `<div class="card"><div class="label">New experiment</div><div class="formgrid">
    <label class="wide">Name<input id="x-name" placeholder="e.g. Full strength vs Elo 1800"></label>
    <label>Games (even = fair colors)<input id="x-games" type="number" value="20" min="2"></label>
    <label>Max moves per game (plies)<input id="x-max" type="number" value="300" min="40"></label></div></div>
    ${cfgBox("A")}${cfgBox("B")}
    <button id="x-start" class="primary">▶ Start experiment</button>`;
  $("#x-start").onclick = startExperiment;
}
function readCfg(k) {
  const o = {};
  for (const [f, , t] of CFG_FIELDS) { const v = $(`#x-${k}-${f}`).value; o[f] = t === "select" ? v : (v === "" ? null : +v); }
  return o;
}
async function startExperiment() {
  try {
    const r = await api("/api/experiments", { name: $("#x-name").value, games: +$("#x-games").value, max_plies: +$("#x-max").value, a: readCfg("A"), b: readCfg("B") });
    expSel = r.id; toast("Experiment started"); loadExperiments();
  } catch (err) { toast(err.message, true); }
}
const expStatus = { running: "Running", stopped: "Stopped", done: "Complete", error: "Error" };
async function loadExperiments() {
  clearTimeout(expTimer);
  buildExpForm();
  let list;
  try { list = await api("/api/experiments"); } catch (err) { return toast(err.message, true); }
  if (!expSel && list.length) expSel = list[0].id;
  $("#exp-list").innerHTML = list.length ? list.map((e) => {
    const t = e.tally;
    return `<tr data-id="${e.id}" class="${e.id === expSel ? "sel" : ""}" style="cursor:pointer"><td>${esc(e.name)}</td><td>${expStatus[e.status]}</td><td>${t.games}/${e.total_games}</td><td>${t.a_wins}–${t.draws}–${t.b_wins}</td></tr>`;
  }).join("") : `<tr><td class="muted">No experiments yet.</td></tr>`;
  const sel = list.find((e) => e.id === expSel);
  if (sel) renderExpDetail(sel); else $("#exp-detail").innerHTML = "";
  if (list.some((e) => e.status === "running") && !$("#tab-experiments").classList.contains("hidden")) expTimer = setTimeout(loadExperiments, 1000);
}
$("#exp-list").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) { expSel = tr.dataset.id; loadExperiments(); } });
function renderExpDetail(e) {
  const t = e.tally, n = t.games || 1, pct = (100 * t.games / e.total_games).toFixed(0);
  const score = t.games ? (100 * (t.a_wins + t.draws / 2) / t.games).toFixed(1) + "%" : "—";
  const elo = e.elo ? (e.elo.elo === null ? e.elo.note : `A is ${e.elo.elo >= 0 ? "+" : ""}${e.elo.elo} ± ${e.elo.margin} Elo vs B (95% interval)`)
    : `Elo estimate appears after 20 finished games (${t.games} so far)`;
  const live = e.live;
  $("#exp-detail").innerHTML = `<div class="card">
    <div class="evalrow"><b style="font-size:20px">${esc(e.name)}</b><span class="muted">${expStatus[e.status]}${e.note ? " — " + esc(e.note) : ""}</span></div>
    <div class="muted" style="font-size:13px">A: ${esc(e.label_a)}<br>B: ${esc(e.label_b)}</div>
    <div class="bar" style="height:10px;margin:10px 0"><i style="width:${pct}%;background:var(--accent)"></i></div>
    <div class="tiles">
      <div class="tile"><div class="v">${t.a_wins}</div><div class="l">A wins</div></div>
      <div class="tile"><div class="v">${t.draws}</div><div class="l">Draws</div></div>
      <div class="tile"><div class="v">${t.b_wins}</div><div class="l">B wins</div></div>
      <div class="tile"><div class="v">${score}</div><div class="l">A score</div></div>
      <div class="tile"><div class="v">${t.games}/${e.total_games}</div><div class="l">Games done</div></div>
    </div>
    <div>${elo}</div>
    <div class="muted" style="font-size:12px;margin:4px 0 10px">White won ${t.white_wins}, Black won ${t.black_wins}${t.games ? ` · avg ${Math.round(t.plies / n / 2)} moves/game` : ""}. Score = (wins + ½ draws) ÷ games.</div>
    <div class="navrow">
      ${e.status === "running" ? `<button id="x-stop">■ Stop</button>` : ""}
      ${e.status !== "running" && e.status !== "done" ? `<button id="x-resume" class="primary">▶ Resume</button>` : ""}
      ${e.status !== "running" ? `<button id="x-del">Delete</button>` : ""}
    </div>
    ${live ? `<div style="max-width:320px;margin-top:10px"><div class="muted">Game ${live.game_no} · ${live.white} is White · move ${Math.ceil(live.ply / 2)}</div>${boardSvg(live.fen, { last: live.last })}</div>` : ""}
  </div>
  <div class="card tablecard"><table><thead><tr><th>Game</th><th>Result</th><th>Winner</th><th>Moves</th></tr></thead><tbody id="x-games-body"></tbody></table></div>`;
  if ($("#x-stop")) $("#x-stop").onclick = async () => { await api(`/api/experiments/${e.id}/stop`, {}); toast("Stopping after the current move…"); };
  if ($("#x-resume")) $("#x-resume").onclick = async () => { try { await api(`/api/experiments/${e.id}/resume`, {}); loadExperiments(); } catch (err) { toast(err.message, true); } };
  if ($("#x-del")) $("#x-del").onclick = async () => { if (confirm("Delete this experiment and all its games?")) { await api(`/api/experiments/${e.id}`, undefined, "DELETE"); expSel = null; loadExperiments(); } };
  loadExpGames(e);
}
async function loadExpGames(e) {
  const d = await api(`/api/games?experiment=${e.id}&limit=200`);
  const body = $("#x-games-body"); if (!body) return;
  body.innerHTML = d.games.slice().reverse().map((g) => {
    const winner = g.result === "1/2-1/2" ? "Draw" : ((g.result === "1-0") === (g.exp_white === "A") ? "A" : "B");
    return `<tr data-id="${g.id}" style="cursor:pointer"><td>${esc(g.notes || g.id.slice(0, 4))}</td><td>${esc(g.result)}</td><td>${winner}</td><td>${Math.ceil(g.plies / 2)}</td></tr>`;
  }).join("") || `<tr><td class="muted">No finished games yet.</td></tr>`;
}
document.addEventListener("click", async (ev) => {
  const tr = ev.target.closest("#x-games-body tr[data-id]"); if (!tr) return;
  try {
    const g = await api(`/api/games/${tr.dataset.id}`);
    S.orient = "white"; $("#f-color").value = "white"; newGame(g.start_fen, g.plies, g); S.cursor = 0; refresh(); showTab("analyze");
  } catch (err) { toast(err.message, true); }
});

/* ---------- settings ---------- */
const sform = $("#settings-form");
$("#btn-settings").onclick = async () => {
  const c = await api("/api/config");
  for (const el of sform.elements) if (el.name) el.value = c[el.name] ?? "";
  $("#settings").showModal();
};
sform.addEventListener("submit", async (e) => {
  if (e.submitter && e.submitter.value !== "ok") return;
  const patch = {};
  for (const el of sform.elements) if (el.name) patch[el.name] = el.type === "number" ? (el.value === "" ? null : +el.value) : el.value;
  if (patch.skill_level === null) patch.skill_level = 20;
  try { await api("/api/config", patch, "PUT"); toast("Settings saved"); S.analysis = null; analyse(); } catch (err) { toast(err.message, true); }
});

/* ---------- Chess.com auto-sync (computer games, via the extension) ---------- */
let syncSeq = -1, syncBusy = false, syncLast = null, farSince = null;
const START_PLACEMENT = START.split(" ")[0];
function renderSyncChip(d) {
  const on = $("#sync-on").checked, site = d.site === "lichess" ? "Lichess" : d.site === "chess.com" ? "Chess.com" : "game";
  $("#sync-chip").textContent = d.connected ? `● Synced with ${site} tab` + (d.tabs > 1 ? ` (${d.tabs} open, follows the one you use)` : "")
    : "○ Waiting for a Chess.com / Lichess computer game";
  $("#sync-chip").className = "chip " + (d.connected ? "mine" : "opp") + (on ? "" : " hidden");
}
async function syncTick(d) {
  if (syncBusy || E.on) return;
  syncBusy = true;
  try {
    d = d || await api("/api/sync");
    syncLast = d; renderSyncChip(d); updateClock(d);
    if (!$("#sync-on").checked || !d.connected || d.seq === syncSeq || !d.placement) return;
    if (S.cursor !== S.plies.length) return; // you're reviewing an earlier move; don't jump
    const end = S.plies.length ? S.plies[S.plies.length - 1].fen : S.startFen;
    const r = await api("/api/sync/apply", { fen: end, placement: d.placement, flipped: d.flipped });
    if (r.mode === "reset" && d.placement !== START_PLACEMENT && S.plies.length) {
      // a board we can't reach from this game: a real jump, or a half-drawn frame. Only rebuild if it holds for 1.2 s.
      if (!farSince || farSince.p !== d.placement) { farSince = { p: d.placement, t: Date.now() }; setTimeout(() => syncTick(), 1300); return; }
      if (Date.now() - farSince.t < 1200) return;
    }
    farSince = null; syncSeq = d.seq;
    if (d.site) S.live = { site: d.site, opponent: d.opponent || S.live.opponent };
    if (r.mode === "append") {
      const lastP = r.plies[r.plies.length - 1], mover = sideOf(lastP.fen) === "white" ? "black" : "white";
      lastP.clk = mover === S.orient ? d.my_clock : d.opp_clock; // time left after that move (saved as [%clk])
      S.plies = S.plies.concat(r.plies); S.cursor = S.plies.length; S.viewing = null; renderBanner(); refresh(true);
    } else if (r.mode === "reset") {
      S.orient = r.color; $("#f-color").value = r.color; newGame(r.fen);
    }
  } catch {} finally { syncBusy = false; }
}
$("#sync-on").checked = store.get("cl_sync", true);
$("#sync-on").onchange = (e) => { store.set("cl_sync", e.target.checked); syncSeq = -1; syncTick(); };
// Long-poll: the server answers the moment the game tab's board changes, so a move shows up (and analysis starts) immediately.
(async function syncLoop() {
  let seen = -1;
  for (;;) {
    try {
      const t = performance.now(), d = await api(`/api/sync?after=${seen}`);
      // an outdated server answers instantly instead of waiting; never spin on it
      if (d.seq === seen && performance.now() - t < 1000) await new Promise((res) => setTimeout(res, 1000));
      seen = d.seq;
      while (syncBusy) await new Promise((res) => setTimeout(res, 30));
      await syncTick(d);
    } catch { await new Promise((res) => setTimeout(res, 1000)); }
  }
})();
setInterval(() => syncTick(), 1500); // fallback: picks up anything skipped while reviewing or busy

/* ---------- init ---------- */
(async function init() {
  const f = store.get("cl_form", {});
  if (f.opponent) $("#f-opp").value = f.opponent;
  if (f.source) $("#f-source").value = f.source;
  loadOpponents();
  setInterval(() => fetch("/api/ping").catch(() => {}), 5000);
  const d = store.get("cl_draft", null);
  if (d) {
    try {
      const t = await api("/api/timeline", { start_fen: d.startFen, ucis: d.ucis });
      S.orient = d.orient || "white"; $("#f-color").value = S.orient;
      S.startFen = t.start_fen; S.plies = t.plies; S.cursor = Math.min(d.cursor ?? t.plies.length, t.plies.length);
      S.gameId = d.gameId || null; S.gameFinal = !!d.gameFinal; if (d.live) S.live = d.live;
      (d.clocks || []).forEach((c, i) => { if (S.plies[i] && c != null) S.plies[i].clk = c; });
      toast("Restored your unsaved game");
    } catch { clearDraft(); }
  }
  refresh();
  $("#move-input").focus();
})();

/* ---------- style & openings controls ---------- */
(function initStyleControls() {
  const seg = $("#style-seg");
  seg.innerHTML = Object.entries(STYLES).map(([k, v]) => `<button data-style="${k}">${v}</button>`).join("");
  const paint = () => {
    seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.style === PREF.style));
    $("#style-cost-wrap").classList.toggle("hidden", PREF.style === "balanced");
    const names = [["white", "White"], ["e4", "vs e4"], ["d4", "vs d4"]].filter(([k]) => PREF.ops[k]).map(([k, l]) => `${l}: ${OPENINGS[k][PREF.ops[k]].name}`);
    $("#op-sum").textContent = names.length ? names.join(" · ") : "engine chooses";
  };
  seg.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    PREF.style = b.dataset.style; store.set("cl_style", PREF.style); paint();
    S.pick = -1; S.analysis = null; if (S.st) analyse(true); // style needs 5 options instead of 3: ask again
  };
  $("#style-cost").value = String(PREF.cost);
  $("#style-cost").onchange = (e) => { PREF.cost = +e.target.value; store.set("cl_style_cost", PREF.cost); S.pick = -1; if (S.st) renderAnalysis(false), drawBoard(); };
  for (const k of ["white", "e4", "d4"]) {
    const sel = $("#op-" + k);
    sel.innerHTML = `<option value="">Engine chooses</option>` + Object.entries(OPENINGS[k]).map(([id, o]) => `<option value="${id}">${o.name}</option>`).join("");
    sel.value = PREF.ops[k] && OPENINGS[k][PREF.ops[k]] ? PREF.ops[k] : "";
    sel.onchange = () => { PREF.ops[k] = sel.value; store.set("cl_openings", PREF.ops); paint(); S.pick = -1; if (S.st) renderAnalysis(false), drawBoard(); };
  }
  paint();
})();

/* ---------- clocks, blitz mode, strength ---------- */
const CLK = { my: null, opp: null, at: 0 };
let autoBlitzGame = -1;
const fmtClock = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), sec = t - m * 60; return t < 20 ? `${m}:${sec.toFixed(1).padStart(4, "0")}` : `${m}:${String(Math.floor(sec)).padStart(2, "0")}`; };
const clockLive = () => !S.viewing && CLK.my != null && Date.now() - CLK.at < 5000;
function thinkMs() { // full search normally; quicker in blitz and when your clock is low
  const my = clockLive() ? CLK.my : null;
  if (my != null && my < 10) return 150;
  if (my != null && my < 30) return 300;
  return PREF.blitz ? 500 : undefined;
}
function updateClock(d) {
  CLK.my = d.my_clock ?? null; CLK.opp = d.opp_clock ?? null; CLK.at = Date.now();
  const chip = $("#clock-chip"), on = d.connected && CLK.my != null;
  chip.classList.toggle("hidden", !on || !!S.viewing);
  if (on) {
    chip.textContent = `⏱ You ${fmtClock(CLK.my)} · Opp ${CLK.opp != null ? fmtClock(CLK.opp) : "—"}`;
    chip.classList.toggle("low", CLK.my < 15);
    // short time control at the start of a game: switch blitz on once (you can switch it off again)
    if (!PREF.blitz && CLK.my <= 300 && S.plies.length <= 2 && autoBlitzGame !== gameNo) { autoBlitzGame = gameNo; setBlitz(true); toast("⚡ Blitz mode on (short clock). Tap ⚡ Blitz to turn it off."); }
  }
  renderClockWarn();
}
function renderClockWarn() {
  const el = $("#clock-warn"), mine = S.st && !S.viewing && S.st.turn === S.orient && !S.st.over;
  const low = clockLive() && mine && CLK.my < 15;
  el.classList.toggle("hidden", !low);
  if (low) el.textContent = `⏱ ${Math.ceil(CLK.my)}s left: play fast`;
}
function setBlitz(on) {
  PREF.blitz = on; store.set("cl_blitz", on);
  document.body.classList.toggle("blitz", on);
  $("#blitz-btn").classList.toggle("on", on); $("#blitz-btn").setAttribute("aria-pressed", on);
  if (S.st) { S.pick = -1; S.analysis = null; analyse(true); }
}
$("#blitz-btn").onclick = () => { autoBlitzGame = gameNo; setBlitz(!PREF.blitz); };
document.body.classList.toggle("blitz", PREF.blitz); $("#blitz-btn").classList.toggle("on", PREF.blitz);
(function initLevel() {
  const r = $("#level"), paint = () => { $("#level-name").textContent = LEVELS[PREF.level].name; r.classList.toggle("weak", PREF.level > 0); };
  r.value = String(PREF.level); paint();
  r.oninput = () => { PREF.level = +r.value; store.set("cl_level", PREF.level); paint(); };
  r.onchange = () => { S.pick = -1; S.analysis = null; if (S.st) analyse(true); };
})();
