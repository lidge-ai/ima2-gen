# Signing gate implementation plan

Dependencies: existing desktop builder configuration, afterPack Mach-O scanner,
macOS verifier, and the five existing GHA secrets. This is one atomic work-phase.

## File changes and interfaces

1. NEW `desktop/scripts/desktop-build-policy.mjs`:
   export `resolveDesktopBuildPolicy({eventName, platform, publish})` with a
   deterministic existing OS matrix and trusted/preview intent. Allowed platform
   values are all/mac/win/linux; non-dispatch defaults to all. Reject partial
   platform plus publish=true and unknown events/values. Export credential
   preflight accepting an environment object and requiring the five named inputs
   without logging values. CLI modes emit GITHUB_OUTPUT matrix or run preflight.
2. MODIFY `.github/workflows/desktop.yml`:
   add workflow_dispatch platform choice, default all; add prepare job to validate
   inputs and emit matrix; build consumes `fromJSON(needs.prepare.outputs.matrix)`.
   Keep pull_request and tag triggers; never use pull_request_target.
   Replace the current single macOS step and presence fallback with:
   - PR preview: no secret env, discovery=false, notarize=false, publish never.
   - Trusted macOS: exact five secret env values, mandatory preflight, then
     `dist:mac -- --config.forceCodeSigning=true --config.mac.type=distribution
     --config.mac.notarize=true --publish never`.
   Secret-bearing steps and release conditions use GitHub's event/ref/input
   context directly, never a trusted/signed/release flag emitted by PR-controlled
   policy code or matrix data. Trusted signing is explicit workflow_dispatch or
   a push of refs/tags/desktop-v*. A PR cannot opt into signing through outputs.
   - Trusted verification step invokes the new artifact verifier with expected
     APPLE_TEAM_ID, requiring stapling for every app and both architectures.
   - Installer upload occurs only after successful verification for trusted Mac;
   preview and unrelated platform behavior remains explicit. Separate proof
     upload preserves reports, including available failed verification reports;
     failed installers are never uploaded as verified output. Release needs both
   prepare/build and uses exactly `(push AND desktop-v tag) OR
   (workflow_dispatch AND publish=true AND platform=all)` from GitHub context.
   A manual dispatch on a tag with publish=false MUST NOT publish. Partial
   publish is rejected before scheduling. This task never publishes.
3. MODIFY `desktop/build/sign-extra-binaries.mjs`:
   preserve the afterPack owner, Mach-O magic scan and deepest-first order.
   Async identity resolution first awaits `context.packager.codeSigningInfo.value`,
   then runs existing native `security find-identity -v -p codesigning` scoped
   to the returned keychainFile. Parse Developer ID names/hashes, de-duplicate
   identical hashes, and honor CSC_NAME as a hash or matching identity qualifier.
   Reject certificate-type-prefixed full names, as outer electron-builder does;
   do not rewrite global environment or claim such names are end-to-end supported.
   Reject multiple distinct matching identities instead of choosing arbitrarily.
   Do not import app-builder-lib at hook module load: root CI intentionally has
   no desktop dependencies. codesign uses the selected hash and same keychain.
   Preview returns before lazy keychain access. With forceCodeSigning, an unsigned
   override, missing signing API/identity, missing imported keychain when CSC_LINK
   was supplied, wrong certificate type,
   unreadable scanned content or signing failure throws. For an intentional local
   build without CSC_LINK, an existing unlocked login-keychain identity remains
   usable. Builder retains cleanup after successful imports. If import/setup
   rejects before registering its disposer, propagate failure and rely on the
   disposable hosted runner's destruction; do not guess/delete keychains.
   This task performs no real CSC_LINK import on a persistent local machine.
   Include both-endian FAT64 magic values in the existing scanner and fixtures.
4. MODIFY `desktop/scripts/verify-mac-signature.mjs`:
   factor import-safe verification/report logic while preserving the existing CLI.
   Keep combined stdout/stderr probe capture. Require info command success;
   Developer ID authority; expected team; secure timestamp; hardened runtime;
   strict/deep codesign; Gatekeeper; stapled ticket. Read CFBundleExecutable and
   use lipo on that bundle's executable, validating it is a simple bundle filename.
   Expected x64 maps to x86_64; arm64 maps to arm64. Wrong/missing architecture
   fails. Also read bundle identifier, short version and build version; require
   expected appId from electron-builder.yml and version from root package.json.
   Capture the outer CodeDirectory CDHash from a successful codesign information
   probe. Strict/deep verification binds its sealed resources; this signed-content
   fingerprint plus bundle identity/version is compared across exports below.
   Emit a small structured report with explicit check outcomes; failed
   native commands cannot pass by printing plausible success text.
5. NEW `desktop/scripts/verify-mac-artifacts.mjs`:
   verify dist/mac-arm64/ima2.app and dist/mac/ima2.app; require exactly the
   expected versioned arm64/x64 ZIP and DMG exports. Extract each ZIP with ditto
   into an owned temporary directory; attach each DMG read-only and nobrowse at
   an owned mountpoint. Run the same strict verifier on each recovered .app.
   Compare each recovered app's CDHash, bundle identifier, short version and build
   version to that architecture's verified original. Another valid signed app
   with the same team/architecture must still fail when fingerprints differ.
   Expected builder appId is read with the already-installed yaml dependency;
   no new dependency or parallel app-identity constant is added.
   Detach owned mounts before cleaning extraction directories. On detach failure
   or an uncertain mounted state, fail and preserve the owned directory/report;
   never recursively delete a mounted volume. Cleanup failures never turn success.
   No app is executed. Only after all checks pass hash installers with SHA-256.
   Persist `dist/signature-proof/` JSON/report evidence with source SHA, ref,
   event, run ID, attempt, each archive's identity/architecture checks and hashes.
   Failed/missing output still produces a failed report and nonzero exit.
