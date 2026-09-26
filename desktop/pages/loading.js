const api = window.ima2Desktop;
// Gates the macOS-only drag strip styling (loading.css); absent outside darwin.
document.documentElement.dataset.platform = api?.platform ?? "";
const $ = (id) => document.getElementById(id);
const rowServer = $("row-server");
const rowOpen = $("row-open");
const tag = $("tag");
const errorEl = $("error");
const actions = $("actions");

const TAGS = {
  starting: "Starting your local studio",
  running: "Ready",
  stopped: "Server stopped",
  error: "Server failed to start",
};

let port = null;
let startedAt = 0;
let timer = null;
let lastStatus = null;

function setRow(row, state, detail) {
  row.dataset.state = state;
  row.querySelector(".d").textContent = detail ?? "";
}

function serverDetail(status) {
  if (status.state === "running") {
    return status.external ? `Using the server already running at ${status.url}` : status.url ?? "";
  }
  if (status.state === "starting") {
    const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    return [port ? `port ${port}` : null, `${seconds}s`].filter(Boolean).join(" · ");
  }
  if (status.state === "stopped") return "Stopped";
  return (status.lastError ?? "").split("\n")[0] || "Failed";
}

function tick() {
  if (lastStatus?.state === "starting") setRow(rowServer, "active", serverDetail(lastStatus));
}

function render(status) {
  lastStatus = status;
  if (status.state === "starting") {
    if (!timer) {
      startedAt = Date.now();
      timer = setInterval(tick, 1000);
    }
  } else if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const failed = status.state === "error" || status.state === "stopped";
  const serverState = status.state === "running" ? "done" : failed ? "error" : "active";
  setRow(rowServer, serverState, serverDetail(status));
  setRow(rowOpen, status.state === "running" ? "active" : "wait", status.state === "running" ? "Opening…" : "");
  tag.textContent = TAGS[status.state] ?? status.state;
  errorEl.hidden = !(failed && status.lastError);
  errorEl.textContent = status.lastError ?? "";
  actions.hidden = !failed;
}

$("restart").addEventListener("click", () => api.restartServer());
$("logs").addEventListener("click", () => api.openLogs());
$("settings").addEventListener("click", () => api.openSettings());

async function init() {
  api.onStatus(render);
  // Port and version only decorate the page; a failed read must not block status updates.
  const [settings, info] = await Promise.all([
    api.getSettings().catch(() => null),
    api.getInfo().catch(() => null),
  ]);
  port = settings?.port ?? null;
  if (info?.appVersion) $("foot").textContent = `ima2 ${info.appVersion} · Runs on this computer`;
  render(await api.getStatus());
}

void init();
