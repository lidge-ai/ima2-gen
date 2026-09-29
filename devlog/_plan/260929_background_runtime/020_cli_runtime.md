# wp2 — CLI background runtime

Consumes: 000 decisions D1–D5. Produces the JSON contracts wp3 consumes.

## File change map

| File | Change |
|---|---|
| `lib/runtimeIdentity.ts` (new) | `type Launcher = "foreground"\|"background"\|"service"\|"desktop"`; `resolveLauncher(env)`: `IMA2_DESKTOP=1`→desktop, `IMA2_SERVICE=1`→service, `IMA2_LAUNCHER=background`→background, else foreground. `isStrictPort(env)` reads `IMA2_STRICT_PORT=1`. |
| `config.ts` | `server.strictPort` from `IMA2_STRICT_PORT` (config values stay in config). |
| `lib/runtimeContext.ts` | `bootId: string`, `launcher: Launcher` on the context type + test defaults. |
| `server.ts` | `createRuntimeContext` sets `bootId = resolveBootId(process.env)` (`IMA2_BOOT_ID` when it is a UUID, else `randomUUID()`), `launcher = resolveLauncher(process.env)`. `buildAdvertisePayload` adds `bootId`, `launcher`, `root` (= `rootDir`). `advertise()` writes `<file>.<pid>.tmp` (0600) then `renameSync` (atomic). `listenWithPortFallback` gets `maxAttempts: 0` when strict; strict bind failure logs `[server.port] strict port N busy` and exits 1. |
| `routes/health.ts` | `/api/health` adds `bootId`, `launcher`, `root` (non-secret; existing fields unchanged). |
| `routes/admin.ts` | After nonce validation, write `IMA2_STOP_INTENT <bootId>` with `process.stdout.write(line, cb)` and self-signal inside the callback (040). |
| `lib/processControl.ts` | `AdvertiseEntry` gains `bootId?`, `launcher?`, `root?`, `version?`. |
| `bin/lib/runtime.ts` (new) | `resolveRuntime({advertiseFile, port, fetchFn, span=20})` → `{status:"live"\|"absent-proven"\|"unknown", source:"advertise"\|"port"\|null, runtime:{pid,url,port,version,startedAt,bootId,launcher,root}\|null, advertiseStale:boolean, reason?}`. Candidates: advertised url (live only if health pid = advertised pid), then `http://127.0.0.1:port`…`port+span`. A healthy ima2 answer (`ok:true` + numeric pid) on any candidate → live. `absent-proven` only when every candidate refuses the connection; timeouts, non-ima2 answers, or advertised pid alive but mismatching → `unknown`. `buildServerEnv(config, extra)` shared by serve/start. `logFilePath()` = `<configDir>/logs/server.log`. |
| `bin/commands/start.ts` (new) | `ima2 start [--port N] [--dev] [--json]`. resolve → live: `already-running`, ok, exit 0 (idempotent; names pid/url/launcher); unknown: `refused`, exit 1. absent: open log fd (append), `spawnDetached()` (`bin/lib/runtime.ts`: `spawn(execPath,[entry],{detached:true, stdio:["ignore",fd,fd], windowsHide:true, env})`, `unref()`, parent `closeSync(fd)`) with env `IMA2_LAUNCHER=background`, `IMA2_STRICT_PORT=1`, `IMA2_PORT`. Generates `bootId` and passes `IMA2_BOOT_ID`. Wait ≤45 s for `/api/health` with `pid === child.pid` and matching `bootId`; early child exit → failed + last 20 log lines. JSON `ima2-start/1` `{schema, ok, outcome:"started"\|"already-running"\|"refused"\|"failed", pid, url, port, launcher, logFile, message}`. |
| `bin/commands/runtimeStatus.ts` (new) | `ima2 status --runtime [--json]` → `ima2-status/1` `{schema, ok, liveness, source, runtime, advertiseStale, stoppable, manager:{state:"absent"\|"bound"\|"unknown", kind?, pid?, active?, reason?}, serviceOwnership:"managed"\|"unmanaged"\|"unknown", logFile, reason?}`. `stoppable` = runtime came from a matching advertisement (nonce available). Exit 0 live, 3 absent-proven, 1 unknown (LSB). Plain `ima2 status` gains one "Runtime:" line; `ima2 status --json` (auth report) unchanged. |
| `bin/lib/serviceManager.ts` (new, amended audit r3) | `inspectManager(run)` → `{state:"absent"}` (no plist/unit installed, or registration reports not loaded), `{state:"bound", kind, pid, active}` (parsed `pid = N`/`state = running`, or `MainPID`/`ActiveState`), or `{state:"unknown", reason}` (command failed / unparseable). `serviceOwnership(runtime, manager)` → `"managed"` (bound, active, manager pid = runtime pid), `"unmanaged"` (manager absent, or bound to another/no pid while runtime launcher is not service), `"unknown"` (manager unknown, or launcher service without a matching manager). Stop/takeover refuse on unknown (`code:"ownership-unknown"`); `--service` requires managed and re-checks the manager pid immediately before the manager stop. |
| `bin/commands/stop.ts` | Split into `stopRuntime(opts): Promise<StopReport>` + renderers. JSON `ima2-stop/1` `{schema, ok, outcome:"stopped"\|"not-running"\|"refused"\|"failed", code?, method:"graceful"\|"term"\|"kill"\|"taskkill"\|"service"\|null, pid, launcher, runtimeDown, message}`; human lines go to stderr under `--json`. `--expect-pid P` with `--expect-boot B` or `--expect-started T`: immediately before acting, live health must carry exactly those values, else `refused` / `identity-changed` (no action). Windows: remove refusal; graceful admin stop, then `taskkill /PID pid /T /F` only after identity `match`. Service ownership (`serviceOwnership`): unknown → refuse (`code:"ownership-unknown"`); managed → refuse (`code:"service-managed"`) unless `--service` (stop the manager via `stopServiceManager`, require success, then verify the listener stays down ≥2 s) or `--force` (old behaviour). A stale `service-state.json` alone no longer refuses. Exit 0 for stopped/not-running, 1 otherwise. |
| `bin/commands/service.ts` | Export `stopServiceManager(): Promise<{ok:boolean; message:string}>` extracted from `stopSvc` (bootout / `systemctl --user stop`, result now checked); `stopSvc` calls it. |
| `bin/lib/helpText.ts` (new) | `showHelp` text moved out of `bin/ima2.ts` (N1) and extended with the runtime commands. |
| `bin/commands/logs.ts` (new) | `ima2 logs [-n N] [-f]` tails `server.log`; points to `ima2 service logs` when the live launcher is service. |
| `bin/ima2.ts` | Dispatch `start`, `restart` (stop then start; refuses for service/desktop launchers with the right command), `logs`, `status --runtime`, `serve --background` → start. Help text + `helpOwningCommands`. |
| `bin/lib/runtimeReport.ts` (new) | Schema constants and pure builders for the three JSON documents (shared by commands and tests). |

