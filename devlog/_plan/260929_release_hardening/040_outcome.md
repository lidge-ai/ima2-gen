# 040 Outcome — v3.24.1 through the hardened pipeline

v3.24.1 is live on every channel, and each tag was pushed by the pipeline (v3.24.1 by the tag job,
desktop-v3.24.1 by scripts/release.mjs as the admin maintainer), not by hand. Getting there took
three stops, and each one became a fix.

| Channel | Evidence |
|---|---|
| npm latest | `ima2-gen@3.24.1`, gitHead `d71f73cbb68fff662a1802154a5c9e6fb0b9c82f` (publish run 36586105008 on ref v3.24.1) |
| GitHub release | `v3.24.1` Latest, assets release-manifest.json + sbom.cdx.json |
| Desktop | `desktop-v3.24.1` published (desktop.yml 36581120764, event push, one run): dmg, zip, win x64/arm64 exe, linux AppImage/deb x64/arm64, latest*.yml, SHA256SUMS.txt |
| Pages | pages.yml 36587153586 success; the live site resolves "Download for Mac (Apple Silicon)" to desktop-v3.24.1 |
| dev | `bb3cff29 [agent] chore: land release v3.24.1 on dev` (land-dev merge) |

What happened, in order:

1. Release 36567557657: the main push CI for the promotion commit was red on Windows only
   (EBUSY in a temp DB cleanup, then a timing flake). The cut refused to reuse it. Two reruns of the
   failed jobs turned it green (run 36567549865 attempt 3). Follow-up: wp4.
2. Release 36573038192: version commit d71f73cb on main and preview, preview package published at
   13:27Z, but npm answered E404 for over 15 minutes, so the registry proof and the cut failed
   before tagging. Fix #344: resume mints a missing tag from the preview-proven version commit;
   registry window 35 minutes.
3. Resume 36580960098: minted v3.24.1, landed dev, release.mjs pushed desktop-v3.24.1. The stable
   publish ran on main (a086d88a) and its package smoke compared the tarball with that SHA.
   Fix #346: dispatch publish.yml on the published ref; the smoke reads PUBLISH_SHA.
   desktop-production was approved with the same API call --approve makes, because release.mjs
   stops watching after a failed run.
4. Resume 36586040061: stable publish on ref v3.24.1 succeeded, Pages deployed, release.mjs ended
   on "Desktop release desktop-v3.24.1 is published."

Promotions: #343, #345, #348 (a locally merged promotion branch, because dev and main had each
merged d71f73cb and 8bc7f98d and GitHub could not build that merge), #349.

What did not improve: CI still cannot create desktop-v tags by itself (org deploy keys are off and
the Actions app cannot bypass a repo ruleset), so a release needs an admin running release.mjs.
The 3.24.1 package predates #344 and #346; those are pipeline-only changes and apply from the next
release. structure/06-infra-operations.md still says the updater is macOS-only; the code covers
Windows installers and AppImage.
