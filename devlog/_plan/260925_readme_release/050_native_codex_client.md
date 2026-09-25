# 050 Native Codex backend client (replaces the openai-oauth proxy)

Supersedes 040's proxy upgrade. User direction 2026-09-25: reimplement on the OpenCodex model instead of carrying openai-oauth, probing the backend directly.

## Why

openai-oauth is a thin shim (auth headers + request normalization) in front of `https://chatgpt.com/backend-api/codex`. ima2 already owns login (`ima2 gpt login`, web login) and the session file (`~/.ima2/chatgpt-auth.json`, lib/chatgptAuth.ts); the proxy only relays and refreshes. Carrying it costs a child process, port 10531 (with its Windows conflicts), readiness waiting, a 2.0 single-instance lock, `ai@6`/`@ai-sdk/*`, and a maintained session patch. 1.0.2 cannot reach GPT-6 at all; 2.0 strips the hosted image tool.

## Direct probe (2026-09-25, ima2 session token, no proxy)

| Call | Result |
|---|---|
| `GET /models?client_version=0.157.0` (npm `@openai/codex` latest) | gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol/terra/luna — all `use_responses_lite` |
| `POST /responses` lite: header `x-openai-internal-codex-responses-lite: true`, `instructions: ""`, tools moved into an `additional_tools` developer input item, `reasoning.context: "all_turns"`, `parallel_tool_calls: false`, `store: false`, `stream: true` | gpt-6-sol 4.1 s, gpt-6-luna 5.0 s, gpt-6-astra 20.3 s, each one `image_gen` function_call with an expanded prompt |
| same without `reasoning.context` | 400 "Responses-Lite requires reasoning.context all_turns" |
| `reasoning.effort: "none"` on gpt-6-astra (via 2.0) | 400 unsupported; sol/luna accept it |
| `POST /images/generations` `{model:"gpt-image-2", prompt, n, quality, size}` | 200 in 21 s; `model` is ignored by the backend (any value renders gpt-image-2); 3840x2160 accepted |
| `POST /images/edits` JSON `{model, prompt, images:[{image_url:dataURL}], background:"transparent", quality, size}` | 200 in 43 s, PNG with real alpha |

## Design

`lib/codexBackend/`:
- `session.ts` — session from `resolveChatgptSessionFile()` (same file the proxy was given); per-request read; one serialized refresh shared by near-expiry tokens and upstream 401s; compare-before-write so a concurrent login wins; atomic write keeping unknown keys, mode 0600. Port of scripts/vendor/openai-oauth/ima2-session.js.
- `version.ts` — Codex client version from `registry.npmjs.org/@openai/codex/latest`, cached 1 h, floor 0.157.0 on failure.
- `catalog.ts` — `/models?client_version=` per account, 10 min cache, exposes public slugs and `use_responses_lite`.
- `request.ts` — `codexFetch(ctx, path, init)`: `/v1/responses` (lite normalization when the catalog says so, forced stream, collect to JSON when the caller did not ask for SSE), `/v1/chat/completions` (translated to Responses and back for the JSON planners), `/v1/images/generations` (JSON), `/v1/images/edits` (JSON images[]), `/v1/models` (catalog). Auth headers `Authorization`, `chatgpt-account-id`, `X-OpenAI-Fedramp` when applicable; 401 → refresh → one retry.
- `oauthFetch(ctx, path, init)` — the single entry for every GPT OAuth caller: native client by default; plain HTTP to `ctx.oauthUrl` when `IMA2_NO_OAUTH_PROXY` / `oauth.autoStart=false` points at an external proxy.

Callers moved to `oauthFetch`: responsesTransport (responses + images), promptBuilder router/client, agentPlannerModel, agentQuestionResponder, cardNewsPlanner(Client), responsesDoctor, routes/health `/api/oauth/status`, legacy lib/oauthProxy runtime.

Server: native mode starts no child process; OAuth readiness = session present; status models from the catalog. `openai-oauth` dependency, vendor tarball, launcher spawn and install-policy entries are removed; the external-proxy mode keeps working.

Image lane: lib/oauthImages.ts (planner + render) on top of `oauthFetch`, unchanged in shape (ParsedResponsesResult, originalIndexes, error). Models: OAuth lane = gpt-6-sol (`sol`), gpt-6-luna (`luna`, default), gpt-6-astra (`astra`); legacy OAuth ids normalize to the matching GPT-6 tier; the API-key lane keeps its list. Transparent background goes through as `background: "transparent"` on the OAuth lane now that the Images API supports it.

## A round 1 (040) carried forward

- Card-news (lib/oauthProxy/generators.ts) and doctor image-probe are OAuth image paths too: both move to the new lane.
- Multimode returns the full result with `extraIgnored` and `originalIndexes`; error diagnostics keep `eventCount`, `eventTypes`, `diagnostics`.
- No lane-level format conversion: save-time sharp already enforces the requested format.
- Node mode loses partial previews on the OAuth lane (the Images API has no streaming); documented as a behavior change.
- Model normalization spans server, CLI aliases, UI options/persistence, agent session settings, prompt builder, style sheet and card-news planner defaults.

## Verification

Focused unit tests for session refresh (port of the four proxy contracts to the in-process client with a fake upstream), lite normalization, chat translation, images routing, planner parsing, model normalization; typecheck, full `npm test`, provider registry check, UI build; live generate / edit-transparent / multimode 2 through each GPT-6 model on the demo runtime; hosted PR gate, dev CI, release candidate CI.
