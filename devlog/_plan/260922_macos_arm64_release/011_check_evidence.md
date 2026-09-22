---
created: 2026-09-22
updated: 2026-09-22
tags: [ima2-gen, desktop, macos, arm64, verification]
---

# 011 — Apple Silicon 릴리스 계약 검증

## 결과

1단계 계약 구현은 로컬 검증을 통과했다. 실제 데스크톱 번들 생성, Developer ID 서명,
Apple 공증, stapling, GitHub Release 업로드는 이번 단계의 완료 주장에 포함하지 않는다.

## RED → GREEN

- RED: `tests/desktop-release-contract.test.ts` 최초 실행에서 3/3 실패.
  - DMG/ZIP에 x64가 남아 있음.
  - 3-OS matrix가 남아 있음.
  - manual dispatch의 publish 입력이 남아 있음.
- GREEN: 같은 명령 재실행에서 3/3 통과.

## Fresh checks

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run typecheck:tests` | exit 0 |
| `npm run test:inventory` | exit 0; 491 total, 266 contract |
| focused desktop contract | 3 pass, 0 fail |
| `npm run ui:build` | exit 0; Vite production build 생성 |
| `npm test` | 3,549 tests; 3,544 pass, 0 fail, 5 skip |
| YAML parse for desktop workflow/builder config | exit 0 |
| `git diff --check` | exit 0 |

`npm test`의 첫 실행은 빌드 산출물 부재 때문에 기존 health/package smoke가 실패했다.
`npm run build:server`, `npm run build:cli`, `npm run ui:build` 후 원인 테스트 15/15와 전체
suite를 다시 실행해 위 최종 결과를 얻었다.

## Conditional-path activation

workflow의 `Validate desktop release tag` 스크립트를 실제로 실행했다.

- `GITHUB_REF_NAME=desktop-v999.0.0`: exit 1, `Expected tag desktop-v0.1.0` 관측.
- `GITHUB_REF_NAME=desktop-v0.1.0`: exit 0.

## Audit

- CI와 Release upload 목록에 `.exe`, `.AppImage`, `.deb`가 없다.
- workflow에 `dist:win`, `dist:linux`, `matrix.*` 참조가 없다.
- `electron-builder.yml`의 `win`/`linux` 설정은 유지됐다.
- signing/notarization optional-secret 분기는 변경되지 않았다.
- 외부 architect/reviewer 실행 표면이 없어 독립 검토는 수행하지 못했다. 계약 테스트,
  전체 suite, source-of-truth 동기화와 수동 diff 감사가 이 단계의 대체 증거다.
