const api = window.ima2Desktop;
const dot = document.getElementById("dot");
const label = document.getElementById("label");
const urlEl = document.getElementById("url");
const errorEl = document.getElementById("error");
const actions = document.getElementById("actions");

const LABELS = {
  starting: "Starting ima2 server…",
  running: "Server ready — opening…",
  stopped: "Server stopped",
  error: "Server failed to start",
};

function render(status) {
  dot.className = `dot ${status.state}`;
  label.textContent = LABELS[status.state] ?? status.state;
  urlEl.textContent = status.url ?? "";
  const failed = status.state === "error" || status.state === "stopped";
  errorEl.hidden = !(failed && status.lastError);
  errorEl.textContent = status.lastError ?? "";
  actions.hidden = !failed;
}

document.getElementById("restart").addEventListener("click", () => api.restartServer());
document.getElementById("logs").addEventListener("click", () => api.openLogs());
document.getElementById("settings").addEventListener("click", () => api.openSettings());

api.onStatus(render);
api.getStatus().then(render);
