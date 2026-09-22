---
created: 2026-09-22
updated: 2026-09-22
tags: [ima2-gen, desktop, macos, arm64, updater, electron]
---

# 030 — Apple Silicon 자동 업데이트

Status: complete (2026-09-22)

## Scope

IN:

- packaged `darwin/arm64`에서만 활성화되는 `electron-updater` controller.
- 앱 시작 후 background check와 macOS 앱 메뉴의 `Check for Updates…` 수동 check.
- 사용자 동의 기반 다운로드, 다운로드 후 재시작 확인, 서버 graceful stop 뒤 설치.
- GitHub provider, `desktop-v` tag prefix, draft release, `latest-mac.yml` 생성 계약.
- 실제 app package인 root `package.json`의 버전·production dependency 소유권 복구.

OUT:

- 자동 다운로드, 자동/강제 종료, 주기 polling, staged rollout UI.
- 실제 tag push, GitHub Release 생성·공개, Apple notarization 실행.
- Windows/Linux updater, settings page 또는 tray updater 항목.

## External contract evidence

- electron-builder v26 공식 문서는 macOS auto-update에 서명된 앱과 ZIP target이 필요하고,
  ZIP이 없으면 `latest-mac.yml`이 생성되지 않는다고 명시한다.
- 공식 two-package 문서는 `directories.app`이 가리키는 app package가 production
  dependencies와 `version` metadata의 소유자라고 명시한다. 현재 app은 저장소 루트다.
- `electron-updater@6.8.9` registry metadata는 공식 electron-builder 저장소를 가리키고,
  장기간 릴리스 이력과 npm signature가 있으며 install script가 없다. 2026-09-22 기준
  latest stable은 6.8.9이고 7.x는 alpha다.
- 6.8.9 API에는 `autoDownload`, `autoInstallOnAppQuit`, `checkForUpdates()`,
  `downloadUpdate()`, `quitAndInstall()`과 update event들이 존재한다.

## Threat model

- 보호 대상: 사용자가 설치하는 앱 bundle과 로컬 ima2 server process.
- 신뢰 경계: 공개 GitHub Release metadata/artifact → signed macOS updater → local app.
- 위협: 개발/타 플랫폼에서 원치 않는 network check, draft/unsigned artifact 노출,
  사용자 동의 없는 download/restart, updater 종료와 기존 `before-quit` handler의 race.
- blast radius: 설치된 모든 Apple Silicon desktop 사용자와 각 사용자의 로컬 server job.

## Necessity and ownership

- do nothing/configure-only는 런타임 check·dialog·graceful install을 제공하지 못해 제외한다.
- Electron built-in updater 대신 이미 builder metadata와 GitHub provider를 소유하는
  `electron-updater`를 재사용한다.
- `desktop/lib/updater.mjs`는 외부 updater event/state/dialog만 소유한다.
- `desktop/lib/app-lifecycle.mjs`는 기존 `main.mjs`의 app/server 종료 순서를 이동해 normal
  quit와 update install을 한 상태 소유자에서 직렬화한다.
- native 메뉴는 기존 `desktop/lib/menu.mjs`, server 종료는 기존 `ServerSupervisor.stop()`을
  재사용한다. 새 settings/tray 상태는 만들지 않는다.

## Diff-level map

| Path | Action | Before | After |
|---|---|---|---|
| `package.json` / `package-lock.json` | MODIFY | updater runtime dependency 없음 | app package production dependency에 exact `electron-updater@6.8.9` |
| `desktop/package.json` / lock | MODIFY | dist가 publish mode를 명시하지 않음 | dist scripts가 `--publish never`; toolchain package에는 updater를 중복 선언하지 않음 |
| `desktop/electron-builder.yml` | MODIFY | `publish:null` | public GitHub `lidge-jun/ima2-gen`, `desktop-v`, draft, update metadata config |
| `desktop/lib/updater.mjs` | NEW | updater owner 없음 | packaged darwin/arm64 guard, event/dialog/download/install controller |
| `desktop/lib/app-lifecycle.mjs` | NEW | `main.mjs`의 boolean shutdown handler | normal quit와 update-install preparation을 직렬화하는 lifecycle owner |
| `desktop/main.mjs` | MODIFY | server start와 menu 뒤 updater 없음 | lifecycle/controller 연결, server start 완료 뒤 background check |
| `desktop/lib/menu.mjs` | MODIFY | updater 메뉴 없음 | mac app menu에 `Check for Updates…` action |
| `.github/workflows/desktop.yml` | MODIFY | tag version을 dev package에서 읽음 | root app version을 읽고 build는 publish를 명시적으로 금지 |
| `tests/desktop-updater.test.ts` | NEW | updater behavior test 없음 | guards, manual/background result, download consent, restart ordering, errors |
| `tests/desktop-app-lifecycle.test.ts` | NEW | update shutdown race test 없음 | normal quit와 update install branch activation |
| `tests/desktop-release-contract.test.ts` | MODIFY | version owner 오판, publish config 미검사 | root version, provider/prefix/draft, no-auto-publish, dependency 위치 계약 |
| `structure/06-infra-operations.md` | MODIFY | updater 후속 범위 | updater/runtime/version/release visibility 운영 계약 |
| roadmap/map/evidence docs | MODIFY/NEW | phase 1~2 상태 | phase 3 상태와 fresh check receipt |

