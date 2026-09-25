---
created: 2026-08-13
updated: 2026-08-13
tags: [ima2-gen, devlog, research, evidence]
---

# 002 — 주장 원장

평가서의 검증 가능한 주장을 하나씩 판정한다. 기준 트리는 `dev` @ `d2fe420`
(직전 릴리스 관련 상태는 `ac1cace`).

판정 값:

- **verified** — 저장소·CI·npm·GitHub API에서 재현됨
- **refuted** — 재현 시도했고 사실이 아님
- **partial** — 요지는 맞고 세부가 다름
- **unverifiable** — 우리가 가진 데이터로 판정 불가 (사용자 행동 지표 등)

## 릴리스·공급망

| id | 주장 | 판정 | 근거 |
|---|---|---|---|
| C-01 | 최신 npm publish 워크플로가 실패했다 | verified | publish run `31605449399` failure. Windows Node24/npm12에서 `test:package-global-update` 15분 타임아웃 |
| C-02 | 릴리스 컷도 실패했다 (평가서 미언급, 우리가 추가) | verified | release run `31604716464` failure. `assert-clean`이 `M ui/tsconfig.node.tsbuildinfo` 검출 |
| C-03 | GitHub Actions가 SHA로 고정돼 있다 | **partial** | 대부분 40자 SHA다(`.github/workflows/publish.yml` 50행 등). 그러나 `.github/workflows/nix.yml:18`의 `cachix/install-nix-action@v30`은 태그다. `090`이 이 한 건을 다룬다 |
| C-04 | SBOM과 릴리스 매니페스트가 있다 | verified | `.github/workflows/publish.yml` 107행 "Upload tested package, manifest, and SBOM" |
| C-05 | 저장소 크기가 약 358MiB다 | verified | `gh api repos/lidge-ai/ima2-gen` → `size` = 367028 KB ≈ 358.4 MiB |
| C-06 | `SECURITY.md`, `CODEOWNERS`, `CONTRIBUTING.md`가 없다 | verified | 저장소 루트와 `.github/`에 없음. `.github/`에는 `workflows/`만 존재 |

## 코드·아키텍처

| id | 주장 | 판정 | 근거 |
|---|---|---|---|
| C-07 | 백엔드가 이미 `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`다 | **refuted** | `./tsconfig.json` 13행에 `strict: true`만 있다. 나머지 두 플래그는 `tsconfig*.json` 어디에도 없다 (`rg` 0건) |
| C-08 | `.ts` 소스와 커밋된 `.js` 산출물이 병존한다 | partial | 요지는 맞지만 규모가 다르다. 아래 "C-08을 다시 센 이유" 참조 |
| C-09 | UI에 별도 테스트 스크립트가 없다 | verified | `ui/package.json` scripts = `dev`, `build`, `preview`뿐. Playwright/Vitest/Cypress 없음 |
| C-10 | CI가 4개 조합(Ubuntu/Windows × Node 22/24)에서 돈다 | verified | `.github/workflows/ci.yml` 25–34행의 matrix include 4건 |
| C-11 | 테스트가 2000건대다 | verified | `d2fe420`에서 `npm test` 재실행: `tests 2118 / pass 2116 / skipped 2 / fail 0`, exit 0. 테스트 파일은 `git ls-files 'tests/*.test.*'` → 344 |

C-11의 근거를 교체했다. 처음에는 `050_release_automation_closeout.md`의 "2115
pass"와 "파일 198개"를 인용했는데, 그건 **과거 문서의 산문을 현재 증거로 제시한
것**이다. 이 원장 자신이 금지하는 행위다. 감사가 `npm test`를 직접 돌려 2118/2116을
얻었고, 파일 수도 세는 방식에 따라 198이 아니라 344였다. 이제 두 숫자 모두 실행
명령과 SHA를 함께 적는다.

### C-08을 다시 센 이유

처음 이 행은 "167건"으로 `verified`였다. 감사를 예상하고 다시 세면서 그 숫자가
**두 가지를 섞고 있다**는 것을 발견했다.

```
git ls-files '*.js' | grep -vE '^(ui/|vendor/|node_modules)'   → 167
  그중 같은 이름의 .ts가 함께 추적되는 것                      →  18
  나머지                                                       → 149, 전부 tests/ 아래
```

149건은 컴파일 산출물이 아니라 **손으로 쓴 `.js` 테스트 파일**이다
(`tests/agent-mode-frontend-contract.test.js` 등). drift가 아니다.

진짜 source/build drift는 **18쌍**이다: `bin/ima2.js`, `config.js`,
`lib/capabilities.js`, `lib/imageModels.js`, `routes/index.js` 등이 각자의 `.ts`와
나란히 추적된다.

`002`의 167과 `003`의 18은 서로 다른 측정이지 모순이 아니다. 그러나 167을 drift
근거로 제시한 것은 **과장이었다.** source/build drift는 `010`이 소유하며(아래
"phase 귀속" 참조) 작업 규모는 18쌍 기준으로 잡는다. 149개
`.js` 테스트를 `.ts`로 옮기는 것은 별개 문제이고 이번 로드맵 범위가 아니다. 게다가
`npm run test:inventory`(`scripts/classify-tests.mjs --check --fail-js-runtime`)가
이미 분류를 강제하므로 방치된 상태도 아니다.

