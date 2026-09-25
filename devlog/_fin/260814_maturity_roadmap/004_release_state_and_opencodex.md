---
created: 2026-08-13
updated: 2026-08-13
tags: [ima2-gen, devlog, research, release, opencodex]
---

# 004 — 릴리스 상태 스냅샷과 opencodex 대조

기준: `dev` @ `d2fe420`. 릴리스 관련 원격 상태는 `ac1cace`.

> **기준선 고지 (2026-08-14 추가)**: 이 문서는 `dev` @ `d2fe420`, 원격 `ac1cace`
> 시점의 **역사적 스냅샷**이다. 이후 `8bc4468e`가 릴리스를 고쳤고 v3.0.6, v3.0.7이
> 발행됐다. 현재 상태는 `260814_issue_pr_zeroing_release/000_plan.md`를 보라.
> 아래 판정들은 작성 시점에 옳았으며, 갱신은 해당 절 끝에 표시했다.

## 1. 현재 승격 경로

`release.yml`은 bump 하나만 받고 나머지를 스스로 계산한다.

```
dispatch(bump)
  → preflight: HEAD == origin/main, dev/preview가 조상인지 확인
  → assert-toolchain: Node/npm 정확 일치
  → commit: npm version, npm 기공개·기존 태그 거부, package.json/lock만 커밋
  → verify:release (45분 상한)
  → assert-clean: 검증이 추적 산출물을 바꿨으면 거부   ← 31604716464이 여기서 실패
  → push main → 같은 SHA를 preview로
  → publish.yml dispatch(preview, SHA) → 대기
  → assert-preview-proof: npm preview의 gitHead == 그 SHA
  → tag job: 원격 미이동 확인 → main/dev/tag 원자적 push
  → publish.yml dispatch(tag, SHA) → npm latest
```

근거: `.github/workflows/release.yml` 53·66·69·74·76·90·119·126행,
`scripts/release-cut.mjs` 53·108·137행, `scripts/release-contract.mjs:145`.

**이 설계는 이미 상당히 엄격하다.** 발행 가능한 ref는 `refs/heads/preview`와
`package.json` 버전과 정확히 일치하는 `v*` 태그 둘뿐이고
(`scripts/release-contract.mjs:145`), `id-token: write`는 최종 publish job에만
있으며 package job은 OIDC 토큰이 없음을 능동적으로 증명한다
(`.github/workflows/publish.yml` 90행과 194행).

## 2. 두 실패의 성격이 다르다

### 2-1. tsbuildinfo drift — 고쳤으나 재현되지 않음

`ac1cace`가 인덱스에서 제거했고, `./.gitignore` 14–15행이 두 파일을 무시하며,
`tests/release-pipeline-contract.test.ts:309`에 추적되면 실패하는 회귀 테스트까지
있다. 정적 방어는 충분하다.

그러나 **그 뒤 release 워크플로가 한 번도 실행되지 않았다.** 판정:
`fixed-but-unproven`. `010`의 종료 조건은 "무시 설정을 했다"가 아니라 "컷이
`assert-clean`을 통과하는 것을 관측했다"이다.

**2026-08-14 갱신: 관측됐다.** release run `31778196224`가 `assert-clean`을 통과해
preview까지 승격됐고 v3.0.7이 발행됐다. 판정이 `fixed-but-unproven`에서 `proven`으로
바뀐다. 이 문서가 세운 종료 조건("컷이 `assert-clean`을 통과하는 것을 관측했다")이
옳았고 그것이 충족됐다. 고쳤다는 주장과 고쳐진 것을 관측한 것이 다르다는 원칙은
이후 사이클에도 그대로 적용된다.

### 2-2. Windows 타임아웃 — 원인 미제거, 그리고 **여유 부족이 아니다**

이것이 이번 조사에서 가장 중요한 발견이다. 아래는 **job 전체가 아니라 동일한 단계**
("Update a real global install and probe package-local OAuth",
`.github/workflows/publish.yml:182`)의 `startedAt`/`completedAt` 차이다. 독립 감사가
3건을 재계산해 일치를 확인했다.

| run | Node/npm | 결과 | 소요 |
|---|---|---|---:|
| 31605449399 | 24.17.0 / 12.0.0 | **타임아웃** | 15:03 |
| 31605449399 | 22.23.0 / 11.18.0 | 성공 | 8:04 |
| 31603578657 | 24 / 12 | 성공 | 5:58 |
| 31600717390 | 24 / 12 | 성공 | 6:33 |

**2026-08-14 갱신: 해소됐다.** publish run `31780064187`이 success로 끝났다.
다만 이 절의 "여유 부족이 아니다" 분석은 여전히 유효한 경고다 — #138 CI의 Windows
Node24/npm12가 15분 상한에 **14m43s**로 통과했다(여유 17초). 원인이 제거된 것이
아니라 이번에 상한 안에 들어온 것일 수 있다. 계측 부재 지적은
`260814_issue_pr_zeroing_release/060`에 이월 항목으로 남겼다.
| 30875635806 | 24 / 12 | 성공 | 6:03 |
| 30874968178 | 24 / 12 | 성공 | 4:52 |
| 30303574819 | 24 / 12 | 성공 | 8:16 |

Node24/npm12 성공 구간은 **4:52 – 8:16, 중앙값 6:03**이다. 실패한 실행은 성공
중앙값의 **2.5배**에서 멈췄다.

