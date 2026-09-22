---
created: 2026-09-23
updated: 2026-09-23
tags: [ima2-gen, desktop, macos, release, reconciliation]
---

# 050 — #258 서명 게이트 위로 재정렬

Status: complete (repository contract); production Environment, tag ruleset and live release pending

## 왜 다시 맞췄나

1~4단계를 로컬 `dev` 위에서 진행하는 동안, 별도 세션이 PR #258
`Require verified macOS signing and notarization` (branch `codex/macos-signing-gate`)을
`dev`에 병합했다. 두 작업은 같은 파일을 다르게 고쳤고 테스트 수준에서 서로를 부정했다.

| | #258 (병합됨) | 1~4단계 (로컬) |
|---|---|---|
| 빌드 대상 | mac(arm64+x64), win, linux 매트릭스 | macos 단일, arm64 전용 |
| 검증 | 원본 + 내보낸 DMG/ZIP 대조, 소스 결박 증명 | 번들 서명만 |
| 릴리스 | 단일 job, `desktop/package.json` 버전 | Draft → 승인 → 공개 |
| 업데이터 | 없음 | electron-updater, 사용자 승인 설치 |

사용자 결정은 "지금은 Apple Silicon 전용, 멀티플랫폼은 나중"이다. 강제 푸시로 #258을
되돌리지 않고, #258을 기반으로 재구현했다.

## 통합 결정

- **#258의 검증을 채택했다.** `verify-mac-artifacts.mjs`는 원본과 내보낸 설치본을 모두
  확인하고 git HEAD에 결박된 증명과 설치본 SHA-256을 낸다. 4단계의 자체
  `release-verification.json` receipt와 `assert-release-credentials.mjs`는 이보다 약하므로
  폐기하고 증명을 소비하도록 바꿨다.
- **아키텍처 목록을 `electron-builder.yml`에서 파생시켰다.** 검증기가 두 번째 목록을 들고
  있으면 나중에 멀티플랫폼으로 되돌릴 때 드리프트가 생긴다. 미지정이면 기존처럼 두 아키텍처를
  요구해 fail-closed를 유지하므로, #258의 검증 테스트 52건은 수정 없이 통과한다.
- **매트릭스 기계장치는 살렸다.** 예약 이벤트만 mac으로 좁히고 win/linux는 수동 dispatch로
  남겼다. 멀티플랫폼 재개는 정책 재작성이 아니라 설정 변경이다.
- **게시는 태그 전용으로 좁혔다.** dispatch publish를 없앴다. 태그만이 버전을 고정하고
  ruleset으로 보호할 수 있는 ref다.
- **태그 버전 출처를 고쳤다.** #258의 release job은 `desktop/package.json`(0.1.0)에서 버전을
  읽어 실제 태그와 다른 릴리스를 만들었다. `directories.app: ..` 때문에 패키징되는 앱은 루트
  manifest이므로 루트 버전과 정확히 일치해야 한다.

## 검증

| Check | Result |
|---|---|
| `tests/desktop-*.test.ts` | 106 pass, 0 fail |
| #258 검증 테스트 (`desktop-mac-verification`) | 52 pass, 수정 없음 |
| workflow shell 시뮬레이션 | 5 pass, 병합된 workflow에서 수정 없이 통과 |
| `npm run typecheck` / `typecheck:tests` | exit 0 |
| `npm test` | 아래 041 이후 재실행 결과 참조 |

## 남은 것

- `desktop-production` Environment와 `desktop-v*` tag ruleset 설정(소유자 admin 필요).
  명령은 `040_release_workflow_cleanup.md`에 있다.
- `main`에는 아직 desktop 코드가 없다. 첫 릴리스는 desktop 작업이 포함된 새 버전을
  릴리스 트레인으로 자른 뒤 그 커밋에 `desktop-v<version>` 태그를 다는 순서다.
- 실제 서명·공증·승인·공개와 두 버전 live update는 미검증이다.
