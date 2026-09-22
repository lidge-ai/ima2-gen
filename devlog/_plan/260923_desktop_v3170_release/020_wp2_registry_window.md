---
created: 2026-09-23
tags: [ima2-gen, release, npm, registry-proof, wp2]
---

# 020 — wp2: npm 레지스트리 증명 창 연장

wp1 D 결론 인용: "배포 완료. 남은 방향은 wp2 — 검증 창을 늘려 오늘의 수동 rerun이 다음 릴리스에서
필요 없게 한다." 방향 변경 없음.

npm은 provenance가 붙은 5.3MB 패키지를 비동기로 처리한다. 관측치: 3.16.1 preview 약 6분 9초,
3.17.0 preview 5분 10초(20:17:59 → 20:23:09), 3.17.0 stable 약 36초 이상(verify 실패 20:50:17 → 반영 20:50:53).
`verifyRegistryEventually`(scripts/release-contract.mjs:325)는 120초 뒤 포기하므로 publish 잡이 빨갛게 끝나고
release.yml cut이 태그 전에 멈춘다. 게시 자체는 성공했으므로 실패한 것은 검증의 대기 시간이다.

## Loop spec

| 필드 | 내용 |
|---|---|
| Archetype | satisfy-spec, 좁은 코드 수정 |
| Trigger | goalplan wp2, 010 영수증의 재발 방지 항목 |
| Goal | 게시 뒤 레지스트리 반영이 15분 안에 오면 publish 잡이 자동으로 녹색 |
| Non-goals | 증명 내용(무결성, provenance, 서명, dist-tag) 완화, 게시 순서 변경, release.yml 대기 한도 변경 |
| Verifier | `node --import tsx --test tests/release-pipeline-contract.test.ts`(대상 파일을 직접 import, :16), `npm run typecheck`, `npm run typecheck:tests`, PR의 hosted CI |
| Stop | 테스트·CI 녹색 PR이 dev에 머지, c-4 met |
| Memory | 이 문서, goalplan |
| Terminal | DONE / BLOCKED(CI가 무관한 이유로 실패하고 재시도로 회복 불가) |
| Escalation | 증명 기준 자체를 바꿔야 하는 경우 |
| Bounds | 쓰기: scripts/release-contract.mjs, .github/workflows/publish.yml, tests/release-pipeline-contract.test.ts, 이 문서. 외부: 브랜치 push, PR, 머지(사용자 승인 범위) |

## Architect 제안 처분 (Lovelace, wp1 P의 D9–D11 재사용)

- D9 수용 — 관측치 위와 같음. 모든 호출부(:320, :365, :382, :537, :596, :614, :628)가 기본값을 쓰고 두 번째
  인자를 넘기는 곳이 없다(rg 확인).
- D10 수용(형태 조정) — 아래 설계. 환경 변수 override 유지, 상한은 reflection 뒤 20분으로 조정. step timeout 수용(25분):
  publish 잡에는 job timeout이 없어(publish.yml) 무한 대기를 막는 경계가 필요.
- D11 수용 — 기존 "release artifact and provenance contract" describe에 추가, 인벤토리 변화 없음.

## 설계

scripts/release-contract.mjs:

```js
export const REGISTRY_PROOF_TIMEOUT_MS = 15 * 60_000;
export const REGISTRY_PROOF_MAX_TIMEOUT_MS = 20 * 60_000;
export const REGISTRY_PROOF_POLL_MS = 10_000;
// 한 시도의 최악 소요: npm view 2회(30s씩) + provenance fetch 30s
// + 서명 검증의 npm install·audit signatures(120s씩, registry-signature-proof.mjs:15,32-33)
export const REGISTRY_PROOF_ATTEMPT_BUDGET_MS = 330_000;
export function registryProofTimeoutMs(env = process.env) // 미설정/빈 값 → 기본값,
  // 양의 정수 ms이고 상한 이하가 아니면 throw
export async function verifyRegistryEventually(input, {
  timeoutMs = registryProofTimeoutMs(), pollMs = REGISTRY_PROOF_POLL_MS,
  verify = verifyRegistry, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now,
  log = (message) => console.error(message),
} = {})
```

루프 의미는 유지한다: 최소 1회 시도, 실패하면 deadline 전까지 pollMs 간격 재시도, deadline 뒤 마지막 오류를
그대로 throw. 대기 로그에 경과 초를 넣는다. 첫 시도 성공이면 sleep 0회.

publish.yml: 두 "Verify registry, dist-tag, integrity, and provenance" step에 `timeout-minutes: 26`.
근거: 26분 ≥ 최대 창 20분 + 시도 1회 최악 5.5분(deadline은 시도 사이에만 확인). override
`IMA2_REGISTRY_PROOF_TIMEOUT_MS`는 publish.yml이 넘기지 않으므로 로컬·수동 실행 전용이다.
잘못된 override는 호출 시점에 읽혀 모든 명령(pages.yml finalize-check 포함)을 거부시킨다 — fail-closed, 의도.

