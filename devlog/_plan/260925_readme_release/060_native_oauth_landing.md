# 060 — Native GPT OAuth landing record

Supersedes the proxy-2.0 plan in 040 and records what 050 became.

## What landed
- GPT OAuth calls chatgpt.com/backend-api/codex in process (`lib/codexBackend`). The bundled
  openai-oauth proxy, its vendored tarball, launcher and restart/session-sync logic are gone;
  Docker, Electron, Nix and the package manifest no longer carry `vendor/`.
  `IMA2_NO_OAUTH_PROXY=1` still routes GPT OAuth to an external OpenAI-compatible endpoint.
- The OAuth lane keeps exactly gpt-6-luna (default), gpt-6-sol, gpt-6-astra. A GPT-6 model plans
  (Responses-lite, `image_gen` function tool) and gpt-image-2 renders through the Images API.
- Legacy OAuth ids map to their GPT-6 tier on the oauth lane only (server, CLI resolver, agent
  settings, Prompt Builder auto routing, doctor, question responder, card news, `defaults set model`).
  The API-key lane keeps its own list and its own fallback (gpt-5.6-luna).

## Amendments to 050 found in review
- moderation reaches gpt-image-2 (probe 2026-09-25: `moderation:"low"` → 200) on generations
  and on native edits (`editsFormToJson` had dropped it).
- `oauthFetch` strips credentials from an external endpoint URL again.
- Style sheets run on the API-key client, so their default stays gpt-5.6-luna.
- Direct multimode with more than one image plans one prompt per stage.
- A missing ChatGPT session surfaces as `AUTH_CHATGPT_EXPIRED` with an `ima2 gpt login` hint.

## Evidence
- Tests: `tests/oauth-image-lane-contract.test.ts` (routes), `tests/codex-backend-transport.test.ts`
  (native /v1 translation), `tests/codex-backend-session.test.ts` (session contract ported from the
  proxy). Suites that pinned the retired OAuth Responses-tool wire keep their API-key rows.
- Live on the demo server (:3401, native mode): `oauth/gpt-5.6-luna` ran as gpt-6-luna (19.8 s);
  multimode n=2 returned two images; transparent edit returned a real alpha PNG; node SSE on
  gpt-6-sol sent phase + done with no partial frames.
- Observed limit: the ChatGPT Images endpoint returned 1254×1254 for a 1024×1024 request.
- DeepSeek read-only reviews (runtime, tests/docs, packaging) — every material finding fixed.
