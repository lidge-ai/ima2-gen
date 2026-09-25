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

function recentTile(item) {
  if (item.isVideo) {
    const label = document.createElement("span");
    label.className = "tray__video";
    label.textContent = "▶ Video";
    return label;
  }
  const img = document.createElement("img");
  img.src = item.thumb;
  img.alt = item.filename;
  img.loading = "lazy";
  return img;
}

function renderRecent(recent, error) {
  const grid = $("recent");
  grid.replaceChildren(...recent.filter((r) => r.thumb || r.isVideo).map((item) => {
    const btn = document.createElement("button");
    btn.title = item.filename;
    btn.append(recentTile(item));
    btn.addEventListener("click", () => { void bridge.openApp(); void bridge.hideTrayPopup(); });
    return btn;
  }));
  const empty = $("recent-empty");
  empty.textContent = error ? `Couldn't load recent items: ${error}` : "Nothing generated yet";
  empty.hidden = grid.children.length > 0 && !error;
}

async function refresh() {
  try {
    const snap = await bridge.getTraySnapshot();
    renderStatus(snap.status);
    renderJobs(snap.jobs);
    renderRecent(snap.recent, snap.error);
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
setVisible(true);
