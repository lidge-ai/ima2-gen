import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installPopupPolicy, isExternalWebUrl, isLocalServerUrl, resolvePopupNavigation, resolveWindowOpen } from "../desktop/lib/window-open.mjs";

const SERVER = "http://127.0.0.1:3333";

describe("isLocalServerUrl", () => {
  it("matches only the server origin", () => {
    assert.equal(isLocalServerUrl(`${SERVER}/generated/a.png`, SERVER), true);
    assert.equal(isLocalServerUrl("https://example.com/x", SERVER), false);
    assert.equal(isLocalServerUrl(`${SERVER}/x`, undefined), false);
    assert.equal(isLocalServerUrl("not a url", SERVER), false);
  });
});

describe("isExternalWebUrl", () => {
  it("allows only http and https", () => {
    assert.equal(isExternalWebUrl("http://a.b"), true);
    assert.equal(isExternalWebUrl("https://a.b/x?y=1"), true);
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "devtools://d", "mailto:a@b.c", "slack://open", "about:blank", ""]) {
      assert.equal(isExternalWebUrl(url), false, url);
    }
  });
});

describe("resolveWindowOpen", () => {
  it("allows local server pages in-app", () => {
    assert.equal(resolveWindowOpen(`${SERVER}/api/mcp/authorize`, SERVER), "allow");
  });

  it("allows about:blank placeholder popups so OAuth flows get a real window", () => {
    // connectMcpProvider opens about:blank synchronously then navigates the
    // popup to authorizationUrl; denying it makes window.open return null.
    assert.equal(resolveWindowOpen("about:blank", SERVER), "allow");
    assert.equal(resolveWindowOpen("about:blank#blocked", SERVER), "allow");
  });

  it("sends web pages to the system browser", () => {
    assert.equal(resolveWindowOpen("https://accounts.google.com/o/oauth2", SERVER), "external");
    assert.equal(resolveWindowOpen("http://example.com", SERVER), "external");
  });

  it("denies non-web schemes without touching the OS handler", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "devtools://d", "mailto:a@b.c", "slack://open", "about:config", "not a url"]) {
      assert.equal(resolveWindowOpen(url, SERVER), "deny", url);
    }
  });
});

describe("resolvePopupNavigation", () => {
  it("allows web pages and local server pages inside the popup", () => {
    assert.equal(resolvePopupNavigation("https://accounts.google.com/o/oauth2", SERVER), "allow");
    assert.equal(resolvePopupNavigation(`${SERVER}/api/mcp/callback`, SERVER), "allow");
  });

  it("blocks the navigation targets resolveWindowOpen never sees", () => {
    // connectMcpProvider assigns popup.location.href = authorizationUrl —
    // that path bypasses the window.open check, so a bad server-supplied
    // scheme must be stopped here.
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "devtools://d", "slack://open", "about:blank", "not a url"]) {
      assert.equal(resolvePopupNavigation(url, SERVER), "deny", url);
    }
  });
});

describe("installPopupPolicy", () => {
  const fakeApp = () => {
    const handlers = new Map();
    return { handlers, on: (event, fn) => handlers.set(event, fn) };
  };
  const fakeContents = (type) => {
    const calls = { windowOpenHandler: null, listeners: new Map() };
    return {
      calls,
      getType: () => type,
      setWindowOpenHandler: (fn) => { calls.windowOpenHandler = fn; },
      on: (e, fn) => calls.listeners.set(e, fn),
    };
  };

  it("attaches navigation policy to new webContents but skips DevTools", () => {
    const app = fakeApp();
    installPopupPolicy({ app, shell: { openExternal() {} }, getServerUrl: () => SERVER });
    const view = fakeContents("browserView");
    const devtools = fakeContents("devtools");
    app.handlers.get("web-contents-created")(null, view);
    app.handlers.get("web-contents-created")(null, devtools);
    assert.equal(typeof view.calls.windowOpenHandler, "function");
    assert.equal(view.calls.listeners.has("will-navigate"), true);
    assert.equal(devtools.calls.windowOpenHandler, null);
    assert.equal(devtools.calls.listeners.has("will-navigate"), false);
  });

  it("blocks a javascript: authorizationUrl assigned to the OAuth popup", () => {
    const app = fakeApp();
    installPopupPolicy({ app, shell: { openExternal() {} }, getServerUrl: () => SERVER });
    const popup = fakeContents("browserView");
    app.handlers.get("web-contents-created")(null, popup);
    const willNavigate = popup.calls.listeners.get("will-navigate");
    let prevented = false;
    willNavigate({ preventDefault: () => { prevented = true; } }, "javascript:alert(document.cookie)");
    assert.equal(prevented, true);
    prevented = false;
    willNavigate({ preventDefault: () => { prevented = true; } }, "https://accounts.google.com/o/oauth2");
    assert.equal(prevented, false);
  });

  it("routes nested window.open through the same outcome table", () => {
    const app = fakeApp();
    const opened = [];
    installPopupPolicy({ app, shell: { openExternal: (u) => opened.push(u) }, getServerUrl: () => SERVER });
    const popup = fakeContents("browserView");
    app.handlers.get("web-contents-created")(null, popup);
    const handler = popup.calls.windowOpenHandler;
    assert.deepEqual(handler({ url: "about:blank" }), { action: "allow" });
    assert.deepEqual(handler({ url: `${SERVER}/x` }), { action: "allow" });
    assert.deepEqual(handler({ url: "https://example.com" }), { action: "deny" });
    assert.deepEqual(opened, ["https://example.com"]);
    assert.deepEqual(handler({ url: "javascript:alert(1)" }), { action: "deny" });
    assert.deepEqual(opened, ["https://example.com"]);
  });
});
