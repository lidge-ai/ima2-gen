---
created: 2026-09-29
tags: [ima2-gen, runtime, desktop, cli]
---

# Background runtime, CLI control and desktop takeover

**Reader summary.** Today `ima2 serve` only runs in the foreground, `ima2 stop` refuses on
Windows, and the desktop app silently attaches to whatever ima2 server already answers on its
port — even an npm-global or launchd one it cannot restart. When the CLI stops a desktop-owned
server, the desktop treats it as a crash and starts it again. This unit gives ima2 the runtime
control opencodex already has: `ima2 start` runs the server in the background, `ima2 status
--runtime` and `ima2 stop --json` give scripts and the desktop a machine-readable contract, and
the desktop can take over a native server (stop it through its bundled CLI, then start its own)
either on request, after asking, or automatically at startup. CLI users, desktop users and the
desktop shell itself are affected; generation behaviour is not.

## Loop spec

| Field | Value |
|---|---|
| Loop archetype | satisfy-spec, multi-cycle (docs-first roadmap, then one PABCD per work-phase) |
| Trigger | User request 2026-09-29: opencodex-style background execution + CLI control, native takeover, "turn it off at startup and use the bundled one", merge to dev, prepare release |
| Goal | See reader summary; acceptance rows in each work-phase doc |
| Non-goals | Provider/generation logic, `ui/src` studio, opencodex itself, npm publish, running `release.yml`, merging to `main`, Windows service registration, ocx-grade consent generations / install ids |
| Verifier | `npm run typecheck`, `typecheck:tests`, `lint`, `test:inventory`, `npm test` (all read `bin/`, `lib/`, `server.ts`, `desktop/` via tsconfig includes / eslint globs / `tests/*.test.ts` discovery); isolated CLI smoke (020 §Check); PR fast gate + post-merge dev CI |
| Stop condition | wp5 done: feature PR merged to dev, dev CI observed, release PR dev→main open and green, not merged |
| Memory artifact | this unit (`000`–`050`), goalplan `.codexclaw/goalplans/ima2-gen-background-runtime-cli-control-and-desk/` |
| Terminal outcomes | DONE as above; NEEDS_HUMAN only for packaged-GUI click-through (reported as a limitation); BLOCKED after three consecutive CI/GitHub failures |
| Escalation | A change that would signal a process whose identity is unverified (UNSAFE); CI red for reasons outside this diff |
| Resource bounds | Tools: local shell, gh (lidge-ai/ima2-gen), gpt-6-sol subagents (no fixed cap), Aside exec (read-only web). Writes: files listed in 020–050 plus generated inventory. No token/time budget was set by the user. |

## Work-phase map (build order)

| WP | Doc | Delivers | Depends on |
|---|---|---|---|
| wp1 | 000, 010 | this roadmap + research | — |
| wp2 | [020_cli_runtime.md](020_cli_runtime.md) | runtime identity in advertise/health, strict port, resolver, `start`/`status --runtime`/`stop --json`/`restart`/`logs`, Windows stop | wp1 |
| wp3 | [030_desktop_takeover.md](030_desktop_takeover.md) | bundled-CLI bridge, startup decision, takeover, `existingServer` setting, tray/settings actions | wp2 (consumes its JSON contracts) |
| wp4 | [040_cooperation_docs.md](040_cooperation_docs.md) | supervisor honours intentional stops, owner labels, docs/skills/structure SoT sync | wp3 |
| wp5 | [050_merge_release.md](050_merge_release.md) | PR → dev, CI, merge, release notes, dev→main release PR | wp4 |

One PR (`codex/260929-background-runtime` → `dev`) carries wp2–wp4 as separate commits; the diff is
reviewable as one unit, so no stack.

## Architect consultation record

Architect: gpt-6-sol subagent `01a0eb97-effe-7df2-94d0-7aa709ac2c23` (Huygens), proposal D1–D8.
Explorers: `01a0eb97-f0cc-7133-96e1-96d6c7f38567` (opencodex contract), `01a0eb97-f1c2-70e0-96ef-f75a00f4937c`
(ima2 gap audit). Findings in [010_research.md](010_research.md).

