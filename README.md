<p align="center">
  <img src="assets/brand/banner.png" alt="ima2 — local image and video studio for people and coding agents" width="100%">
</p>

<h3 align="center">Generate, branch and clean up images and video on your own machine.</h3>
<p align="center">One local studio for GPT, Grok, Gemini, NovelAI and ComfyUI.<br>
Use it from the browser, the Mac app, the CLI, or hand it to your coding agent.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ima2-gen"><img src="https://img.shields.io/npm/v/ima2-gen?style=flat-square&labelColor=18181b&color=3f3f46&logo=npm&label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/ima2-gen"><img src="https://img.shields.io/npm/dm/ima2-gen?style=flat-square&labelColor=18181b&color=3f3f46&label=downloads" alt="npm downloads"></a>
  <img src="https://img.shields.io/node/v/ima2-gen?style=flat-square&labelColor=18181b&color=3f3f46&logo=node.js&label=node" alt="Node.js version">
  <a href="https://github.com/lidge-jun/ima2-gen/stargazers"><img src="https://img.shields.io/github/stars/lidge-jun/ima2-gen?style=flat-square&labelColor=18181b&color=3f3f46&logo=github&label=stars" alt="GitHub stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3f3f46?style=flat-square&labelColor=18181b" alt="MIT license"></a>
</p>

```bash
npm install -g ima2-gen
ima2 serve
```

<p align="center">
  <a href="https://github.com/lidge-jun/ima2-gen/releases?q=desktop&expanded=true"><img src="https://img.shields.io/badge/macOS-Apple%20Silicon%20.dmg-18181b?style=for-the-badge&logo=apple&logoColor=white" alt="Download the Mac app (.dmg)"></a>
  <a href="#one-line-installers"><img src="https://img.shields.io/badge/Windows%20%C2%B7%20Linux-one--line%20installer-18181b?style=for-the-badge&logo=gnubash&logoColor=white" alt="One-line installers for Windows and Linux"></a>
</p>

<table>
<tr>
<td width="42%" valign="middle">

### Create

Write a prompt, attach references, pick a lane and model. Every result keeps its prompt, timing and settings, so you can copy it, continue from it, or animate it.

</td>
<td width="58%">
  <img src="assets/screenshots/readme-create.webp" alt="Create workspace in dark mode with a chrome sculpture result, the prompt composer on the left and GPT OAuth settings on the right" width="100%">
</td>
</tr>
<tr>
<td width="42%" valign="middle">

### Branch in Node graph

Keep a good image and push it in several directions at once. Each branch remembers its parent, so nothing gets overwritten.

</td>
<td width="58%">
  <img src="assets/screenshots/readme-node.webp" alt="Node graph with one chrome sculpture source branching into gold, marble and forest variants" width="100%">
</td>
</tr>
<tr>
<td width="42%" valign="middle">

### Clean up in Canvas Mode

Annotate, erase, cut backgrounds and export with real alpha. One-click GPT transparency is checked on the server before the app calls it transparent.

</td>
<td width="58%">
  <img src="assets/screenshots/readme-canvas.webp" alt="Canvas Mode showing a transparent camera cutout on a checkerboard with the canvas toolbar" width="100%">
</td>
</tr>
<tr>
<td width="42%" valign="middle">

### Start from Home

See which lanes are ready, type a prompt, and pick up recent work without digging through folders.

</td>
<td width="58%">
  <img src="assets/screenshots/readme-home.webp" alt="Home screen with lane readiness, a prompt box and a recent work grid" width="100%">
</td>
</tr>
</table>

<p align="center">
  <b>English</b> · <a href="docs/README.ko.md">한국어</a> · <a href="docs/README.ja.md">日本語</a> · <a href="docs/README.zh-CN.md">简体中文</a> · <a href="docs/README.zh-TW.md">正體中文</a> · <a href="https://lidge-jun.github.io/ima2-gen/"><b>Website</b></a> · <a href="https://lidge-jun.github.io/ima2-gen/docs"><b>Docs →</b></a>
</p>

`ima2-gen` is a local-first visual generation runtime and studio for people and coding agents, with reproducible image and video workflows across multiple providers. It runs a small server on your machine, keeps every image in `~/.ima2/generated`, and talks to the providers you connect: OpenAI OAuth/API, Grok OAuth/API, Antigravity CLI, Gemini API, AtlasCloud, MiniMax, NovelAI and registered ComfyUI workflows. Runway and Higgsfield stay separate MCP-backed integrations. Prompts and references go only to the provider you pick for each job.

## Quick start

### Mac app (Apple Silicon)

