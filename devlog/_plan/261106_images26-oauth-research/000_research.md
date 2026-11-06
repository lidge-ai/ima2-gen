# Images 2.6 and Codex OAuth research

Checked 2026-11-06. **Verdict:** no independently verifiable way was found for ima2 to select Images 2.5/2.6 Flare or Sunburst or obtain complexity, markup, GIF, or SVG through Codex OAuth. This is an account- and time-specific finding, not proof of a permanent upstream limitation.

A prior Pro-account probe reported images even for a fictitious model ID, an ignored invalid complexity, PNG for SVG, and a GIF rejection. A separate direct-request report used valid GIF frame settings and received the same rejection. These results do not identify the actual serving model. The upstream Codex source has an experimental, default-off GIF flag but is not evidence of working access. OpenAI describes GIF and markup in ChatGPT itself; that does not establish a third-party Codex endpoint contract.

**Decision:** hide 2.5/2.6 image model choice and 2.6 complexity, markup, GIF, and SVG on ima2's OAuth lane; provide them on the OpenAI API-key lane subject to access. GPT-6 Luna, Sol, and Astra select the planning model. Revisit if an authenticated, reproducible Codex OAuth contract becomes available.

## Sources and scope

The following links were checked in the supplied research; reported behavior and unverified leads are labeled.

- <https://openai.com/index/introducing-images-2-6/> — Launch says Images 2.6 is in ChatGPT and Codex and describes developer models; no OAuth selection/request recipe located.
- <https://deploymentsafety.openai.com/chatgpt-images-2-6> — System card explicitly names ChatGPT GIF/photo markup, Chat reasoning picker, and API SVG; no third-party web-backend request contract.
- <https://developers.openai.com/codex/image-generation> — Codex image documentation, redirected to ChatGPT Learn; describes built-in `gpt-image-2`/usage limits, not named 2.6 OAuth model choice.
- <https://developers.openai.com/api/docs/guides/image-generation> — Platform API documentation for 2.6 image features; does not establish Codex OAuth support.
- <https://developers.openai.com/api/reference/resources/images/methods/generate> — Platform API generation schema includes GIF/SVG controls and GIF preview access requirements; different authentication surface.
- <https://developers.openai.com/api/reference/resources/images/methods/edit> — Platform API edit schema documents markup; not evidence for ChatGPT conversation wire format.
- <https://developers.openai.com/api/reference/resources/responses/methods/create.md> — Prior local research records 2.6 options in Platform Responses schema; fresh web reader could not render this Markdown endpoint, so the prior reading was not independently reverified here.
- <https://x.com/OpenAIDevs/status/2118124753340756055> — OpenAI Developers' signed-in X thread, directly read with Aside after public fetch returned 403: says 2.6 comes to Codex/API and describes GIFs and Codex editing UI, but gives no request recipe or model-selection proof.
- <https://github.com/openai/codex/pull/59073> — Merged Nov 3; feature flag and GIF tool options, with test-coverage description; no live OAuth success claimed.
- <https://github.com/openai/codex/blob/ddd1812a51f4aded35c3ec5446672474d5cb546b/codex-rs/ext/image-generation/src/tool.rs> — Fixed `gpt-image-2`, strict tool args, maps optional GIF to Images request; no image-model selector, complexity, SVG or markup tool option in inspected file.
- <https://github.com/openai/codex/blob/ddd1812a51f4aded35c3ec5446672474d5cb546b/codex-rs/features/src/lib.rs> — `image_generation_animation` is UnderDevelopment and disabled by default at inspected head.
- <https://github.com/openai/codex/blob/ddd1812a51f4aded35c3ec5446672474d5cb546b/codex-rs/codex-api/src/images.rs> — GIF serialized as `output_format` with sibling frame fields; typed request has no complexity/markup/SVG member.
- <https://github.com/openai/codex/blob/ddd1812a51f4aded35c3ec5446672474d5cb546b/codex-rs/ext/image-generation/src/backend.rs> — Shows originator and turn metadata headers; no explicit GIF feature-enable header in the image-specific builder.
- <https://github.com/router-for-me/CLIProxyAPI/issues/7269> — Independent direct Codex OAuth GIF request reports 400; maintainer says fields are forwarded and diagnoses entitlement restriction.
- <https://github.com/router-for-me/CLIProxyAPI/issues/7270> — Proxy Responses report of `gpt-image-2-codex` metadata and complexity rejection despite 2.6 selection; maintainer attribution to upstream is not independently proven.
- <https://github.com/router-for-me/CLIProxyAPI/issues/7259> — Requests adding 2.6 aliases to proxy lists; accepting aliases does not prove effective upstream selection.
- <https://github.com/router-for-me/CLIProxyAPI/pull/7262> — Proxy work to register 2.6 names; no verifiable evidence that OAuth selected the requested upstream model.
- <https://github.com/edubovit/opencode-chatgpt-image> — Explicitly separates subscription and paid API modes; subscription backend manages model/size/quality, while 2.6/SVG/GIF settings are listed for API mode.
- <https://www.codex-pooler.com/docs/clients/openai-compatible/> — Its translated image adapter accepts 2.6 aliases but warns upstream may disregard sizes/quality; new 2.6 outputs/controls are outside its adapter subset; native passthrough is a distinct contract.
- <https://github.com/icoretech/codex-pooler/> — OAuth gateway advertises 2.6 client configuration; repository name/alias alone supplies no upstream model or new-output proof.
- <https://github.com/abhishek944/pi-image-gen/> — Distinguishes ChatGPT Codex subscription `gpt-image-2` route from API-key image-model choices; no demonstrated OAuth 2.6 controls.
- <https://community.openai.com/t/responses-api-with-gpt-image-2-gives-complexity-low-is-not-supported-after-gpt-image-2-6-launch-with-temporary-hack/1412952> — Platform Responses bug report and null-effort workaround; not an OAuth 2.6 control.
- <https://news.ycombinator.com/item?id=50372945> — Reports of GIF use and one user unable to get GIF from Codex CLI 0.166.0; no reproducible OAuth success request.
- <https://www.reddit.com/r/ChatGPT/comments/1xo3oir/introducing_images_26/> — Launch discussion; no documented OAuth request/model-selection evidence in visible comments.
- <https://www.reddit.com/r/ChatGPT/comments/1xo6c69/images_26_brings_gifts_d/> — User-posted Images 2.6 GIF example/discussion; no programmatic OAuth endpoint or payload.
- <https://www.reddit.com/r/OpenAI/comments/1xoh2u0/i_tried_the_new_image_26_gif_feature/> — User GIF-feature discussion; no verified third-party request shape.
- <https://www.reddit.com/r/codex/search/?q=%22image_generation_animation%22&restrict_sr=1> — Exact public subreddit search returned no results; not an exhaustive search.
- <https://www.reddit.com/r/codex/search/?q=%22images%202.6%22&restrict_sr=1> — Search returned a pricing discussion; no OAuth method discovered in returned results.
- <https://www.reddit.com/r/OpenAI/search/?q=%22images%202.6%22&restrict_sr=1> — Results include GIF user posts; no wire-level evidence found.
- <https://www.reddit.com/r/ChatGPT/search/?q=%22images%202.6%22&restrict_sr=1> — Results include launch/GIF posts; no wire-level evidence found.
- <https://www.sotwe.com/devadventur3s?lang=en> — Search indexing showed an alleged X post describing server GIF rejection and local frame stitching, but the opened page did not reproduce that text; **unverified discovery lead**, not used as proof.
- <https://pi.dev/packages/%40monotykamary/pi-better-openai?name=Agent&page=32> — Search snippet claimed standalone OAuth image-model override; page failed to open. No response/model identity proof, therefore **unverified claim**, not a working method.

