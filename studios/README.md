# Studios

A studio is a separate web UI for the ima2 server. Each one lives in its own
folder under `studios/<name>/`, has its own `package.json`, and talks to the
server only through the typed client in `studios/kit`. Studios never import code
from `ui/` (the classic UI), and the server needs no changes to host a new one.

| Folder | What it is |
|---|---|
| `kit/` | UI-agnostic TypeScript client: catalog, keys, uploads, media jobs, workflow jobs, live events, history, prices, route choice, vendor logos. Also a development fake server. |
| `kit/assets/vendors/` | Official logos of every model maker and route provider, with `manifest.json` recording source, date and usage notes. The server serves this folder at `/media-assets/vendors/`. |
| `main/` | Studio with a feed, image, video, remix, director, models and assets layout (Vite + React). |

## Run a studio

Against the fake server (no keys, no provider calls):

```bash
cd studios/kit && npm ci
cd ../main && npm ci
npm run dev:fake          # fake server on :8790, studio on :5190
```

Against a running ima2 server, point the dev proxy at it:

```bash
IMA2_STUDIO_API=http://127.0.0.1:3333 npm run dev
```

Built studios are served by the ima2 server at `/studio/<name>/` (`npm run build`
writes `studios/<name>/dist`). Set `IMA2_DEFAULT_UI=<name>` or config
`ui.defaultUi` to open it at `/`; `/?ui=classic` always opens the classic UI.

## Add a new studio

1. Create `studios/<name>/` with its own `package.json`. Any framework works.
2. Depend on the kit by path. With Vite, alias `@ima2/studio-kit` to
   `../kit/src/index.ts` (see `main/vite.config.ts`) and set `base: "./"` so the build
   works under `/studio/<name>/`.
3. Create one client and follow events:

```ts
import { createStudioClient } from "@ima2/studio-kit";

const client = createStudioClient({ browserId: localStorage.getItem("ima2.browserId") ?? undefined });
const catalog = await client.catalog();             // models, routes, prices, key state
const { jobId } = await client.media.submit({ model: "bytedance/seedance-2.5", task: "text-to-video", prompt: "...", inputs: [] });
const job = await client.watchJob(jobId, { onUpdate: (j) => console.log(j.status, j.progress) });
```

4. Use `chooseRoute` before submitting: it returns the route the server would use,
   or `needs-key` with the candidate providers. Never submit a keyless route; show
   the key form instead.
5. Show prices with `estimateCost` / `formatUsd`. A price is only ever the
   provider's published number; `usd: null` means none is published.
6. Show makers and providers with their logos from `kit/assets/vendors`
   (`pickLogo(manifest, id, { background, shape })`). Each manifest file records its
   `shape` (`mark`, `wordmark`, `stacked`) and size: small square slots (chips, list
   rows, 16-32 px) take only `mark` files, and `pickLogo` returns null rather than
   squeezing a wordmark into a square. Show `vendorMonogram(name)` in that case, and the
   name as text when a wordmark slot has no file. Give every logo box a fixed height and
   a maximum width so no file can grow past it. Do not redraw or recolor logos.
7. Put the studio's screen tests next to it (Playwright against `kit`'s fake server,
   see `main/playwright.config.ts`).

## Client surface

| Area | Calls | Server endpoints |
|---|---|---|
| Catalog | `catalog()` | `GET /api/media/catalog` |
| Keys | `keys.list/save/remove` | catalog `adapters[]`, `PUT/DELETE /api/keys/:vocabulary` (saving validates with the provider) |
| Uploads | `uploads.put(blob, mime)` | `POST /api/media/inputs` |
| Media jobs | `media.submit/job/jobs/cancel` | `POST /api/media`, `GET /api/media/jobs[/:id]`, `POST /api/media/:id/cancel` |
| Workflows | `workflows.list/estimate/run` | `GET /api/workflows`, `POST /api/workflows/:id[/estimate]` |
| Live events | `events.follow`, `watchJob` | `GET /api/events` (resumes with Last-Event-ID) |
| History | `history.list/remove/favorite` | `GET /api/history`, `DELETE /api/history/:filename`, `POST /api/history/favorite` |

The kit turns the server's wire shapes (`kit/src/wire.ts`) into the UI types in
`kit/src/types.ts`; a server change touches `adapt*.ts` and `client.ts`, not the screens.

## Brand rules

The studio brand is ima2 (`assets/brand`). Logos of model makers and route
providers identify those companies next to their models and prices; they are
never used as the studio's own brand. Sample media in a studio is made for ima2.
