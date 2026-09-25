---
created: 2026-08-13
updated: 2026-08-13
tags: [ima2-gen, devlog, roadmap, issues]
---

# 005 — #122 하위 이슈 분할 계획

- work-phase: WP0 (issue split)
- 세션: `019ffa3f-5cfb-7060-85ca-dd8230eac6a2`
- 기준 트리: `dev` @ `32e5b0a` (로드맵 문서 커밋 포함, 코드 트리는 `ac1cace`와 동일)

## stale 검증 결과 (P phase)

| 확인 | 결과 |
|---|---|
| `git diff ac1cace..HEAD --name-only`에서 devlog/structure 외 파일 | 0건 — decade 문서가 여전히 현재 트리와 일치 |
| 추적된 `.js`/`.ts` 동명 쌍 | 18쌍 — `010` 문서와 일치 |
| 추적된 `*.tsbuildinfo` | 0건 — `010` 문서의 "이미 제거됨"과 일치 |
| `devlog/_fin/260714_git-index-fix/artifacts/`의 tarball 2개 | 추적 상태 유지 — `010` 삭제 대상과 일치 |
| `devlog/` 크기 | 220M — 문서의 ~228MB와 측정 시점 차이 범위 내 |
| #122 기존 sub-issue | 0건 (`GET /repos/lidge-ai/ima2-gen/issues/122/sub_issues` 빈 목록) |

## 분할 계획

#122의 "구현 단계" 절을 전달/검증 경계별로 10개 하위 이슈로 나눈다.
각 이슈는 본문에 상위 이슈 링크, 대응 decade 문서 경로, 범위, 수용 기준,
의존 관계를 적는다. GitHub sub-issue 관계는
`POST /repos/{owner}/{repo}/issues/122/sub_issues`로 설정하고, 차단 의존은
`POST /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by`를 시도하되
API가 거부하면 본문 명시로 대체한다.

| # | 제목 | 문서 | blocked by |
|---|---|---|---|
| 1 | [Maturity 010] Build artifact determinism | `010_build_artifact_determinism.md` | — |
| 2 | [Maturity 020] Release cut determinism | `020_release_cut_determinism.md` | 010 |
| 3 | [Maturity 030] Release channel contract | `030_release_channel_contract.md` | 020 |
| 4 | [Maturity 040] Provider Capability Registry | `040_provider_capability_registry.md` | — |
| 5 | [Maturity 050] Job terminal status contract | `050_job_state_machine.md` | — |
| 6 | [Maturity 060] Provider error taxonomy | `060_error_taxonomy.md` | — |
| 7 | [Maturity 070] Doctor and onboarding | `070_doctor_and_onboarding.md` | 040, 060 |
| 8 | [Maturity 080] Frontend E2E | `080_frontend_e2e.md` | 050, 060 |
| 9 | [Maturity 085] Backend type strengthening | `085_backend_type_strengthening.md` | — |
| 10 | [Maturity 090] Governance and supply chain | `090_governance_and_supply_chain.md` | 030 |

**blocked-by의 출처는 각 decade 문서의 "소비하는 선행 산출물" 줄이다(A phase
감사 blocker 1 반영).** `000`의 WP4 "사슬" 표기는 문서 작성 작업의 묶음이지
구현 의존이 아니다. `050`은 `040`을 소비하지 않고(`050` 문서 10행), `060`은
`040`/`050` 어느 것도 소비하지 않는다(`060` 문서 10행). `070`은 `040`과
`060`만, `080`은 `050`과 `060`만 소비한다(각 문서 10행). 따라서 core contract
세 phase(040/050/060)는 서로 독립이고 병렬 가능하다.

099 클로즈아웃은 별도 이슈를 만들지 않는다 — #122의 "완료 조건" 절이 이미
그 역할이고, 실제 발행 행위는 별도 승인 대상이라 코드 이슈로 닫을 수 없다.

## 수용 기준

- `c-i1`: `gh issue list`에 위 10개 이슈가 존재하고 각 본문이 #122와 decade
  문서 경로를 가리킨다.
- `c-i2`: `GET /repos/lidge-ai/ima2-gen/issues/122/sub_issues`가 10개를
  반환한다.
- `c-i3`: blocked-by 관계가 API 또는 본문으로 위 표와 일치한다.

## IN / OUT

- IN: GitHub 이슈 생성, sub-issue/dependency 설정.
- OUT: 코드 변경, #122 본문 재작성(체크리스트 링크 추가는 허용), 이슈 닫기.
