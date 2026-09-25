---
created: 2026-09-22
updated: 2026-09-22
tags: [ima2-gen, desktop, macos, release, github-actions]
---

# 040 — Apple Silicon 릴리스 워크플로 정리

Status: complete — Environment/ruleset 적용과 첫 live release(desktop-v3.17.0, 2026-09-22)는
[260923 영수증](../260923_desktop_v3170_release/010_wp1_release_runbook.md#릴리스-영수증) 참조

## Scope

IN:

- PR은 Apple secret 없는 unsigned candidate. 수동 dispatch는 (아래 정정 참조) 서명·공증까지 하되
  Release를 만들지 않는 Actions artifact로 유지.
- `desktop-vX.Y.Z` 태그는 root app version과 정확히 일치할 때 동일 SHA에서 다시 빌드.
- Developer ID 서명, hardened runtime, timestamp, Gatekeeper, stapled notarization과 Team ID를
  확인하고 `release-verification.json` receipt를 Actions artifact에 보관.
- artifact의 version, URL, size, SHA-512, source tag/SHA를 재검증하고 SHA-256 목록 생성.
- Draft GitHub Release 생성과 `desktop-production` 승인 후 공개를 서로 다른 job으로 분리.
- 공개 Release asset exact allowlist와 운영 설정 절차 문서화.

OUT:

- 실제 tag push, Apple notarization 요청, Draft/Public Release 생성, Environment 설정 변경.
- 수동 GitHub Release 업로드 권한 제거 또는 repository admin 권한 정책 변경.
- Intel macOS, Windows, Linux 패키지 공개.

## Final workflow

```text
PR
  -> unsigned arm64 candidate
  -> Actions artifact only

workflow_dispatch (2026-09-23 정정: desktop.yml은 dispatch에서도 서명·공증한다)
  -> signed + notarized arm64 build, verification report
  -> Actions artifact only

desktop-vX.Y.Z tag
  -> signed + notarized arm64 build
  -> signature/notarization receipt
  -> exact metadata/digest validation
  -> Draft GitHub Release
  -> desktop-production required-reviewer approval
  -> exact asset-set recheck
  -> public GitHub Release
```

Draft/public assets:

1. `ima2-X.Y.Z-mac-arm64.dmg`
2. `ima2-X.Y.Z-mac-arm64.zip`
3. `ima2-X.Y.Z-mac-arm64.dmg.blockmap`
4. `ima2-X.Y.Z-mac-arm64.zip.blockmap`
5. `latest-mac.yml`
6. `SHA256SUMS.txt`

`release-verification.json`과 생성용 `RELEASE_NOTES.md`는 Actions artifact/runner 내부 증거이며
public asset으로 올리지 않는다. build SHA, Apple Team ID, authority와 각 검증 결과는 Release
notes에 기록된다. Blockmap은 electron-updater의 differential download 계약이므로 공개 자산에
남긴다.

## Production Environment setup

첫 live tag 전에 저장소 관리자가 GitHub Settings에서 다음을 구성해야 한다.

1. tag ruleset을 만들고 `desktop-v*` 생성·수정·삭제를 release 관리자에게만 허용하며
   bypass를 제한. Tag workflow는 repository signing secret을 사용하므로 이 규칙이 secret
   사용 전의 최종 신뢰 경계다.
2. `desktop-production` Environment 생성.
3. deployment branch/tag policy를 selected tags `desktop-v*`로 제한.
4. Required reviewers를 최소 1명 지정한다. 리뷰어가 소유자 1명뿐인 동안에는
   prevent self-review를 켜면 승인 가능한 사람이 없어 릴리스가 잠기므로 끈 채로 둔다.
   리뷰어가 2명 이상이 되면 그때 켠다.
5. administrator bypass를 허용하지 않도록 설정.
6. Environment variable `DESKTOP_RELEASE_GATE=required-reviewer-v1` 추가.

2026-09-22 read-only API 확인에서는 이 Environment가 `404 Not Found`로 아직 존재하지 않았다.
Repository ruleset 조회에서도 branch ruleset 하나만 있고 tag ruleset은 없었다.
GitHub는 존재하지 않는 Environment를 workflow가 참조하면 보호 규칙 없이 만들 수 있다.
따라서 publish job의 첫 단계가 environment-scoped marker를 검사하며, 설정 전 실행은 Draft를
공개하지 않고 실패한다. Marker는 required-reviewer 설정 자체를 기술적으로 증명하지는 않으므로
관리자 설정 검토가 여전히 필요하다.

### 관측된 저장소 실태 (2026-09-23)

```text
repository permissions (parkjs101)  admin=false, push=true
environments                        github-pages, npm-preview, npm-stable, provider-canary-live
npm-stable / provider-canary-live   required_reviewers=[lidge-jun], prevent_self_review=false,
                                    can_admins_bypass=true
rulesets                            branch ruleset 1개("Preserve main preview dev"), tag ruleset 0개
```

운영 계정 `parkjs101`은 admin이 아니므로 Environment/ruleset을 만들 수 없다. 아래 명령은
소유자 `lidge-jun` 계정에서 실행해야 한다. 이 명령들은 admin 권한이 없어 이번 단계에서
실행·검증하지 못했다.

```bash
gh api -X PUT repos/lidge-ai/ima2-gen/environments/desktop-production --input - <<'JSON'
{
  "wait_timer": 0,
  "prevent_self_review": false,
  "reviewers": [{ "type": "User", "id": 243035832 }],
  "can_admins_bypass": false,
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
}
JSON

gh api -X POST repos/lidge-ai/ima2-gen/environments/desktop-production/deployment-branch-policies \
  -f name='desktop-v*' -f type=tag

gh variable set DESKTOP_RELEASE_GATE --repo lidge-ai/ima2-gen \
  --env desktop-production --body required-reviewer-v1

gh api -X POST repos/lidge-ai/ima2-gen/rulesets --input - <<'JSON'
{
  "name": "Protect desktop release tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/desktop-v*"], "exclude": [] } },
  "rules": [{ "type": "creation" }, { "type": "update" }, { "type": "deletion" }],
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }]
}
JSON
```

`vars.DESKTOP_RELEASE_GATE`는 environment scope에 두어야 한다. repository scope에 두면
Environment가 없어도 marker가 통과해 gate가 무의미해진다.

References:

- GitHub deployments and environments:
  https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- GitHub environment management:
  https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- GitHub CLI draft publication:
  https://cli.github.com/manual/gh_release_edit

## Failure behavior

- tag/version mismatch, missing credential, wrong Team ID, unsigned/ad-hoc signature, missing hardened
  runtime/timestamp, Gatekeeper rejection, missing stapled ticket: artifact upload 전 실패.
- updater metadata의 version/file/size/SHA-512 mismatch 또는 receipt source SHA/tag mismatch:
  Draft 생성 전 실패.
- 기존 release가 이미 public: rerun이 asset을 덮어쓰지 않고 실패.
- production marker 누락: approval job이 publish command 전에 실패.
- Draft asset이 exact allowlist와 다름: 공개 전 실패.
- Draft 대기 중 asset bytes 또는 `SHA256SUMS.txt`가 교체됨: Draft job output에 결박된
  checksum digest 및 승인 job의 재다운로드 검증이 실패.
- 승인 후 `gh release edit --draft=false --latest=false`; npm release의 Latest 표시는 건드리지 않음.

## Enforcement and bypass

- Tier: E5 repository contracts + E6 GitHub Actions + E7 protected Environment settings.
- workflow는 third-party Action을 full commit SHA로 고정하고 build/publish job 권한을 분리한다.
- Draft는 approval 전에 만들어져 검토할 수 있고, publish job은 자산을 다시 내려받아 Draft
  job이 결박한 checksum digest와 모든 파일 digest를 검증한다. 새 artifact를 올리거나 기존
  public asset을 수정하지 않는다.
- repository admin이 workflow·Environment marker·보호 규칙을 함께 변경하거나 GitHub UI/API로
  Release를 수동 공개·업로드할 수 있는 권한은 최종 우회 경로다.
- tag ruleset 전에는 write 권한자가 임의 태그에 수정 workflow를 포함해 repository signing
  secret을 사용하게 만들 수 있으므로 live tag를 만들면 안 된다.
- 실제 required-reviewer 보호와 live release 성공은 5단계 운영 검증 전까지 미확인이다.

## Acceptance

1. candidate path는 unsigned이고 Apple secret expression이 없다.
2. tag path만 다섯 credential을 받고 서명·공증·receipt 검증 뒤 artifact를 올린다.
3. Draft creation은 production Environment 승인 전에 완료된다.
4. publish job만 `desktop-production`을 참조하고 marker 누락 시 fail closed한다.
5. public asset set은 위 여섯 파일과 정확히 일치하며 receipt는 공개하지 않는다.
6. Release notes에 build SHA, Team ID, Developer ID authority, hardened runtime/timestamp,
   Gatekeeper와 stapled notarization 통과가 기록된다.
7. focused/full tests, typechecks, inventory, action pin sweep, audit, diff audit가 통과한다.

Fresh 결과는 `041_check_evidence.md`에 기록한다.

### 적용 결과 (2026-09-22 21:0x UTC, 소유자 lidge-jun)

위 명령을 그대로 실행했고 readback으로 확인했다: desktop-production은 required_reviewers=[lidge-jun],
prevent_self_review=false, can_admins_bypass=false, deployment policy `desktop-v*`(tag); 환경 범위
`DESKTOP_RELEASE_GATE=required-reviewer-v1`, 저장소 범위 변수 없음; 태그 룰셋 23844976
"Protect desktop release tags" active, creation/update/deletion, admin bypass, 소유자
`current_user_can_bypass=always`.

남은 신뢰 경계 공백: Apple 서명 시크릿은 저장소 범위라 push 권한자는 dispatch나 수정한 워크플로로
태그 없이도 서명을 쓸 수 있다. 태그 룰셋은 공개 경로만 막는다. 시크릿을 태그 제한 환경으로 옮기는 것은 후속.
