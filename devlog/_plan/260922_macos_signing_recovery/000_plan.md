# macOS signing and notarization recovery

Desktop CI previously produced unsigned PR artifacts while presenting a successful
build. This unit reuses the existing Apple credentials, restores reliable nested
binary signing, and makes a trusted macOS build pass only after both architecture
installers contain Developer ID signed, notarized and stapled applications.

## Scope and completion

- Class C4; one satisfy-spec P/A/B/C/D work-phase, without creating a host goal or
  changing the session FSM. Trigger: the user's request to use macbookpro2's Apple
  credentials, connect signing authentication, and merge the fix into dev.
- Goal: an audited dev PR plus a successful nonpublishing macOS-only signing run
  on its exact SHA, with native evidence for arm64 and x64 exported installers.
- Non-goals: Windows signing, public release/tag creation, npm releases, Aside
  authentication, new certificates, password rotation, permanent keychain/ACL
  changes, or unrelated dependency upgrades.
- Stop: relevant tests, independent review, actual signed artifact verification,
  PR CI and dev merge are complete; local dev is synchronized.
- Evidence: this unit and GitHub run artifacts. No passwords, private keys,
  signing packages or authentication tokens enter the repository or logs.
- Escalate if existing GHA authentication fails and a new human authentication
  gesture or unavailable credential is required. Preserve progress and diagnose
  the actual failure; never replace authentication with an unsigned success.

## Evidence and decisions

Base `dc51a80c77eb093ec53adfbc51dd501fd7391ef5`. The prior inspection is summarized
in `001_evidence.md`; executable changes and acceptance rows are in
`010_signing_gate.md`.

Architect consultation: `01a0c865-ceac-7191-8e5a-711c23ae4839`.

- D1 accepted: explicit preview/trusted workflow paths and platform selection.
  Main specifies a small `desktop-build-policy.mjs` owner so matrix validation
  and credential preflight have executable tests rather than duplicated YAML JS.
- D2 accepted: await the pinned packager's lazy signing information in afterPack,
  then select and use the same keychain and Developer ID identity for sidecars.
  Main amendment D2a retains the existing native security lookup instead of a
  runtime app-builder-lib import. Root CI does not install desktop dependencies;
  this keeps the hook testable there. CSC_NAME follows the outer builder's
  supported qualifier/hash selection; certificate-type-prefixed full names fail
  clearly rather than succeeding in the hook and failing during outer signing.
- D3 accepted: native identity/team/architecture verification of original and
  exported applications, with portable JSON proof and final installer hashes.
- Existing GHA credentials are tested before any extraction or replacement.
  macbookpro2's key was proven usable in the same SSH session as an interactive
  keychain unlock. No credential migration is needed merely to repair CI order.
- Architect reflection: initial D1-D3 ALIGNED; D2a identified an outer-builder
  selector mismatch and missing acceptance rows. Both were folded into revision
  3, which the same architect marked ALIGNED with no remaining gaps. Independent
  A audit found three gaps; revision 4 folds all three into D1/D3 and records the
  builder import-failure cleanup limit. The same architect marked revision 4
  ALIGNED with no remaining reflection gaps. The same independent A reviewer
  re-audited revision 4 and returned PASS, zero blockers. Main accepts that verdict.

A reviewer `01a0c879-aab6-76c2-b98f-06d3c4d9d889` dispositions:
1. Accepted: dispatch-on-tag publication now requires explicit dispatch publish.
2. Accepted: expected bundle ID/version plus original/export CDHash comparison.
3. Accepted: import-failure cleanup boundary and mount/extraction failure rows.
The optional FAT64 recommendation was accepted and its constants verified in the
macbookpro2 SDK's mach-o/fat.h. No blocker was waived or relabeled as a pass.

## Security model and control limits

Assets are the Developer ID private key, Apple notarization credentials, and
installer integrity. Inputs are GitHub event/ref/platform/publish values, the
five existing encrypted secrets, and locally built application archives.
PR code is an untrusted preview boundary: it receives no signing/notarization
secrets. Trusted explicit dispatch/tag events may use the existing credentials.
The builder owns its temporary keychain creation and cleanup. This unit does not
copy private keys into source artifacts or weaken the user's login keychain.
Successful imports register builder cleanup; a failed import can occur before
registration in the pinned builder. Real CSC_LINK import for this task runs only
on disposable GitHub-hosted macOS, whose destruction is that failure's final
cleanup boundary. Local recovery uses the existing identity in one unlocked SSH
session and does not import/export a credential package or alter keychain lists.

The build policy, hook and native verifier are executable CI controls, not a
repository-administrator security boundary. A maintainer able to modify trusted
workflow/code can change those controls; direct manual commands can bypass CI.
Residual risk is recorded rather than claiming an unbypassable system. Within
the reviewed workflow, verification failure blocks installer upload and the
release job; `continue-on-error` and unsigned fallback are prohibited there.

## Verifier baseline

- Existing `desktop/scripts/verify-mac-signature.mjs` executed against its absent
  default app on Windows: exit 1, correctly reporting missing bundle. It observes
  the app path directly; positive native verification requires macOS.
- macbookpro2 native codesign probe failed while locked, then passed signing and
  strict verification with a Developer ID authority and secure timestamp in the
  same unlocked SSH session. This is key usability proof, not app release proof.
- Desktop Build workflow ID `362523453` is active. Signed dispatch will use
  `--ref <audited branch>` with `platform=mac,publish=false`; publication remains off.
- New policy/hook/verifier tests are planned, not yet executed. Existing root
  runner `scripts/run-tests.mjs` discovers `tests/*.test.{js,ts,mjs,...}`; new
  TypeScript tests join its inventory and typecheck configuration.

## Implementation and portable checks

- Implemented D1, D2a and D3 in the existing owners and the two scoped scripts.
- Independent C reviewer `01a0c89f-46ee-7810-b086-f74f01ade011` reviewed all 15
  changed files and returned PASS. The later cleanup precision delta also passed
  its independent re-review with two focused checks.
- Main verified 79 focused tests, source/test typechecks, server/CLI/UI builds,
  inventory, structure checks and whitespace. Full root suite: 3,621 passed,
  zero failed, seven existing skips (3,628 total).
- Cleanup identity checks use bigint stats. A real Windows inode exceeded the
  safe integer range; incrementing its Number representation was invisible.
  The injected inode-change regression failed before the bigint correction and
  passed afterward, preserving the directory and withholding successful hashes.
- macbookpro2's real read-only DMG attach/detach probe passed. The explicitly
  created mountpoint remained after detach, matching collector cleanup behavior.
- Actual ima2 Developer ID signing, notarization, exported-app checks and PR CI
  remain pending. Unit doubles and the tiny key probe are not app-release proof.
