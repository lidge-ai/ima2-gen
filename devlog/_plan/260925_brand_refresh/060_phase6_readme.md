# 060 Phase 6 — README polish (en, ko, ja, zh-CN, zh-TW)

## README.md outline (after)

1. Centered logo `assets/logo.png` (width 160), one-line tagline, badges (npm, Node ≥22, MIT), site/docs/language links as plain text (drop the emoji markers).
2. One short "what it is" paragraph from the current facts.
3. Existing screenshot.
4. Install — in order: Desktop app for Mac (Apple Silicon, releases link, signed and notarized), one-click install script (existing commands), npm (existing Quick Start); Docker keeps its own subsection.
5. Remaining sections kept, tightened where they run on.
6. Desktop (Electron) section: `npm run dist:mac  # dmg + zip (arm64)`; signature paragraph says arm64 only (desktop/electron-builder.yml:91).

Translated READMEs get the same structural changes (logo path `../assets/logo.png`, install options including the desktop app, arm64 correction). Other translated content stays as is unless the readme gap report shows a factual error.

## Accept criteria

- Link check script over the five READMEs (markdown links and img src that are relative paths must exist) — output captured at C.
- `rg -n "x64" README.md docs/README.*.md` shows no claim that the desktop release ships x64.
- Rendered GitHub preview is not reproducible offline; human review row.


## A round 1 amendments (002) — file change map

| Path | Change |
|---|---|
| README.md | items 1-19 of 001/readme: FAQ anchor, 14 video refs, arm64-only desktop, desktop workflow triggers (push to dev + desktop-v* tags + manual) and inputs (platform only), Grok defaults (planner grok-4.3, image grok-imagine-image-2.0, generation timeout 300000), grok-imagine-image-2.0 in picker text, skill reference counts from `ls`, zh-TW link, CLI quickstart subsection before Docker, stop parenthetical, emoji markers removed, "Install the Mac app" block, logo block |
| docs/README.ko.md | logo block, docs link, install incl. desktop app, 10 core lanes, CLI.md duplicate, Grok defaults where present |
| docs/README.ja.md | logo block, docs link, install incl. desktop app, 14 refs, 10 lanes, heading rename, CLI.md duplicate |
| docs/README.zh-CN.md | 14 refs, alt text, Grok defaults/timeouts, 多变的→变量, 满的→完整, 客户→客户端, 车道→lane, duplicate 设置 heading, self-link→zh-TW, desktop install block |
| docs/README.zh-TW.md | same class as zh-CN, 客戶→用戶端, 車道→lane, counts 21/37, 10 lanes, desktop install block |

Link checker: `node devlog/_plan/260925_brand_refresh/scripts/check-readme-links.mjs` (NEW, unit-local) — resolves every relative `](...)` and `src="..."` in the five files; exit 1 on a missing target.
Counts are recomputed at B with `ls skills/ima2-front/references | wc -l` and `ls skills/ima2-uiux/references | wc -l` rather than copied from the report.

## wp6 P re-verification (HEAD fec80dd0) — final edit list

Verified facts: skills/ima2-front/references = 32 files, skills/ima2-uiux/references = 21 (`ls | wc -l`); core lanes = 10 (oauth, api, grok, grok-api, agy, gemini-api, atlascloud, minimax, nai, comfy — lib/providers/registry.ts); desktop.yml triggers: push to `dev` = unsigned macOS validation build (desktop.yml:114), manual dispatch = signed + notarized build that never publishes (:124, input `platform` only, :8-13), `desktop-v*` tag = build, verify, draft + publish release (:185, :259-262); macOS builds arm64 only (electron-builder.yml:87-95). Grok facts as in 050.

README.md
1. Logo block: new mark (`assets/logo.png`, width 160, alt "ima2") + one-line tagline.
2. Link lines lose the 🌐/📖 markers.
3. Quick Start: new first subsection "Mac app (Apple Silicon)" (releases link, 3 steps, signed + notarized, docs link); the lane-default / `ima2 gen` / `ima2 video` paragraph moves out of "Docker" into its own "Generate from the CLI" subsection before Docker.
4. Updating: parenthetical after the code block.
5. Facts: 14 video refs (line 128); skill counts (143, 151); planner default `grok-4.3` with 4.5/4.6 selectable (173); Grok image default `grok-imagine-image-2.0` (180) and picker sentence (185); config rows planner model, image default, generation timeout 300000 (358-364).
6. Useful references: add zh-TW README.
7. FAQ anchor → `#what-should-i-share-when-gpt-oauth-image-generation-returns-no-image` (docs/FAQ.md:296 heading).
8. Desktop section: arm64 only for dist:mac; trigger/publish paragraph rewritten to the verified triggers; `gh workflow run desktop.yml --ref <branch> -f platform=mac`; verification sentence arm64 only; remove the non-existent `publish` input sentence.

Translations (ko, ja, zh-CN, zh-TW)
- Logo block present and pointing at `../assets/logo.png` (add to ko/ja).
- 🌐/📖 markers removed.
- Mac app install subsection at the top of the install section (translated).
- 8 → 10 core lanes (add NovelAI, ComfyUI), 7 → 14 video refs, planner default grok-4.3, uiux 18 → 21 references where stated.
- zh-CN: 多变的 → 变量, 满的 → 完整, 客户 → 客户端 (CLI client heading), self-link → zh-TW; zh-TW: 客戶 → 用戶端.
- Other translated sections stay as they are (English README is canonical).

Verifier: `node devlog/_plan/260925_brand_refresh/scripts/check-readme-links.mjs` (NEW) exit 0; `rg -n "grok-4\.5\`|x64\)|both arm64 and x64|publish=false|🌐|📖|up to 7 references|最多 7|8 個 core|8 个 core|core lane 8|8 つの" README.md docs/README.*.md` empty; tests/runtime-install-projection.test.ts passes (generated tables untouched).
