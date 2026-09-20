import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";

export const TITLEBAR_SCHEME = "ima2-desktop";
export const TITLEBAR_HEIGHT = 38;

/** Serves desktop build assets (icons) to the injected title bar as ima2-desktop://<name>. */
export function registerTitlebarProtocol(buildDir) {
  protocol.handle(TITLEBAR_SCHEME, (req) => {
    const name = new URL(req.url).hostname.replace(/[^a-z0-9@._-]/gi, "");
    return net.fetch(pathToFileURL(`${buildDir}/${name}`).href);
  });
}

export function registerTitlebarScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: TITLEBAR_SCHEME, privileges: { standard: true, secure: true } }]);
}

const CSS = `
#ima2-desktop-titlebar {
  position: fixed; top: 0; left: 0; right: 0; height: ${TITLEBAR_HEIGHT}px; z-index: 2147483647;
  display: flex; align-items: center; gap: 8px; padding-left: 78px; padding-right: 14px;
  background: rgba(24, 25, 28, 0.82); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  color: #e6e7ea; font: 500 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-app-region: drag; user-select: none; box-sizing: border-box;
}
#ima2-desktop-titlebar[data-platform="win32"], #ima2-desktop-titlebar[data-platform="linux"] { padding-left: 14px; }
#ima2-desktop-titlebar img { width: 18px; height: 18px; border-radius: 4px; }
#ima2-desktop-titlebar .title { letter-spacing: 0.01em; }
#ima2-desktop-titlebar .sep { width: 1px; height: 14px; background: rgba(255,255,255,0.14); margin: 0 4px; }
#ima2-desktop-titlebar .url { color: rgba(230,231,234,0.55); font-weight: 400; font-size: 12px; }
#ima2-desktop-titlebar .spacer { flex: 1; }
#ima2-desktop-titlebar button {
  -webkit-app-region: no-drag; appearance: none; border: 0; background: transparent; color: rgba(230,231,234,0.7);
  font: 500 12px/1 inherit; padding: 5px 8px; border-radius: 6px; cursor: default;
}
#ima2-desktop-titlebar button:hover { background: rgba(255,255,255,0.08); color: #fff; }
`;

function injectScript({ url, platform }) {
  return `(() => {
    if (document.getElementById("ima2-desktop-titlebar")) return;
    const bar = document.createElement("div");
    bar.id = "ima2-desktop-titlebar";
    bar.dataset.platform = ${JSON.stringify(platform)};
    bar.innerHTML = '<img alt="" src="${TITLEBAR_SCHEME}://icon.png">'
      + '<span class="title">ima2-gen</span><span class="sep"></span>'
      + '<span class="url">' + ${JSON.stringify(url.replace(/^https?:\/\//, ""))} + '</span>'
      + '<span class="spacer"></span><button type="button" data-act="settings">Settings</button>';
    bar.querySelector('[data-act="settings"]').addEventListener("click", () => window.ima2Desktop?.openSettings());
    document.documentElement.appendChild(bar);
  })();`;
}

/** Overlay a draggable app title strip on top of the served ima2 UI. */
export function attachTitlebar(win, { getServerUrl }) {
  win.webContents.on("did-finish-load", () => {
    const url = getServerUrl();
    if (!url || !win.webContents.getURL().startsWith(url)) return;
    void win.webContents.insertCSS(CSS);
    void win.webContents.executeJavaScript(injectScript({ url, platform: process.platform }));
  });
}
