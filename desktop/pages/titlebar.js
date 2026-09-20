const api = window.ima2Desktop;
const urlEl = document.getElementById("url");

document.body.classList.add(api.platform);
document.getElementById("settings").addEventListener("click", () => api.openSettings());

function render(status) {
  urlEl.textContent = status?.url ? status.url.replace(/^https?:\/\//, "") : "";
}

api.getStatus().then(render);
api.onStatus(render);
