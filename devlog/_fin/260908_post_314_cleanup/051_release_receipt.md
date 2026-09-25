# 051 release receipt — v3.15.0 (2026-09-08)

## Delivery
| PR | Merge | Scope |
|---|---|---|
| #221 | 9ebd765e -> dev | hygiene: CHANGELOG 3.14.0 cut, 260905 unit archived, 51 no-op rethrows removed, AGENTS.md convention |
| #220 / #194 / #195 / #222 | b7997058 / 32c83129 / e187f075 / 99c03615 -> main | dependabot (actions, @xyflow/react, @openai/codex 0.152.0 + openai + sharp + zod 4.5.4, node-gyp + tsx); #196 superseded by #222 |
| #223 | aa2339c0 -> dev | main synced into dev |
| #224 | a2de1110 -> dev | NAI V5 battery quota lane + 402 split; issue #193 closed |
| #225 | d42678f9 -> dev | adapter-owned execution, api/grok-api/gemini-api descriptors; issue #150 re-measured, open |
| #226 | 9f87bd1c -> dev | CHANGELOG 3.15.0 cut |
| #227 | 7fc27f55 -> main | dev -> main promotion (exact-head ci.yml dispatch 34162146580 green after one Windows EBUSY teardown flake rerun) |

## Release
- release.yml run 34164089396 (bump=minor, dry_run=false, expected_sha=7fc27f55): cut b96a11ed, candidate CI gate green, preview published, tag job approved via pending_deployments (npm-stable 19898997367), atomic push of main/dev/preview + tag.
- publish.yml stable run 34167194583 (publish_ref refs/tags/v3.15.0, publish_sha b96a11ed): publish-stable approved via pending_deployments; success.
- R = b96a11ed8a46c5782e673b5eeb61129d9f3aee9d; origin/main = origin/dev = origin/preview = v3.15.0 = R.
- npm: latest 3.15.0 (gitHead R, integrity sha512-gNOuyIdRffCmqcfRrP1A9PgaZGxSbmfEzwZJtoqPy0gp6gT7lTiQNiqn7BfQsojwzbV5lvTQHRnWHIKD2JbPmQ==), preview 3.15.0-preview.260907.34165674345.1 (gitHead R).
- `node scripts/release-contract.mjs finalize-check 3.15.0 R` exit 0 (signatureVerified true, runId 34167194583).
- GitHub release https://github.com/lidge-ai/ima2-gen/releases/tag/v3.15.0 (main, not draft, not prerelease).
- Rollback baseline recorded before dispatch: 3.14.0 @ 36aa6fce, integrity sha512-VBL8fh14xEV1i4Y++BGdc/wS+5JruJzTSeJ/rCTOh56RGzwQtJ2NHM5R3uDdNSrJYA6ubWoWy+2GL+J2wLFlbQ==.

## Artifact proof
- `npm pack ima2-gen@3.15.0`: 6151475 bytes, integrity equals registry and publisher release-manifest.json (verify-artifact exit 0).
- `GITHUB_SHA=R IMA2_PACKAGE_TARBALL=... node --test tests/package-install-smoke.mjs`: 1 pass, exit 0 (Node 24.17.0 / npm 11.18.0).
- Global install into an isolated prefix: `ima2 --version` = 3.15.0; served on 127.0.0.1:18797 with isolated HOME/config/generated; `/api/health` version 3.15.0; `/api/quota` nai lane from a local fixture.

## Pages
- pages.yml run 34167873788 (--ref main, release_sha R, release_version 3.15.0): build + deploy success.
- Deployed installers byte-equal to `R:site/public/*`: install-mac.sh c4c4a364c10bcfa6, install-linux.sh 2d5d02b72565311e, install-windows.ps1 1ff45d33a672f877 (sha256 prefixes).

## Visual evidence (.codexclaw/evidence/01a07ce8-b02b-7200-9bfc-300c549d3c70/)
- wp3-settings-novelai-card.jpg 0d40670599b9c19e (dev build, fixture quota)
- wp5-published-3.15.0-home.jpg d021ac99f115c604
- wp5-published-3.15.0-settings-novelai.jpg af67c874392a4e06 (published build: Ready chip, Tier 3, 37% amber bar, "+1% in 132 min", "Anlas: 4000 + 50")
- wp5-published-3.15.0-node-graph.jpg eb5cc595e94ff44a
Screenshots use a dummy token against a local fixture; they prove rendering, not a live NovelAI account.

## Residuals
- #150 stays open (UI provider switches 10+1, packages/ extraction, oauth/grok/agy descriptors need async readiness).
- API_REQUEST_POLICY applies to loopback (600 req / 120 mutations per minute per peer): follow-up note, no change made.
- Windows ci.yml job hit an EBUSY sessions.db unlink flake in tests/structured-filename-pipelines.test.ts on the promotion dispatch; rerun passed. Worth a bounded retry in that fixture's teardown.

