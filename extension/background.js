// Relays board snapshots from Chess.com / Lichess game tabs to the local Chess Lab server, tagged per tab.
chrome.runtime.onMessage.addListener((msg, sender) => {
  const source = sender.tab ? `${msg.site || "tab"}:${sender.tab.id}` : "default";
  fetch("http://127.0.0.1:8765/api/sync", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...msg, source }),
  }).catch(() => {});
});