## Execution flow

1. `app.whenReady()` 뒤 lifecycle coordinator와 updater controller를 만든다.
2. controller는 `app.isPackaged && darwin && arm64`일 때만 dependency를 load하고 event를
   연결한다. `autoDownload=false`, `autoInstallOnAppQuit=false`로 설정한다.
3. 기존 server start가 끝난 뒤 background check를 한 번 시작한다. background no-update는
   조용히 끝나고 오류는 log에만 남는다.
4. menu check는 결과와 오류를 dialog로 알린다. update가 있으면 `Download Update` 동의를
   받은 뒤에만 `downloadUpdate()`를 호출한다.
5. `update-downloaded`는 `Restart and Install`을 묻는다. 동의 시 lifecycle coordinator가
   server를 stop/dispose하고 update-install quit를 허용한 다음 `quitAndInstall()`을 호출한다.
6. normal quit는 update-install branch와 분리되어 기존 server stop 후 `app.exit(0)`을 유지한다.

## Conditional-path activation

| Path | Trigger | Observable proof |
|---|---|---|
| inactive guard | unpackaged, non-darwin 또는 non-arm64 | dependency loader/check가 호출되지 않는 unit test |
| background no-update/error | startup check에서 no-update/error | dialog 없음, error log만 존재 |
| manual no-update/error | menu action check에서 no-update/error | 사용자 dialog가 정확히 한 번 표시 |
| consented download | `update-available` dialog response 0 | `downloadUpdate()` 호출; Later면 호출 없음 |
| install restart | `update-downloaded` dialog response 0 | `stop` → `dispose` → `quitAndInstall` 순서 assertion |
| update quit bypass | install preparation 완료 뒤 `before-quit` | event가 prevent되지 않고 normal `app.exit`가 호출되지 않음 |
| metadata generation | unsigned arm64 package | ZIP/blockmap과 `latest-mac.yml` 존재, metadata version=app version |

## Acceptance

1. updater network/API는 packaged Apple Silicon macOS 이외에서 절대 시작하지 않는다.
2. 자동 다운로드와 app quit 시 자동 설치가 모두 꺼진다.
3. background check는 no-update/error dialog를 띄우지 않고 manual check는 결과를 알린다.
4. 다운로드와 재시작은 각각 사용자 동의 뒤에만 실행된다.
5. 설치 전 local server가 graceful stop/dispose되고 기존 `before-quit`가 updater quit를
   가로채지 않는다.
6. builder publish config는 GitHub `lidge-jun/ima2-gen`, `desktop-v`, draft이며 모든 build
   command는 `--publish never`로 업로드를 release job에만 남긴다.
7. root app version이 workflow tag, packaged app, `latest-mac.yml`의 단일 버전 원천이다.
8. focused tests, typechecks, inventory, full suite, high dependency audit, unsigned package
   metadata check와 diff audit가 통과한다.
9. 실제 공개 Release에서의 업데이트 성공은 후속 live release 전까지 완료로 주장하지 않는다.

## Enforcement and bypass

- Tier: E3 runtime guards + E5 repository contracts + E6 release workflow.
- 실행 표면: updater controller, lifecycle controller, electron-builder config, desktop workflow.
- 알려진 우회: workflow/config/test를 함께 약화하거나 관리자가 artifact를 수동 공개할 수 있다.
- 잔여 위험: 공개 GitHub Release의 실제 metadata 접근, Apple signature 검증, 설치 재실행은 live
  두 버전 release가 있어야 완전 검증된다.
- 표현: local behavior와 build metadata 계약을 검증하며 실제 OTA 성공을 보장한다고 표현하지 않는다.
- 최종 enforcement layer: macOS code signature 검증과 GitHub Release visibility; live 검증은 후속.

## Audit record

- 공식 app-directory 계약을 근거로 recalled plan의 `desktop/package.json` dependency와
  desktop version source를 각각 root app package로 수정한다.
- 새 module은 updater external boundary와 app shutdown state라는 두 책임에 한정한다.
- 독립 architect/reviewer 실행 표면이 없어 formal consultation/A audit는 미충족이다. 계획의
  path/import/caller를 직접 재검사하고 RED→GREEN 부정 테스트와 최종 diff self-audit로 보완한다.

## Check commands

```bash
node --experimental-test-module-mocks --import tsx --test \
  tests/desktop-updater.test.ts \
  tests/desktop-app-lifecycle.test.ts \
  tests/desktop-release-contract.test.ts \
  tests/desktop-release-credentials.test.ts
npm run typecheck
npm run typecheck:tests
npm run test:inventory
npm test
npm audit --omit=dev --audit-level=high
npm --prefix desktop audit --omit=dev --audit-level=high
npm --prefix desktop run dist:mac -- --config.mac.notarize=false --config.mac.hardenedRuntime=false
git diff --check
```

Package check는 network publish 없이 실행하고 실제 signing/notarization credential을 사용하지 않는다.

Fresh 결과는 `031_check_evidence.md`에 기록한다.
