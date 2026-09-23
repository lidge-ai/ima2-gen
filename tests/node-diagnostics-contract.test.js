import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSourceTree } from "./_readTree.mjs";

// NOTE: lib/oauthProxy.ts was split into lib/oauthProxy/*.ts behind a 1-line
// facade. The `oauth` constant below concatenates all split sources so the
// existing regex assertions continue to match.
const OAUTH_PROXY_SOURCES = [
  "lib/oauthProxy.ts",
  "lib/oauthProxy/types.ts",
  "lib/oauthProxy/prompts.ts",
  "lib/oauthProxy/references.ts",
  "lib/oauthProxy/errors.ts",
  "lib/oauthProxy/runtime.ts",
  "lib/oauthProxy/streams.ts",
  "lib/oauthProxy/generators.ts",
  "lib/oauthProxy/multimodeGenerators.ts",
  "lib/oauthProxy/index.ts",
];
const oauth = OAUTH_PROXY_SOURCES.map((p) => readFileSync(p, "utf-8")).join("\n");
const nodes = [
  (readFileSync("routes/nodes.ts", "utf-8") + readFileSync("lib/nodeGeneration.ts", "utf-8") + readFileSync("lib/nodeValidation.ts", "utf-8")),
  readFileSync("lib/nodeHelpers.ts", "utf-8"),
].join("\n");

describe("node diagnostics contract", () => {
  it("preserves safe OAuth stream error metadata", () => {
    assert.match(oauth, /logEvent\(scope, "stream_error"/);
    assert.match(oauth, /eventCount/);
    assert.match(oauth, /eventType: data\.type/);
    assert.match(oauth, /err\.eventCount = eventCount/);
  });

  it("logs node attempts and retries with node context", () => {
    assert.match(nodes, /logEvent\("node", "attempt"/);
    assert.match(nodes, /operation/);
    assert.match(nodes, /clientNodeId/);
    assert.match(nodes, /parentNodeId/);
    assert.match(nodes, /errorEventType: lastErr\?\.eventType/);
    assert.match(nodes, /errorEventCount: lastErr\?\.eventCount/);
  });

  it("sends SSE error payloads after headers are committed", () => {
    assert.match(nodes, /if \(res\.headersSent\)/);
    assert.match(nodes, /writeSse\(res, "error"/);
    assert.match(nodes, /outerHttpAlreadyCommitted: res\.headersSent/);
    assert.match(nodes, /sseErrorSent: streamResponse/);
  });

  it("does not collapse stream context into only SAFETY_REFUSAL", () => {
    assert.match(nodes, /logEvent\("node", "final_error"/);
    // The upstream code (falling back to the ima2 code) and type are emitted as
    // filtered labels; tests/responses-parse-diagnostics.test.ts checks their values.
    assert.match(nodes, /\.\.\.finalErrorUpstreamLabels\(lastErr\)/);
    assert.match(nodes, /errorEventType: lastErr\?\.eventType/);
    assert.match(nodes, /errorEventCount: lastErr\?\.eventCount/);
  });

  it("does not add raw prompt or base64 to diagnostic logs", () => {
    assert.match(nodes, /promptChars: prompt\.length/);
    assert.match(oauth, /imageChars: imageB64\.length/);
    assert.match(oauth, /refsCount: references\.length/);
    assert.doesNotMatch(nodes, /logEvent\("node", "attempt", \{[^}]*prompt:/);
    assert.doesNotMatch(nodes, /logEvent\("node", "attempt", \{[^}]*parentB64/);
    assert.doesNotMatch(oauth, /logEvent\("oauth-edit", "request", \{[^}]*imageB64/);
  });
});
