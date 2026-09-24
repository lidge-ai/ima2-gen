# ima2-gen — AI Context

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

Runtime installation metadata is generated from `package.json` and `.node-version`; source TypeScript users must build before running emitted JavaScript.

## What This Project Does
Local image generation studio — CLI + 웹 UI
- GPT OAuth, API Key, Grok, Gemini API, Antigravity CLI 다중 provider 지원
- 텍스트→이미지, 이미지→이미지(편집), 비디오 생성
- SSE 멀티플렉싱: 단일 `GET /api/events` SSE 채널 + async POST (202) 아키텍처
- 병렬 생성 (최대 12건, 브라우저 연결 포화 없음)

## Tech Stack
- Runtime: Node.js ES Module; package engine is shown in the generated table above
- Server: Express 5
- API Client: OpenAI SDK range is rendered in the runtime-install contract above
- OAuth: openai-oauth (ChatGPT 세션 프록시)
- Grok: xAI OAuth (device code) 또는 API key, api.x.ai 직접 호출
- Gemini: Google Generative Language API / Vertex AI
- Frontend: React + Vite (`ui/src`, built to `ui/dist`)
- SSE: lib/eventBus.ts (ring buffer pub/sub) + routes/events.ts

## Project Structure
```
ima2-gen/
├── bin/                  # CLI entry + subcommands
├── server.ts             # Express bootstrap / static UI serving
├── config.ts             # Runtime config
├── routes/               # API route modules (*.ts source)
│   ├── events.ts         # GET /api/events SSE multiplexing
│   ├── multimode.ts      # Multimode batch (async POST + dual-emit)
│   ├── nodes.ts          # Node mode (async POST + dual-emit)
│   ├── video.ts          # Video generation (async POST + dual-emit)
│   └── ...               # generate, edit, sessions, history, etc.
├── lib/                  # Server helpers (*.ts source)
│   ├── eventBus.ts       # Global pub/sub ring buffer (2000 events)
│   ├── ssePublish.ts     # Cancel-done race guard
│   ├── inflight.ts       # Job lifecycle tracking
│   └── ...               # OAuth, storage, sessions, etc.
├── ui/src/               # React/Vite app source
│   ├── lib/eventChannel.ts  # Singleton EventSource for /api/events
│   ├── lib/sseStreamError.ts # SSE error parser
│   └── store/store*Impl.ts  # Modular Zustand slices
├── ui/dist/              # Built frontend served by server.js
├── site/                 # Astro marketing/docs site (GitHub Pages)
├── integrations/comfyui/ # ComfyUI bridge/custom node
├── structure/            # Current architecture reference docs (00-07)
├── devlog/               # _plan (active), _fin (archived)
├── tests/                # node:test contracts/regressions
└── package.json
```

## Agent Skills (packaged)

Three Markdown skill files ship inside `skills/` for AI coding agents:

| Skill | Path | CLI | What It Covers |
|-------|------|-----|----------------|
| Core | `skills/ima2/SKILL.md` | `ima2 skill` | CLI reference, prompting protocol, provider routing, video workflows |
| Frontend | `skills/ima2-front/SKILL.md` | `ima2 skill front` | Asset pipeline, motion/video, responsive, a11y, anti-slop, 28 reference files |
| UI/UX Design | `skills/ima2-uiux/SKILL.md` | `ima2 skill uiux` | Image-first ism discovery, UX states, design-isms, product personalities, 18 reference files |

Use `ima2 skill ls` to list, `ima2 skill <name> path` for file paths,
`ima2 skill <name> --json` for JSON-wrapped content. Reference modules
inside `front` and `uiux` skills are loadable individually:

```bash
ima2 skill front refs              # list reference modules with line counts
ima2 skill front ref anti-slop     # load one module by name
ima2 skill uiux ref design-isms    # load a uiux module
ima2 skill install --dir <path>     # install to agent's skill directory
ima2 skill install --tmp            # install to temp dir (ephemeral fallback)
```

**Recommended approach:** The agent resolves its own skill directory path and runs
`ima2 skill install --dir <path>`. Skills land on disk as directories (SKILL.md +
references/) and the agent reads them natively. Avoid piping large bundled outputs.

## Devlog Phase Roadmap
- Current active plans live under `devlog/_plan/`.
- Completed plans live under `devlog/_fin/`.
- Legacy phase docs live under `devlog/_plan/_legacy/`.
- Use `structure/07-devlog-map.md` and `devlog/_plan/README.md` as the current roadmap references.

## Conventions
- ES Module only (import/export)
- File length < 500 lines (split if exceeded)
- Function length < 50 lines
- Wrap async work in try/catch only where the error is transformed, logged, or surfaced at a boundary (route handler, job runner, CLI entry). A catch that only rethrows is noise; let the error propagate.
- Config values in config.js or .env, never hardcode

## Test Command
```bash
npm run typecheck          # tsc --noEmit (server + lib)
npm run typecheck:tests    # tsc --noEmit (test files)
npm test                   # scripts/run-tests.mjs canonical node:test runner
npm run test:inventory     # verify test file registry
cd ui && npm run build     # Vite production build
```

## CI Layout
- PRs run only the minimal `PR fast gate` contract (`pr-fast.yml`, Ubuntu-only). Do not add Windows/macOS legs to it.
- Cross-platform CI is post-merge: pushes to `dev`/`main`/`preview` run the full `CI` workflow, the Agy filesystem matrix, and the unsigned macOS desktop build (path-filtered so docs-only pushes stay green).
- A red `dev` run is fixed forward on `dev`; details in CONTRIBUTING.md `## CI`.

## Heartbeat
- 20분마다 devlog/_plan 점검 및 다음 작업 제안
- 완료된 phase는 _fin/으로 이동 (YYMMDD_ prefix)
