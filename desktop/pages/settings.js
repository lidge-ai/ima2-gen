const api = window.ima2Desktop;
const BOOL_IDS = ["devLogging", "openAtLogin", "startHidden", "menubarOnly", "keepRunningOnClose", "autoUpdate"];
const TEXT_IDS = ["configDir", "nodeBinary"];
const SELECT_IDS = ["existingServer"];
const $ = (id) => document.getElementById(id);

const LABELS = { starting: "Starting…", running: "Running", stopped: "Stopped", error: "Error" };
const LAUNCHERS = { foreground: "a terminal", background: "the background CLI", service: "the login service", desktop: "another ima2 app" };

function guestText(guest) {
  const by = guest.serviceManaged ? LAUNCHERS.service : LAUNCHERS[guest.launcher] ?? "another ima2 install";
  return `started by ${by}, pid ${guest.pid}`;
}

function renderStatus(status) {
  $("dot").className = `dot ${status.state}`;
  $("status-label").textContent = LABELS[status.state] ?? status.state;
  const guest = status.ownership === "guest" ? status.guest : null;
  const detail = status.state === "running"
    ? `${status.url}${guest ? ` (${guestText(guest)})` : ` · pid ${status.pid}`}`
    : status.lastError ?? status.note ?? "—";
  $("status-detail").textContent = detail;
  $("restart").disabled = !!guest;
  $("restart").textContent = status.state === "stopped" ? "Start Server" : "Restart Server";
  $("use-bundled").hidden = !guest;
  $("use-bundled").disabled = !!guest?.takeoverBlocker;
  $("use-bundled").title = guest?.takeoverBlocker ?? "";
}

function fill(settings) {
  $("port").value = settings.port;
  for (const id of BOOL_IDS) $(id).checked = !!settings[id];
  for (const id of TEXT_IDS) $(id).value = settings[id] ?? "";
  for (const id of SELECT_IDS) $(id).value = settings[id];
}

async function save(patch) {
  fill(await api.saveSettings(patch));
}

function bind() {
  for (const id of BOOL_IDS) $(id).addEventListener("change", (e) => save({ [id]: e.target.checked }));
  for (const id of TEXT_IDS) $(id).addEventListener("change", (e) => save({ [id]: e.target.value }));
  for (const id of SELECT_IDS) $(id).addEventListener("change", (e) => save({ [id]: e.target.value }));
  $("port").addEventListener("change", (e) => save({ port: Number(e.target.value) }));
  $("restart").addEventListener("click", () => api.restartServer());
  $("use-bundled").addEventListener("click", () => api.useBundledServer());
  $("check-updates").addEventListener("click", () => api.checkForUpdates());
  $("logs").addEventListener("click", () => api.openLogs());
  $("config").addEventListener("click", () => api.openConfigDir());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "w")) api.closeWindow();
  });
}

async function init() {
  if (api.platform !== "darwin") {
    for (const el of document.querySelectorAll("[data-mac-only]")) el.remove();
  }
  bind();
  fill(await api.getSettings());
  renderStatus(await api.getStatus());
  api.onStatus(renderStatus);
  const info = await api.getInfo();
  $("check-updates").disabled = info.updaterActive === false;
  $("info").textContent = `ima2 ${info.appVersion} · Electron ${info.electron} · Node ${info.node} · ${info.platform}/${info.arch}`;
}

void init();