PLAN-FIELD-CHAIN-01 for `launcher`/`bootId`/`root`: creation `createRuntimeContext` (env) → serialization
`buildAdvertisePayload` + `/api/health` → deserialization `AdvertiseEntry`, `resolveRuntime` (unknown launcher string →
reported as-is, treated as native) → consumers `start` (refusal text), `runtimeStatus`, `stop` (service/desktop
branching), `logs`, desktop `decideStartup` (wp3), tray labels (wp4). Enum values appear in `lib/runtimeIdentity.ts` only.

## Scope

IN: files above, tests below, `docs/migration/runtime-test-inventory.md` regeneration.
OUT: desktop (wp3), docs (wp4), Windows service registration, LAN-token-guarded non-loopback stop (still degrades to signals, as today).

## Acceptance (with activation)

1. `tests/runtime-identity-contract.test.ts`: `resolveLauncher` for each env; advertise payload carries `bootId/launcher/root`; advertise write leaves no `.tmp` and mode 0600.
2. `tests/runtime-resolve-contract.test.ts` with a local `http.createServer` stub and injected fetch: live via advertise; stale advertise (dead pid) + refused port → `absent-proven`, `advertiseStale:true`; pid mismatch → `unknown`; hanging port → `unknown`.
   Plus: hopped server (configured port refused, port+2 answers, no advertise) → live via port scan.
2b. `tests/runtime-start-spawn.test.ts`: `spawnDetached` with a node health stub → log file receives output, health pid = child pid, parent fd closed; stub stopped at the end. Cross-platform (runs in post-merge Windows/macOS CI).
3. `tests/stop-json-contract.test.ts`: report builders; service-managed without `--service` → `refused`, exit 1; legacy advertisement (no launcher) + active manager with same pid → service-managed; desktop launcher + inactive manager → not service-managed; `--expect-boot` mismatch → `identity-changed`, no action taken; not running → `not-running`, exit 0; stdout is exactly one JSON document. `tests/service-manager-parse.test.ts`: launchctl/systemctl output parsers.
4. Strict port: `tests/server-fallback-contract.test.ts` gains a case — `maxAttempts:0` on a busy port throws `PORT_RANGE_EXHAUSTED` without hopping.
5. **Smoke (C activation):** `npm run build:server && npm run build:cli`, then with `IMA2_CONFIG_DIR=$(mktemp -d)` and free port P run the checkout's `node bin/ima2.js`: `start --port P --json` → `started`; second `start` → `already-running`, exit 0; `status --runtime --json` → `live`, `launcher:"background"`, `stoppable:true`; `stop --json --expect-boot wrong` → `refused`/`identity-changed`, server still up; `stop --json` → `stopped`, method `graceful`; `status --runtime --json` → `absent-proven`, exit 3. Foreign holder: hold P with a raw TCP listener, `start --port P` → `refused` (resolver `unknown`), exit 1, nothing spawned. Strict bind: `IMA2_STRICT_PORT=1 IMA2_PORT=P node server.js` while P is held → exit 1 and `[server.port] strict port P busy`.

Verifiers (run at P, all exit 0 on the base `52f6667e`): `npm run typecheck` (tsconfig includes `bin/**`, `lib/**`, `server.ts`),
`npm run typecheck:tests` (`tests/**/*.ts`), `npm run lint` (eslint over bin/lib/routes/desktop), `npm run test:inventory`,
`npm test` (discovers `tests/*.test.ts`, `scripts/run-tests.mjs:8`).
