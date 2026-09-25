const bridge = window.ima2Desktop;
const $ = (id) => document.getElementById(id);
const REFRESH_MS = 3000;
const STATE_TEXT = { starting: "Starting server…", running: "Server running", stopped: "Server stopped", error: "Server error" };
let timer = null;

if (bridge.trayAcrylic) document.body.classList.add("is-acrylic");

function renderStatus(status) {
  const el = $("status");
  const state = status?.state ?? "stopped";
  el.dataset.state = state;
  const host = status?.url ? ` · ${status.url.replace(/^https?:\/\//, "")}` : "";
  el.textContent = state === "error" && status.lastError ? `${STATE_TEXT.error}: ${status.lastError}` : `${STATE_TEXT[state] ?? state}${state === "running" ? host : ""}`;
  $("open").disabled = state !== "running" && state !== "starting";
  $("browser").disabled = state !== "running";
}

function elapsed(startedAt) {
  if (!startedAt) return "";
  const s = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function renderJobs(jobs) {
  const list = $("jobs");
  list.replaceChildren(...jobs.map((job) => {
    const li = document.createElement("li");
    const p = document.createElement("span");
    p.className = "p";
    p.textContent = job.prompt || job.kind || "Generation";
    const m = document.createElement("span");
    m.className = "m";
    m.textContent = [job.kind, job.phase, elapsed(job.startedAt)].filter(Boolean).join(" · ");
    li.append(p, m);
    return li;
  }));
  $("job-count").textContent = String(jobs.length);
  $("jobs-empty").hidden = jobs.length > 0;
}

function renderRecent(recent) {
  const grid = $("recent");
  grid.replaceChildren(...recent.filter((r) => r.thumb && !r.isVideo).map((item) => {
    const btn = document.createElement("button");
    btn.title = item.filename;
    const img = document.createElement("img");
    img.src = item.thumb;
    img.alt = item.filename;
    img.loading = "lazy";
    btn.append(img);
    btn.addEventListener("click", () => { void bridge.openApp(); void bridge.hideTrayPopup(); });
    return btn;
  }));
  $("recent-empty").hidden = grid.children.length > 0;
}

async function refresh() {
  try {
    const snap = await bridge.getTraySnapshot();
    renderStatus(snap.status);
    renderJobs(snap.jobs);
    renderRecent(snap.recent);
  } catch (error) {
    console.warn("tray snapshot failed", error);
  }
}

function setVisible(visible) {
  clearInterval(timer);
  timer = null;
  if (!visible) return;
  void refresh();
  timer = setInterval(refresh, REFRESH_MS);
}

const act = (fn) => () => { void fn(); void bridge.hideTrayPopup(); };
$("open").addEventListener("click", act(bridge.openApp));
$("browser").addEventListener("click", act(bridge.openInBrowser));
$("folder").addEventListener("click", act(bridge.openGenerated));
$("settings").addEventListener("click", act(bridge.openSettings));
$("quit").addEventListener("click", () => void bridge.quit());
bridge.onStatus(renderStatus);
bridge.onTrayVisibility(setVisible);
void refresh();
