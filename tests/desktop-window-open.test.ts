import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isExternalWebUrl, isLocalServerUrl, resolveWindowOpen } from "../desktop/lib/window-open.mjs";

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
