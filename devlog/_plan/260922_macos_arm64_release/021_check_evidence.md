---
created: 2026-09-22
updated: 2026-09-22
tags: [ima2-gen, desktop, macos, signing, notarization, verification]
---

# 021 — Fail-closed 서명·공증 gate 검증

## 결과

2단계의 저장소 및 GitHub Actions 계약을 구현하고 로컬 검증을 통과했다. 실제 Developer ID
서명, Apple notarization, stapling, tagged workflow, GitHub Release 업로드는 실행하지 않았으며
완료 주장에 포함하지 않는다.

## RED → GREEN

- RED: focused command에서 8개 중 3 pass, 5 fail.
  - candidate/release 분리 단계와 release credential validation 단계가 없었다.
  - credential guard 파일이 없어 성공·누락·공백 시나리오가 실패했다.
- GREEN: 같은 focused command에서 8 pass, 0 fail.

## Fresh checks

| Check | Result |
|---|---|
| focused desktop release tests | 8 pass, 0 fail |
| `npm run typecheck` | exit 0 |
| `npm run typecheck:tests` | exit 0 |
| `npm run test:inventory` | exit 0; 492 total, 225 runtime, 267 contract |
| desktop workflow/builder YAML parse | exit 0 |
| `npm test` | 3,554 tests; 3,549 pass, 0 fail, 5 skip |
| `git diff --check` | exit 0 |
| repository secret-name lookup | 5 required names present; values were not read |
| `actionlint` | unavailable; not installed during this task |
| `gitleaks detect --source=. --no-git` | unavailable; not installed during this task |

## Conditional-path activation

- 모든 credential이 non-whitespace: guard exit 0, `MAC_RELEASE_READY=true` 기록.
- 각 credential을 하나씩 제거: 모두 exit 1, 누락 변수 이름 관측, 제공된 fake secret 값은
  stderr에 나타나지 않음.
- `APPLE_ID`를 whitespace로 설정: exit 1, ready marker 파일 미생성.
- workflow AST: candidate에는 secret expression이 없고 `notarize=false`,
  `hardenedRuntime=false`; release validation과 signed build에만 다섯 secret이 있으며
  `notarize=true`.
- workflow AST: `verify:mac-signature`가 signed build 뒤, artifact upload 앞에 존재하고
  `MAC_RELEASE_READY == 'true'` 조건을 공유한다.

## Audit

- secret은 job-level, install, prepare, candidate 단계에 노출되지 않는다.
- guard는 secret 값을 비교·출력하지 않고 누락 변수 이름만 보고한다.
- release build 실패 또는 signature/stapling 검증 실패는 뒤의 artifact upload를 막는다.
- 기존 `verify-mac-signature.mjs`의 Developer ID, hardened runtime, timestamp, strict codesign,
  Gatekeeper, stapler 검증을 재사용했다.
- 독립 architect/reviewer 실행 표면이 없어 P/A 독립 검토는 수행하지 못했다. focused 부정
  테스트, 전체 suite, workflow data-flow와 최종 diff 수동 감사가 대체 근거이며 독립 감사로
  간주하지 않는다.
