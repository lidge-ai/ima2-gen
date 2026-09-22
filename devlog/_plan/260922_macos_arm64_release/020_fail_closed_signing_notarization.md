---
created: 2026-09-22
updated: 2026-09-22
tags: [ima2-gen, desktop, macos, signing, notarization, github-actions]
---

# 020 — Fail-closed 서명·공증 gate

## Scope

IN:

- `.github/workflows/desktop.yml`: candidate/release 경계, release secret 사전검사,
  release 전용 서명·공증 build, 업로드 전 signature/stapling 검증.
- `desktop/scripts/assert-release-credentials.mjs`: 필요한 환경변수 이름의 단일 소유자와
  값 비노출 fail-closed CLI.
- `tests/desktop-release-contract.test.ts`: workflow 단계·조건·secret 노출 범위 계약.
- `tests/desktop-release-credentials.test.ts`: guard의 성공, 누락, 공백, 비밀값 비노출 부정 테스트.
- `structure/06-infra-operations.md`: 운영 source of truth 동기화.

OUT:

- secret 값 생성·교체·조회.
- App Store Connect API key 방식으로의 자격증명 전환.
- 자동 업데이트 런타임.
- 실제 태그, GitHub Release, Apple notarization 실행, 원격 push.

## Threat model

- 보호 대상: Developer ID 인증서/암호, Apple 공증 계정 자격증명, 사용자가 받는 desktop artifact.
- 신뢰 경계: GitHub Actions secret 주입에서 electron-builder package 및 Release artifact 전달까지.
- 위협: 일부 secret 누락 시 unsigned/unstapled artifact가 성공처럼 업로드되는 것, secret이
  candidate·설치 단계 또는 로그에 노출되는 것.
- blast radius: signing credential과 모든 desktop release 사용자.

## Diff-level map

| Path | Action | Before | After |
|---|---|---|---|
| `desktop/scripts/assert-release-credentials.mjs` | NEW | secret 완전성 소유자 없음 | 5개 변수의 비어 있지 않은 값을 검사하고 성공 시 `MAC_RELEASE_READY=true`만 `GITHUB_ENV`에 기록 |
| `.github/workflows/desktop.yml` | MODIFY | 하나의 build가 secret 존재 여부에 따라 optional notarization | candidate는 secret 없이 unsigned, tag release는 guard 통과 후 `notarize=true`, 검증 뒤 upload |
| `tests/desktop-release-contract.test.ts` | MODIFY | arm64/tag/artifact만 검사 | candidate/release 조건, secret 주입 범위, 검증 순서를 추가 검사 |
| `tests/desktop-release-credentials.test.ts` | NEW | guard 부정 계약 없음 | 전체 존재 성공, 각 누락/공백 실패, 값 비노출 검사 |
| `desktop/electron-builder.yml` | MODIFY | 주석이 optional 자동 활성화로 설명 | 기본 `notarize:false`와 release CLI override 책임을 설명 |
| `structure/06-infra-operations.md` | MODIFY | optional-secret 후속 범위로 기록 | fail-closed release와 unsigned candidate 운영 계약 |
| `devlog/_plan/README.md` | MODIFY | 1단계만 완료 | 2단계 진행/완료 상태 |
| `structure/07-devlog-map.md` | MODIFY | 1단계만 설명 | 2단계 계약까지 설명 |

## Execution flow

1. 모든 build는 checkout과 Node setup까지만 공통으로 수행한다.
2. PR/manual candidate는 secret을 받지 않고 `MAC_RELEASE_READY=false`와
   `CSC_IDENTITY_AUTO_DISCOVERY=false`, `notarize=false`, `hardenedRuntime=false`로 package한다.
3. `desktop-v*` push는 다섯 secret을 guard 단계에만 주입한다. 하나라도 비었으면 변수 이름만
   출력하고 package 전에 실패한다.
4. guard 성공 시 signed build 단계에만 같은 secret을 주입하고 `notarize=true`로 package한다.
5. release build는 기존 `verify:mac-signature`를 통과한 뒤에만 artifact upload가 실행된다.

## Conditional-path activation

| Path | Trigger | Observable proof |
|---|---|---|
| candidate | release tag가 아닌 event | workflow AST에서 secret env가 없고 unsigned/notarize/hardened runtime false command가 존재 |
| release credential success | 다섯 변수가 모두 non-whitespace | guard exit 0, `GITHUB_ENV`에 `MAC_RELEASE_READY=true` 기록 |
| release credential failure | 각 변수 누락 또는 whitespace | guard exit 1, stderr에 누락 이름만 존재하고 제공 값은 없음 |
| release artifact verification | `MAC_RELEASE_READY=true` | build와 upload 사이 `verify:mac-signature` 단계가 release-only 조건으로 존재 |

## Acceptance

1. required credential은 `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` 정확히 다섯 개다.
2. tag release는 하나라도 누락/공백이면 package 전에 exit 1이다.
3. candidate step에는 위 secret expression이 하나도 없고 signing auto-discovery, notarization,
   hardened runtime이 꺼진다.
4. release build는 다섯 secret을 받으며 `--config.mac.notarize=true`를 명시한다.
5. release artifact upload 전에 `npm --prefix desktop run verify:mac-signature`가 실행된다.
6. guard의 오류에는 누락 변수 이름만 있고 설정된 secret 값은 출력되지 않는다.
7. 실제 Apple 공증 성공은 tag CI 실행 전까지 완료로 주장하지 않는다.

## Enforcement와 우회 가능성

- Tier: E5 repository contract + E6 GitHub Actions runtime.
- 실행 표면: credential guard, desktop workflow, signature verifier.
- 알려진 우회: workflow/test를 같은 변경에서 약화하거나 관리자가 Release에 수동 업로드할 수 있다.
- 잔여 위험: GitHub environment protection과 required checks 설정은 저장소 밖 상태이며, 실제
  secret 유효성·Apple 서비스 응답은 live tag run에서만 증명된다.
- 표현: 이 변경은 version-controlled release pipeline을 fail-closed로 만들지만 GitHub 관리자
  권한까지 막는 절대 enforcement는 아니다.
- 최종 enforcement layer: GitHub Actions job 실패와 repository/environment 권한; 후자는 범위 밖.

## Audit disposition

- 기존 `verify-mac-signature.mjs`를 최종 artifact verifier로 재사용한다.
- secret은 credential guard와 signed build 두 단계에만 좁혀 주입한다.
- job 전체나 install/prepare step에 secret을 두지 않는다.
- architect/reviewer 도구가 없어 독립 P/A 감사는 미충족이다. 이 공백은 focused negative tests,
  full suite, secret scan, 수동 workflow data-flow 감사로 보완하되 독립 검토로 표현하지 않는다.

## External contract sources

- [electron-builder v26 macOS configuration](https://www.electron.build/v26/docs/mac/):
  CI signing uses `CSC_LINK`/`CSC_KEY_PASSWORD`; Apple ID notarization requires `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- [Apple Developer ID distribution](https://developer.apple.com/developer-id/): direct distribution
  uses Developer ID signing; custom notarization workflows use `notarytool` and `stapler`.

## Check

```bash
node --experimental-test-module-mocks --import tsx --test \
  tests/desktop-release-contract.test.ts \
  tests/desktop-release-credentials.test.ts
npm run typecheck
npm run typecheck:tests
npm run test:inventory
npm test
gitleaks detect --source=. --no-git
git diff --check
```

`gitleaks`는 설치된 경우에만 실행하며 이 단계에서 새 보안 도구를 설치하지 않는다. 실제
Developer ID/Apple 자격증명을 사용하는 build와 notarization은 실행하지 않는다.
