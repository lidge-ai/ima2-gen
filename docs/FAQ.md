# ima2-gen FAQ

Last reviewed: 2026-05-26

This FAQ collects the questions that tend to come up after installing or updating `ima2-gen`. The README stays short; this page is the place for practical details and recovery steps.

For Korean, see [FAQ.ko.md](FAQ.ko.md). For Traditional Chinese, see [FAQ.zh-TW.md](FAQ.zh-TW.md); for Simplified Chinese, see [FAQ.zh-CN.md](FAQ.zh-CN.md).

## Quick fixes

| Symptom | Try first |
|---|---|
| The server is unreachable | Run `ima2 serve`, then `ima2 ping`. |
| GPT OAuth login fails | Re-run `ima2 setup` (option 1), then restart `ima2 serve`. |
| API key provider says `API_KEY_REQUIRED` | Configure an API key, or switch back to the GPT OAuth provider. |
| Old gallery images look missing | Run `ima2 doctor`, then see [Recover Old Generated Images](RECOVER_OLD_IMAGES.md). |
| A GPT-6 model fails on GPT OAuth | Run `ima2 gpt login` again, check `ima2 models --kind image`, then try `gpt-6-luna`. |
| Reference upload fails | Use JPEG/PNG, lower the resolution, and keep references to 5 images or fewer. |
| Prompt Studio controls are unclear | Read the [Prompt Studio manual](PROMPT_STUDIO.md) for multimode, Direct, reasoning, and gallery behavior. |
| Image generation returns `EMPTY_RESPONSE` or no image data | Run `ima2 doctor image-probe --json`, then collect the safe support bundle below. |
| `fetch failed` repeats on a proxy/VPN network | Enable proxy TUN/TURN-style mode, or start `ima2 serve` with `HTTPS_PROXY` and `NODE_USE_ENV_PROXY=1`. |

## Install and update

### What version of Node do I need?

Use Node.js 22 or newer. The package declares Node `>=22`, and the README badge follows that requirement.

### How do I install?

Install globally with npm:

```bash
npm install -g ima2-gen
ima2 setup
ima2 serve
```

If an old install behaves strangely, update first:

```bash
npm install -g ima2-gen@latest
```

Then run:

```bash
ima2 doctor
```

### Windows says `spawn EINVAL`. What should I do?

Update to the latest version. Older versions had trouble spawning npm/npx shims on Windows. Current builds route those commands through a Windows-safe path.

If Codex login itself is unreliable on native Windows, WSL can be the more predictable environment.

### Windows says `EBUSY` or `resource busy or locked` during update. What should I do?

This usually means npm cannot replace the global package because a running
`ima2 serve`, stale `node.exe`, terminal, Explorer window, antivirus, or indexer
still holds the package folder. Stop ima2, close related terminals, end stale
`node.exe` processes if needed, then retry:

```bash
npm install -g ima2-gen@latest
```

If the lock persists, reboot Windows and run the update before starting ima2
again.

## Authentication and providers

### Why does LAN access now show a studio sign-in page or return 401 for media?

LAN APIs and generated images/videos now share an authenticated session. Open the
studio and enter its configured LAN token; CLI users set `IMA2_LAN_TOKEN` and an
explicit `--server` / `IMA2_SERVER`. This is separate from provider login. Sessions
expire after eight hours or server restart. Reconnect does not replay generation,
and sign-out does not cancel accepted work. No generated files are deleted.

