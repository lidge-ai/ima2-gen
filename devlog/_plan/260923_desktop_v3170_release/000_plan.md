---
created: 2026-09-23
tags: [ima2-gen, release, desktop, macos, npm, v3170]
---

# 260923 — v3.17.0 npm 마무리와 첫 macOS 데스크톱 릴리스

v3.17.0 릴리스 트레인이 npm 비동기 처리 지연(약 5분) 때문에 태그 직전에 멈췄다. 이 유닛은
060(3.16.1 영수증)에 기록된 복구 경로로 npm `latest`와 GitHub Release `v3.17.0`을 끝내고,
관리자 게이트를 만든 뒤 첫 서명·공증 Apple Silicon 데스크톱 릴리스 `desktop-v3.17.0`을
공개한다. 이어서 같은 지연이 다음 릴리스를 또 멈추지 않도록 레지스트리 검증 창을 늘린다.
사용자는 npm으로 3.17.0을, GitHub Releases에서 서명된 DMG를 받게 된다.

## Loop spec

| 필드 | 내용 |
|---|---|
| Archetype | satisfy-spec, 운영 런북(wp1) + 좁은 코드 수정(wp2) |
| Trigger | 사용자: "ㅇㅇ 하고 배포해줘" (cxc-loop HOTL), 직전 보고의 남은 작업 1~4 |
| Goal | npm latest=3.17.0, GitHub Release v3.17.0, desktop-v3.17.0 공개, 검증 창 수정 dev 머지 |
| Non-goals | Windows/Linux 배포, Windows 서명, 인증서·시크릿 교체, 의존성 업그레이드, 새 버전 번호, 두 버전 간 live 자동 업데이트 증명 |
| Verifier | wp1: 레지스트리 직접 조회, `release-cut.mjs assert-preview-proof`, publish.yml/desktop.yml run 잡 결과, `gh release view` 자산 목록과 SHA256SUMS, 로컬 `codesign`/`spctl`/`stapler`. wp2: focused node:test + exact-head hosted CI |
| Stop condition | 네 criteria(c-1..c-4)가 fresh evidence로 met, 또는 아래 중단 조건 |
| Memory artifact | 이 디렉터리(000, 010, 020)와 goalplan `.codexclaw/goalplans/ship-ima2-gen-v3-17-0-*` |
| Terminal outcomes | DONE / BLOCKED(npm·Apple·GitHub 외부 거부) / UNSAFE(ref 이동, 다른 SHA의 기존 태그·버전) / NEEDS_HUMAN(태그·릴리스 삭제, unpublish 필요) |
| Escalation | 파괴적 복구, force push, 이미 공개된 릴리스 교체가 필요해질 때 멈추고 보고 |
| Resource bounds | 도구: gh(owner lidge-jun), git push(main/dev/v3.17.0/desktop-v3.17.0 태그만), GitHub 설정 API(desktop-production, 태그 룰셋), npm 조회. 쓰기 범위: 위 ref와 설정, wp2 브랜치 파일. 시간: 서명 빌드 1회당 약 15분, 전체 수 시간 이내. 토큰 예산은 사용자가 정하지 않음 |

## Work phases

| wp | 문서 | 내용 |
|---|---|---|
| wp1 | [010_wp1_release_runbook.md](010_wp1_release_runbook.md) | npm 복구 → 관리자 게이트 → 서명 dry run → desktop 태그 공개 |
| wp2 | 020_wp2_registry_window.md (wp2 P에서 작성) | verify-registry 대기 창 연장 + 테스트, PR → dev |

순서 근거: wp2는 다음 릴리스부터 효과가 있고 이번 릴리스 복구에는 필요 없다. 이미 올라간
preview를 증명하는 수동 경로가 있으므로 wp1을 먼저 닫는다.

SoT sync: 릴리스 영수증은 이 유닛 문서에 남기고, `devlog/_plan/260922_macos_arm64_release/040`의
"Production Environment setup" 절에 실제 적용 결과를 덧붙인다.

