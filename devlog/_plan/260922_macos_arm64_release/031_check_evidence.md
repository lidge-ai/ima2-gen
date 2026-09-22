---
created: 2026-09-22
updated: 2026-09-22
tags: [ima2-gen, desktop, macos, arm64, updater, check]
---

# 031 — 자동 업데이트 check evidence

## Outcome

3단계의 저장소·런타임·로컬 패키지 계약은 통과했다. 실제 public GitHub Release의
signed/notarized 두 버전 update는 태그·Apple credential·외부 공개가 필요한 후속 증거이며,
이번 결과에 포함하지 않는다.

## Focused behavior and contract tests

Release toolchain Node `24.17.0`, npm `11.18.0`으로 실행했다.

```text
tests 21
suites 4
pass 21
fail 0
```

검사 범위:

- unpackaged/non-darwin/non-arm64에서 updater dependency와 network check가 시작되지 않음.
- `autoDownload=false`, `autoInstallOnAppQuit=false`.
- background no-update/error는 dialog 없이 종료하고 manual 결과/error는 dialog로 표시.
- `Download Update`, `Restart and Install` 각각의 명시적 사용자 동의.
- update install은 `stop -> dispose -> quitAndInstall` 순서를 보장.
- normal quit와 updater-owned quit의 `before-quit` race 방지.
- root app version, exact updater dependency, GitHub draft provider, `desktop-v` prefix,
  builder `--publish never` 계약.

## Repository verification

```text
npm run typecheck            PASS
npm run typecheck:tests      PASS
npm run test:inventory       PASS (494 files: 225 runtime / 269 contract)
npm test                     PASS (3567 tests, 3562 pass, 0 fail, 5 skip)
npm run audit:gate           PASS (root high+ 0; UI high+ 0 after 2 dated exceptions)
npm --prefix desktop audit --omit=dev --audit-level=high
                             PASS (0 vulnerabilities)
npm ls electron-updater      electron-updater@6.8.9
node --check updater/lifecycle/main modules
                             PASS
git diff --check             PASS
```

`actionlint`와 `gitleaks` 실행 파일은 이 환경에 없어 별도 결과를 주장하지 않는다.
릴리스 workflow의 updater 계약은 `tests/desktop-release-contract.test.ts`에서 YAML을 직접
파싱해 검증했다.

## Unsigned local package proof

실제 release credential 없이 network publish를 금지하고 arm64 package를 생성했다.

```text
electron-builder 26.16.1
app version                  3.16.1
executable architecture     Mach-O 64-bit executable arm64
bundled electron-updater    6.8.9
latest-mac.yml path         ima2-3.16.1-mac-arm64.zip
app-update provider         github / lidge-jun / ima2-gen
releaseType                 draft
tagNamePrefix               desktop-v
```

Artifacts:

```text
ZIP  270,591,037 bytes  sha256 dae7ae5c8846c982db8f39a8f7da525c2a7f423f0d2a76451861c26d8f08f909
DMG  278,814,655 bytes  sha256 de5e6668414e9ab63f09208b23c086b771c881c0931ed69177e2665ff9b7292f
YML          504 bytes  sha256 455f292ef72f7797628bead2a64a1804c1233eaee4262a629f3abaaea490524a
```

`codesign -dv`는 `Signature=adhoc`, `TeamIdentifier=not set`을 보고했고 `spctl --assess`는
후보 앱을 거부했다. 이는 이 검증이 production 서명·공증을 가장하지 않았다는 기대 결과다.

## Native macOS proof

패키지된 `ima2.app`을 macOS에서 직접 실행해 server/UI가 준비되는 것을 확인했다. 앱 메뉴의
활성 항목은 다음과 같았다.

```text
About ima2
Check for Updates…
Settings…
Services
Hide ima2
Quit ima2
```

업데이트 항목은 존재하고 enabled 상태였다. 실제 update action은 누르지 않았다. `Quit ima2`
선택 직후 graceful shutdown이 진행됐고, 다음 상태 읽기에서 bundle id `com.lidge.ima2`가
`isRunning: false`로 확인됐다.

Computer Use transcript summary:

- path: `computer-use`
- action classes: `state-read`, `element-action`, `transcript-summary`
- stale warning: 없음
- result: packaged app launch, updater menu visibility, normal quit 모두 확인

## Residual risk / next proof

- 실제 Developer ID 서명·Apple notarization은 2단계 workflow 계약만 있으며 이번 로컬 build에는
  실행하지 않았다.
- GitHub draft를 공개한 뒤 설치 앱이 metadata를 읽고 signed ZIP을 내려받아 재실행하는 end-to-end
  경로는 두 개의 서로 다른 app version이 필요하다.
- 이 live proof 전에는 OTA 성공이나 운영 배포 완료를 주장하지 않는다.
