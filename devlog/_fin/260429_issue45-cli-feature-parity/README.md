# Issue #45 — CLI Feature Parity

**Status:** planned (oracle-audited 2026-04-29, NEEDS_FIX → revised)
**GitHub:** https://github.com/lidge-ai/ima2-gen/issues/45
**Priority:** P3
**Audit:** see `ORACLE-AUDIT.md` in this folder

## Do Not Start Before

- TypeScript migration (#24) merged and green — done.
- ORACLE-AUDIT.md findings reflected in each PHASE-*.md — done.

## Product Intent

Bring `ima2` CLI surface up to parity with the server API so power users can script every workflow the UI exposes. Today the CLI ships 12 commands while the server registers 26+ endpoints. Recently-added request fields (`reasoningEffort`, `webSearchEnabled`) are not surfaced as flags on existing `gen`/`edit`.

## Topology (verified)

```
bin/ima2.ts                       # router (~406 lines), switch dispatch at L389-L399
bin/commands/<name>.{ts,js}       # per-command modules. Today: gen, edit, ls, show, ps, cancel, ping
bin/lib/<helper>.{ts,js}          # shared helpers: args, client, error-hints, files, output, platform, star-prompt, storage-doctor
```

New commands extend this pattern:
1. Add `bin/commands/<name>.ts`.
2. Add a `case "<name>":` branch in `bin/ima2.ts:389–399`.
3. Reuse `bin/lib/{args,client,output,files}.ts` helpers.

There is **no** parallel `bin/lib/commands/*` tree. (The first plan revision proposed one; that was wrong — see `ORACLE-AUDIT.md`.)

## Phases

| # | File | Surface | Commands added | Risk |
|---:|---|---|---:|---|
| 1 | `PHASE-1-existing-command-flags.md` | `gen`, `edit`, `ls`, `show` | 5 flags, 1 sub-mode | Low |
| 2 | `PHASE-2-sessions-history.md` | `session`, `history` | 12 commands | Med |
| 3 | `PHASE-3-prompt-library.md` | `prompt` | 14 commands | Med |
| 4 | `PHASE-4-generation-modes-utility.md` | `multimode`, `node`, `annotate`, `canvas-versions`, `metadata`, `comfy` | 11 commands | Med (SSE) |
| 5 | `PHASE-5-cardnews-observability-config.md` | `cardnews`, `storage`, `billing`, `providers`, `oauth`, `inflight`, `config` | 12 commands | Low–Med |

Total: ~54 new commands/flags after audit corrections (down from the original ~66 — phantoms removed).

## Non-Goals

- Do not redesign endpoints. CLI only wraps what the server already exposes.
- Do not bundle `docs/API.md` updates here — separate effort.
- Do not introduce a new argv-parser library. Stay on the existing `bin/lib/args.ts` `parseArgs(argv, SPEC)` pattern.
- Do not block phases on each other. Each ships independently.

## Testing Strategy

- Each new command gets at least one smoke test in `tests/cli.smoke.test.js`. Mirror existing `gen`/`ls` smokes.
- SSE-streaming commands (Phase 4) get a parser unit test under `tests/cli-sse.test.js`.
- No coverage gate; the bar is "user can hit each command without crashing" plus a `--help` text contract.

## Risks / Watchouts

- `bin/ima2.ts` switch will grow by ~10 cases. Acceptable; module dispatch already keeps the file thin.
- SSE in CLI requires careful chunk buffering and Ctrl+C handling. Tests in Phase 4 cover this.
- `prompt import discovery` calls external sources. CLI variant must require `--source` and refuse silent fanout.
- `config set` foot-guns: must redact `provider`/`apiKey`/oauth tokens, warn about server restart for file changes.

## Acceptance

- Each phase ships with: command implementation + smoke test + `bin/ima2.ts` switch entry + README "CLI Commands" table update.
- Phase 1 + Phase 2 land before any Phase 3+ work.
- Issue closes when Phases 1–4 merged. Phase 5 may spin off if Card News surface keeps drifting.
