// Relays board snapshots from the Chess.com tab to the local Chess Lab server.
chrome.runtime.onMessage.addListener((msg) => {
  fetch("http://127.0.0.1:8765/api/sync", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg),
  }).catch(() => {});
});