| ID | Proposal | Main disposition |
|---|---|---|
| D1 | Runtime decisions live in shared CLI modules; Electron calls the bundled CLI | **Accept.** `bin/lib/runtime.ts` owns resolve; desktop runs `bin/ima2.js` (already packaged, `electron-builder.yml:26`) |
| D2 | Advertise gains bootId, launcher, owner, installId, bundleId; health mirrors non-secret fields | **Amend.** Add `bootId`, `launcher` (foreground/background/service/desktop) and `root` (install root). `root` identifies "bundled vs native" without install ids; owner is derived from launcher. Also make the advertise write atomic (gap audit §1) |
| D3 | `ima2 start`; `status --runtime --json` (`ima2-status/1`); `stop --json` (`ima2-stop/1`) | **Accept**, plus `ima2-start/1`, `restart`, `logs`, `serve --background` alias. Existing `ima2 status --json` auth contract untouched |
| D4 | Detached spawn, log file, health wait on pid+bootId, strict port | **Accept.** Strict port via `IMA2_STRICT_PORT=1` (server exits instead of hopping, `runtimePorts.ts:77`) |
| D5 | Manager-aware stop; Windows graceful path | **Accept.** Service stop behind explicit `--service`; Windows uses admin nonce, then `taskkill /T /F` only on an identity match |
| D6 | Fail-closed desktop state machine probe→attach/ask/takeover→start | **Accept (final, after reflection rounds 1–2 and audit round 1).** Unknown *and* resolver-could-not-run both block spawning; login launches never prompt |
| D7 | Stop-intent receipt keyed to bootId | **Amend.** Receipt is a stdout marker from the tracked child, matched against the bootId read from that child's `/api/health` (040). No file |
| D8 | Setting + takeover action + owner labels in tray/settings | **Accept.** Setting `existingServer: ask|attach|takeover` |

### Reflection (same architect, round 1): MISALIGNED — dispositions

| Gap | Main disposition |
|---|---|
| G1 D7: exit 0 only proves shutdown ran (SIGHUP, external SIGTERM, handler errors also exit 0, `bin/lib/platform.ts:96`) | **Accept.** Stop intent is an explicit marker: `POST /api/admin/stop` prints `IMA2_STOP_INTENT <bootId>` on the server's own stdout before self-signalling. The supervisor skips restart only when its *own tracked child's pipe* carried the marker with that child's bootId **and** the exit was code 0. The pipe binds it to the boot; the nonce authenticates it. No file. See 040 |
| G2 classifyRuntime root is unverifiable from health | **Accept.** `/api/health` also carries `root`. Bundled iff health `launcher==="desktop"`, health `pid` = advertised pid, and `realpath(health.root) === realpath(bundledRoot)`; any realpath failure → native (guest). A foreign process with the same root is the same app bundle, so attaching to it is correct |
| G3 unknown → legacy spawn loses fail-closed; hop range not probed | **Accept.** Resolver probes advertised url, then `127.0.0.1:port`…`port+20` (the hop range, `lib/runtimePorts.ts:3`). `absent-proven` only if every candidate refuses the connection. Desktop on `unknown`: error state + Retry, **no spawn**. (Resolver-could-not-run later also blocks — R2b) |
| G4 Windows detached spawn unproven | **Accept.** Parent closes its log fd after spawn; `tests/runtime-start-spawn.test.ts` spawns a tiny health stub detached with fd stdio and checks log writes + pid + stop — runs on Windows/macOS in post-merge CI |
| G5 extra cases | **Accept:** resolver unknown, hopped server with missing advertisement, foreign desktop process with same root, external SIGTERM → restart |

Aside analog research (010 §Analogous products) adopted: status exit codes 0 live / 3 absent / 1 unknown;
`start` idempotent (already running → ok, exit 0); probe `127.0.0.1`, not `localhost`; never stop a service-owned
server without stopping its manager; show who owns the server everywhere. Rejected: advisory lock file (needs a
native flock helper; the pid+bootId identity check plus atomic advertise covers the stale-file case), refusing CLI
stop of an app-owned server (the user explicitly wants CLI control of the desktop server).

### Audit round 1 (reviewer 01a0eba2-b09b, VERDICT FAIL, 5 blockers) + reflection round 2 (MISALIGNED, 3 gaps)