If a Docker port or proxy address differs, configure its exact
`IMA2_PUBLIC_ORIGINS` value. HTTP requires a trusted network; use TLS/VPN otherwise.
Old downloaded/cached copies cannot be revoked. See the [access contract](API.md#local-and-lan-access)
and [CLI setup](CLI.md#lan-server-authentication).

### Do I need an OpenAI API key?

No for the default generation path. The normal path uses your local Codex/ChatGPT OAuth session.

If you configure an API key, image generation routes can also use `provider: "api"` through the Responses API `image_generation` tool.

### Why does the settings page say "API key provider available"?

It means `ima2-gen` found a valid API key. API-key mode can generate, edit, run multimode, and create node outputs. If no key is configured, `provider: "api"` fails before upstream with `API_KEY_REQUIRED`.

### If Codex CLI is already logged in, does ima2-gen reuse it?

Yes. `ima2-gen` checks for an existing Codex login and uses the local GPT OAuth path. If detection fails or the token expires, run:

```bash
ima2 setup     # re-run option 1 (GPT OAuth)
ima2 doctor
```

Then restart `ima2 serve`.

### What if I see `Provided authentication token is expired`?

Your Codex/ChatGPT OAuth session needs to be refreshed.

```bash
ima2 setup     # re-run option 1 (GPT OAuth)
ima2 serve
```

If this happens on a company network, a firewall, VPN, proxy, or captive portal may also be blocking the OAuth flow.

### How do I use the Gemini providers?

Two Gemini providers are available:

- **`agy`** — uses the Antigravity CLI (`agy -p`) with no API key needed. Requires the `agy` binary to be installed and logged in. Model is `nano-banana-2`, output is fixed at 1024×1024.

- **`gemini-api`** — calls the Google Generative Language API directly. Add a `GEMINI_API_KEY` env var, or configure a key via Settings > API Keys. For Vertex AI, add a service account JSON via Settings or the `VERTEX_SERVICE_ACCOUNT_JSON` env var. When both an API key and Vertex credentials are present, Vertex takes priority. Use the auth-mode dropdown in Settings to switch between `apikey` and `vertex`; the choice is saved and restored automatically.

The `gemini-api` provider supports two models: `nano-banana-2` (Gemini 3.1 Flash Image) and `nano-banana-pro` (Gemini 3 Pro Image). The web UI shows aspect-ratio and resolution controls (512px–4K) for `gemini-api`; these are honored only on the direct Gemini API path and are ignored by Vertex AI.

### How do I re-authenticate Grok or Codex without restarting?

Use the **Switch Account** button in Settings > QuotaCard for the provider. This starts a device-code OAuth flow: a new browser tab opens the verification URL, you complete the login, and the server automatically picks up the new credentials. For current Grok Build xAI auth, the quota bar shows the server-calculated weekly usage percentage and reset time. Legacy auth falls back to the older monthly `$used / $limit` billing view when available.

## Models and quota

### Which model should I use?

On GPT OAuth the app starts with `gpt-6-luna`. The lane offers three GPT-6 models: the one you pick plans the image and `gpt-image-2` renders it.

- `gpt-6-luna`: the default.
- `gpt-6-sol`: the other everyday GPT-6 model.
- `gpt-6-astra`: reasons longest and is the slowest; a `none` reasoning effort runs as `low`.

Older OAuth ids (`gpt-5.6-sol`, `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`) still work in saved settings and scripts. `gpt-5.6-sol` runs as `gpt-6-sol` and the rest run as `gpt-6-luna`. The API-key lane (`provider: "api"`) keeps its own list, with `gpt-5.6-luna` as its default.

### Why does one GPT-6 model fail when the others work?

The GPT OAuth lane uses the GPT-6 models your ChatGPT plan exposes. Update ima2-gen, sign in again with `ima2 gpt login`, and check `ima2 models --kind image`. If one model keeps failing, switch to `gpt-6-luna`.

### How many images can Plus or Pro generate?

Do not treat any community number as a guarantee. GPT OAuth generation can be limited by account, backend capability, traffic, and policy changes. `ima2-gen` does not publish a fixed Plus/Pro image count because that number is not stable enough to document as a promise.

## Prompt Studio and multimode

### Is there a detailed Prompt Studio manual?

Yes. See the [Prompt Studio manual](PROMPT_STUDIO.md). It explains the composer,
multimode slots, 1:1 Direct, model/reasoning quick settings, recent history,
gallery favorites, and which actions intentionally import prompt text.

### Why did multimode images look unrelated?

Multimode starts several separate image requests from the same prompt. The slots
are candidate outputs, not panels inside one shared canvas and not a guaranteed
story sequence. To get related alternatives, write the common subject first and
then name the allowed variations. To get one multi-panel image, use a normal
single-image request and ask for a two-panel, collage, or contact-sheet layout.

### Should selecting a gallery image change my current prompt?

Passive image selection is view-only. It should focus the selected image without
rewriting the composer. Prompt Library insert, "continue from this image", and
other explicit reuse actions are the actions that intentionally change prompt
text.

### What changed for issue #75?

The Prompt Studio closeout fixed navigation and state-coupling regressions:
keyboard movement now follows the visible recent history domain, the gallery
entry remains reachable, long prompts no longer starve the image viewer,
Direct and Multimode states are visible together, gallery favorites preserve the
browsing viewport, and passive image selection does not refill the composer.

## Gallery and generated files

### Where are generated images stored?

Current versions store generated images in your user data folder:

```text
macOS / Linux: ~/.ima2/generated
Windows: %USERPROFILE%\.ima2\generated
```

You can override that with `IMA2_GENERATED_DIR`.

### Why did old gallery images look missing after an update?

Older versions stored generated images inside the installed package folder. Recent versions moved the gallery to user data storage so package updates do not mix app code with runtime files.

Sorry for the scare. If the old global install folder was replaced during an update, the previous `generated/` folder may no longer be on disk. `ima2-gen` can recover old files only when that old folder still exists.

Run:

```bash
ima2 doctor
```

Then follow [Recover Old Generated Images](RECOVER_OLD_IMAGES.md).

### Does ima2-gen delete my old images during this migration?

No. The migration is copy-only. It does not delete or move legacy folders. If old files are not found, the likely issue is that the old global install folder is no longer present on disk.

### What does "Open folder" open?

The gallery's **Open folder** button opens the generated image folder on the machine running `ima2 serve`.

That is usually your own computer. If you are using a remote server, SSH session, VM, container, WSL, or another machine on your network, the folder opens or resolves on that server machine, not necessarily on the browser device.

### Is Card News part of the stable public release?

Not yet. Card News is still dev-only and experimental. The default published
runtime should keep it hidden unless it is explicitly enabled for development,
and public docs should not treat it as a stable feature.

## Reference images

### How many reference images can I attach?

Up to 5.

### What formats work best?

Use JPEG or PNG. The browser path does not support HEIC/HEIF directly, so convert those images before attaching them.

### What if a reference image is too large?

The app compresses large JPEG/PNG files before upload. If a file still fails, lower the resolution or convert it to JPEG/PNG and try again.

The API may report reference errors such as `REF_TOO_MANY`, `REF_TOO_LARGE`, `REF_NOT_BASE64`, or `REF_EMPTY`.

## Network and OAuth errors

### Why did the backend move to another port?

`ima2-gen` is a local app. If the preferred backend port `3333` is already in use, the runtime falls back to the next available port and records the actual URL in:

```text
~/.ima2/server.json
```

Run this to see the configured and actual backend URLs:

```bash
ima2 doctor
```

GPT OAuth needs no local port: the server calls ChatGPT directly.

### How do I point split frontend development at the real backend?

Pass the backend URL that `ima2 doctor` reports to Vite:

```bash
VITE_IMA2_API_TARGET=http://localhost:3334 npm run ui:dev
```

### What does `failed to fetch` mean?

Usually one of these:

- GPT OAuth could not reach `chatgpt.com`,
- the server was restarted,
- a VPN/proxy/firewall blocked the request,
- an auto-start Windows network interception tool, including a DNS/fragmentation
  bypass tool such as SecretDNS, broke OAuth or streaming image transport,
- the network dropped while Codex/ChatGPT OAuth was being used.

Try:

```bash
ima2 doctor
ima2 ping
```

Then restart `ima2 serve` if needed.

### What should I share when GPT OAuth image generation returns no image?

Use the image probe before assuming moderation. `EMPTY_RESPONSE` means the
Responses path did not produce image data that `ima2-gen` could use; it can be
caused by OAuth capability, stream parsing, web-search/tool-choice behavior,
local proxy/network transport, unsupported options, or a real refusal.

Run this first:

```bash
ima2 doctor
ima2 doctor image-probe --json > ima2-image-probe.json
```

If `ima2 serve` is running, also capture one search-off and one normal cat
generation result:

```bash
ima2 gen "고양이" --model oauth/gpt-6-luna --no-web-search --json > ima2-cat-no-search.json
ima2 gen "고양이" --model oauth/gpt-6-luna --json > ima2-cat-current.json
```

The probe JSON is designed to be safe to attach to a public issue. It reports
diagnostic codes, event counts, tool-call summaries, and byte counts, but not
prompt text, auth tokens, credential URLs, or base64 image data.

When opening an issue, include:

- `ima2 doctor` output.
- `ima2-image-probe.json`.
- `ima2-cat-no-search.json` and `ima2-cat-current.json`, if you captured them.
- `ima2-gen` version and Windows version.
- Whether you use VPN, corporate proxy, antivirus TLS inspection, or a custom CA.
- Whether a Windows DNS/fragmentation bypass tool such as SecretDNS is running
  automatically.
- Whether `provider: "api"` works on the same machine, if you already have an API key configured.

Do not share ChatGPT cookies, OAuth token files, API keys, raw upstream
responses, prompt history, or generated base64.

How to read the result:

- Text probe fails: refresh OAuth and inspect proxy/model availability first.
- Text works but minimal non-stream image fails: likely account, OAuth backend, model, or image-tool capability.
- Non-stream image works but stream image fails: likely stream parsing or transport.
- Search-off generation works but normal generation fails: likely web-search/tool-choice interaction.
- Bytes were read but no events were parsed: likely SSE delimiter or `data:` parsing.

### What if `fetch failed` keeps happening behind a proxy or VPN?

GPT OAuth requests leave from the `ima2 serve` process and go straight to `chatgpt.com`, so the network path of that process is what matters.

If your network requires a proxy, enable your proxy client's TUN/TURN-style mode so terminal processes can use it. On Windows, also temporarily disable auto-start DNS or fragmentation bypass tools such as SecretDNS and retry. If that is not enough, set the proxy in the terminal that starts `ima2 serve`. Node.js 22.21+ and 24+ read `HTTPS_PROXY` only when `NODE_USE_ENV_PROXY=1` is also set (older Node.js ignores both; use TUN mode there):

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
export NODE_USE_ENV_PROXY=1
ima2 serve
```

Use the host and port from your proxy client. If `ima2-gen` still fails, collect the exact command, OS, proxy setup, and terminal error before opening a new issue.

### What should I check on a company computer?

GPT OAuth may require access to OpenAI and ChatGPT/Codex-related hosts. A corporate firewall, TLS inspection, VPN, or proxy can break the flow. Try a different network if login and `failed to fetch` errors keep repeating.

## SSE Multiplexing

### Why does the web UI use a single SSE connection?

Browsers limit the number of concurrent HTTP connections to the same origin (typically 6). When generating multiple images at once, each generation request used to hold a Server-Sent Events connection open. With multimode, node, and video running simultaneously, the browser would run out of connections and gallery thumbnails would hang.

The web UI now opens a single persistent `GET /api/events` SSE connection and all generation progress is multiplexed through it. Generation requests use `async: true` and receive an immediate `202 { requestId }` response, freeing the connection immediately. The CLI is unaffected — it still uses per-request SSE when `async` is not set.

### What happens if the SSE connection drops?

The event channel client reconnects automatically with exponential backoff. On reconnect, it sends `Last-Event-ID` so the server can replay missed events from its ring buffer (up to 2000 entries). If events have been evicted from the buffer, the server sends a `replay-gap` event so the client knows some updates may have been lost.

### What is the maximum number of concurrent jobs?

The server caps concurrent generation jobs at the configured `limits.maxParallel` value (default `24`, overridable with `IMA2_MAX_PARALLEL`). Additional requests receive `429` with `Retry-After: 5`. The SSE endpoint itself caps at 512 simultaneous connections.

## CLI troubleshooting checklist

Run these in order:

```bash
ima2 doctor
ima2 status
ima2 ping
ima2 ps
ima2 setup
npm install -g ima2-gen@latest
```

If you run the server on a non-default port:

```bash
IMA2_SERVER=http://localhost:3333 ima2 ping
```