The desktop app runs the same local server and studio in a Mac window with a menu bar icon. It is signed with a Developer ID and notarized by Apple, and it brings its own runtime, so you do not need Node.js.

1. Download `ima2-<version>-mac-arm64.dmg` from the newest [ima2 Desktop release](https://github.com/lidge-jun/ima2-gen/releases?q=desktop&expanded=true).
2. Open the DMG and drag **ima2** into **Applications**.
3. Launch ima2 and pick a provider on the welcome screen.

The [Mac App guide](https://lidge-jun.github.io/ima2-gen/docs/desktop) covers checksums, updates and settings. On an Intel Mac, Windows or Linux, use npm or a one-line installer.

### npm

```bash
npm install -g ima2-gen
ima2 setup
ima2 serve
```

Then open `http://localhost:3333`. If `3333` is taken, `ima2-gen` binds the next free port and writes the real URL to `~/.ima2/server.json`; `ima2 open` always finds it.

### First image from the CLI

Pick explicit image and video defaults once, then generate:

```bash
ima2 models
ima2 defaults set image oauth/gpt-6-luna
ima2 defaults set video grok/grok-imagine-video-1.5
ima2 gen "a clean product photo of a red guitar pedal"
ima2 video "a cat playing piano" --duration 5 --resolution 720p
```

`ima2 gen` and generate-mode `ima2 video` fail closed with `NO_DEFAULT_MODEL` until a CLI target is configured, unless the call passes `--model <lane>/<model>` or an explicit `--provider <lane>`. An upgrade can never silently switch providers or billing lanes.

<a id="one-line-installers"></a>

### One-line installers (no npm required)

Each script checks the package-derived Node.js floor, installs Node LTS if needed, installs ima2-gen once, and runs the offline installation check before launching `ima2 serve`. It does not stop unrelated processes or clear global locks.

**macOS**

```bash
curl -fsSL https://lidge-jun.github.io/ima2-gen/install-mac.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://lidge-jun.github.io/ima2-gen/install-windows.ps1 | iex
```

**Linux / WSL**

```bash
curl -fsSL https://lidge-jun.github.io/ima2-gen/install-linux.sh | bash
```

<details>
<summary><b>Docker</b></summary>

```bash
docker build -t ima2-gen .
docker run -d -p 3333:3333 -e IMA2_LAN_TOKEN=change-me -v ima2-data:/data ima2-gen
```

See [docs/DOCKER.md](docs/DOCKER.md) for compose usage, required environment, and limitations.

</details>

<details>
<summary><b>Setup, updating and npx</b></summary>

`ima2 setup` offers four authentication choices:

1. **GPT OAuth** — log in with a ChatGPT account (images)
2. **Grok OAuth** — log in with an xAI/Grok account (images and video)
3. **Both** — GPT OAuth and Grok OAuth
4. **Web setup** — configure everything in the web UI

Video generation needs Grok OAuth (option 2 or 3). If you already use GPT OAuth, run `ima2 grok login` to add video; it defaults to the manual-paste flow.

To update, stop the server with Ctrl+C (or `ima2 stop` from another terminal), then run:

```bash
npm install -g ima2-gen@latest
```

Ctrl+C shuts down cleanly: it closes the database, stops child processes and releases file locks. If an install fails, check the reported npm permissions or stop the specific `ima2` process yourself; the installer does not perform broad process cleanup.

Using npx instead? See [docs/NPX_QUICKSTART.md](docs/NPX_QUICKSTART.md) for the `npx ima2-gen serve` workflow.

</details>

## What you can do

- **Create**: generate, edit, reuse the current image, paste references, and continue from history. Attach up to 5 references for images or up to 14 for video; large images are compressed before upload. Turn on multimode to launch several candidates from one prompt and watch them fill slot by slot. The [Prompt Studio manual](docs/PROMPT_STUDIO.md) walks through every control, multimode recipes, Direct mode and reasoning effort.
- **Node graph**: branch a good image into several directions. Root nodes take local references; child nodes use their parent image as the source. Finished jobs are matched back by request ID, so reloads and graph version conflicts still recover results.
- **Canvas Mode**: zoom, pan, annotate with hover highlighting, erase, group, undo, add sticky notes, clean backgrounds and export with preserved alpha or a matte color. Choose **SVG (embedded raster)** for a self-contained canvas document, or **Trace to SVG (vector)** to flatten the composition into real vector paths. The **GPT transparency** button removes a background through the OAuth i2i lane and reports `alphaVerified` from the decoded bytes. Saved canvas versions stay out of Gallery and the history strip, but Canvas Mode can reopen them and attach one as the next reference.
- **Video**: text-to-video, image-to-video and reference-to-video through Grok video models, with live progress and First/Mid/Last frame copy buttons; SSE progress shows planning → submitted → progress % → done. **Storyboard mode** keeps characters and scenes consistent across sequential frames: image keyframes are composed for video production, and video clips inherit character and environment lock rules.
- **Raster to vector**: trace flat raster art into real SVG paths with `ima2 vectorize`, from AssetGen/Assets, or from Canvas Export.
- **NovelAI dual prompt**: with NovelAI selected, Create, Home and the mobile compose sheet show **Positive prompt** and **Undesired content** as peer panes; they stack below a 719px composer container.
- **Prompt library**: import local prompt packs, GitHub folders and curated GPT-image hints; imports are indexed locally for search.
- **Prompt Builder**: refine intent through a text backend. Settings > Providers keeps routing on Auto or pins a backend and model, and the **via &lt;backend&gt;** badge shows which one answered. When the GPT backend is selected, its default model is `gpt-6-luna`.
- **Local gallery**: every image and video stays on your machine with session-aware history, generation time and reasoning effort in its metadata. The gallery opens on the current session, an All Images toggle reveals the full history, and the default scope is sticky across sessions.
- **Light and dark themes**: token-based palettes with AA contrast, switchable between light, dark and system without a flash on load.
- **Mobile shell** and **observable jobs**: a compact app bar, compose sheet and settings toggle on small screens, and active/recent jobs with safe logs and request IDs.

Card News exists as a dev-only experiment and is hidden in the published runtime.

### Agent skills

ima2-gen ships three Markdown skills that coding agents load for structured image, video, frontend-asset and design-direction workflows.

| Skill | Command | What it covers |
|-------|---------|----------------|
| **Core** | `ima2 skill` | CLI reference, prompting protocol, provider routing, Korean text, video workflows |
| **Frontend** | `ima2 skill front` | Asset pipeline (parallel generation, variant selection, provider routing), motion and video for the web, responsive, a11y, anti-slop, 30+ reference files |
| **UI/UX Design** | `ima2 skill uiux` | Image-first design direction, UX states, design-isms, product personalities, DESIGN.md workflow, 21 reference files |

```bash
ima2 skill ls                   # list available skills
ima2 skill front path          # print the file path (for agents)
ima2 skill front --json        # JSON wrapper (for agents)
ima2 skill front refs           # list reference modules
ima2 skill front ref motion     # load one reference module
ima2 skill install --dir <path> # install skills into an agent's skill directory
ima2 skill install --tmp        # install to a temp dir (fallback)
```

## Providers and models

| Lane | Auth | Images | Video | Notes |
|---|---|:-:|:-:|---|
| `oauth` | ChatGPT login; ima2 calls ChatGPT directly | ✓ | | Default lane; GPT-6 plans, `gpt-image-2` renders; `gpt-6-luna` |
| `api` | `OPENAI_API_KEY` | ✓ | | Responses API `image_generation` tool; masks, multimode, nodes |
| `grok` | xAI OAuth (`ima2 grok login`) | ✓ | ✓ | Web search + planner pass before the Images API |
| `grok-api` | `XAI_API_KEY` | ✓ | ✓ | Direct xAI Images API |
| `gemini-api` | `GEMINI_API_KEY` or Vertex service account | ✓ | | `nano-banana-2`, `nano-banana-pro`, 512px to 4K |
| `agy` | Antigravity CLI | ✓ | | Gemini `nano-banana-2` / `nano-banana-pro` through `agy -p` |
| `nai` | NovelAI API token | ✓ | | Four NAI Diffusion models, text-to-image |
| `comfy` | Local ComfyUI | ✓ | ✓ | Registered image and video workflows |
| `atlascloud` | AtlasCloud API key | ✓ | | `openai/gpt-image-2` text-to-image and edit |
| `minimax` | MiniMax API key | ✓ | | `image-01`, `image-01-live` |
| `runway`, `higgsfield` | MCP connection | ✓ | ✓ | Separate MCP-backed integrations |

The GPT OAuth lane offers three GPT-6 models: **`gpt-6-luna`** (default), `gpt-6-sol`, and `gpt-6-astra`, which reasons longest and is the slowest. The chosen model plans the image and `gpt-image-2` draws it. Older OAuth ids such as `gpt-5.6-luna` keep working in saved settings and scripts and map to their GPT-6 tier. The API-key lane keeps its own list: `gpt-5.6-luna` (default), `gpt-6-astra`, `gpt-5.6-terra`, `gpt-5.6-sol`, `gpt-5.5`, `gpt-5.4` and `gpt-5.4-mini`. The app also exposes quality (`low`, `medium`, `high`) and moderation (`auto`, `low`) controls.

<details>
<summary><b>Provider details</b></summary>

- `provider: "oauth"` signs in with your ChatGPT session and calls ChatGPT's Codex backend from the ima2 server process, with no separate proxy. A GPT-6 model plans the prompt and `gpt-image-2` renders it; Direct mode skips the planner. Transparent backgrounds and image edits run on the same lane.
- `provider: "api"` calls the OpenAI Responses API with the hosted `image_generation` tool.
- `provider: "grok"` calls `https://api.x.ai` directly with the xAI OAuth session stored in `~/.progrok/auth.json`, running mandatory xAI Web Search plus a planner pass (default: `grok-4.3`, configurable in settings or via `--planner-model`) before the xAI Images API call. `grok-4.5` and `grok-4.6` are also selectable. Log in once with `ima2 grok login` or the Settings **Switch Account** button; the session refreshes itself two minutes before expiry.
- `provider: "grok-api"` calls the xAI Images API directly with `XAI_API_KEY` (no OAuth session involved).
- `provider: "nai"` calls the NovelAI image API with a persistent API token (saved in Settings > API Keys or `NOVELAI_API_KEY`; no fixed token prefix is required). Four models: `nai-diffusion-5-full`, `nai-diffusion-5-curated`, `nai-diffusion-4-5-full`, `nai-diffusion-4-5-curated`. Responses arrive as a ZIP archive that ima2 decodes to PNG. Text-to-image only — reference images, edits, and masks are refused rather than silently dropped. Browser and CLI surfaces expose negative prompt, sampler/schedule, steps/guidance/CFG rescale, seed, presets, Auto SMEA, Decrisper, Variety+, and V5 alpha.
- `provider: "agy"` spawns the Antigravity CLI (`agy -p`) to generate images via Google Gemini's `default_api:generate_image` tool (models: `nano-banana-2` and `nano-banana-pro`). Output is fixed at 1024×1024 JPEG, max 3 reference images. No web search, quality, or size controls.
- `provider: "gemini-api"` calls the Google Generative Language API directly. Supports two models: `nano-banana-2` (Gemini 3.1 Flash Image) and `nano-banana-pro` (Gemini 3 Pro Image). Auth is via `GEMINI_API_KEY` env var, web UI key management, or a Vertex AI service account JSON (`VERTEX_SERVICE_ACCOUNT_JSON`). When both an API key and Vertex credentials are configured, Vertex takes priority. Supports variable aspect ratios (1:1 through 21:9) and four resolution tiers (512px, 1K, 2K, 4K); these controls are only honored on the direct API path — the Vertex AI endpoint ignores aspect/size because it does not accept the `response_format` field. Per-model cost differs: `nano-banana-2` (Flash): 512=$0.001, 1K=$0.003, 2K=$0.004, 4K=$0.006; `nano-banana-pro`: 1K=$0.007, 2K=$0.007, 4K=$0.013. No web search or mask controls.
- API-key generation supports classic generate, edit, mask-guided edit, multimode, and node generation.
- Grok generation supports Classic, Node, and Agent flows. If a Classic reference, Node parent image, or Agent current image is present, ima2 switches the final Grok call to xAI image edit so image-to-image context is preserved.

If no provider is specified, the app keeps the current GPT OAuth/default behavior. GPT OAuth defaults to `gpt-6-luna` and API-key generation to `gpt-5.6-luna`; the API-key path also defaults to `low` reasoning and `1024x1024` unless the request passes validated options. Grok image generation defaults to `grok-imagine-image-2.0`.

One caveat on the OAuth Grok lane: xAI documents only `/v1/me` as accepting an OAuth token, so image and video calls to `api.x.ai` with that token ride an undocumented path. It works today — progrok relied on the same path — but it carries no compatibility promise. If xAI closes it, `provider: "grok-api"` with `XAI_API_KEY` is the documented route and stays unaffected.

Grok image generation exposes a Fast/Best model picker (`grok-imagine-image` / `grok-imagine-image-quality`; new sessions start on `grok-imagine-image-2.0`) and a size picker (aspect ratio + 1k/2k resolution). The Settings page prefers the Grok Build weekly credits percentage and reset time from `GET /v1/billing?format=credits`; if that source is unavailable, it falls back to the legacy monthly billing window and `$used/$limit`. A **Switch Account** button starts a device-code OAuth flow (`POST /api/auth/switch`) for re-authenticating without leaving the app.

Grok video generation defaults to canonical `grok-imagine-video-1.5`; `grok-imagine-video` remains available for base-model-only Ref2V, V2V edit, and extension paths, and the legacy `grok-imagine-video-1.5-preview` string is accepted as an alias. Three modes are auto-detected from reference count: text-to-video (0 refs), image-to-video (1 ref), and reference-to-video (2-14 refs; up to 15s on grok-imagine-video-1.5, 10s on grok-imagine-video). 1080p is available for `grok-imagine-video-1.5` prompt-only text-to-video and single image/frame image-to-video; prompt-only 1.5 uses the internal white-canvas I2V shim before the upstream request. Video controls include duration (1-15s), resolution (480p, 720p, 1080p when supported), and aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, auto).

</details>

## CLI

<details>
<summary><b>Server commands</b></summary>

| Command | Description |
|---|---|
| `ima2 serve [--dev]` | Start the local web server; `--dev` enables verbose server diagnostics |
| `ima2 stop [--force]` | Stop the running server safely — graceful admin-API stop first, then SIGTERM/SIGKILL; verifies the advertised pid against `/api/health` so a recycled pid is never killed |
| `ima2 service <sub>` | Background service: `install`/`uninstall`/`start`/`stop`/`restart`/`status`/`logs`/`repair` — launchd on macOS, systemd user unit on Linux, auto-start on login with crash restart |
| `ima2 setup` | Reconfigure saved auth |
| `ima2 status` | Show config and OAuth status |
| `ima2 doctor` | Diagnose Node, package, config, and auth |
| `ima2 doctor image-probe [--json]` | Run sanitized image probes for no-image diagnostics |
| `ima2 open` | Open the web UI |
| `ima2 reset` | Remove saved config |

</details>

<details open>
<summary><b>Client commands</b></summary>

These require a running `ima2 serve`. The CLI covers every server route. The most common ones are below — the [full CLI reference](docs/CLI.md) lists everything (generation, history, sessions, prompt library, annotations, Card News, observability, config).

| Command | Description |
|---|---|
| `ima2 models [--kind image\|video] [--lane <lane>] [--json]` | List live lanes, status, model IDs, and capabilities |
| `ima2 defaults set image\|video <lane>/<model>` | Persist the fail-closed CLI target for image or video generation |
| `ima2 defaults reset image\|video` | Remove a persisted CLI generation target |
| `ima2 gen <prompt> [--model <lane>/<model>]` | Generate from the CLI; requires an explicit target or saved image default |
| `ima2 edit <file> --prompt <text>` | Edit an existing image |
| `ima2 vectorize <input.png> [-o output.svg]` | Trace PNG/JPEG/WebP into a real SVG locally; no server or provider required |
| `ima2 prompt build --message <text> [--backend <backend>] [--model <model>]` | Refine prompt intent through the configured or explicitly selected Prompt Builder backend; requires the local server |
| `ima2 multimode <prompt>` | Multi-image SSE generation |
| `ima2 video <prompt> [--model <lane>/<model>]` | Generate video through a Grok or MCP lane; requires an explicit target or saved video default |
| `ima2 ls [--session <id>] [--favorites]` | List recent history |
| `ima2 show <name> [--metadata]` | Reveal a generated asset |
| `ima2 prompt ls -q <search>` | Search the prompt library |
| `ima2 inflight ls [--terminal]` | List active and recent jobs (alias of `ps`) |
| `ima2 config set <key> <value>` | Write to `~/.ima2/config.json` |
| `ima2 ping` | Health-check the running server |

The server advertises its actual port at `~/.ima2/server.json`. If `3333` is busy, the backend falls back to `3334+` and CLI commands follow the advertised URL. Override discovery with `--server <url>` or `IMA2_SERVER=http://localhost:3333`.

```bash
ima2 models --kind image
ima2 gen "poster" --model oauth/gpt-6-luna --reasoning-effort high
ima2 gen "1girl, blue hair" --model nai/nai-diffusion-5-full --nai-negative-prompt "lowres, watermark"
ima2 vectorize logo.png -o logo.svg --json
ima2 prompt build --message "Make this prompt production-ready" --backend auto --model auto
ima2 edit input.png --prompt "make it rainy" --web-search
ima2 multimode "two cats playing" -n 2
ima2 video "a cat playing piano" --model grok/grok-imagine-video-1.5 --duration 5 --resolution 720p
ima2 video "animate this" --model grok/grok-imagine-video-1.5 --ref photo.png --aspect-ratio 16:9
ima2 inflight ls --terminal
ima2 config set imageModels.reasoningEffort high
```

Full reference: [docs/CLI.md](docs/CLI.md).

</details>

## Configuration

Config priority is `environment variables > ~/.ima2/config.json > built-in defaults`. Prompt Builder settings persist as `promptBuilder.backend` (`auto`, `oauth`, `grok`, `api` or `grok-api`) and `promptBuilder.model`. On Auto, Prompt Builder tries GPT OAuth, Grok, OpenAI API, then Grok API and uses the first ready lane; an explicit choice stays pinned and returns a typed error when unavailable.

<details>
<summary><b>Environment variables</b></summary>

| Variable | Default | Description |
|---|---:|---|
| `IMA2_PORT` / `PORT` | `3333` | Web server port |
| `IMA2_HOST` | `127.0.0.1` | Web server bind host |
| `IMA2_OAUTH_PROXY_PORT` / `OAUTH_PORT` | `10531` | Port of the external GPT OAuth endpoint used with `IMA2_NO_OAUTH_PROXY=1` |
| `IMA2_SERVER` | — | CLI target override |
| `IMA2_CONFIG_DIR` | `~/.ima2` | Config and SQLite location |
| `IMA2_ADVERTISE_FILE` | `~/.ima2/server.json` | Runtime discovery file |
| `IMA2_GENERATED_DIR` | `~/.ima2/generated` | Generated image directory |
| `IMA2_IMAGE_MODEL_DEFAULT` | `gpt-6-luna` | Server fallback image model |
| `IMA2_PROMPT_BUILDER_BACKEND` | `auto` | Prompt Builder text backend (`auto`, `oauth`, `grok`, `api`, or `grok-api`); Settings persists the same value as `promptBuilder.backend` |
| `IMA2_PROMPT_BUILDER_MODEL` | `auto` with Auto backend | Backend-scoped Builder model; Settings persists the same value as `promptBuilder.model` |
| `IMA2_REASONING_EFFORT` | `medium` | Default reasoning effort for the default (GPT OAuth) path; one of `none`, `low`, `medium`, `high`, `xhigh`, `max` |
| `IMA2_NO_OAUTH_PROXY` | — | Set `1` to send GPT OAuth calls to an OpenAI-compatible endpoint on `127.0.0.1:IMA2_OAUTH_PROXY_PORT` instead of ChatGPT directly |
| `IMA2_CODEX_CLIENT_VERSION` | latest `@openai/codex` | Codex client version sent to ChatGPT; the automatic value is never lower than `0.157.0` |
| `IMA2_LOG_LEVEL` | `info` | Normal serve defaults to `info`; dev mode defaults to `debug`; supports `debug`, `info`, `warn`, `error`, or `silent` |
| `IMA2_INFLIGHT_TERMINAL_TTL_MS` | `300000` | Recent terminal job retention for debug views |
| `OPENAI_API_KEY` | — | API key for the `provider: "api"` Responses API image path and auxiliary API-key features |
| `XAI_API_KEY` | — | API key for `provider: "grok-api"` direct xAI Images API path |
| `NOVELAI_API_KEY` | — | NovelAI persistent API token for `provider: "nai"` |
| `IMA2_NAI_IMAGE_MODEL_DEFAULT` | `nai-diffusion-5-full` | Default NovelAI image model |
| `IMA2_NAI_DEFAULT_AUTO_SMEA` | `false` | Default NovelAI Auto SMEA state |
| `IMA2_NAI_DEFAULT_DECRISPER` | `false` | Default NovelAI Decrisper (`dynamic_thresholding`) state |
| `IMA2_API_IMAGE_MODEL_DEFAULT` | `gpt-5.6-luna` | Default image model for `provider: "api"` |
| `IMA2_API_REASONING_EFFORT` | `low` | Default reasoning effort for `provider: "api"` |
| `IMA2_API_IMAGE_SIZE` | `1024x1024` | Default size for `provider: "api"` |
| `IMA2_API_ALLOW_WEB_SEARCH` | `true` | Toggle web search for `provider: "api"` |
| `IMA2_GROK_PLANNER_MODEL` | `grok-4.3` | Grok search/planner model; `grok-4.5`, `grok-4.6` and GPT planners are selectable (settings UI or `--planner-model`) |
| `IMA2_GROK_PLANNER_TIMEOUT_MS` | `900000` | Timeout for the Grok planner call |
| `IMA2_GROK_SEARCH_TIMEOUT_MS` | `300000` | Timeout for the Grok web-search brief (degrades instead of failing) |
| `IMA2_GROK_VIDEO_PLAN_TOTAL_TIMEOUT_MS` | `1500000` | Ceiling on the whole video planning phase (clamped above search + planner) |
| `IMA2_GROK_IMAGE_MODEL_DEFAULT` | `grok-imagine-image-2.0` | Default final Grok image model |
| `IMA2_GROK_VIDEO_MODEL_DEFAULT` | `grok-imagine-video-1.5` | Default Grok video model |
| `IMA2_GROK_GENERATION_TIMEOUT_MS` | `300000` | Timeout for the final Grok Images API call |
| `IMA2_OAUTH_MASKED_EDIT_ENABLED` | `false` | Opt-in feature flag for masked-edit requests on the OAuth path (#31, groundwork only) |
| `GEMINI_API_KEY` | — | API key for `provider: "gemini-api"` direct Generative Language API path |
| `VERTEX_SERVICE_ACCOUNT_JSON` | — | Google service account JSON for Vertex AI auth with `provider: "gemini-api"`; takes priority over `GEMINI_API_KEY` when both are set |
| `IMA2_AGY_BIN` | `agy` on PATH | Explicit path to the Antigravity CLI binary for `provider: "agy"` |
| `IMA2_MAX_PARALLEL` | `24` | Server-wide parallel generation cap |

`IMA2_GROK_PROXY_HOST`, `IMA2_GROK_PROXY_PORT`, `IMA2_NO_GROK_PROXY`, and `IMA2_GROK_RESTART_*` were removed in 3.16 together with the local Grok proxy; they are no longer read, and setting them is harmless.

</details>

<details>
<summary><b>Logging modes</b></summary>

`ima2 serve` keeps terminal output intentionally quiet: startup URLs, warnings, and errors stay visible, while request/node/OAuth structured logs are hidden by default.

Use `ima2 serve --dev`, `npm run dev`, or `IMA2_LOG_LEVEL=debug ima2 serve` when you need request IDs, node generation phases, OAuth stream diagnostics, or inflight state transitions. Explicit `IMA2_LOG_LEVEL` and `~/.ima2/config.json` values still override the built-in defaults.

</details>

## Troubleshooting

<details>
<summary><b><code>ima2 ping</code> says the server is unreachable</b></summary>

Start `ima2 serve`, then check `~/.ima2/server.json`. You can also run `ima2 ping --server http://localhost:3333`.

</details>

<details>
<summary><b>GPT OAuth login does not work</b></summary>

Re-run `ima2 setup` (option 1), confirm `ima2 status`, then restart `ima2 serve`.

</details>

<details>
<summary><b><code>fetch failed</code> repeats on a proxy/VPN network</b></summary>

GPT OAuth requests leave from the `ima2 serve` process and go straight to `chatgpt.com`. On networks that require a proxy, enable your proxy client's TUN/TURN-style mode. If that is not possible, set both `HTTPS_PROXY` and `NODE_USE_ENV_PROXY=1` in the terminal that starts the server; Node.js 22.21+ and 24+ read `HTTPS_PROXY` only with the second variable; older Node.js ignores both, so use TUN mode there. On Windows, also check for auto-start network interception tools, including DNS/fragmentation bypass tools such as SecretDNS, because they can break OAuth or image responses even when the browser appears connected.

</details>

<details>
<summary><b>Images fail with <code>API_KEY_REQUIRED</code></b></summary>

Set `OPENAI_API_KEY` or configure an API key before using `provider: "api"`. The default GPT OAuth path still works without an API key.

</details>

<details>
<summary><b>Image generation returns <code>EMPTY_RESPONSE</code> or no image data</b></summary>

Run `ima2 doctor image-probe --json > ima2-image-probe.json` and attach the safe JSON when opening an issue. For GPT OAuth cases, also capture `ima2 gen "고양이" --model oauth/gpt-6-luna --no-web-search --json` and `ima2 gen "고양이" --model oauth/gpt-6-luna --json` while `ima2 serve` is running. Do not share ChatGPT cookies, OAuth token files, API keys, raw upstream responses, prompt history, or generated base64. See the [FAQ support bundle](docs/FAQ.md#what-should-i-share-when-gpt-oauth-image-generation-returns-no-image).

</details>

<details>
<summary><b>A large reference image fails</b></summary>

The app compresses large JPEG/PNG references before upload. If a file still fails, convert it to JPEG or PNG at a lower resolution and try again. HEIC/HEIF files are not supported by the browser path.

</details>

<details>
<summary><b>Old gallery images are missing after updating</b></summary>

Recent versions moved generated images from the installed package folder to `~/.ima2/generated`. Run `ima2 doctor` and see [Recover old images](docs/RECOVER_OLD_IMAGES.md).

</details>

<details>
<summary><b>A GPT-6 model is missing or rejected on the GPT OAuth lane</b></summary>

The GPT OAuth lane uses the GPT-6 models your ChatGPT plan exposes. Update ima2-gen, sign in again with `ima2 gpt login`, then check `ima2 models --kind image`. If one model keeps failing, switch to `gpt-6-luna`, the default.

</details>

<details>
<summary><b>The app opened on a different port</b></summary>

If the requested server port is busy, `ima2-gen` falls back to the next available port and records it in `~/.ima2/server.json`. If the port is unexpectedly `3457`, your shell may also have inherited `PORT=3457` from another local tool. Run `unset PORT` or start with `IMA2_PORT=3333 ima2 serve`.

</details>

More answers live in the [FAQ](docs/FAQ.md).

## Documentation

- [Developer documentation site](https://lidge-jun.github.io/ima2-gen/docs) — overview, quickstart, architecture, modes, providers, CLI, config and server API
- [CLI reference](docs/CLI.md) · [API reference](docs/API.md) · [Prompt Studio](docs/PROMPT_STUDIO.md) · [FAQ](docs/FAQ.md) · [Recover old images](docs/RECOVER_OLD_IMAGES.md)

The API reference covers `POST /api/assets/derived` with `kind=vector-svg`, NovelAI's `negativePrompt` field, `POST /api/prompt-builder/chat`, and `GET`/`PUT /api/prompt-builder/config`.

## Development

```bash
git clone https://github.com/lidge-jun/ima2-gen.git
cd ima2-gen
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run dev` builds the UI and starts the TypeScript server with `--watch` and verbose diagnostics. `npm run typecheck`, `npm run build:server` and `npm run build:cli` verify the TypeScript emit path. Node mode and Canvas Mode are part of the packaged UI by default.

The web UI keeps one `GET /api/events` Server-Sent Events connection for all progress. Multimode, node and video requests are submitted as async POST (`202 { requestId }`) and multiplexed through a shared event bus, so concurrent jobs never hit the browser's six-connection limit. CLI clients that do not send `async: true` still receive per-request SSE streams.

### Requirements

<!-- runtime-install:generated:start -->
| Contract | Value |
|---|---|
| Node engine | `>=22` |
| npm toolchain | `npm@11.18.0` |
| Release Node | `24.17.0` |
| CLI entry | `bin/ima2.js` |
| OpenAI SDK | `^7.4.0` |
| Express | `^5.1.0` |
<!-- runtime-install:generated:end -->

The installer derives its Node.js floor from package metadata and runs an offline installation check before launching the server.

<details>
<summary><b>Desktop app (Electron)</b></summary>

`desktop/` wraps the same local server and UI in a menubar/tray app for macOS, Windows, and Linux. It supervises `server.js` as a child process (attaching to an already-running server on the configured port instead of starting a second one) and adds a native settings window: port, open at login, start hidden, menubar-only (macOS), keep-server-on-close, log level, config directory.

```bash
cd desktop
npm install
npm run prepare:app     # builds server + CLI + UI at the repo root
npm start               # run unpackaged
npm run dist:mac        # dmg + zip (Apple Silicon / arm64)
npm run dist:win        # nsis + zip
npm run dist:linux      # AppImage + deb
```

Only the macOS app is distributed today, for Apple Silicon. `.github/workflows/desktop.yml` runs in three ways: a push to `dev` builds an unsigned macOS validation build, a manual dispatch builds signed and notarized installers without publishing anything, and a `desktop-v*` tag push builds, verifies, and publishes the desktop release. Trusted macOS builds require `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`; missing or invalid authentication fails the build instead of producing an unsigned success.

For a signed macOS verification build without publishing, run:

```bash
gh workflow run desktop.yml --ref <reviewed-branch> -f platform=mac
```

The workflow verifies Developer ID, team, architecture (arm64), hardened runtime, secure timestamp, nested signatures, Gatekeeper and stapled notarization tickets. It checks the apps recovered from the final ZIP and DMG against the original signed content, then exports `ima2-macos-signature-proof` reports and installer SHA-256 hashes. Failed verification blocks installer upload. Only a `desktop-v*` tag push creates and publishes a release.

Signing credential imports run on disposable GitHub-hosted macOS. The builder cleans successfully imported keychains; if import/setup fails before its cleanup registration, runner destruction is the final cleanup boundary. Local recovery should reuse an existing login-keychain identity in the same unlocked session, rather than importing credential packages into a persistent machine. This does not require changing automatic locking or key access rules.

Windows Authenticode remains separate and uses `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`; Windows builds without them are unsigned.

</details>

## Contributors

- [@lidge-jun](https://github.com/lidge-jun) — maintainer
- [@ree9622](https://github.com/ree9622) — moderation controls, Windows fixes, structured logging
- [@Charley-Peng](https://github.com/Charley-Peng) — API cache fix (#74)
- [@philiptaron](https://github.com/philiptaron) — Nix flake (#81)
- [@aorying](https://github.com/aorying) — upstream validation error surfacing (informed TS migration direction)
- [@PARKJONGMlN](https://github.com/PARKJONGMlN) — batch comparison matrix design (#80)

## License

MIT
