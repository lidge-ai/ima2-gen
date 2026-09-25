---
created: 2026-05-25
status: P / plan
tags: [ima2-gen, empty-response, oauth, responses-api, diagnostics, jawdev]
depends_on:
  - ../README.md
---

# Empty Response Diagnostics Jawdev Plan

Public phase report anchor: https://github.com/lidge-ai/ima2-gen/issues/76

## Why This Exists

DCInside user reports show a Windows OAuth user repeatedly hitting the Korean
card:

```text
이미지가 돌아오지 않았어요:
Codex가 응답을 보냈지만 이미지 데이터가 비어 있었어요.
```

The reported repro is intentionally benign:

- Windows environment;
- OAuth status shows green;
- prompt is always `고양이`;
- failure has persisted across updates for about a month.

That combination makes real moderation unlikely. The current code also shows
that `EMPTY_RESPONSE` is diagnostically too broad: it can mean the model called
only `web_search`, the stream format changed, the image tool failed without a
parsed result, the Codex OAuth account lacks image-tool entitlement, or the SSE
parser did not parse bytes that actually arrived.

## Current Highest-Probability Root Causes

1. OAuth/Codex capability or entitlement mismatch.
2. Streaming event-shape drift or brittle SSE parsing.
3. `tool_choice: "required"` with both `web_search` and `image_generation`.
4. Unsupported Codex OAuth payload combination, especially stream + reasoning
   + image tool + optional web search.
5. Windows proxy or stream transport behavior.
6. Real moderation, only if explicit safety/refusal fields are present.

## Scope

This lane covers the Classic generation path first:

```text
POST /api/generate
-> routes/generate.ts
-> lib/responsesImageAdapter.ts generateViaResponses()
-> openai-oauth /v1/responses or OpenAI API /v1/responses
-> UI EMPTY_RESPONSE card
```

Agent Mode, multimode, and edit paths should receive mirrored parser/error
hardening after the Classic path has a reproducible diagnostic matrix.

## Non-Goals

- Do not claim this is moderation without upstream safety/refusal evidence.
- Do not log prompt text, revised prompt text, base64 image data, OAuth tokens,
  auth headers, full upstream response bodies, or user-identifying URLs.
- Do not silently switch provider or model in production as a hidden fallback.
- Do not make Windows-only assumptions until probe output separates platform
  behavior from account/tool entitlement.

## Source Findings

- `routes/generate.ts` imports `generateViaResponses()` and no longer uses the
  older Classic `generateViaOAuth()` path.
- `lib/responsesImageAdapter.ts` sends `stream: true`, `tool_choice:
  "required"`, and may include both `web_search` and `image_generation`.
- The parser only accepts final image results from
  `response.output_item.done` where `item.type === "image_generation_call"` and
  `item.result` exists.
- The older `lib/oauthProxy/generators.ts` path had a valuable non-stream,
  prompt-only image retry and richer empty-response diagnostics.
- `openai-oauth` is account/Codex-plan dependent and proxies to the ChatGPT
  Codex backend rather than the public API-key path.

## External References

- OpenAI image generation tool docs:
  https://developers.openai.com/api/docs/guides/tools-image-generation
- OpenAI Responses streaming reference:
  https://platform.openai.com/docs/api-reference/responses-streaming
- OpenAI web search tool docs:
  https://developers.openai.com/api/docs/guides/tools-web-search
- `openai-oauth` README:
  https://github.com/EvanZhouDev/openai-oauth

## Plan Documents

- `01_current_findings.md`
- `02_phase1_diagnostics_and_doctor.md`
- `03_phase2_parser_and_payload_hardening.md`
- `04_image_tool_call_hardening.md`
- `05_phase3_fallback_and_error_taxonomy.md`
- `06_windows_oauth_repro_playbook.md`
- `07_verification_risks_acceptance.md`
