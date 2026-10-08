// Relays board snapshots from Chess.com / Lichess game tabs to the local Chess Lab server, tagged per tab.
// Also handles Chess Lab's "Reconnect": re-attaches to open game tabs and asks them for a fresh snapshot.
const SERVER = "http://127.0.0.1:8765/";
const GAME_URLS = ["https://www.chess.com/play/computer*", "https://www.chess.com/game/computer/*", "https://lichess.org/*"];

async function reattach() { // inject the reader into game tabs that are already open (no tab refresh needed)
  const tabs = await chrome.tabs.query({ url: GAME_URLS });
  for (const t of tabs) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }).catch(() => {});
}
async function checkRecal(n) {
  const { recalSeen } = await chrome.storage.local.get("recalSeen");
  if (recalSeen === undefined || n !== recalSeen) {
    await chrome.storage.local.set({ recalSeen: n });
    // Reattaching on the first observation also handles a reconnect requested
    // while the extension service worker was asleep or freshly updated.
    reattach();
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  const source = sender.tab ? `${msg.site || "tab"}:${sender.tab.id}` : "default";
  fetch(SERVER + "api/sync", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...msg, source }),
  }).then((r) => r.json()).then((d) => { if (typeof d.recal === "number") checkRecal(d.recal); }).catch(() => {});
});

// When no tab is reporting, a light check every 30 s still picks up a Reconnect request.
chrome.alarms.create("recal", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "recal") fetch(SERVER + "api/sync/recal").then((r) => r.json()).then((d) => checkRecal(d.n)).catch(() => {});
});
chrome.runtime.onInstalled.addListener(reattach); // after installing/reloading the extension
chrome.runtime.onStartup.addListener(reattach);
