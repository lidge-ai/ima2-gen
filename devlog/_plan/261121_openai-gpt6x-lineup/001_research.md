# 001 Research and live evidence (2026-11-21)

All web/doc reads below were made through Aside (`codemode` → `browse.exec`, account u0) on the `.md` versions of the official pages.

## 1. GPT OAuth (ChatGPT Codex backend), live

Raw log: `.codexclaw/evidence/oauth-live-probe-261121.md` (not committed).

- `GET /backend-api/codex/models?client_version=0.171.0` → 200, lists gpt-6.2-sol, gpt-6.2-astra, gpt-6.1-terra, gpt-6.1-sol, gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol/terra/luna; all `use_responses_lite: true`.
- Catalog by `client_version`: 0.157.0 (current `CODEX_CLIENT_VERSION_FLOOR`) lists only gpt-6-astra/sol/luna and gpt-5.6-*; 0.160-0.164 add gpt-6.1-terra; 0.166.0+ add gpt-6.2-sol and gpt-6.2-astra. ⇒ the floor must rise to 0.166.0, otherwise a failed npm registry lookup hides the new ids from the catalog.
- `lib/codexBackend/client.ts` `isLiteModel` falls back to `/^gpt-(6|5\.6)(-|$)/`, which does not match `gpt-6.1-terra` / `gpt-6.2-*` ⇒ a catalog miss would send them non-lite.
- `POST /backend-api/codex/responses` (lite), "Reply with exactly: OK":

| model | effort low | effort none |
|---|---|---|
| gpt-6-luna | 200 OK | 200 OK |
| gpt-6.1-terra | 200 OK | 200 OK |
| gpt-6.2-sol | 200 OK | 400 unsupported_value: "'none' is not supported with the 'gpt-6.2-sol' model" |
| gpt-6.2-astra | 200 OK | 400 unsupported_value (same) |

- `POST /backend-api/codex/images/generations` with `output_format: "svg"`: `gpt-image-2` → 200 with `output_format: "png"` and PNG bytes; `gpt-image-2.6-flare` + `svg.model: gpt-6-luna` → 200, PNG. The OAuth lane silently ignores SVG.

## 2. OpenAI API (API key), docs only (no key on this host)

- Models overview (https://developers.openai.com/api/docs/models.md): "use GPT-6.2 Astra … Choose GPT-6.2 Sol to balance intelligence and cost, or GPT-6 Luna for cost-sensitive, high-volume workloads"; lists GPT-6.1 Terra. GPT-5.6 Luna/Sol/Terra, GPT-6 Sol/Astra remain listed.
- Per-model pages (gpt-6-luna, gpt-6.1-terra, gpt-6.2-sol, gpt-6.2-astra .md): each lists "Supported tools … image_generation" for the Responses API and "Image generation | v1/images/generations | Not supported" (so they are mainline models that call the hosted tool, as ima2's API lane does).
- Effort: gpt-6-luna "`reasoning.effort` supports `none`, `low`, `medium` (default), `high`, `xhigh`, and `max`"; gpt-6.1-terra "supports `none`, `low`, `medium` (default), `high`, …"; gpt-6.2-sol and gpt-6.2-astra "The API rejects requests that set reasoning effort to `none`." Reasoning guide: "GPT-6.2 Astra and GPT-6.2 Sol reject requests that set `reasoning.effort` … to `none`."
- Chat Completions: compare page lists "Chat Completions, Responses, Batch" for Astra, Sol, Luna; Terra page lists Chat Completions Supported.
- Deprecations (https://developers.openai.com/api/docs/deprecations.md): no shutdown date for gpt-5.6-*, gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-6-sol, gpt-6-astra. Migration of saved ids is therefore a product choice (user-requested), not a forced shutdown.

## 3. SVG

- Image-generation guide: "GPT-Image-2.6 includes Sunburst … and Flare … Both models support complexity control, markup-guided edits, SVG output, and animated GIF output through the Image API." The 2.5 lines in the API reference concern backgrounds and quality, not SVG ⇒ ima2's 2.6-only gate stays.
- Create-image reference: "`svg`: Selects the model and reasoning effort used to author SVG output. Requires output_format=svg and access to SVG model selection. When model selection is enabled, supply svg.model … SVG generation requires n=1 and does not support streaming, partial images, prompt_rewriter, or output_compression." "`model: string` — Model used to author the SVG." "Supported efforts depend on the selected author model." No list of allowed author models and no default is documented.
- PR #425 live-verified `svg.model: gpt-5.6-luna` with a funded key (200, `output_format: svg`, `svg_usage`). No live evidence exists for gpt-6-luna as author model.
- Other lanes (official docs via Aside): Gemini/Nano Banana image generation documents `response_format` image entries with `mime_type` "image/png" / "image/jpeg" and no SVG; Imagen page has no vector output; xAI "Control the output format with the response_format parameter … default is url … request base64" (delivery encoding only); MiniMax text-to-image documents `response_format: "url"`/base64; Antigravity docs expose no image output format. None documents SVG output ⇒ `SVG_OUTPUT_UNSUPPORTED` stays for every non-API lane. ima2 already ships local raster→SVG tracing as `ima2 vectorize` for those lanes.
