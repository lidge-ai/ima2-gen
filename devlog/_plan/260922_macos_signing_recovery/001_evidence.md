# Initial evidence

- Prior Desktop Build `35507323386`, attempt 1, event pull_request: both macOS
  architectures logged no Developer ID identity and PR signing skipped, despite
  `notarize=true`. No Accepted/stapling completion proof was present.
- The existing verifier performs codesign/Gatekeeper/staple checks but is not
  called by `.github/workflows/desktop.yml`; smoke merely lists output files.
- GHA already stores MAC_CSC_LINK, MAC_CSC_KEY_PASSWORD, APPLE_ID,
  APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID (updated 2026-09-20). Values were not
  printed or retrieved from the GitHub API.
- macbookpro2 Developer ID certificate SHA-1 is
  `94E152BFF6CC21ABD4275A89CA418AAF8B484B99`, team U9ATA49N28, valid through 2031.
  Certificate presence alone was not treated as private-key usability.
- SecKeychainGetStatus reported unlocked=false. codesign failed with
  errSecInternalComponent. Unlocking in one SSH connection and signing in another
  retained the failure. Unlocking and signing in the same connection passed,
  including timestamp and strict signature verification. No password was put in
  command arguments or files; no global keychain policy was changed.
- This rejects missing/destroyed identity and a necessary timestamp-network
  failure as explanations of the probe. The SSH security-session lifetime is
  material to using the already-present key.

Pinned electron-builder 26.16.1 evidence was checked in its installed public
declarations and implementation. `MacPackager.codeSigningInfo.value` imports
CSC_LINK lazily and retains builder-owned keychain cleanup. `afterPack` precedes
the normal sign stage, so unscoped `security find-identity` can happen before
import. `findIdentity(certType, qualifier, keychain)` is exported by the pinned
`app-builder-lib/out/codeSign/macCodeSign.js` module.

Upstream provenance revision supplied and verified by the architect:
https://github.com/electron-userland/electron-builder/tree/7d3b30f3b15950d19f7c5ff882cf2d161cd3ba2c

Native app signing/notarization is still pending. The successful tiny probe is
not evidence that an ima2 installer is signed, accepted, or stapled.
