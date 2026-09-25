---
created: 2026-09-22
updated: 2026-09-22
tags: [ima2-gen, desktop, macos, release, check]
---

# 041 — 릴리스 워크플로 정리 check evidence

## Outcome

4단계 repository contract를 구현하고 로컬 검증을 통과했다. PR·수동 candidate, signed tag
build, verified Draft, protected publish의 경계를 workflow에서 분리했다. 실제 GitHub
Environment/ruleset 생성, tag push, Apple notarization, Draft/Public Release는 실행하지 않았다.

## RED → GREEN

- RED: 준비 모듈 부재, 단일 release job, receipt 미생성으로 focused 11 tests 중 6 fail.
- GREEN: 자산 준비·workflow·credential focused tests 13 pass, 0 fail.
- Action pin 25 tests를 포함한 release/security focused set은 38 pass, 0 fail.

## Fresh checks

| Check | Result |
|---|---|
| focused desktop release tests | 13 pass, 0 fail |
| workflow shell simulation tests | 5 pass, 0 fail |
| real-artifact asset preparation dry run | PASS on the phase-3 arm64 build |
| focused + action pin tests | 38 pass, 0 fail |
| `npm run typecheck` | exit 0 |
| `npm run typecheck:tests` | exit 0 |
| `npm run test:inventory` | exit 0; 495 total, 225 runtime, 270 contract |
| `npm run docs:runtime:check` | exit 0; changedPaths `[]` |
| `npm test` | 3,571 tests; 3,566 pass, 0 fail, 5 skip |
| `npm run audit:gate` | root high+ 0; UI unexcepted high+ 0, 2 dated exceptions |
| `npm --prefix desktop audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| workflow Bash block `bash -n` sweep | PASS |
| workflow YAML/action pin parse | PASS; every external Action full-SHA pinned |
| unsigned app receipt negative path | expected verification failure; receipt absent |
| `git diff --check` | PASS |

`actionlint` 실행 파일은 환경에 없어 별도 결과를 주장하지 않는다. 로컬 independent reviewer
dispatch는 cli-jaw service가 stopped/fetch failed 상태여서 결과를 얻지 못했다. 이를 독립
감사로 표현하지 않으며, RED→GREEN 부정 테스트, 전체 suite, shell syntax와 최종 diff
self-audit를 근거로 남긴다.

## Contract evidence

- `macos-15`는 2026-09-22 GitHub 공식 hosted-runner 표에서 M1/arm64 standard runner다.
- candidate는 Apple secret expression 없이 unsigned artifact만 만든다.
- tag build만 다섯 credential을 사용하고 실제 signature Team ID가 configured Team ID와
  일치해야 receipt를 만든다.
- `latest-mac.yml`은 외부 npm dependency 없이 strict schema, exact arm64 URL set, size,
  per-file/top-level SHA-512를 재검증한다.
- Draft upload는 DMG, ZIP, 두 blockmap, metadata, SHA-256 목록의 여섯 파일만 명시한다.
- publish job은 `desktop-production` marker를 확인하고, Draft asset을 다시 내려받아 Draft
  job output에 결박된 checksum-list digest, 각 파일 digest, Release notes digest를 재검증한다.
- existing public release rerun과 asset/notes TOCTOU mutation은 publication 전에 실패한다.

## Executed shell and artifact proof (2026-09-23)

계약 테스트는 workflow 텍스트만 읽으므로 quoting 실수나 뒤집힌 조건을 잡지 못한다.
`tests/desktop-release-workflow-shell.test.ts`가 실제 `run:` 블록을 stub `gh`와 함께 Bash로
실행한다. Draft 생성은 여섯 자산만 업로드하고 `--verify-tag --target <sha> --draft`를 쓰며,
승인 경로는 자산을 다시 올리지 않고 `--draft=false --latest=false`만 호출한다. 거부 경로 5종
(자산 추가, 산출물 교체, checksum 목록 재작성, notes 편집, draft 해제)은 모두 공개 전에 실패했다.

비공허성은 mutation으로 확인했다. workflow에서 notes digest 가드를 임시로 제거하자 해당
테스트가 `publication survived: the release notes are edited`로 실패했고, 복구 후 workflow는
커밋된 HEAD와 바이트 동일했다.

`prepare-release-assets.mjs`는 합성 fixture가 아니라 3단계의 실제 electron-builder 산출물
(DMG 278,814,655 B / ZIP 270,591,037 B / blockmap 2종 / `latest-mac.yml`)에 대해 실행했다.
엄격 파서가 실제 metadata를 통과했고 생성된 SHA-256은 031 evidence의 기록값과 일치했으며
독립 `shasum -a 256 -c`가 5개 파일 전부 OK를 반환했다.

## Permission finding

```text
repos/lidge-ai/ima2-gen permissions (parkjs101): admin=false, push=true, triage=true
repos/lidge-ai/ima2-gen/actions/permissions: 403
```

운영 계정에 admin이 없어 Environment와 tag ruleset을 이번 단계에서 생성하지 못했다. 소유자
계정에서 실행할 명령은 `040_release_workflow_cleanup.md`에 기록했다. 기존 `npm-stable`과
`provider-canary-live`가 `prevent_self_review=false`에 리뷰어 `lidge-jun` 단독인 것을 확인하고,
단일 리뷰어 상태에서 self-review 방지를 켜면 승인 불가로 잠긴다는 점을 반영해 040과
`structure/06-infra-operations.md`의 권고를 수정했다.

## External configuration state

2026-09-22 read-only GitHub API:

```text
GET /repos/lidge-ai/ima2-gen/environments/desktop-production -> 404 Not Found
GET /repos/lidge-ai/ima2-gen/rulesets -> active branch ruleset 1, tag ruleset 0
```

따라서 실제 release 전 필수 후속 설정은 다음 두 가지다.

1. `desktop-v*` tag creation/update/deletion ruleset과 제한된 bypass actor.
2. required reviewer, prevent self-review, admin bypass off, selected tag policy 및
   `DESKTOP_RELEASE_GATE=required-reviewer-v1`을 가진 `desktop-production` Environment.

Workflow marker는 존재하지 않는 Environment가 무보호로 자동 생성되는 경우 공개를 막지만,
required-reviewer 설정 자체를 증명하지는 않는다. Tag ruleset이 없으면 write actor의 임의 tag가
repository signing secret을 사용할 수 있으므로 설정 전 live tag는 금지한다.

## Residual risk / next proof

- repository admin의 workflow/Environment/ruleset 변경과 수동 GitHub Release 업로드·공개는
  최종 우회 경로다.
- 실제 Developer ID signing/notarization, GitHub approval UI, public asset download, Gatekeeper
  first launch와 signed two-version updater는 5단계 live 검증이 필요하다.
- 이번 단계에서는 외부 state를 변경하지 않았고 production readiness를 주장하지 않는다.
