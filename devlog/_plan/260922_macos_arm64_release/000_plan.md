---
created: 2026-09-22
updated: 2026-09-22
tags: [ima2-gen, desktop, macos, arm64, release]
---

# 000 — Apple Silicon 전용 데스크톱 릴리스 계약

이 유닛은 데스크톱 배포를 Apple Silicon macOS로 좁히고, candidate와 production
release의 신뢰 경계를 분리한다. 1단계는 arm64 DMG/ZIP과 버전 태그 계약을, 2단계는
Developer ID 서명·Apple 공증의 fail-closed gate를, 3단계는 사용자의 명시적
다운로드·재시작 동의 뒤 설치하는 자동 업데이트 런타임을 완료했다. 4단계는 검증된
자산만 Draft Release에 올리고 보호된 production Environment 승인 뒤 공개하는 릴리스
워크플로를 정리한다.

## Loop spec

- Archetype: dependency-ordered satisfy-spec 4개 work-phase.
- Trigger: 1~3단계 완료 후 릴리스 워크플로 정리를 진행하라는 요청.
- Goal: Apple Silicon 전용 서명·공증 및 updater 계약 위에 Draft와 production 공개를
  분리하는 승인 기반 GitHub Release workflow를 추가한다.
- Non-goals: 실제 태그·Release·push, secret 값 변경, 자동 다운로드·강제 재시작,
  Windows/Linux 패키징 설정 삭제.
- Verifier: focused `node:test`가 updater event 흐름, platform guard, 수동 다운로드,
  graceful shutdown 후 설치, publish/version 계약을 실행한다. production build는
  `latest-mac.yml`과 arm64 ZIP을 생성해야 하며 typecheck, inventory, full suite,
  dependency audit가 함께 통과해야 한다.
- Stop: 4단계 workflow·자산 검증·계약·문서가 통과하고 diff 감사가 끝날 때.
- Memory: 이 문서, `010_arm64_release_contract.md`,
  `020_fail_closed_signing_notarization.md`, `030_automatic_updater.md`와 각 단계 check evidence.
- Terminal outcomes: 통과하면 4번의 저장소·런타임 계약 완료, 실제 Apple 서비스 실행은
  근거와 함께 미검증으로 기록,
  계약 충돌은 구현 중단 후 재계획.
- Escalation: 실제 태그·공증·배포·push 또는 secret 값 변경이 필요하면 사용자 승인을 받는다.

## Work-phase map

1. `010_arm64_release_contract.md` — Apple Silicon 전용 build/release 계약. 완료.
2. `020_fail_closed_signing_notarization.md` — production tag의 자격증명, 서명·공증,
   artifact 검증 gate. 완료.
3. `030_automatic_updater.md` — packaged darwin/arm64 전용 업데이트 확인·다운로드·설치
   수명주기와 GitHub update metadata 계약. 완료.
4. `040_release_workflow_cleanup.md` — 검증 receipt, checksum, exact asset allowlist,
   Draft 생성과 `desktop-production` 승인 후 공개. 완료.

## 근거와 결정

- `desktop/electron-builder.yml`의 mac DMG/ZIP은 각각 `arm64, x64`를 선언한다.
- `.github/workflows/desktop.yml`은 3개 OS matrix와 수동 publish 입력을 가진다.
- `directories.app: ..` 때문에 실제 app package와 패키지 버전은 root `package.json`이다.
  1단계의 `desktop/package.json` 태그 원천 판단은 3단계에서 바로잡는다.
- Windows/Linux builder 설정은 후속 재개 가능성을 위해 남기되, 이번 CI와 Release에서는
  참조하지 않는다.

1단계는 새 helper나 의존성 없이 기존 YAML과 `node:test` + `yaml` 계약 테스트 관례를
재사용했다. 2단계는 workflow shell에 secret 검사를 복제하지 않고, 출력이 비밀값을
포함하지 않는 단일 자격증명 guard를 `desktop/scripts/`에 둔다. 기존
`verify-mac-signature.mjs`가 Developer ID, hardened runtime, timestamp, strict codesign,
Gatekeeper, stapled ticket의 최종 검증 소유자다. 독립 architect/reviewer 실행 표면이 이
세션에 없어 상담과 독립 A 감사는 미충족이며, RED→GREEN 계약·부정 테스트와 주 변경 후
수동 diff 감사를 남긴다. 3단계도 같은 도구 제약 아래 self-audit와 실행 가능한 계약·부정
테스트를 남기며, 이를 독립 검토로 표현하지 않는다. 4단계는 환경 이름만 참조하면 GitHub가
보호 규칙 없이 환경을 만들 수 있다는 동작을 고려해, environment-scoped marker가 없으면
공개 job이 실패하도록 한다. 실제 required reviewer와 우회 금지 설정은 저장소 관리자가
GitHub Settings에서 구성해야 하며 workflow만으로 그 설정 완료를 주장하지 않는다.

## Enforcement와 우회 가능성

- Tier: E5 CI 계약 + E6 GitHub Actions 실행.
- 실행 표면: `tests/desktop-release-contract.test.ts`, `.github/workflows/desktop.yml`.
- 알려진 우회: workflow 자체를 함께 바꾸거나 GitHub Release에 수동 업로드할 권한이 있는
  관리자는 우회할 수 있다.
- 잔여 위험: branch protection/required check가 이 테스트를 필수로 연결하는지는 저장소
  설정에 달려 있다.
- 표현: 절대적 배포 강제가 아니라 저장소 CI 계약과 태그 기반 Release gate다.
- 최종 enforcement layer: GitHub 권한/branch protection; 이 변경 범위 밖.

## 검증기 사전 확인

- `npm run test:inventory`: exit 0, `tests/*.test.*` inventory를 읽는다.
- `npm run typecheck:tests`: 최초에는 `node_modules` 부재로 실행 불가했고 `npm ci` 후 재실행
  대상으로 유지한다. `tsconfig.tests.json` include는 `tests/**/*.test.ts`다.
- RED: 새 계약 테스트 3건 모두 기존 cross-platform 설정 때문에 의도대로 실패했다.
