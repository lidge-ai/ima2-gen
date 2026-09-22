---
created: 2026-09-23
tags: [ima2-gen, release, runbook, v3170, desktop]
---

# 010 — wp1 런북: npm v3.17.0 복구와 desktop-v3.17.0 공개

기준 사실(2026-09-22 20:30 UTC 조회):

| 항목 | 값 |
|---|---|
| 릴리스 SHA | `bfb83da57b1497e9581cf51bfd7213272d79c9e2` (origin/main = origin/preview) |
| origin/dev | `50e2009e`, 릴리스 SHA의 조상 |
| npm preview | `3.17.0-preview.260922.35777691805.1`, 20:23:09 UTC 레지스트리 반영 (publish 20:17:59) |
| npm latest | `3.16.1` |
| 원격 태그 | `v3.17.0`, `desktop-v*` 없음 |
| 브랜치 룰셋 | "Preserve main preview dev" — deletion만 금지, fast-forward push 허용 |
| 태그 트리거 | `v*` → publish.yml만, `desktop-v*` → desktop.yml만 |
| 직전 서명 빌드 | run 35716708666 (#258 헤드), mac 잡 약 15분 |

## T1 — npm 트레인 복구 (060 경로)

1. 레지스트리 직접 조회로 preview의 `gitHead`가 릴리스 SHA인지 확인.
2. `node scripts/release-cut.mjs assert-preview-proof 3.17.0 <SHA>` → exit 0 요구.
3. push 직전 재조회: origin/main·preview = SHA, origin/dev가 SHA의 조상, 원격 `v3.17.0` 부재.
   하나라도 다르면 UNSAFE로 중단.
4. `git tag v3.17.0 <SHA>` 후
   `git push --atomic origin <SHA>:refs/heads/main <SHA>:refs/heads/dev refs/tags/v3.17.0:refs/tags/v3.17.0`.
   dev가 포함돼야 publish.yml `prepare`의 `validateRemoteRefs`(latest 채널)가 통과한다.
   force 없음: non-fast-forward면 거부되고 멈춘다.
5. 태그 push가 publish.yml(push tag)을 띄운다. `prepare`가 ref와 preview proof를 확인하면
   `npm-stable` 승인 대기에서 pending deployment를 승인한다. 승인은 admin bypass가 아니라
   `gh api -X POST repos/lidge-jun/ima2-gen/actions/runs/<id>/pending_deployments -F 'environment_ids[]=<int>' -f state=approved -f comment=...`.
6. `publish-stable`이 게시 뒤 검증 창(120s)에서 또 E404로 떨어질 수 있다(D5). 그 경우
   레지스트리에서 latest=3.17.0, gitHead=SHA를 직접 확인 → `gh run rerun <id> --failed` →
   npm-stable 재승인 → rerun의 guard-publish가 기존 버전을 증명하고 게시를 건너뛴 뒤
   create-github-release(attestation 포함)가 Release를 만든다. rerun이 attempt-1 artifact를
   못 읽을 때만 060의 수동 `ensure-github-release 3.17.0 <SHA> <artifact dir>`로 대체.
   이 fallback은 `attest-build-provenance`를 건너뛰므로 사용 시 알려진 공백으로 기록.
   순서 규칙: v3.17.0 GitHub Release가 생길 때까지 `dev`를 움직이지 않는다(rerun의
   `assert-remote-ref`가 dev=SHA를 요구, release-contract.mjs:192-196). wp2 머지는 그 뒤.
7. 증거: `npm view ima2-gen@latest version gitHead`, `gh release view v3.17.0`.

## T2 — 관리자 게이트 (040 명령 그대로)

1. `desktop-production` 환경: reviewer lidge-jun(id 243035832), prevent_self_review=false,
   can_admins_bypass=false, custom deployment policy.
2. deployment policy: type=tag, name=`desktop-v*`.
3. 환경 범위 변수 `DESKTOP_RELEASE_GATE=required-reviewer-v1` (저장소 범위 금지).
4. 태그 룰셋 "Protect desktop release tags": `refs/tags/desktop-v*`에 creation/update/deletion,
   bypass = RepositoryRole 5(admin) always. 소유자는 admin이므로 태그 push 가능.
5. readback 증거: GET environment(`protection_rules` reviewer, `can_admins_bypass=false`),
   deployment-branch-policies(`desktop-v*` tag), GET `environments/desktop-production/variables`,
   GET ruleset(`current_user_can_bypass=always`).

## T3 — 서명 dry run (T1과 병렬 가능)

`gh workflow run desktop.yml --ref main -f platform=mac`. dispatch는 draft/publish 잡이 없어
공개가 불가능하다. #260 이후 arm64 전용 설정·검증기·자산 이름으로 서명, 공증, verify가 통과하는지
첫 실전 태그 전에 본다. 성공 조건: `Build signed and notarized macOS installers`,
`Verify every declared macOS architecture and exported installer` success, artifact에
`ima2-3.17.0-mac-arm64.dmg/.zip`, 두 blockmap, `latest-mac.yml` 다섯 개가 있고 x64 산출물이 없으며,
signature proof report가 `ok:true`.

## T4 — desktop-v3.17.0 공개

전제: T1(릴리스 SHA가 태그된 상태), T2, T3 success.

1. push 직전 `git ls-remote origin 'refs/tags/desktop-v*'`로 desktop-v3.17.0 부재 확인(있으면
   UNSAFE 중단), `git tag desktop-v3.17.0 <SHA>`, `git push origin refs/tags/desktop-v3.17.0`.
2. desktop.yml: prepare → build(서명·공증·검증) → draft_release(버전=태그 대조, 자산 준비,
   Draft 생성) → publish_release(`desktop-production` 승인 대기).
3. 승인 전 Draft 확인: 자산 6개(dmg, zip, 두 blockmap, latest-mac.yml, SHA256SUMS.txt), notes의 SHA.
   공개는 되돌릴 수 없으므로(desktop.yml:207-209) 로컬 검증도 이 단계에서 한다: draft 자산 다운로드,
   `shasum -a 256 -c SHA256SUMS.txt`, DMG 마운트 후 안의 `ima2.app`에
   `codesign --verify --deep --strict`, `spctl -a -vv -t exec`(source=Notarized Developer ID),
   `xcrun stapler validate`. DMG 파일 자체의 서명·스테이플은 CI가 만들지 않으므로 참고 정보로만 기록.
   실패하면 승인하지 않고 멈춘다.
4. pending deployment 승인(위와 같은 API, desktop-production) → publish_release가 자산 목록·체크섬·notes 해시 재검증 후 공개
   (`--latest=false`).
5. 공개 후 확인: `gh release view desktop-v3.17.0` isDraft=false, 자산 6개, 공개 자산 해시가 3의 검증값과 동일.

## 조건부 경로와 활성 시나리오

| 경로 | 활성 조건 | 관측 증거 |
|---|---|---|
| T1-3 UNSAFE 중단 | ref 이동 또는 v3.17.0 기존재 | 재조회 출력, push 미실행 |
| T1-6 rerun 복구(수동 fallback) | publish-stable verify 실패 | attempt-1 failure, 레지스트리 직접 조회, rerun attempt와 create-github-release 결과(또는 수동 명령 출력) |
| publish_release gate 실패 | 환경 변수 누락 | "not configured with the required approval gate" — T2 증거로 사전 차단 |
| draft 교체 거부 | 이미 공개된 desktop-v3.17.0 | 해당 없음 예상; 발생 시 NEEDS_HUMAN |

## Bypass 기록 (PLAN-BYPASS-NAMED-01)

| 게이트 | 계층 | 실행 주체 | 알려진 우회 | 잔여 위험 |
|---|---|---|---|---|
| desktop-production reviewer | GitHub 환경 보호(E6급 외부) | GitHub | 저장소 설정을 바꿀 수 있는 admin, 워크플로 파일 수정 | 리뷰어가 소유자 1인이라 자기 승인 |
| desktop-v* 태그 룰셋 | GitHub ruleset | GitHub | admin bypass(의도적) | Apple 시크릿이 저장소 범위라 push 권한자(parkjs101 포함)는 dispatch나 수정한 워크플로로 태그 없이 서명 가능. 룰셋은 공개 경로만 막는다(D7 후속) |
| DESKTOP_RELEASE_GATE | 워크플로 첫 단계 marker | publish_release 잡 | 환경 변수를 설정할 수 있는 admin | marker는 reviewer 설정 자체를 증명하지 않음 → T2 GET 증거로 보완 |


## Architect consultation (wp1 P, rev 1)

- Handle: `01a0cacb-8243-7f93-ac21-1e24fac88b71` (Lovelace), read-only proposal D1–D11.
- 처분:
  - D1 수용 — release.yml 재실행 금지(재실행 시 3.17.1 cut).
  - D2 수용 — assert-preview-proof + `git ls-remote`로 main/preview/dev/v3.17.0 수동 확인(assertRemotesUnmoved는 dev 미검사).
  - D3 수용 — T1-4 그대로.
  - D4 수용 — package 잡(약 25분) 뒤 npm-stable 승인. T3 dry run을 이 시간과 병렬로 돌린다.
  - D5 수정 수용 — T1-6 순서: 레지스트리에서 latest=3.17.0/gitHead 확인 → `gh run rerun <id> --failed` → npm-stable 재승인 → create-github-release(attestation 포함). rerun이 artifact를 못 읽으면 060의 수동 `ensure-github-release`.
  - D6 수용 — T2는 어떤 desktop 태그보다 먼저, readback에 `environments/desktop-production/variables`와 룰셋 `current_user_can_bypass` 포함.
  - D7 범위 밖(시크릿 범위 변경은 이번 목표 Non-goal) — 후속 과제로 D 요약과 040에 기록.
  - D8 수용 — T3 유지. dry run은 자산 allowlist를 검증하지 않으므로 T4-3 Draft 확인이 그 역할. 040:32-34의 "dispatch는 서명 안 함" 서술은 SoT sync에서 정정.
  - D9–D11 — wp2 P의 입력으로 이월(020에서 재검증).

Reflection: 같은 architect가 rev 1에 ALIGNED, 본문 gap 4건(T1-6 기본 경로, T2-5 readback, bypass
잔여 위험, T4 사전 태그 확인) → 모두 본문에 반영(rev 2).

## A — 독립 감사 (rev 2 → rev 3)

감사자 `01a0cacf-742d-7463-81aa-2d37817baf47` (Russell), VERDICT: NEAR-PASS. 처분:

1. MAJOR 로컬 Gatekeeper가 공개 뒤 → 수용, T4-3(승인 전)으로 이동.
2. MAJOR DMG stapler 검사 → 수용, 마운트한 .app만 검사, DMG 자체는 참고.
3. MAJOR wp2 조기 머지가 rerun을 깨뜨림 → 수용, T1-6 순서 규칙 추가.
4. MINOR 승인 API 미기재 → 수용, pending_deployments 호출 명시.
5. MINOR T3 산출물 확인 부족 → 수용, 다섯 파일·x64 부재·ok:true.
6. MINOR fallback attestation 공백 → 수용, 사용 시 기록.
7. MINOR 040의 dispatch 무서명 서술 → 이미 SoT sync 대상(D8).

## B 중 발견 — 서명 빌드의 `--publish` 중복 (B-1 수정)

T3 dry run(run 35781284918)에서 Developer ID 서명과 공증은 성공했으나(`notarization successful`,
20:55:10Z) 그 뒤 electron-builder가 GitHub 업로드를 시도해 `GitHub Personal Access Token is not set`으로
실패했다. #260이 `desktop/package.json`의 `dist:mac`에 `--publish never`를 넣었고 워크플로도
같은 플래그를 붙여, CLI가 `["never","never"]`를 받아 "never" 판정을 통과하지 못했다. PR 미리보기는
electron-builder가 PR 빌드의 게시를 항상 끄므로 이 결함을 드러내지 못했다. 태그 빌드도 같은 경로라
dry run 없이 태그를 올렸다면 첫 실전 릴리스가 여기서 실패했을 것이다.

수정: 워크플로 두 mac 명령에서 중복 플래그 제거(스크립트가 소유), `tests/desktop-signing-policy.test.ts`가
스크립트+워크플로 합산 `--publish` 1회를 요구. 수정 전 워크플로로 되돌리면 이 테스트가 실패하는 것을 확인.

계획 영향: desktop 태그는 릴리스 SHA `bfb83da5`가 아니라 이 수정이 dev에 머지된 커밋에 붙는다.
루트 `package.json` 버전은 그대로 3.17.0이라 태그 검증(desktop.yml:177-181)을 통과하고, 패키징되는
앱 코드는 npm 3.17.0과 같다(차이는 워크플로·테스트·devlog). 머지 뒤 그 커밋에서 T3를 다시 돌린 다음 T4.
