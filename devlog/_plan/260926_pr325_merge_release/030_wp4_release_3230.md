# 030 — wp4: v3.23.0 릴리스 + 배포

## MODIFY / NEW / DELETE map

- 프로모션 PR: dev→main, gh pr create --base main --head dev + merge **merge commit**
  (#324 패턴 7af92857; squash로 dev 커밋을 재작성하지 않는다).
- gh workflow run release.yml -f bump=minor -f dry_run=false -f expected_sha=<origin/main SHA>
  (release-cut.mjs:53-57 preflight: main이 dev+preview를 포함해야 함).
- release.yml 진행: version commit → verify:release → candidate ref CI → main/preview push →
  publish.yml preview dispatch → npm-stable 환경 승인 대기(tag job) → main/dev/tag atomic push →
  publish.yml stable dispatch → 두 번째 npm-stable 승인 → create-github-release.
  승인 전제: npm-stable / desktop-production 환경은 required_reviewers=1 — 승인 actor가
  지정 reviewer(lidge-jun)여야 하며 write 권한만으로는 부족하다.
  절차: GET repos/lidge-ai/ima2-gen/actions/runs/<run>/pending_deployments →
  environment_ids 추출 → POST {environment_ids:[...], state:"approved"}.
  80분 타임아웃(release.yml:240) — 상시 감시.
- v3.23.0 tag 확인 후 같은 커밋에 desktop-v3.23.0 push → desktop.yml 3플랫폼 빌드 →
  draft → desktop-production 승인 → publish.
- pages.yml dispatch: -f release_sha=<tag sha> -f release_version=3.23.0 (stable publish 증거 후).

## Rollback / recovery

- preflight(assertBaseline) 실패: 아직 아무 ref도 안 움직임. baseline을 맞추고 재dispatch.
- atomic push(main+dev+v3.23.0 tag) 성공 후 stable publish 실패/거절: refs를 되감지 않는다
  (tag는 immutable, npm은 3.22.0 유지). 복구는 publish.yml의 verify-existing job 또는
  tag 대상 stable 재dispatch — rerun이 immutable registry 상태를 먼저 확인한다
  (structure/06-infra-operations.md publish 절 참조).
- desktop draft만 생기고 publish가 멈춘 경우: desktop-production 승인 후 재개;
  잘못 버전된 tag는 삭제 후 같은 커밋에 재생성(desktop.yml:213-218 버전 검증).

## TESTS

없음 (release.yml 내부 verify:release가 canonical gate).

## Verification (C)

1. npm view ima2-gen version == 3.23.0, npm view ima2-gen dist-tags.latest == 3.23.0.
2. gh release view v3.23.0 — manifest + SBOM 첨부, Latest 표시.
3. gh release view desktop-v3.23.0 — draft 아님, asset allowlist(desktop.yml:343-361) 일치, Latest 아님.
4. npm audit signatures (ima2-gen@3.23.0) 통과.
5. pages.yml run success (release_sha/version 바인딩 env 확인).
Exit: 1-5 전부 충족.
