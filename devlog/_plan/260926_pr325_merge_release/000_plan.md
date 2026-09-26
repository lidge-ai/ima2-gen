# 000 — pr325_merge_release: Plan

## Objective

PR #325 (desktop integrated title bar + collapsible sidebar, devin bot,
head 7def7d1e, base dev, +605/-217, 35 files) 를 리뷰·다듬고 dev에 스쿼시 머지한 뒤,
post-merge dev CI를 확인하고, v3.23.0 릴리스를 컷·배포(npm/GitHub Release/desktop/site)한다.

Evidence base: PR #325 checks all green at 7def7d1e (PR Fast Gate backend/frontend,
screenshot-gate, CodeQL x2, changes). Repo at 6cf75909 = v3.22.0 == desktop-v3.22.0.
Architect: kimi subagent Arendt proposal D1-D7, reflection ALIGNED (2026-09-26).

## Loop-spec

- Loop archetype: verifier-defined (각 단계 exit code / gh·npm 출력이 판정 근거)
- Tools/credentials: local git, gh CLI (lidge-ai/ima2-gen write), npm scripts that only
  dispatch workflows; npm publishing은 CI OIDC(publish.yml)만 사용, 로컬 publish 없음.
  kimi 서브에이전트 무제한 (사용자 명시 승인).
- Write scope: 이 worktree, PR 브랜치 devin/1790417151-integrated-titlebar (polish push),
  dev (squash merge), 프로모션 PR dev→main (merge commit), release.yml이 관리하는 refs
  (main/preview/v* tag), desktop-v* tag push, npm-stable/desktop-production environment
  승인 (gh api pending_deployments), pages.yml dispatch.
- Out-of-scope: 다른 이슈/PR, Windows/Linux 실기 QA (CI 빌드까지만), native stack 기능.
- Budget/bounds: 사용자가 kimi 무제한 승인; main 세션 토큰 제한 없음(세션 내 완료).
  wall-clock: 이 세션. release.yml stable wait 상한 80분 — 승인 대기 중 상시 감시 필수.

## Work-phase map (one phase = one full PABCD cycle)

| WP | Doc | Slice | Depends on |
|----|-----|-------|------------|
| wp1 | (이 문서) | 로드맵 확정 (docs-first) | — |
| wp2 | 010_wp2_review_polish.md | PR #325 리뷰 + polish push + exact-head CI | wp1 |
| wp3 | 020_wp3_merge_dev.md | dev 스쿼시 머지 + post-merge dev CI | wp2 |
| wp4 | 030_wp4_release_3230.md | dev→main 프로모션, release.yml 컷, npm/GitHub/desktop/pages 배포 | wp3 |

## Accept criteria

- c-1: 이 로드맵 문서 세트가 커밋되어 리뷰/머지/릴리스 단계와 검증 명령을 포함한다.
- c-2: 확인된 PR #325 리뷰 지적이 전부 push된 커밋으로 수정되거나 문서상 근거와 함께 반박된다.
- c-3: PR 최종 head SHA에서 PR Fast Gate(backend+frontend), screenshot-gate, CodeQL이 green이다.
- c-4: origin/dev가 PR #325 스쿼시 머지 커밋을 포함하고, 그 커밋의 push CI(ci.yml 매트릭스 + desktop.yml unsigned mac)가 green이다.
- c-5: npm view ima2-gen version == 3.23.0, dist-tags.latest 일치, gh release view v3.23.0 존재, npm audit signatures 통과.
- c-6: gh release view desktop-v3.23.0 가 draft가 아니며 asset allowlist(desktop.yml:343-361)와 일치하고 repo "Latest" 릴리스가 아니다.