판정을 `verified`에서 `partial`로 내린 이유가 이것이다. "병존한다"는 참이지만
"167건"이라는 인상은 거짓이었다.

## 평가서가 놓친 것 (우리가 추가)

| id | 사실 | 근거 | 왜 중요한가 |
|---|---|---|---|
| C-12 | `ima2 doctor`가 **이미 존재한다** | `bin/commands/doctor.ts` (236줄). 런타임 의존성 해석, 스토리지, 하드닝, Codex auth 감지, 이미지 probe 포함 | 평가서는 Phase 1의 핵심 과제로 "`ima2 doctor` 구현"을 든다. 실제로는 **신규 구현이 아니라 확장**이다. 신규로 잡으면 있는 것을 다시 만든다 |
| C-13 | npm provenance와 trusted publishing이 **이미 있다** | `.github/workflows/publish.yml` 196행 `id-token: write`, 235행 `npm publish ... --provenance --access public`, 236행 "Verify registry, dist-tag, integrity, and provenance" | 평가서는 Phase 4에서 "npm provenance"를 미래 과제로 든다. 이미 있다 |
| C-14 | `doctor`가 비과금 검증을 **이미 하고 있다** | `scripts/package-global-update-smoke.mjs`가 unauthed 상태에서 `doctor`를 호출해 exit 1과 "no file-backed Codex session"을 단언한다 | 평가서의 "인증 검증에 유료 생성을 쓰지 말라"는 이미 지켜지는 부분이 있다. 남은 문제는 provider별 capability 검증이지 doctor 자체가 아니다 |
| C-15 | tsbuildinfo drift의 **원인은 이미 제거됐다** | `ac1cace`가 추적 해제. `./.gitignore` 14–15행에 두 tsbuildinfo. `git ls-files \| grep tsbuildinfo` → 0건 | 그러나 그 뒤 컷을 다시 돌리지 않아 **초록이 재현되지 않았다**. 고친 것과 고쳐졌음을 관측한 것은 다르다 |

C-12와 C-13이 이 원장의 실질적 가치다. 평가서를 그대로 실행했다면 이미 있는 것
두 개를 새로 만들 뻔했다.

## 판정 불가

| id | 주장 | 왜 불가한가 |
|---|---|---|
| C-16 | 설치 후 첫 생성 성공률 85% | 텔레메트리가 없다. 만들지 여부 자체가 소유자 결정 |
| C-17 | 28일 재사용률 25% | 동일 |
| C-18 | 이슈 최초 응답 중앙값 48시간 | 현재 open issue 0건이라 표본이 없다 |
| C-19 | bus factor 1 | 커밋 분포로는 보이지만, 이것이 위험인지는 소유자의 의도에 달렸다. 엔지니어링 판정 대상이 아니다 |

## 이 원장이 로드맵에 미친 영향

1. C-07 반증 → 백엔드 타입 안전성 강화가 **살아 있는 과제**로 남는다. `085`에서
   다룬다(아래 "phase 귀속" 참조).
2. C-12 → `070`은 "doctor 구현"이 아니라 "doctor에 provider capability 검증
   추가"다.
3. C-13 → `090` 공급망 절에서 provenance를 빼고, 실제로 없는 것(CodeQL,
   Dependabot/Renovate, 서명된 릴리스 매니페스트, 비공개 취약점 신고 경로)만 남긴다.
4. C-15 → `010`의 종료 조건은 "tsbuildinfo를 ignore한다"가 아니라 "컷이 초록인
   것을 관측한다"이다.

## phase 귀속 (A phase 감사 blocker 2 반영)

감사가 실제 충돌을 짚었다. `000`은 `010`을 빌드 산출물 결정성, `080`을 프런트엔드
E2E로 정의했는데, 이 문서는 `.js` drift와 백엔드 타입 안전성을 둘 다 `080`에
보냈다. 구현자가 어느 문서를 봐야 할지 알 수 없고, 백엔드 컴파일러 강화는 아예
주인이 없었다.

정리한다.

| 작업 | 소유 phase | 이유 |
|---|---|---|
| 추적된 18쌍 `.js`/`.ts` drift 제거 | `010` | 실패한 release run이 증명하듯 drift는 릴리스 결정성의 **선행 조건**이다 |
| devlog 백업 tarball 126MB 처리 | `010` | 같은 이유. 저장소/체크아웃 비용 |
| 프런트엔드 E2E (Playwright) | `080` | 원래 정의 그대로 |
| 백엔드 `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` | **`085` (신설)** | 어디에도 속하지 않던 작업. E2E와 성격이 다르므로 `080`에 섞지 않고 별도 문서로 뗀다 |

`085`를 새로 만드는 이유: `080`을 넓혀 "테스트와 타입"으로 만들면 이름이 내용을
설명하지 못하고, `010`에 넣으면 릴리스 결정성과 무관한 컴파일러 플래그가 릴리스
phase를 부풀린다. `085`는 `080`–`089` decade **안의 하위 문서 번호**이며
(LEXICO-SPLIT-01이 허용한다), 십의 자리 사이의 새 자리가 아니다 — 2라운드 감사가
이 표현을 정정했다. `080`의 하위 단계가 아니라 독립 사이클로 돌리고, 소비하는
것은 WP2의 C-07 검증 결과다.

`000`의 work-phase 맵과 `001`의 범위 표도 이 귀속에 맞춰 갱신했다.
