---
created: 2026-09-22
updated: 2026-09-22
tags: [ima2-gen, desktop, macos, arm64, github-actions]
---

# 010 — Apple Silicon 빌드·릴리스 계약

## Scope

IN:

- `desktop/electron-builder.yml`: mac DMG/ZIP 아키텍처를 arm64 하나로 제한.
- `.github/workflows/desktop.yml`: Apple Silicon macOS 단일 job, Mac artifact allowlist,
  태그 전용 Release, package version 일치 검사.
- `tests/desktop-release-contract.test.ts`: 위 계약의 YAML AST 회귀 테스트.
- `structure/06-infra-operations.md`: 운영 source of truth에 데스크톱 릴리스 계약 반영.

OUT:

- 비밀값 존재를 요구하는 fail-closed 서명/공증.
- `electron-updater`와 업데이트 UI.
- Windows/Linux builder 설정 삭제.
- 실제 DMG 생성, 공증, 태그 생성, GitHub Release 업로드, 원격 push.

## Diff-level map

| Path | Action | Before | After |
|---|---|---|---|
| `desktop/electron-builder.yml` | MODIFY | DMG/ZIP `arm64, x64` | DMG/ZIP `arm64` |
| `.github/workflows/desktop.yml` | MODIFY | 3-OS matrix, dispatch publish, 모든 OS artifact | `macos-15` 단일 build, dispatch build-only, tag-only release, Mac arm64 artifact |
| `tests/desktop-release-contract.test.ts` | NEW | 계약 없음 | builder/workflow 구조와 금지 artifact를 검증 |
| `structure/06-infra-operations.md` | MODIFY | npm 릴리스만 설명 | 별도 데스크톱 arm64 계약 추가 |

## Acceptance

1. mac DMG와 ZIP의 arch 배열은 각각 정확히 `[arm64]`다.
2. workflow build job은 `macos-15`이며 matrix, Windows/Linux build 명령이 없다.
3. CI/Release artifact는 DMG, ZIP, blockmap, `latest-mac.yml`만 허용한다.
4. `workflow_dispatch`는 build만 하고 Release job은 실행하지 않는다.
5. Release 전에 `GITHUB_REF_NAME === desktop-v${desktop/package.json.version}`를 검사하며
   불일치 시 `exit 1`이 관측된다.
6. `win`/`linux` builder 설정은 그대로 존재한다.
7. 서명·공증의 기존 optional 동작은 이 단계에서 바뀌지 않는다.

## Check

```bash
node --experimental-test-module-mocks --import tsx --test tests/desktop-release-contract.test.ts
npm run typecheck:tests
npm run test:inventory
npm test
git diff --check
```

실제 macOS 설치기/서명/공증 결과는 이 단계의 주장이 아니므로 desktop bundle build는 완료
증거에 포함하지 않는다. 이번 변경은 YAML/cloud pipeline 계약이라 정적 계약 테스트가 직접
변경 대상을 읽는다.
