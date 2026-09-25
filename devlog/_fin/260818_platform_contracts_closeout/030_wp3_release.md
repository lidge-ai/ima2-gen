---
created: 2026-08-18
updated: 2026-08-18
tags: [ima2-gen, devlog, wp3, release]
---

# 030 (WP3) — dev push + stable 릴리스

의존: wp1, wp2 (둘 다 D 종료 후).

## 절차 (저장소 canonical 메커니즘 — wp3 감사 반영)

1. **main+dev atomic 동시 push** (감사 블로커 1: cut job의 `assertBaseline`은
   origin/main == HEAD, main ⊇ dev, main ⊇ preview를 요구한다. dev만 밀면
   preflight가 죽는다):
   `git push --atomic origin "<SHA>:refs/heads/main" "<SHA>:refs/heads/dev"`
   (사용자 승인 완료: "dev에 푸시하고 배포까지 완료")
2. main push CI 완료 확인 + `gh pr list`로 신규 Dependabot PR 부재 확인
3. 로컬 `npm run verify:release` 선실행 (audit:gate가 라이브 registry 조회라
   원격 실패를 로컬에서 초 단위로 선발견)
4. `gh workflow run release.yml -f bump=minor -f dry_run=false -f expected_sha=<full SHA>`
   (feat 포함이므로 minor: 3.5.3 → 3.6.0. expected_sha로 baseline 이동 거부)
5. **승인은 2회다** (감사 블로커 2): `npm-stable` 환경(id 19898997367)이
   release.yml의 `tag` job과 publish.yml의 `publish-stable` job을 **각각**
   게이트한다. 두 run에 대해 각각
   `gh api repos/lidge-ai/ima2-gen/actions/runs/<run_id>/pending_deployments
   -X POST -f state=approved -f "environment_ids[]=19898997367"` 실행.
   두 번째를 놓치면 태그는 됐는데 npm latest가 안 움직이는 좌초 상태가 된다.
6. 검증: npm dist-tags latest=3.6.0, gh release view v3.6.0,
   main/dev/tag SHA 일치, preview proof (npm gitHead == release SHA),
   임시 `release-candidate` ref 정리 확인

## 이슈 마감

- #151: 코멘트에 생산 커버리지 전환 목록 + 소비자 전환 증거 + 수용 조건
  체크표. 수용 조건 6개 중 충족/부분/미충족을 명시하고 close 여부는 충족
  수준으로 판단 (SSE/CLI/MCP/UI 소비 + sequence + idempotency + terminal
  복구가 충족되면 close, cancel/retry/resume 계약은 문서화로 처리).
- #150: core diff 실측표 + contract suite 자동 적용 증거. 수용 조건 6개 중
  '5파일 이하'와 'contract suite 자동 적용'이 실증되므로 부분 충족 상태
  기록. 남은 조건(UI switch 제거, 외부 패키지 로딩)은 갈 길을 명시하고
  close 여부는 결과 코멘트에서 판단.

## 수용 기준

- [ ] npm latest가 새 버전
- [ ] GitHub Release 생성, main/dev/tag 정렬
- [ ] 이슈 2건에 증거 코멘트