**따라서 "15분이 빠듯하다"는 해석은 틀렸다.** 12–14분이 정상이고 15분이 아슬아슬한
상황이 아니라, 평소 6분짜리 작업이 15분 넘게 매달린 것이다. 타임아웃을 25분으로
올리면 이 실행은 25분을 기다린 뒤 같은 자리에서 실패하거나, 더 나쁘게는 매달린 채
통과할 수도 있다.

실제 문제는 계측 부재다. `scripts/package-global-update-smoke.mjs`는 이 경로에서
**13개의 하위 프로세스**를 동기 실행하며 그중 **어느 것에도 개별 timeout이 없다**
(`scripts/package-global-update-smoke.mjs` 11행과 32행, `scripts/npm-subprocess.mjs:21`).
그중 3개는 `npm install --global`이고 baseline
설치(`scripts/package-global-update-smoke.mjs:97`)는 레지스트리에서 실제 tarball을
받는다. 단계 로그는 바깥 타임아웃만 알려줄 뿐 **어느 자식이 매달렸는지 기록하지
않는다.**

그래서 `020`의 처방은 "타임아웃 상향"이 아니라 **하위 프로세스별 deadline +
시작/종료/소요 로깅**이다. 상향은 그 계측이 붙어서 어느 구간이 얼마나 걸리는지
보인 뒤에 판단할 문제다.

## 3. 브랜치 보호: 없음

```
gh api repos/lidge-ai/ima2-gen/branches/main/protection
→ gh: Branch not protected (HTTP 404)
```

`preview`, `dev`도 동일하게 404다. 세 브랜치 모두 classic branch protection이
없다. (이 엔드포인트는 classic protection만 보므로 ruleset은 별도 확인이 필요하다.)

평가서의 "브랜치 보호 확인 및 강제"는 **verified**이며, 지금은 사람이든 CI든
`main`에 직접 push할 수 있다. 다만 릴리스 워크플로 자신이 `main`/`dev`/`preview`를
직접 push하므로(`.github/workflows/release.yml` 74행과 126행) 보호 규칙을 켤 때
워크플로 주체를 예외로 두지 않으면 릴리스가 막힌다. `030`에서 이 순서를 다룬다.

## 4. opencodex 대조 — 채택/거부

`../opencodex/.github/workflows/release.yml`을 읽고 항목별로 판정했다. **이미
있는 것을 "도입하자"고 쓰지 않는 것**이 이 표의 목적이다.

| 항목 | 판정 | 이유 |
|---|---|---|
| dispatch에 명시적 version 입력 | **거부** | ima2-gen은 bump만 받고 npm 기공개·기존 태그를 확인해 다음 버전을 계산·커밋한다(`scripts/release-cut.mjs:108`). 사람이 버전을 입력하면 그 계약이 약해진다 |
| `dry-run` 기본 true | **채택** | 로컬 `publish:dry-run` 스크립트는 `./package.json` 33행에 있지만 워크플로 차원의 무발행 리허설이 없다. 진짜 빠져 있다 |
| `expected-sha` 입력 | **채택** | 컷 이후의 원격 이동은 막지만(`.github/workflows/release.yml:119`), **감사 시점과 dispatch 시점 사이**의 기준 SHA를 사람이 고정할 수단이 없다 |
| 정확 SHA CI 성공 게이트 | **채택** | ima2-gen은 릴리스 job 안에서 후보를 검증하지만 그 SHA에 대한 `ci.yml` 성공 실행을 GitHub에 **조회하지 않는다**. 독립 게이트가 없다 |
| npm dist-tag를 choice 입력으로 | **거부** | 이미 ref에서 자동 결정된다(`scripts/release-contract.mjs` 152행과 166행). 사람 선택은 더 약한 계약이다 |
| concurrency group | **거부** | 이미 있다(`.github/workflows/release.yml:24`), 게다가 publish는 발행 대상 ref로 키를 잡아 더 정확하다(`.github/workflows/publish.yml:34`) |
| OIDC trusted publishing / provenance | **거부** | 이미 있고 **더 엄격하다**. 최종 job에만 OIDC를 주고 package job은 토큰 부재를 증명한다(`.github/workflows/publish.yml` 90·194·231행) |
| opencodex의 15분 job timeout | **값 복사 거부** | 파이프라인 구조가 다르다. 현재 90/45/90 + 25/15가 근거 있는 값이고, Windows 사건의 처방은 job 상한 조정이 아니라 하위 프로세스 deadline이다 |

**결론: opencodex에서 실제로 가져올 것은 3개다.** dry-run dispatch, expected-sha,
정확 SHA CI 게이트. 나머지 5개는 ima2-gen이 이미 갖췄거나 더 엄격하다.

이 표가 `002`의 C-13(provenance는 이미 있다)과 같은 종류의 발견이다. 참조 저장소를
읽고 "저쪽에 있으니 우리도"라고 적었다면 이미 있는 것 세 개를 다시 만들 뻔했다.

## 5. `030`으로 넘기는 결정

평가서의 Phase 0 종료 조건 중 "preview publish 10회 연속 성공"은 채택하지 않는다.
현재 preview 발행은 릴리스 컷마다 한 번씩 일어나므로 10회를 채우려면 의미 없는
버전 10개를 발행해야 한다. 대신 `030`은 **dry-run dispatch로 반복 가능한 리허설**을
종료 조건으로 삼는다. 발행 없이 같은 경로를 10번 도는 것이 실제로 결정성을
증명한다.
