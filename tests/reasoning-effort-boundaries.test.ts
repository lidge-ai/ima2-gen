import assert from "node:assert/strict";
import { test } from "node:test";
import { requestAgentQuestionAnswer } from "../lib/agentQuestionResponder.ts";
import { requestCardNewsPlannerJson } from "../lib/cardNewsPlannerClient.ts";
import { generateViaOAuth } from "../lib/oauthProxy/generators.ts";
import { postResponses } from "../lib/responsesTransport.ts";

test("OpenAI request boundaries coerce unsupported none while preserving other efforts", async (t) => {
  const original = globalThis.fetch;
  let body: any;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ output_text: '{"ok":true}', output: [] });
  };
  t.after(() => { globalThis.fetch = original; });
  await t.test("API agent question uses migrated model", async () => {
    await requestAgentQuestionAnswer({ apiKey: "fixture" }, "question", { provider: "api", model: "gpt-6-sol", reasoningEffort: "none" });
    assert.deepEqual([body.model, body.reasoning.effort], ["gpt-6.2-sol", "low"]);
  });
  await t.test("card planner proxy", async () => {
    await requestCardNewsPlannerJson({ messages: [] }, { oauthUrl: "http://fixture.invalid", model: "gpt-6.2-astra", reasoningEffort: "none" });
    assert.equal(body.reasoning.effort, "low");
  });
  await t.test("legacy OAuth generator proxy", async () => {
    await generateViaOAuth("draw", "high", "auto", "low", [], null, "auto", { oauthUrl: "http://fixture.invalid" }, { model: "gpt-6.2-sol", reasoningEffort: "none" }).catch(() => {});
    assert.equal(body.reasoning.effort, "low");
  });
  for (const provider of ["api", "oauth"]) {
    await t.test(`Responses ${provider} boundary`, async () => {
      await postResponses({ ctx: { apiKey: "fixture", oauthUrl: "http://fixture.invalid" }, provider, scope: "test", payload: { model: "gpt-6.2-astra", reasoning: { effort: "none" } } });
      assert.equal(body.reasoning.effort, "low");
      await postResponses({ ctx: { apiKey: "fixture", oauthUrl: "http://fixture.invalid" }, provider, scope: "test", payload: { model: "gpt-6.1-terra", reasoning: { effort: "none" } } });
      assert.equal(body.reasoning.effort, "none");
    });
  }
});