테스트 import(tests/release-pipeline-contract.test.ts:9-16)에 새 export 추가. 가짜 verify는
tsconfig.tests.json(allowJs, checkJs:false)이 기본값 verifyRegistry에서 타입을 추론하므로 명시 cast로 넘긴다.

release.yml 대기 한도(preview 100분, stable 80분)와의 관계: 성공 경로에서 늘어나는 시간은 실제 npm 반영
지연 + poll 10초 + 시도 1회뿐이다(관측 최대 약 6분 → 약 12분 이하). 이전에는 이 경우가 곧바로 실패였다.
npm이 15분 넘게 늦는 실패 경로에서는 verify step이 최대 26분을 쓰고, preview 경로 합(package 25 +
windows 40 + verify 26)이 100분에 가까워 release.yml wait가 먼저 끝날 수 있다. 어느 쪽이 먼저 끝나도
결과는 실패이고 복구는 060/010의 rerun 절차로 같다. 한도 변경은 Non-goal.

## 조건부 경로와 활성 시나리오

| 경로 | 활성 조건 | 관측 증거(테스트) |
|---|---|---|
| 재시도 후 성공 | verify가 두 번 E404 뒤 성공 | 결과 반환, verify 3회, sleep 2회 모두 pollMs |
| 첫 시도 성공 | verify 즉시 성공 | sleep 0회, log 0회 |
| 창 0 | timeoutMs=0, verify 실패 | 시도 정확히 1회 후 그 오류로 reject |
| 대기 로그 | 재시도 시나리오 | log 2회, 각 메시지에 "registry proof pending", 경과 초(0s, 10s), 원래 error.message |
| 창 만료 | 가짜 시계가 deadline을 넘김 | 마지막 오류 그대로 reject, 이후 sleep 없음 |
| env override | IMA2_REGISTRY_PROOF_TIMEOUT_MS=60000 / 미설정 / "" | 60000 / 기본값 / 기본값 |
| env 거부 | 0, -1, "abc", "1.5", "60000abc", 상한 초과 | throw |
| step 경계 | publish.yml 두 verify step | timeout-minutes × 60000 ≥ MAX + ATTEMPT_BUDGET (계약 테스트) |

## Bypass 기록

| 항목 | 계층 | 주체 | 우회 | 잔여 위험 |
|---|---|---|---|---|
| 15분 창 | 스크립트 기본값 | publish 잡 | env override로 짧게/길게(상한 20분, 로컬·수동 전용) | 15분을 넘는 npm 지연은 여전히 빨간 잡 → 060/010의 rerun 절차 |
| 느린 실패 | 같은 루프를 쓰는 guard-publish, prepare preview proof, verify-existing, verify-channel, ensure-github-release, wait, pages.yml finalize-check | — | — | gitHead·무결성·provenance 같은 영구 불일치도 이제 최대 15분 뒤에 실패한다(이전 약 2분). 26분 step timeout은 두 verify step에만 있다. 오류 분류로 빨리 끝내는 것은 증명 의미를 건드리므로 이번 범위 밖 |

Reflection: Lovelace ALIGNED, gap 5건(override·step timeout 충돌, 한 시도 초과, 느린 실패, 테스트 import,
로그 미검증) → 위와 같이 반영(rev 2).

SoT: structure/·docs에 이 동작 서술 없음(rg). 060의 교훈 절과 010 후속 항목이 참조점 — D에서 020 링크만 추가.

## A — 독립 감사 (rev 2 → rev 3)

감사자 `01a0cb29-a03d-7bb3-961a-b870a4dd5ecc` (Franklin), VERDICT: NEAR-PASS. 처분: 1 MAJOR 시도 예산 330s로
정정·step 26분 — 수용. 2 MAJOR release.yml 대기 계산 — 수용, 위 절에 성공·실패 경로 계산 기록(한도 변경은 Non-goal).
3 MINOR 느린 실패 목록 — 수용. 4 MINOR 가짜 verify 타입 — 수용, 명시 cast. 5 MINOR 테스트 누락 — 수용, 표 확장.
6 MINOR 잘못된 override fail-closed — 수용, 명시.

## B 중 발견 — 마지막 대기 뒤 시도가 없던 루프

"창 만료" 테스트가 기존 `do…while (now() < deadline)`의 결함을 드러냈다. 마지막 poll 대기가 deadline에
닿으면 루프가 다시 시도하지 않고 끝나 그 대기가 버려졌다(수정 전 루프로 30초 창: 시도 3회, 대기 3회).
수정: 실패 시 deadline이 지났으면 그 오류를 던지고, 아니면 `min(pollMs, 남은 시간)`만 기다린 뒤 항상 다시
시도한다. 25초 창에서 시도는 0·10·20·25초 4회, 대기는 10·10·5초. 증명 내용과 호출부 의미는 그대로다.
