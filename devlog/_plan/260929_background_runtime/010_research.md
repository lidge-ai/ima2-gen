# Research synthesis

## opencodex (explorer 01a0eb97-f0cc)

- Startup matrix: unknown resolve → fail with retry; `absent-proven` → start bundled; live + owned by this
  desktop → attach; live + other owner + takeover supported + user launch → ask (decline = guest);
  recovery/login mode → guest without asking (`desktop/src-tauri/src/startup.rs:873-1138`).
- Wire contracts are single JSON documents on stdout with a `schema` field (`ocx-resolve/1`,
  `ocx-stop/1`, `ocx-service-claim/1`), human lines on stderr, exit 0 only for clean success
  (`src/cli/stop-report.ts:66-137`).
- Takeover = re-resolve, require the approved answer unchanged, run guarded `ocx stop`, wait for
  connection refusal, claim, start (`startup.rs:1229-1385`).
- Hazards they hit: duplicate proxies from a weak shell-side probe; KeepAlive respawn; recycled pids;
  stale records. Essential for ima2: one resolver shared by CLI and desktop, three-state liveness,
  identity-checked stop, PID-conditional cleanup, stop intent controls recovery. Overkill: consent
  generations, install ids, compatibility tokens, manager ancestry
  (`devlog/_plan/260921_app_runtime_ownership/070_decisions.md`).

## ima2 gap audit (explorer 01a0eb97-f1c2)

1. `server.json` written non-atomically after bind; removed only when pid matches; stale after a hard kill (`server.ts:343-371`).
2. Admin stop self-SIGTERMs; shutdown exits 0 (`bin/lib/platform.ts:93`). The desktop supervisor restarts every exit unless it set `stopping` itself (`desktop/lib/server.mjs:178`) → CLI stop of a desktop server is undone.
3. Busy port hops up to +20 (`lib/runtimePorts.ts:77`); desktop probes only its configured port, so a native server on a hopped port is missed and a second server starts.
4. Packaged desktop ships `bin/**/*.js` and runs server.js under `ELECTRON_RUN_AS_NODE`; `bin/ima2.js` is runnable the same way.
5. `IMA2_DESKTOP=1` / `IMA2_SERVICE=1` exist in env but never reach the advertise file or health, so nobody can tell who launched a server.
6. New tests must be `tests/*.test.ts` and appear in `docs/migration/runtime-test-inventory.md` (`scripts/classify-tests.mjs`).

## Analogous products (Aside exec)

Aside exec (account u0, read-only web; report `/Users/jun/.aside/u/0/artifacts/ima2-bg-runtime/analogs-report.md`, 320 lines).

| Product | Detection | On conflict | Lesson for ima2 |
|---|---|---|---|
| Ollama | port probe on 11434 | app attaches; fights launchd/systemd-restarted servers (#690); pkill-by-name reaped user sessions (#15657) | never kill by name; stop the manager, not the process |
| LM Studio | `~/.lmstudio` file as hint + API identity | CLI refuses to stop an app-owned server; `lms status` always exits 0 (#622) | file is a hint, identity is truth; honest exit codes |
| Docker Desktop | context/socket ownership | silently retargets the CLI (desktop-linux #8, #20) | say which server you use and how to switch back |
| Syncthing | advisory file lock | macOS wrapper retries every 10 s against an outside instance | surface the state; back off instead of looping |

Recommendations used: attach to a compatible server by default, prompt for replacement, never stop blindly,
atomic 0600 advertise with a per-boot id, versioned JSON on stdout with human text on stderr, LSB status codes,
owner/pid/url always visible.
