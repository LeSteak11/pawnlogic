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
function boardSvg(fen, { flip = false, last = null, selected = null, legal = [], arrow = null } = {}) {
  const grid = parseFen(fen);
  let svg = `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ah" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#4c9a2a"/></marker></defs>`;
  const pos = (f, r) => (flip ? [(7 - f) * 10, r * 10] : [f * 10, (7 - r) * 10]);
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const [x, y] = pos(f, r), name = sqName(f, r), dark = (f + r) % 2 === 0;
    svg += `<rect x="${x}" y="${y}" width="10" height="10" fill="var(${dark ? "--sq-dark" : "--sq-light"})" data-sq="${name}"/>`;
    if (last && (last.slice(0, 2) === name || last.slice(2, 4) === name)) svg += `<rect x="${x}" y="${y}" width="10" height="10" fill="var(--hl)" pointer-events="none"/>`;
    if (selected === name) svg += `<rect x="${x}" y="${y}" width="10" height="10" fill="rgba(106,167,255,.55)" pointer-events="none"/>`;
    const p = grid[7 - r][f];
    if (p) {
      const white = p === p.toUpperCase();
      svg += `<text x="${x + 5}" y="${y + 7.9}" font-size="9" text-anchor="middle" pointer-events="none" font-family="'Segoe UI Symbol',serif" fill="${white ? "#fff" : "#1a1a1a"}" stroke="${white ? "#222" : "#ddd"}" stroke-width=".35" paint-order="stroke">${GLYPH[p.toLowerCase()]}︎</text>`;
    }
    if (f === (flip ? 7 : 0)) svg += `<text x="${x + .6}" y="${y + 2.6}" font-size="2.2" fill="${dark ? "#e8dcc4" : "#a47c58"}" pointer-events="none">${r + 1}</text>`;
    if (r === (flip ? 7 : 0)) svg += `<text x="${x + 9.4}" y="${y + 9.4}" font-size="2.2" text-anchor="end" fill="${dark ? "#e8dcc4" : "#a47c58"}" pointer-events="none">${"abcdefgh"[f]}</text>`;
  }
  if (selected) for (const u of legal) if (u.startsWith(selected)) {
    const [x, y] = pos("abcdefgh".indexOf(u[2]), +u[3] - 1);
    svg += `<circle cx="${x + 5}" cy="${y + 5}" r="1.7" fill="rgba(40,40,40,.45)" pointer-events="none"/>`;
  }
  if (arrow) {
    const [x1, y1] = pos("abcdefgh".indexOf(arrow[0]), +arrow[1] - 1), [x2, y2] = pos("abcdefgh".indexOf(arrow[2]), +arrow[3] - 1);
    svg += `<line x1="${x1 + 5}" y1="${y1 + 5}" x2="${x2 + 5}" y2="${y2 + 5}" stroke="#4c9a2a" stroke-opacity=".8" stroke-width="1.4" marker-end="url(#ah)" pointer-events="none"/>`;
  }
  return svg + "</svg>";
}
function drawBoard() {
  const best = S.analysis && S.analysis.fen === curFen() && S.analysis.candidates && S.analysis.candidates[0];
  $("#board").innerHTML = boardSvg(curFen(), {
    flip: S.orient === "black", last: S.cursor > 0 ? S.plies[S.cursor - 1].uci : null, selected,
    legal: S.st ? S.st.legal : [], arrow: best ? best.uci : null,
  });
}

$("#board").addEventListener("click", (e) => {
  const sq = e.target.dataset && e.target.dataset.sq;
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
async function refresh() {
  selected = null;
  S.st = await api("/api/state", { fen: curFen() });
  drawBoard(); renderStatus(); renderMoves(); updateSaveForm();
  analyse();
}
function renderStatus() {
  const st = S.st;
  $("#turn-dot").className = "dot " + st.turn;
  $("#turn-text").textContent = st.over ? "Game over" : (st.turn === "white" ? "White" : "Black") + " to move";
  $("#status-text").textContent = st.over ? `${st.result} · ${st.reason}` : st.check ? "Check!" : "";
}
function renderMoves() {
  let h = "";
  const first = S.startFen.split(" ")[1] === "b" ? 1 : 0, startNo = +S.startFen.split(" ")[5] || 1;
  if (first) h += `<div class="n">${startNo}.</div><div class="m">…</div>`;
  S.plies.forEach((p, i) => {
    const idx = i + first;
    if (idx % 2 === 0) h += `<div class="n">${startNo + idx / 2}.</div>`;
    h += `<div class="m${S.cursor === i + 1 ? " cur" : ""}" data-i="${i + 1}">${esc(p.san)}</div>`;
  });
  const el = $("#movelist"); el.innerHTML = h;
  const cur = el.querySelector(".cur"); if (cur) cur.scrollIntoView({ block: "nearest" });
  persistDraft();
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
  if (e.key === "ArrowLeft") go(S.cursor - 1);
  else if (e.key === "ArrowRight") go(S.cursor + 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(S.plies.length);
  else if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key) && !e.ctrlKey && !e.metaKey) $("#move-input").focus();
});