6. MODIFY `desktop/electron-builder.yml` comments to describe the trusted CLI
   flags, preview opt-out, and hook/keychain ordering. Keep pinned versions.
7. NEW focused tests under `tests/desktop-signing-policy.test.ts`,
   `tests/desktop-sign-extra.test.ts`, `tests/desktop-mac-verification.test.ts`.
   Use existing node:test, parsed YAML and controlled native-command doubles;
   exercise real script interfaces and actual temporary Mach-O-shaped files.
   Add no test-only production branch. Update test inventory.
8. MODIFY README desktop signing instructions and
   `structure/06-infra-operations.md` with trusted vs preview, mac-only dispatch,
   required inputs, native proof, and no-publication recovery procedure.

## Field chain

- platform: dispatch input -> policy validation -> matrix output JSON ->
  workflow fromJSON -> scheduled target jobs. No persistence beyond run metadata.
- publish: existing input -> policy validates all-platform constraint -> existing
  release job condition. False must never schedule release publication.
- keychainFile/identity hash: builder's imported signing info -> hook lookup ->
  each codesign invocation; not exported in public proof as credential material.
- expected team/arch: trusted workflow and fixed architecture matrix -> verifier
  inputs -> actual native comparison -> check results/report. Team is public
  certificate metadata; no secret value other than public team metadata is output.
- proof: verifier check outcomes -> JSON -> workflow artifact; archives are read
  back and hashed only after their contained app passes native checks.

## Reachable acceptance rows

| Trigger | Required observation |
|---|---|
| PR build, even with process env containing unrelated credentials in a test | Preview workflow injects none; hook never evaluates lazy signing info; unsigned preview explicit |
| Trusted mac dispatch, publish=false | Only mac job scheduled; release skipped; successful actual arm64/x64 signing and notarization proof |
| Each one of five signing inputs missing | Preflight nonzero before packaging, names only in diagnostic |
| Invalid platform or partial platform publish=true | Prepare fails; no build/release jobs |
| Manual dispatch on either branch or desktop-v tag, publish=false | Release skipped regardless of ref prefix |
| Manual all-platform dispatch publish=true, or an actual desktop-v tag push | Existing release behavior allowed only by explicit direct event condition |
| Deferred lazy keychain import | Identity lookup/signing waits; same returned keychain used for lookup and every binary |
| Root-only test environment without desktop node_modules | Hook imports successfully using built-in modules only |
| CSC_NAME hash or supported qualifier | Hook selects the matching identity; outer builder accepts the unchanged selector |
| Certificate-type-prefixed CSC_NAME | Clear failure before sidecar signing; no false end-to-end compatibility claim |
| Same identity hash listed more than once | De-duplicated and signed once per binary |
| Multiple distinct matching identity hashes | Fail with an ambiguity diagnostic; no arbitrary selection |
| CSC_LINK supplied but imported keychain absent | Fail before any sidecar signing |
| Local build without CSC_LINK and one unlocked Developer ID | Prepared default-keychain lookup remains usable; no forced credential migration |
| Missing/wrong identity, unreadable Mach-O/tree, signing command fails | Forced signing fails; no silent unsigned fallback |
| Extensionless Mach-O mixed with ordinary files | Mach-O signed and strictly checked; ordinary files not signed |
| FAT64 magic in either endianness | Classified and signed rather than silently ignored |
| Native info exits nonzero with plausible certificate text | Verification fails |
| Wrong team/arch, ad-hoc/development identity, missing runtime/timestamp | Verification fails |
| Broken nested signature, Gatekeeper rejection or missing staple | Verification fails |
| One architecture or an exported archive missing/invalid | Entire artifact gate fails; other architecture success insufficient |
| ZIP/DMG recovered .app differs or fails native checks | No successful proof/installer upload |
| Recovered app passes native checks but has different CDHash or bundle identity/version | Export-equivalence check fails |
| Keychain import/setup promise rejects | Hook fails before lookup/signing; no guessed keychain deletion; hosted destruction is documented fallback |
| Extraction or signature verification fails | Owned temporary content cleaned when unmounted; failed report retained; no installer upload |
| DMG detach fails or mount state is uncertain | Fail; retain owned mount directory and report, no recursive deletion through mount |
| Valid exported apps for both architectures | Native checks, expected identities, source binding and final installer hashes exported |

## Execution and evidence

Run focused script/YAML tests and typechecks locally; then independent review and
PR CI. Use the active workflow ID on the audited feature ref to run mac-only
nonpublishing signing. Inspect successful notarization, native reports and
exported app proof before claiming signing recovery. If existing GHA auth fails,
diagnose it and only then recover the matching credential through the authorized
Mac session; never rotate, erase or broadly export the user's credentials.

Main owns credential operations, final signing dispatch and dev merge. A bounded
executor may implement this audited file set; it receives no passwords or keys.
