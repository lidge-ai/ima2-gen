const api = window.ima2Desktop;
const BOOL_IDS = ["devLogging", "openAtLogin", "startHidden", "menubarOnly", "keepRunningOnClose", "autoUpdate"];
const TEXT_IDS = ["configDir", "nodeBinary"];
const $ = (id) => document.getElementById(id);

const LABELS = { starting: "Starting…", running: "Running", stopped: "Stopped", error: "Error" };

function renderStatus(status) {
  $("dot").className = `dot ${status.state}`;
  $("status-label").textContent = LABELS[status.state] ?? status.state;
  const detail = status.state === "running"
    ? `${status.url}${status.external ? " (attached to external server)" : ` · pid ${status.pid}`}`
    : status.lastError ?? "—";
  $("status-detail").textContent = detail;
  $("restart").disabled = !!status.external;
}

function fill(settings) {
  $("port").value = settings.port;
  for (const id of BOOL_IDS) $(id).checked = !!settings[id];
  for (const id of TEXT_IDS) $(id).value = settings[id] ?? "";
}

async function save(patch) {
  fill(await api.saveSettings(patch));
}

function bind() {
  for (const id of BOOL_IDS) $(id).addEventListener("change", (e) => save({ [id]: e.target.checked }));
  for (const id of TEXT_IDS) $(id).addEventListener("change", (e) => save({ [id]: e.target.value }));
  $("port").addEventListener("change", (e) => save({ port: Number(e.target.value) }));
  $("restart").addEventListener("click", () => api.restartServer());
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
  $("info").textContent = `ima2-desktop ${info.appVersion} · Electron ${info.electron} · Node ${info.node} · ${info.platform}/${info.arch}`;
}

void init();
