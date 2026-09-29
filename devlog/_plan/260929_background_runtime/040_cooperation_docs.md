# wp4 — CLI/desktop cooperation and docs

## Supervisor stop intent (D7 disposition)

Round-1 reflection rejected the plain exit-code rule (G1). Final rule:

- `routes/admin.ts` writes `IMA2_STOP_INTENT <bootId>\n` with `process.stdout.write(line, cb)` after nonce
  validation and self-signals inside the callback, so the line is flushed before shutdown.
- `desktop/lib/server.mjs`: the supervisor generates `childBootId` and passes it as `IMA2_BOOT_ID` (independent
  of the marker; confirmed against health when running). `#onOutput` keeps a stdout line buffer (stderr ignored) and sets
  `stopIntent` only for a complete line `IMA2_STOP_INTENT <childBootId>`.
- `#onExit`: marker seen **and** `code === 0` → `stopped`, `stoppedBy: "cli"`, no restart. Anything else
  (external SIGTERM/SIGHUP, crash, non-zero) keeps the crash-restart policy.
- `ima2 stop` against a desktop server uses the graceful path first, so the marker is present; if graceful fails and
  it escalates to signals (identity verified), the desktop restarts it — documented, matches "only a hung server".

Tray shows "Start Server" when stopped (the restart path already starts).

`ima2 restart` against `launcher==="desktop"` refuses and says "use the desktop app's Restart Server";
`ima2 stop` works (graceful) and the desktop stays open in the stopped state.

Test: `tests/desktop-server-supervisor.test.ts` — marker + exit 0 → stopped, no respawn; marker split across two
chunks + immediate exit → stopped; marker with a foreign bootId → respawn; exit 0 without marker (external
SIGTERM) → respawn scheduled; exit 1 → respawn scheduled.

## Docs / SoT sync

README CLI section; `structure/02-command-reference.md`, `structure/06-infra-operations.md`,
`structure/03-server-api.md` (health fields); `skills/ima2/SKILL.md` command table; `docs/` CLI page if present
(`rg -l "ima2 stop" docs site/src`); CHANGELOG entry under the next version.

wp4 A fold (reviewer GO-WITH-FIXES, 1): also update `site/src/pages/docs/desktop.astro` (+ Korean strings in `site/src/i18n/strings.ts`), `site/src/pages/docs/reference/cli.astro`, and `docs/API.md` (+ zh-CN, zh-TW) for the health fields and the stop-intent line.
