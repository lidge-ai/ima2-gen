# wp3 — Desktop attach-or-takeover

Consumes `ima2-status/1` and `ima2-stop/1` from wp2. Decisions D1, D6, D8.

## File change map

| File | Change |
|---|---|
| `desktop/lib/runtime-env.mjs` (new) | `desktopRuntimeEnv(settings, {forServer})` → `IMA2_PORT`, optional `IMA2_CONFIG_DIR`, plus `IMA2_DESKTOP=1` and a fresh `IMA2_BOOT_ID` for the server spawn. Used by `ServerSupervisor` and `runBundledCli`. |
| `desktop/lib/runtime-cli.mjs` (new) | `runBundledCli({rootDir, args, env, isPackaged, nodeBinary, timeoutMs})` spawns `bin/ima2.js` with `resolveNodeCommand` (ELECTRON_RUN_AS_NODE when packaged), collects stdout/stderr, kills on timeout. `parseStatus(stdout, code)` accepts exit 0+live, 3+absent-proven, 1+unknown with a valid `ima2-status/1` document; `parseStop(stdout, code)` validates `ima2-stop/1`; anything else → `{ok:false, reason}`. |
| `desktop/lib/startup-decision.mjs` (new, pure) | `classifyRuntime(runtime, bundledRoot, realpathFn)` → `"bundled"\|"native"` (bundled iff health-sourced `launcher==="desktop"` and `realpath(root)===realpath(bundledRoot)`; realpath failure → native). `decideStartup({resolved, bundledRoot, existingServer, origin})` → `start` (absent-proven) \| `attach-bundled` \| `attach-guest` \| `ask` \| `takeover` \| `blocked` (unknown, or the bundled CLI could not run / answered with an invalid document: error + Retry, no spawn). |
| `desktop/lib/takeover.mjs` (new) | `takeOver({resolved, runCli, probe})`: requires `stoppable`; re-resolve, require same `pid` and `bootId` (or `startedAt` for pre-upgrade servers); run `stop --json --expect-pid P` + `--expect-boot B` or `--expect-started T` (+`--service` when status `serviceOwnership==="managed"`); require `ok && runtimeDown`; wait for three consecutive refused probes (≤5 s); return `{ok, reason}`. Never signals a process itself. |
| `desktop/lib/server.mjs` | `start(settings, {origin, askTakeover})` uses the decision; `#attach(runtime, ownership)`; `takeOver(settings)` public (tray/IPC); snapshot gains `ownership:"bundled"\|"guest"\|null` and `guest:{pid, launcher, version, root}\|null`; `external` kept for compatibility (= guest). Constructor accepts `spawnFn`/`runCli` for tests. |
| `desktop/lib/settings.mjs` | `existingServer: "ask"` default; enum-sanitised (`ask\|attach\|takeover`). |
| `desktop/lib/takeover-prompt.mjs` (new) | `askTakeover(dialog, runtime)` → `showMessageBox` buttons "Use the bundled server" / "Keep using it", checkbox "Remember my choice"; returns `{approve, remember}`. Text names the launcher (terminal `ima2 serve`, background `ima2 start`, login service) and, for service, that it returns at next login unless `ima2 service uninstall`. |
| `desktop/lib/launch-origin.mjs` (new) | `launchOrigin(argv, loginSettings)` → `"login"` when argv has `--autostart` or `wasOpenedAtLogin`, else `"user"`. |
| `desktop/lib/login-item.mjs` | Linux entry `Exec=<target> --autostart`; Windows `setLoginItemSettings({openAtLogin, args:["--autostart"]})` and `getLoginItemSettings({args:["--autostart"]})` in both `isEnabled` and `set`. |
| `desktop/main.mjs` | Pass `origin` from `launchOrigin`, `askTakeover` (persists `existingServer` when remembered), action `useBundledServer`. |
| `desktop/lib/tray.mjs` | "Use Bundled Server" item visible when `ownership==="guest"`; status line names the guest launcher. |
| `desktop/lib/ipc.mjs`, `desktop/preload.cjs` | `desktop:server:takeover`. |
| `desktop/pages/settings.html`/`.js` | Select "When another ima2 server is already running": Ask / Use it / Replace it with the bundled server; "Use Bundled Server" button while guest. |

## Decision table (tested)

| resolved | classify | existingServer | origin | action |
|---|---|---|---|---|
| resolver could not run (bundled CLI missing / unparseable) | — | any | any | blocked ("bundled CLI unavailable", Retry; no spawn) |
| absent-proven, manager absent or bound inactive | — | any | any | start |
| absent-proven, manager bound **active** | — | any | any | wait-service: re-resolve every 1 s for up to 20 s; live → classify as below; still absent → blocked ("the login service is running but not answering yet — wait, or stop it with ima2 service stop") |
| absent-proven, manager unknown | — | any | any | blocked (cannot tell whether a login service is about to start a server) |
| unknown | — | any | any | blocked (error "an ima2 server answers but cannot be identified", Retry; no spawn) |
| live | bundled | any | any | attach-bundled |
| live | native | attach | any | attach-guest |
| live | native, `stoppable:false` | any | any | attach-guest (takeover unsupported; reason shown) |
| live | native, `serviceOwnership:"unknown"` | any | any | attach-guest (takeover unsupported: "cannot tell whether a login service manages it"; reason shown) |
| live | native | takeover | any | takeover |
| live | native | ask | user | ask → approve: takeover; decline: attach-guest |
| live | native | ask | login | attach-guest (never prompt a hidden launch) |

Takeover failure → attach as guest if the old server still answers, else `error` with the reason; never start beside a live server.

## Acceptance

1. `tests/desktop-startup-decision.test.ts` covers every table row (including absent + active manager → wait-service, absent + unknown manager → blocked) + `classifyRuntime` root comparison.
2. `tests/desktop-runtime-cli.test.ts`: parse accepts exit 0/3/1 with the matching liveness, rejects wrong schema / garbage / mismatched exit; `runBundledCli` against a real `node -e` script honours timeout and receives `IMA2_PORT`/`IMA2_CONFIG_DIR` from `desktopRuntimeEnv`. Resolver launch failure → `blocked`, spawn never called.
3. `tests/desktop-takeover.test.ts` with injected `runCli`/`probe`: identity changed → refused before stop; stop not ok → refused; still answering after stop → refused; happy path passes `--service` for service launcher.
   Also: `serviceOwnership:"unknown"` → takeover never offered and stop never called; stop argv carries `--expect-pid/--expect-boot`; `stoppable:false` never calls stop.
3b. `tests/desktop-launch-origin.test.ts` and a `login-item` case for the Linux `--autostart` Exec line.
4. Supervisor test (`tests/desktop-server-supervisor.test.ts`) with injected `runCli` + `spawnFn`: takeover path calls stop then spawn; ask declined → guest snapshot.
5. Settings sanitise test for `existingServer`.
6. Human (NEEDS_HUMAN, reported): packaged GUI click-through of the prompt and tray item.
