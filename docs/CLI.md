# CLI Reference

Most server routes under `/api/*` have a CLI wrapper; Agent Mode (`/api/agent/*`) is web-UI-only and has no `ima2` subcommand. The prompt builder HTTP route (`POST /api/prompt-builder/chat`) is available through `ima2 prompt build`. The CLI is a thin shell over the local server, so most commands require a running `ima2 serve` (the few exceptions — `serve`, `setup`, `doctor`, `status`, `open`, `reset`, `config`, `grok`, `skill`, `capabilities`, `backfill-thumbs`, and local `defaults` inspection — work without a live server).

For a quick start, see the [main README](../README.md). For endpoint mapping, see [API.md](API.md).

## Server commands

| Command | Description |
|---|---|
| `ima2 serve [--dev]` | Start the local web server; `--dev` enables verbose server diagnostics |
| `ima2 setup` / `ima2 login` | Reconfigure saved auth (interactive) |
| `ima2 status` | Show config and OAuth status |
| `ima2 doctor` | Diagnose Node, package, config, and auth |
| `ima2 doctor --installation --json` | Offline package checks without config, account or network access |
| `ima2 doctor image-probe [--json]` | Run live sanitized Responses image probes for `EMPTY_RESPONSE` support |
| `ima2 open` | Open the web UI in a browser |
| `ima2 grok login/status/logout` | Manage the xAI OAuth session used by the Grok provider |
| `ima2 reset` | Remove saved config |
| `ima2 backfill-thumbs` | Generate missing gallery thumbnails for images and videos (offline, no running server needed) |

## API image tool selection

`gen`, `edit`, `multimode`, and `node generate` accept
`--image-tool-model gpt-image-2.5-sunburst|gpt-image-2.5-flare` with `--provider api`.
This is separate from `--model`, which continues to choose the outer GPT reasoning
model. Omission preserves upstream selection and existing defaults. Only an explicit
API 2.5 selection enables `--quality xhigh|max`; other scopes normalize these values
to medium. Non-API core providers ignore the tool model; MCP generation rejects the
core-only flag.

```bash
ima2 gen "botanical illustration" --provider api --model gpt-5.4 --image-tool-model gpt-image-2.5-sunburst --quality xhigh
```

## Common flags

These work on most client commands:

| Flag | Meaning |
|---|---|
| `--server <url>` | Explicit server origin; overrides `IMA2_SERVER`, then credential-free advertise/default discovery |
| `--json` | Emit machine-readable JSON instead of human-formatted output |
| `-h`, `--help` | Show subcommand help |

## LAN server authentication

Export your private `IMA2_LAN_TOKEN`, then select the known server explicitly:

```bash
IMA2_SERVER=http://192.168.1.20:3333 ima2 ping --json
ima2 models --server https://studio.example --json
```

The token goes only to the selected normalized HTTP(S) origin, never to arbitrary
advertise entries, redirects or external returned media. Do not put credentials,
query strings or non-root paths in `--server` / `IMA2_SERVER`. No token flag or
cookie jar is used. Auth/forbidden failures exit 4 with a safe code; an unreachable
explicit server exits 3. Explicit targets never silently fall back to local data.
`--local`/`--offline` options keep their documented local behavior.

For a proxy or changed published port, configure exact origins and restart:

```bash
ima2 config set server.publicOrigins '["https://studio.example"]' --yes
ima2 config rm server.publicOrigins --yes
```