| # | Finding | Disposition (folded into 020/030/040) |
|---|---|---|
| A1 | Takeover stop not bound to the approved process | `stop --expect-pid P --expect-boot B`: stop re-reads health right before graceful/signal/manager action; mismatch → `refused`, `code:"identity-changed"` |
| A2 | Linux (and Windows) login launch cannot be recognised | Autostart entries pass `--autostart` (Linux `Exec`, Windows `args`); macOS uses `wasOpenedAtLogin`. `launchOrigin(argv, loginSettings)` tested |
| A3 | Advertisement-free live server has no stop target | Status reports `stoppable:false` when the runtime came from a port scan without an advertisement (no nonce). Desktop: takeover unsupported → attach as guest, prompt/menu explain why |
| A4 / R2c | Legacy service (no `launcher`) or stale state file mis-classified | Status carries `manager:{kind:"launchd"\|"systemd", pid, active}\|null` from `launchctl print` / `systemctl show -p MainPID,ActiveState`. Service-managed iff manager active **and** manager pid = runtime pid (or `launcher==="service"`). Stop and desktop both use this; a desktop server beside a dormant service registration is not refused. `systemctl --user stop` result is checked |
| A5 | Smoke may run stale JS; second-start expectation inconsistent | Smoke runs `npm run build:server && npm run build:cli` then `node bin/ima2.js`; second start expects `already-running`, exit 0. Package check (`npm run test:package-install`) in wp5 |
| R2a | Marker bootId must be independent; flush; chunking | Supervisor reads bootId from its child's `/api/health` when it reaches running; marker parsed from a line buffer over stdout only; admin route writes the marker with `process.stdout.write(line, cb)` and self-signals in the callback. Test: split marker + immediate exit |
| R2b | Resolver-could-not-run still spawns | Now `blocked` ("bundled CLI unavailable: <reason>") — no spawn |
| N1 | `bin/ima2.ts` 593 lines | Move `showHelp` text to `bin/lib/helpText.ts` (wp2) so the dispatcher drops under 500 |

### Audit round 2 (VERDICT FAIL, 5) + reflection round 3 (MISALIGNED, 4)

| # | Finding | Disposition |
|---|---|---|
| B1 / R3-1 | Desktop parser rejects exit 3, so absent never reaches `start` | `parseStatus` accepts exit 0 with `liveness:"live"`, 3 with `absent-proven`, 1 with `unknown`; any other pairing or a missing/invalid document → `{ok:false}` (blocked). Tested |
| B2 | Pre-upgrade servers have no `bootId`; `--expect-boot` would always refuse | Identity guard = `--expect-pid P` plus `--expect-boot B` when the resolved runtime has a bootId, else `--expect-started T` (health `startedAt` exists in every version, `routes/health.ts:58`). Stop requires health to carry exactly the expected pid and boot/started value. Test: legacy advertisement without bootId → takeover argv uses `--expect-started` |
| B3 / R3-3 | `legacy` spawn still in the 030 file map | Removed; resolver launch failure test asserts no spawn |
| B4 | Bundled CLI env untraced | `desktop/lib/runtime-env.mjs` `desktopRuntimeEnv(settings)` → `IMA2_PORT`, optional `IMA2_CONFIG_DIR` (+ `IMA2_DESKTOP`, `IMA2_BOOT_ID` for the server spawn); used by the server spawn and `runBundledCli`. Real-bridge test with custom port + config dir |
| B5 | Windows `getLoginItemSettings` must pass the same `args` | `login-item.mjs` reads and writes with `{args:["--autostart"]}` on Windows; test |
| R3-2 | 020 route text still said `console.log` | 020 now matches 040 (write callback) |
| R3-4 | Start waits on pid only; port-busy smoke unreachable | Spawners generate the boot id and pass `IMA2_BOOT_ID` (server adopts it when it is a UUID). `start` waits for health pid and bootId; the desktop knows its child's bootId without reading the child's output. Port-busy smoke expects `refused` (resolver `unknown` on a foreign listener); strict bind is tested by launching `server.js` directly with `IMA2_STRICT_PORT=1` on a held port |

## Source-of-truth sync target

`structure/02-command-reference.md` (CLI), `structure/06-infra-operations.md` (runtime/desktop),
`structure/03-server-api.md` (health fields), README CLI section, `skills/ima2/SKILL.md` CLI table.

### Audit round 3 (FAIL, 1) + reflection round 4 (MISALIGNED, 1) — same finding

| # | Finding | Disposition |
|---|---|---|
| C1 | Manager inspection conflated "none" with "failed"; `--service` could stop a manager bound to a different pid | Three-state `inspectManager` (absent / bound / unknown) and `serviceOwnership` (managed / unmanaged / unknown). Unknown refuses destructive stop and takeover. `--service` requires managed (manager active with pid = approved runtime pid) re-checked right before the manager stop. Tests: failed launchctl → unknown → refused; service launcher + manager bound to another pid → unknown → refused; manager pid match → managed |
| C2 | Status did not carry unknown ownership to the desktop (reviewer r4 Medium, architect r5) | `ima2-status/1` carries `manager.state` and `serviceOwnership`; desktop row "native + serviceOwnership unknown → attach-guest, takeover unsupported"; test the chain |
| D1w3 | wp3 A: absent-proven while the login service is active/unknown would start a competing server during service startup | Decision table: absent + manager bound active → wait-service (≤20 s re-resolve, then blocked); absent + manager unknown → blocked; start only when manager absent or inactive. Tested |