## Desktop app teardown (ChatGPT.app 26.1029.61003, 2026-11-06)

Static read of the installed `/Applications/ChatGPT.app` (bundle `com.openai.codex`, build 24614, `app.asar` dated Nov 4) and its bundled Codex CLI `0.166.0-alpha.6`. Nothing was executed or sent; this only shows what the first-party clients ask for.

- **Bundled Codex CLI has no 2.6 or GIF path.** The binary contains `gpt-image-2` (50 hits) and `x-codex-image-turn-id`, and zero hits for `gpt-image-2.6`, `image_generation_animation`, `frame_count` and `frame_duration_ms`. The GIF flag from openai/codex#59073 is not in the shipped build.
- **Codex-side image endpoint inside the app is PNG/JPEG/WebP only.** Library-note image generation posts `{prompt, images?}` to `/backend-api/wham/images/{generations,edits}` and validates `output_format` against `png|jpeg|webp`.
- **ChatGPT GIFs, markup and model choice live in the ChatGPT conversation API, not the Codex image endpoints.** The app's ChatGPT thread view submits through `/backend-api/f/conversation`, which needs sentinel chat-requirements tokens (proof of work, Turnstile, `x-conduit-token`). Image work rides on `system_hints: ["picture_v2"]`:
  - Inpainting: `metadata.dalle.from_client.operation = {type:"inpainting", original_file_id, mask_file_id, original_gen_id}`.
  - Markup: first `POST /backend-api/image-gen/markup-preview` (multipart `original_file_id`, `markup` overlay PNG, `is_temporary_chat`, `is_project_thread`, `gizmo_id?`), which returns a composite `image_asset_pointer`. Then the conversation message carries `operation = {type:"transformation", original_file_id, original_gen_id, input_image_asset_pointer, is_markup:true}`.
  - GIF: the client sends no GIF parameter. GIF prompts come from `POST /backend-api/composer/items {feature:"gif_nux"}` suggestions, and the model's image tool decides. Results arrive as `image/gif` asset pointers whose `metadata.generation` carries `animation {rows, columns, frame_count}`, a `spritesheet` pointer and `gif_speed_variants` / `watermarked_gif_speed_variants`; `POST /backend-api/image-gen/gif/select_speed` stores the chosen speed. Delayed GIF jobs surface as `is_gif` offers on `/image-gen/delayed/accept`.
  - The model shown for a generated image is read back from `message.metadata.model_slug`; the client does not pick an image model.
- **Decision unchanged.** These shapes belong to the ChatGPT web conversation protocol with bot-protection tokens, not to the Codex OAuth image API ima2 uses. Reproducing them would mean driving the ChatGPT web chat as an unofficial client, which is out of scope. GIF, SVG, complexity, markup and model choice stay on the API-key lane.