Invalid origin values are rejected without echoing them. Removal can recover an
invalid primary or legacy file-layer value while preserving other settings; the
edited full object is written privately to the primary path and the legacy file
is retained. An invalid environment override must be unset or corrected separately.
Config listings/get redact nested credentials; `config path` identifies the file.
See [LAN HTTP/session and transport limits](API.md#local-and-lan-access).

## Agent discovery

Agents should start from the packaged skill and capability commands instead of guessing from scattered help text.

| Command | Description |
|---|---|
| `ima2 skill` | Print the core Markdown skill (`skills/ima2/SKILL.md`) |
| `ima2 skill front` | Print the frontend implementation skill (`skills/ima2-front/SKILL.md`) |
| `ima2 skill uiux` | Print the design direction skill (`skills/ima2-uiux/SKILL.md`) |
| `ima2 skill ls` | List all available packaged skills |
| `ima2 skill --json` | Print a JSON wrapper around the core skill content |
| `ima2 skill front --json` | Print a JSON wrapper around the frontend skill |
| `ima2 skill uiux --json` | Print a JSON wrapper around the design skill |
| `ima2 skill path` | Print the core skill file path |
| `ima2 skill front path` | Print the frontend skill file path |
| `ima2 skill uiux path` | Print the design skill file path |
| `ima2 skill front refs` | List reference modules for the frontend skill (names + line counts) |
| `ima2 skill uiux refs` | List reference modules for the design skill |
| `ima2 skill front ref <name>` | Print one reference module by name (e.g. `motion`, `stacks/react`) |
| `ima2 skill uiux ref <name>` | Print one reference module by name (e.g. `design-isms`) |
| `ima2 skill install --dir <path>` | Install all skills to agent's skill directory |
| `ima2 skill install --tmp` | Install to `$TMPDIR/ima2-skills/` (ephemeral fallback) |
| `ima2 skill front refs --json` | JSON list of reference modules |
| `ima2 skill front ref motion --json` | JSON wrapper around one reference module |
| `ima2 capabilities --json` | Print supported commands, model/quality/reasoning values, and advisory limits |
| `ima2 defaults --json` | Print the running server's effective model/reasoning defaults, falling back to local config when no server is reachable |
| `ima2 defaults --local --json` | Print local effective defaults without contacting the server |

`ima2 capabilities --json` separates supported and unsupported model ids. Agents should use only `valid.imageModels.supported` for generation/default choices. `limits.maxGeneratedImages` reports the configured per-request image count limit, and `limits.maxParallel` reports the enforced server-side inflight capacity guard.

## Generation

| Command | Description |
|---|---|
| `ima2 gen <prompt>` | Generate from the CLI |
| `ima2 edit <file> --prompt <text>` | Edit an existing image |
| `ima2 multimode <prompt>` | Multi-image SSE generation (streams `phase` / `partial` / `image` events) |
| `ima2 video <prompt>` | Video generation via Grok (SSE streaming with progress) |
| `ima2 node generate` | Node-mode generate (SSE; supports `--no-stream`) |
| `ima2 node show <nodeId>` | Read node metadata |

Since 3.0.0, `ima2 gen` and generate-mode `ima2 video` are **fail-closed**: they resolve their
target through the lane catalog (`GET /api/models`) and exit 2 with `NO_DEFAULT_MODEL` when no
`--model <lane>/<model>`, `--provider <lane>`, or persisted `ima2 defaults set image|video`
target applies. Their `--provider` accepts explicit lanes only
(`oauth|api|grok|grok-api|agy|gemini-api|atlascloud|minimax|nai|comfy|runway|higgsfield`); `--provider auto` exits 2 with
`PROVIDER_AUTO_REMOVED`. Inspect lanes and models with `ima2 models [--kind image|video] [--lane <lane>] [--json]`.

`edit`, `multimode`, and `node generate` keep the legacy surface for now: `--provider <auto|oauth|api|grok|grok-api|agy|gemini-api|atlascloud|minimax|nai>`, `--reasoning-effort {none\|low\|medium\|high\|xhigh\|max}`, `--web-search` / `--no-web-search`, `--model`, `--mode`, `--moderation`, `--ref <file>` (repeatable, up to 5 where supported), `-q low|medium|high`, `-n <count>`, `-o <file>`.

Provider override semantics:

- `api` forces the API-key Responses path and requires a configured API key.
- `oauth` forces GPT OAuth: the server calls ChatGPT directly, a GPT-6 model plans and `gpt-image-2` renders.
- `grok` calls `https://api.x.ai` directly with the xAI OAuth session in `~/.progrok/auth.json`. Classic generation first runs mandatory xAI Web Search through Responses API, then asks `grok-4.5` to call ima2's local `generate_image` tool, then ima2 executes xAI `/v1/images/generations`. `grok-4.3` remains available as an explicit compatibility override. If `--ref` images are attached, the final step uses xAI `/v1/images/edits` instead so image-to-image/reference context is preserved. Models: `grok-imagine-image`, `grok-imagine-image-quality`. Size is mapped to xAI `aspect_ratio` and `resolution`; the UI web-search toggle is OpenAI-provider-only because Grok search is always on in this path.
- `agy` spawns the Antigravity CLI to generate via Google Gemini (`nano-banana-2`). Fixed 1024×1024 JPEG output, max 3 refs. No web search, quality, size, or mask controls. If `agy` is not on the server process PATH, ima2 also checks common user-local installs such as `~/.local/bin/agy`; set `IMA2_AGY_BIN=/absolute/path/to/agy` to force a specific binary.
- `gemini-api` calls the Google Generative Language API directly. Models: `nano-banana-2` (Gemini 3.1 Flash Image) and `nano-banana-pro` (Gemini 3 Pro Image). Use `--model nano-banana-2` or `--model nano-banana-pro` to select. Supports `--size` for aspect ratio and resolution (512px–4K) on the direct API path; Vertex AI ignores aspect/size. Requires `GEMINI_API_KEY` or a Vertex AI service account (`VERTEX_SERVICE_ACCOUNT_JSON`). Switching from `agy` or `gemini-api` provider auto-selects the corresponding Gemini model; switching away resets to the GPT default.
- `atlascloud` calls Atlas Cloud's Media API directly. Models: `openai/gpt-image-2/text-to-image` for text-to-image and `openai/gpt-image-2/edit` when references are attached. Requires `ATLASCLOUD_API_KEY`; web search, reasoning, mask, and video controls are ignored.
- `minimax` calls the MiniMax image-generation API directly at `POST /v1/image_generation`. Models: `image-01` for text-to-image and `image-01-live` when a reference image is attached (mapped to the `subject_reference` field). Region selects the global (`https://api.minimax.io/v1`, default) or China (`https://api.minimaxi.com/v1`, `IMA2_MINIMAX_REGION=cn_zh`) base URL. `--size` maps to the closest supported `aspect_ratio`; responses are returned as URLs or base64. Requires `MINIMAX_API_KEY`; web search, reasoning, mask, and video controls are ignored, and image-to-image supports at most one subject reference.
- `runway` / `higgsfield` (gen/video only) route through the MCP async pipeline (`POST /api/mcp/generate` + SSE wait). Runway requires an MCP connection; Higgsfield stays catalog-only (`locked`) until a paid plan. MCP lanes accept `-n 1` only, gallery filenames for `--ref`, and reject core-only flags with `FLAG_NOT_SUPPORTED`.
- `auto` preserves route default behavior and currently resolves to GPT OAuth unless server routing changes (edit/multimode/node only; removed from gen/video in 3.0.0).

### NovelAI native generation options

`ima2 gen`, `ima2 multimode`, and `ima2 node generate` share these request-only
flags. They do not change saved defaults.

| Flag | Request field | Rule |
|---|---|---|
| `--nai-negative-prompt <text>` | `negativePrompt` | Undesired content, max 10,000 characters |
| `--nai-sampler <id>` | `sampler` | Modern NovelAI sampler enum |
| `--nai-noise-schedule <id>` | `noiseSchedule` | `native`, `karras`, `exponential`, or `polyexponential` |
| `--nai-steps <1..50>` | `steps` | Integer |
| `--nai-scale <1..10>` | `scale` | Prompt guidance |
| `--nai-cfg-rescale <0..1>` | `cfgRescale` | Guidance rescale |
| `--nai-seed <0..4294967295>` | `seed` | Integer; zero is valid |
| `--nai-uc-preset <id>` | `ucPresetId` | `heavy`, `light`, `furryFocus`, `humanFocus`, or `none` |
| `--nai-quality-preset <id>` | `qualityPresetId` | `standard`, `light`, or `none`; V5 only |
| `--nai-auto-smea` / `--no-nai-auto-smea` | `autoSmea` | Explicit true/false |
| `--nai-decrisper` / `--no-nai-decrisper` | `decrisper` | Explicit true/false |
| `--nai-variety-plus` / `--no-nai-variety-plus` | `varietyPlus` | Explicit true/false |
| `--nai-straight-alpha` / `--no-nai-straight-alpha` | `straightAlpha` | Enabled alpha is V5 only |

`gen` may resolve a persisted NovelAI default set with
`ima2 defaults set image nai/nai-diffusion-5-full`. `multimode` requires an
explicit NovelAI target when any `--nai-*` flag is used, and `node generate`
likewise requires an explicit NovelAI target. Provider/model conflicts fail before
network I/O. V5-only values on V4.5 fail with `NAI_V5_MODEL_REQUIRED`; malformed
values and non-NAI targets also exit 2. The ima2 NovelAI lane is text-to-image only:
references, edits, and masks remain explicitly unsupported.

```bash
ima2 gen "character sprite, transparent background, has alpha" \
  --model nai/nai-diffusion-5-full --nai-straight-alpha \
  --nai-negative-prompt "watermark" -o sprite.png

ima2 multimode "city at night" --provider nai --model nai-diffusion-5-full \
  --nai-auto-smea --nai-decrisper --max-images 2

ima2 node generate "portrait" --provider nai --model nai-diffusion-5-curated \
  --nai-uc-preset light --nai-quality-preset light
```

The Grok lane needs no local proxy and no separate install. Use `ima2 grok login`
once to authorize xAI OAuth; the device-code flow prints a URL and a code, and the
stored session refreshes itself two minutes before it expires. The session lives in
`~/.progrok/auth.json` and is shared with the progrok CLI if you happen to have it
installed. `ima2 grok status --probe` checks it against xAI, and `ima2 grok logout`
removes it.

Grok size mapping follows xAI's image API, not OpenAI's `size` field. ima2
keeps the requested size in local metadata, but sends `aspect_ratio` such as
`1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, or `2:3`, plus `resolution:
"1k"` or `"2k"` where applicable. The 3840 presets map to `resolution: "2k"`
because xAI currently exposes `1k` and `2k` resolution controls.

For Grok classic generation with `--ref`, ima2 sends up to three references into
the `grok-4.5` planner as image inputs, asks the planner for an English final
image prompt, then sends the same references to xAI image editing. More than
three Grok references are rejected with `GROK_REF_TOO_MANY`, matching xAI's
documented multi-image editing limit.

```bash
ima2 models --kind image
ima2 defaults set image oauth/gpt-6-luna
ima2 gen "a poster of a samurai cat" --model api/gpt-5.4 --reasoning-effort high
ima2 grok login
ima2 gen "a cinematic neon city" --model grok/grok-imagine-image-quality
ima2 gen "campaign still" --model runway/gen-4 --ref 1780000000000_abcd.png
ima2 edit input.png --prompt "make it rainy" --provider oauth --web-search
ima2 multimode "two cats playing" --max-images 2 --ref cat.png --mode direct
ima2 node generate --node n_abc --prompt "add neon lights" --no-stream
```

### Prompting with visible text

GPT Image 2 can render visible text in generated images. If the output needs
text, include the exact words in the target language and script instead of vague
phrases like "Korean text" or "Japanese words".

Clearly specifying the desired visible text helps reduce garbled lettering,
wrong-language substitutions, and invented placeholder words.

Use style words directly, such as `manga panel`, `webtoon style`, `children's
book illustration`, `photorealistic product photo`, or `realistic packaging
mockup`.

For dense or critical text, keep the text large and explicit. Exact placement,
small text, and pixel-perfect typography can still need iteration or post-editing.

Multimode-specific flags include `--max-images <1..24>` by default (configurable through `IMA2_MAX_GENERATED_IMAGES`), `--ref <file>` (repeatable, max 5), `--mode <auto|direct>`, `--provider <auto|oauth|api|grok|grok-api|agy|gemini-api|atlascloud|minimax|nai>`, and `--show-partial`. `ima2 edit --mask` remains intentionally deferred to #31 because current mask plumbing is guided edit rather than guaranteed true masked/inpaint semantics.

## Video

| Command | Description |
|---|---|
| `ima2 video <prompt>` | Generate a video via Grok (SSE streaming with progress) |
| `ima2 video edit <prompt> --video <value>` | Edit an existing video (V2V); saves the result as a generated video artifact |
| `ima2 video extend <prompt> --video <value> [--duration 6]` | Extend an existing video from its last frame |
| `ima2 video continue <prompt> --video <generated-file>` | Generate a new clip from a generated video's last frame with branch-local `revisedPrompt` lineage |
| `ima2 video frame <generated-file> [--last] [-o frame.png]` | Extract a PNG frame from a generated `.mp4` |
| `ima2 video analyze <generated-file>` | Analyze first/last frames with the configured planner model (Grok 4.5 by default) |

Video generate flags:

| Flag | Meaning |
|---|---|
| `--duration <1..15>` | Duration in seconds (default: 5) |
| `--resolution <480p\|720p\|1080p>` | Video resolution (default: 480p). 1080p requires `--model grok-imagine-video-1.5`; prompt-only 1.5 uses the internal white-canvas I2V shim |
| `--aspect-ratio <ratio\|auto>` | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, auto (default: auto) |
| `--model <name>` | `grok-imagine-video` or `grok-imagine-video-1.5`; `grok-imagine-video-1.5-preview` is accepted as a compatibility alias |
| `--planner-model <name>` | Grok planner override (default: `grok-4.5`; `grok-4.3` remains compatible; also in settings UI and `IMA2_GROK_PLANNER_MODEL`) |
| `--storyboard` | Enable storyboard mode — maintains character/scene continuity across sequential clips |
| `--ref <file>` | Attach source/reference image (repeatable, max 7) |
| `-o, --out <file>` | Output file path |
| `-d, --out-dir <dir>` | Output directory |
| `--timeout <sec>` | Timeout in seconds (default: 5400) |
| `--session <id>` | Session ID |

Blank video prompts are rejected. Prompts should include visual flow, camera or
subject motion, sound/no-music intent, dialogue/no-dialogue intent, ending
frame, and duration pacing. The selected seconds should feel naturally filled:
opening composition, connected motion/emotion change, then a stable ending
frame. Example: `from the last frame, she turns toward camera, rain grows
louder, no background music, says "기다려", use the full duration for the turn
and rain build, end on a still close-up after the line finishes`.

Video edit/extend flags:

| Flag | Meaning |
|---|---|
| `--video <value>` | Source video HTTPS URL, xAI `file_id`, data URL, or generated filename |
| `--duration <2..10>` | Extension duration only (default: 6) |
| `-o, --out <file>` | Download the edited or extended video to a file |
| `--json` | Print JSON result |
| `--timeout <sec>` | Timeout in seconds (default: 5400) |

Video continue flags:

| Flag | Meaning |
|---|---|
| `--video <generated-file>` | Parent generated `.mp4`; server extracts its last frame |
| `--duration <1..15>` | New clip duration (default: 5) |
| `--resolution <480p\|720p\|1080p>` | New clip resolution (default: 720p). 1080p requires `--model grok-imagine-video-1.5` |
| `--aspect-ratio <ratio\|auto>` | New clip aspect ratio |
| `--model <name>` | Optional video generation model |

Video continue also accepts `--planner-model` and `--storyboard`.

Video mode is auto-detected from `--ref` count:

| Refs | Mode |
|---|---|
| 0 | text-to-video |
| 1 | image-to-video |
| 2–14 | reference-to-video (15s on grok-imagine-video-1.5, 10s on grok-imagine-video) |

`grok-imagine-video-1.5` supports 1080p for prompt-only text-to-video and single image/frame image-to-video. Prompt-only 1.5 text-to-video is submitted through the internal white-canvas image-to-video shim because upstream 1.5 rejects raw T2V. The old `grok-imagine-video-1.5-preview` name is accepted as an alias and normalized before the upstream request. 1.5 does not support `reference_images` reference-to-video, V2V edit, or video extension. For 2+ refs, use `grok-imagine-video`; if ima2 auto-retries a 1.5 Ref2V request to the base model, read `video.effectiveModel` and `video.modelFallback` from CLI `--json`, or `effectiveModel` and `modelFallback` from SSE.

SSE events: `planning` → `submitted` → `progress` (0–100%) → `done` or `error`.

```bash
ima2 defaults set video grok/grok-imagine-video-1.5   # once; bare calls fail closed without it
ima2 video "a cat playing piano"
ima2 video "animate this" --ref photo.png --duration 10
ima2 video "animate this in high detail" --ref photo.png --model grok-imagine-video-1.5 --resolution 1080p
ima2 video "cinematic" --model grok/grok-imagine-video-1.5 --resolution 720p --aspect-ratio 16:9 -o out.mp4
ima2 video "product reveal, slow dolly-in" --model runway/veo-3.1 --duration 8
ima2 video "style transfer" --ref a.png --ref b.png --ref c.png --model grok-imagine-video
ima2 video edit "make the lighting warm sunset" --video 1780226256355_50252101.mp4 -o edited.mp4
ima2 video extend "camera slowly pulls back" --video 1780226256355_50252101.mp4 --duration 6
ima2 video continue "from the last frame, the actor crosses the room, footsteps only, no dialogue, end on the door closing" --video 1780226256355_50252101.mp4
ima2 video frame 1780226256355_50252101.mp4 --last -o lastframe.png
ima2 video analyze 1780226256355_50252101.mp4 --json
```

Edit/extend accept HTTPS URLs, xAI `file_id`, `data:video/*` URLs, or generated `.mp4` filenames. Generated-file inputs are limited to real `.mp4` files under the generated directory. `ima2 video continue`, `ima2 video analyze`, and `ima2 video frame` intentionally accept generated `.mp4` files only; remote analysis URLs are rejected so the server does not fetch arbitrary URLs through `ffmpeg`.

`ima2 video continue` differs from `ima2 video extend`: `extend` calls xAI's
native extension endpoint and returns a combined original+extension video.
`continue` calls ima2 generation with the parent video's server-extracted last
frame and persists a `videoContinuity` stack of up to four `revisedPrompt`
entries (`keep-start-plus-latest-3`) for future continuations.

JSON output note: `ima2 video --json` wraps the final result with local
download fields such as `ok`, `path`, and `filename`. `ima2 video continue
--json` prints the server SSE `done` payload directly, including `filename`,
`url`, `video`, `revisedPrompt`, and `videoContinuity`.

## Diagnostics

`ima2 doctor --json` prints one JSON document with `schemaVersion: 1`, `mode`,
`checks` and `summary`. Each check has a stable code, severity, evidence category
and a fixed message/action. Exit0 means no failed checks; warnings alone do not
fail. Exit1 means a prerequisite failed. Invalid flag combinations exit2 with
stderr only. Standard mode retains provider-auth checks; missing OAuth can fail
standard doctor even if a different provider is selected.

Use `ima2 doctor --installation --json` to check only the package Node engine,
runtime dependencies/CLI entries, in-memory SQLite binding, packaged skills and UI
build. It does not load account/config files, repair anything, build the UI or make
network requests. Missing optional provider credentials are not installation errors.
It cannot combine with `--bundle`, `--verify-keys` or `--runtime`.

`ima2 doctor --bundle --json` retains the legacy version/node/platform/hostnameHash/
lanes fields and adds safe checks/summary. The compatibility hostname hash is not
an anonymity guarantee. Machine reports omit arbitrary diagnostic text, raw paths,
URLs, response bodies and credential values.

`--verify-keys` explicitly checks registry-declared non-generating authentication
endpoints. Configured/present is not verified, and successful authentication does
not prove generation capability or balance. Authentication rejection, rate limit,
upstream failure, network failure and timeout have different codes.

`--runtime http://127.0.0.1:3333` explicitly checks only that loopback origin's
`/api/health`; localhost and IPv6 loopback are also accepted. No credentials,
redirects, arbitrary paths, query strings or server discovery are used. A version
match proves a local response, not provider success. Authorization-required health
responses direct the operator to the configured authorized client.

Timeouts default to5000ms for key checks and1500ms for runtime health. Optional
`IMA2_DIAGNOSTIC_KEY_TIMEOUT_MS` and `IMA2_DIAGNOSTIC_RUNTIME_TIMEOUT_MS` override
them, capped at30000ms. Response cleanup remains inside the deadline.

`ima2 doctor image-probe` runs live Responses probes that help classify image
generation failures such as `EMPTY_RESPONSE`. It is intended for support
bundles, especially when OAuth is green but a simple prompt produces no image.

```bash
ima2 doctor image-probe --json > ima2-image-probe.json
```

Use `--matrix` when a maintainer asks for current-payload comparison probes:

```bash
ima2 doctor image-probe --matrix --json > ima2-image-probe.json
```

The JSON output is sanitized for issue attachments. It includes diagnostic
codes, event counts, tool-call summaries, byte counts, provider/model labels,
and probe statuses. It does not include prompt text, auth tokens, URLs with
credentials, raw upstream responses, or base64 image data.

For GPT OAuth no-image reports, a useful support bundle is:

```bash
ima2 doctor
ima2 doctor image-probe --json > ima2-image-probe.json
ima2 gen "고양이" --model oauth/gpt-6-luna --no-web-search --json > ima2-cat-no-search.json
ima2 gen "고양이" --model oauth/gpt-6-luna --json > ima2-cat-current.json
```

Do not share ChatGPT cookies, OAuth token files, API keys, prompt history, raw
upstream responses, or generated base64. Share `ima2-gen` version, OS version,
and whether VPN, corporate proxy, antivirus TLS inspection, a custom CA, or a
Windows DNS/fragmentation bypass tool such as SecretDNS is in use.

## History and metadata

| Command | Description |
|---|---|
| `ima2 ls [--session <id>] [--favorites]` | List recent history; `--favorites` uses server-side favorites filtering before pagination |
| `ima2 show <name> [--metadata]` | Reveal a generated asset; optional embedded-metadata read |
| `ima2 history rm <name> [--permanent]` | Soft-delete (default) or permanently delete |
| `ima2 history restore --trash-id <id>` | Restore from trash |
| `ima2 history favorite <name>` | Toggle favorite (sends `X-Ima2-Browser-Id`) |
| `ima2 history import <file>` | Import a local image (raw PNG/JPEG/WEBP) into history |
| `ima2 metadata <file>` | Read embedded metadata from any local image (no server roundtrip needed for the read itself, but the route lives on the server) |
| `ima2 vectorize <image> [-o <file>] [--preset auto\|flat\|detailed\|mono] [--json]` | Trace a local raster (png/jpeg/webp) into a real SVG. Runs fully local. Best on cutouts, icons, logos and flat art; photographs and small text smear |

## Sessions and graphs

| Command | Description |
|---|---|
| `ima2 session ls / show <id> / create <title> / rm <id> / rename <id> <title>` | Session CRUD |
| `ima2 session graph save <id> --file <graph.json>` | Save a graph (uses GET-then-PUT with `If-Match` to guard against `GRAPH_VERSION_CONFLICT`) |
| `ima2 session graph load <id>` | Read the latest graph snapshot |
| `ima2 session style-sheet get <id> / put <id> --file <style.json> / enable <id> / disable <id> / extract <id>` | Style-sheet ops (advanced; UI no longer surfaces this — kept for API-level workflows) |

## Annotations and canvas

| Command | Description |
|---|---|
| `ima2 annotate get <name>` | Read annotation for an image |
| `ima2 annotate set <name> --body <json\|@file\|->` | Write annotation (sends `X-Ima2-Browser-Id`) |
| `ima2 annotate rm <name>` | Remove annotation |
| `ima2 canvas-versions save <imagefile> [--source <name>] [--prompt <text>]` | Save a raw PNG canvas version |
| `ima2 canvas-versions update <name> <imagefile>` | Update an existing canvas version |

## Prompt library

| Command | Description |
|---|---|
| `ima2 prompt ls [-q <search>] [--folder <id>] [--favorites]` | List prompts |
| `ima2 prompt show <id>` | Read one prompt |
| `ima2 prompt create --name <n> --text <t> [--folder <id>] [--tags <a,b>]` | Create |
| `ima2 prompt edit <id> [--name] [--text] [--folder] [--tags]` | Edit |
| `ima2 prompt rm <id>` | Delete |
| `ima2 prompt favorite <id>` | Toggle favorite |
| `ima2 prompt export [-o <file>]` | Export all prompts to JSON |
| `ima2 prompt folder ls / create <name> / rename <id> <name> / rm <id> [--strategy moveToRoot\|deleteItems]` | Folder CRUD |
| `ima2 prompt import sources` | List configured import sources |
| `ima2 prompt import refresh --source <id>` | Re-index a source |
| `ima2 prompt import curated --source <id> --q <query>` | Curated import (commits prompts) |
| `ima2 prompt import discovery --q <query> --seed <repo>...` | Discovery import (curator-only on some servers) |
| `ima2 prompt import folder <localpath>` | Import a local folder of prompts |
| `ima2 prompt import json <file\|@file\|-> [--folder <id>]` | Import a JSON export body through `/api/prompts/import` |
| `ima2 prompt import preview <file\|@file\|-> [--filename <name>]` | Preview local markdown/text candidates without committing |
| `ima2 prompt build --message <text> [--ref <file>] [--model <id>] [--json]` | Build a structured image prompt through `/api/prompt-builder/chat` |
| `ima2 prompt build --messages <file\|@file\|-> [--json]` | Build from a message transcript file or stdin |

Prompt Builder uses the server's persisted `promptBuilder.backend` preference unless
`--backend <auto|oauth|api|grok|grok-api>` overrides it for one request. `auto`
chooses the first ready supported text backend (oauth, grok, api, grok-api); an explicit
value pins routing and fails with a typed error instead of falling back. The result
identifies `requestedBackend`, the answering `backend`, and `model`, so callers can
detect an Auto fallback.

## Card News (gated)

Card News requires the server to be started with `IMA2_CARD_NEWS=1` (or `features.cardNews: true` in `~/.ima2/config.json`). When disabled, the CLI exits 2 with a clear message instead of producing a 404.

| Command | Description |
|---|---|
| `ima2 cardnews templates` | List image-templates and role-templates |
| `ima2 cardnews template preview <id>` | Preview an image template |
| `ima2 cardnews sets` | List card sets |
| `ima2 cardnews set show <id>` / `set manifest <id>` | Show a set or its manifest |
| `ima2 cardnews draft / generate / export [--data <json>]` | Pass-through bodies (server forwards `req.body`) |
| `ima2 cardnews job create [--data <json>]` | Create + start a job |
| `ima2 cardnews job show <jobId>` | Show one job |
| `ima2 cardnews job retry <jobId> [--cards <id,id>]` | Retry a job (optionally specific cards) |
| `ima2 cardnews card regenerate <cardId> [--data <json>]` | Regenerate a single card |

## Observability and jobs

| Command | Description |
|---|---|
| `ima2 ps` | Alias for `inflight ls` (kept for backward compatibility) |
| `ima2 cancel <id>` | Alias for `inflight rm` |
| `ima2 inflight ls [--kind classic\|node\|multimode] [--session <id>] [--terminal]` | List active (and optionally terminal) jobs with phase / model / prompt |
| `ima2 inflight rm <requestId>` | Force-remove a stuck job |
| `ima2 storage status` | Storage inspection (richer than `doctor`) |
| `ima2 storage open` | Open the generated dir in the OS file manager (POST) |
| `ima2 billing` | API usage probe via `/api/billing` (OpenAI/API-key credits when configured). Grok and NovelAI quota are web-UI only via `GET /api/quota`: weekly percentage/reset for current Grok Build xAI auth, with legacy monthly `usedUsd`/`limitUsd` fallback. |
| `ima2 providers` | Configured providers |
| `ima2 oauth status` | GPT OAuth state |
| `ima2 grok status` | Stored xAI OAuth session, with `--probe` for image-model visibility |
| `ima2 ping` | Health-check the running server |

## Config

`config` reads/writes `~/.ima2/config.json` (the file layer). Effective values follow `env > file > defaults`.

| Command | Description |
|---|---|
| `ima2 config path` | Print the config file path |
| `ima2 config ls [--effective]` | Print the file layer (default), or merged effective config with `--effective` |
| `ima2 config get <key>` | Read a dotted key from the effective config; secrets matching `/token\|secret\|apikey\|password/i` are redacted |
| `ima2 config set <key> <value>` | Write to the file layer; rejects unknown keys, refuses auth keys (`provider`, `apiKey`), warns when an env var is overriding the same key, prints a restart-required note |
| `ima2 config rm <key> [--yes]` | Remove a key from the file layer; non-TTY agents must pass `--yes` |
| `ima2 config keys [--json]` | List writable keys and the env vars that override them |

`defaults` is the agent-friendly wrapper for persistent image model and reasoning policy. It writes both OAuth and API-provider default keys so the user-facing "default model" stays one concept across provider paths.

| Command | Description |
|---|---|
| `ima2 defaults` / `ima2 defaults ls` | Show default model/reasoning values |
| `ima2 defaults --json` | Prefer running server defaults; fall back to local effective config |
| `ima2 defaults --local --json` | Read local effective config only |
| `ima2 defaults set model <model>` | Write `imageModels.default` and `apiProvider.defaultImageModel` |
| `ima2 defaults set reasoning <effort>` | Write `imageModels.reasoningEffort` and `apiProvider.defaultReasoningEffort` |
| `ima2 defaults set image <lane>/<model>` | Persist the fail-closed CLI image target (`defaults.image`); validated against `ima2 models`, locked lanes rejected |
| `ima2 defaults set video <lane>/<model>` | Persist the fail-closed CLI video target (`defaults.video`) |
| `ima2 defaults reset model` | Remove persisted model defaults |
| `ima2 defaults reset reasoning` | Remove persisted reasoning defaults |
| `ima2 defaults reset image` / `reset video` | Remove the persisted CLI generation targets |

Allowed keys (whitelist):

```
imageModels.default          imageModels.reasoningEffort
apiProvider.defaultImageModel apiProvider.defaultReasoningEffort
grokProvider.plannerModel     grokProvider.plannerTimeoutMs
grokProvider.defaultImageModel
log.level                    features.cardNews
cardNewsPlanner.{enabled,model,timeoutMs,deterministicFallback}
comfy.{defaultUrl,uploadTimeoutMs,maxUploadBytes,healthTimeoutMs,pollIntervalMs,generationTimeoutMs,maxDownloadBytes}
storage.{generatedDir,generatedDirName}
server.{port,host,bodyLimit}
oauth.{proxyPort,statusTimeoutMs,restartDelayMs}
limits.{maxRefCount,maxGeneratedImages,maxParallel}
history.{defaultPageSize,maxPageCap}
```

To change `provider` / `apiKey`, run `ima2 setup` or `ima2 login` instead.

## Other

| Command | Description |
|---|---|
| `ima2 comfy export <filename>` | Export a ComfyUI workflow (`POST /api/comfy/export-image`) |
| `ima2 comfy workflow ls` | List registered workflows with per-origin health |
| `ima2 comfy workflow inspect <file>` | Show nodes and binding candidates without saving |
| `ima2 comfy workflow add <file> --id <id>` | Register a workflow from an API-format JSON export or a ComfyUI PNG |
| `ima2 comfy workflow rm <id>` | Remove a registered workflow |

## Discovery

The server writes `~/.ima2/server.json` on start. CLI commands read this file to find the actual port (the backend can fall back from `3333` to `3334+`). Override discovery with `--server <url>` or `IMA2_SERVER=http://localhost:3333`.

## Examples

```bash
# Generation with reasoning effort and web search
ima2 gen "poster" --model gpt-5.4 --moderation low --reasoning-effort high
ima2 edit input.png --prompt "make it rainy" --web-search
ima2 multimode "two cats playing" --max-images 2 --ref cat.png --mode direct -o cat.png

# History and metadata
ima2 ls --session sess_abc --favorites
ima2 show img_xyz.png --metadata
ima2 history import ./local.png

# Prompts
ima2 prompt ls -q sunset
ima2 prompt import refresh --source curated
ima2 prompt import preview ./prompts.md --json
ima2 prompt import json ./prompts-export.json --folder __root__

# Observability
ima2 inflight ls --terminal
ima2 storage status --json

# Config
ima2 skill --json
ima2 skill ls
ima2 skill front --json
ima2 skill uiux path
ima2 skill front refs
ima2 skill front ref motion
ima2 skill install --dir ~/.codex/skills
ima2 skill install --tmp
ima2 capabilities --json
ima2 defaults set model gpt-5.5
ima2 defaults set reasoning high
ima2 config set imageModels.reasoningEffort high
ima2 config get log.level
ima2 config keys --json
ima2 config ls --effective --json
```