$("#btn-flip").onclick = () => { S.orient = S.orient === "white" ? "black" : "white"; $("#f-color").value = S.orient; drawBoard(); };
$("#btn-undo").onclick = () => {
  if (!S.plies.length || S.cursor === 0) return;
  S.plies = S.plies.slice(0, S.cursor - 1); S.cursor = S.plies.length; refresh();
};
$("#btn-reset").onclick = () => newGame(START);
function newGame(fen, plies = [], viewing = null) {
  S.startFen = fen; S.plies = plies; S.cursor = plies.length; S.viewing = viewing; S.analysis = null;
  renderBanner(); refresh();
}

async function playText(text) {
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
  else { const b = bestCand(); if (b) playText(b.uci); else toast("No recommendation yet."); }
});
$("#move-input").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.target.value = ""; e.target.blur(); } });

/* ---------- analysis ---------- */
let aborter = null, aTimer = null;
const bestCand = () => (S.analysis && S.analysis.fen === curFen() && S.analysis.candidates ? S.analysis.candidates[0] : null);
function analyse() {
  clearTimeout(aTimer);
  if (aborter) aborter.abort();
  if (S.st.over) { S.analysis = { fen: curFen(), candidates: [] }; renderAnalysis(false); return; }
  renderAnalysis(true);
  aTimer = setTimeout(async () => {
    const fen = curFen(); aborter = new AbortController();
    const t0 = performance.now();
    try {
      const r = await fetch("/api/analyse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fen }), signal: aborter.signal });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail);
      if (d.superseded || fen !== curFen()) return;
      S.analysis = { ...d, fen, secs: (performance.now() - t0) / 1000 };
      renderAnalysis(false); drawBoard();
    } catch (err) {
      if (err.name === "AbortError") return;
      $("#best-move").textContent = "Engine error"; $("#best-info").textContent = err.message;
    }
  }, 120);
}
function renderAnalysis(busy) {
  const a = S.analysis, ok = a && a.fen === curFen() && a.candidates;
  if (busy && !ok) { $("#best-move").textContent = "…"; $("#best-eval").textContent = "Calculating"; $("#best-info").textContent = ""; $("#cands").innerHTML = ""; return; }
  if (!ok) return;
  if (!a.candidates.length) {
    $("#best-move").textContent = S.st.over ? "—" : "No move"; $("#best-eval").textContent = S.st.over ? "Game over" : "";
    $("#best-info").textContent = ""; $("#cands").innerHTML = ""; $("#evalfill").style.height = "50%"; return;
  }
  const b = a.candidates[0];
  $("#best-move").textContent = b.san;
  $("#best-eval").textContent = b.score.text + " (White)";
  $("#best-info").textContent = `depth ${a.depth} · ${a.secs.toFixed(1)}s`;
  $("#evalfill").style.height = 100 / (1 + Math.exp(-b.score.cp / 400)) + "%";
  $("#cands").innerHTML = a.candidates.map((c) =>
    `<div class="cand" data-uci="${c.uci}"><b>${esc(c.san)}</b><span>${c.score.text}</span><span class="pv">${esc(c.pv.slice(1).join(" "))}</span></div>`).join("");
}
$("#cands").addEventListener("click", (e) => { const c = e.target.closest(".cand"); if (c) playText(c.dataset.uci); });

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
function updateSaveForm() {
  $("#save-card").classList.toggle("hidden", !!S.viewing);
  const auto = $("#f-result").querySelector('[value="auto"]');
  auto.disabled = !(S.st && S.st.over && S.cursor === S.plies.length);
  if (auto.disabled && $("#f-result").value === "auto") $("#f-result").value = "win";
  else if (!auto.disabled) $("#f-result").value = "auto";
}
$("#btn-save").onclick = async () => {
  if (!S.plies.length) return toast("Nothing to save: no moves yet.", true);
  const body = {
    start_fen: S.startFen, ucis: S.plies.map((p) => p.uci), opponent: $("#f-opp").value, my_color: $("#f-color").value,
    source: $("#f-source").value, result: $("#f-result").value, notes: $("#f-notes").value,
  };
  try {
    const r = await api("/api/games", body);
    store.set("cl_form", { opponent: body.opponent, source: body.source });
    $("#f-notes").value = ""; clearDraft();
    toast(`Saved (${r.result}). Press Reset for a new game.`);
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
  store.set("cl_draft", S.plies.length ? { startFen: S.startFen, ucis: S.plies.map((p) => p.uci), orient: S.orient, cursor: S.cursor } : null);
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
     <td>${g.my_color || "—"}</td><td>${Math.ceil(g.plies / 2)}</td><td>${g.source}</td><td class="muted">${esc(g.engine_label || "—")}</td>
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
      toast("Restored your unsaved game");
    } catch { clearDraft(); }
  }
  refresh();
  $("#move-input").focus();
})();
