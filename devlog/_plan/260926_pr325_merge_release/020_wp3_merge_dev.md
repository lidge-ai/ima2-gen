# 020 — wp3: dev 스쿼시 머지 + post-merge CI

## MODIFY / NEW / DELETE map

- remote-only 작업: gh pr merge 325 --squash (repo convention: feature PR = squash,
  근거 git log 단일부모 "(#NNN)" 커밋; repo settings squashMergeAllowed=true).
- 로컬 파일 변경 없음. 머지 후 dev fetch해서 확인만.

## TESTS

없음 (CI가 증거).

## Verification (C)

1. git fetch origin && git log --oneline -3 origin/dev — squash 커밋 "(#325)" 존재.
2. gh run list -R lidge-ai/ima2-gen --branch dev --commit <merge-sha>
   --json databaseId,event,headSha,status,conclusion,workflowName — event=push, ci.yml + desktop.yml 존재.
3. gh run view <id> --json status,conclusion,jobs — ci.yml의 test 매트릭스 +
   windows/macos-install 별도 job 전부 SUCCESS (aggregation job이 세 축을 강제),
   desktop.yml unsigned mac build SUCCESS. cancelled/skipped는 green이 아님
   (DEV-CI-EVIDENCE-01: 집계 job의 dependency까지 확인).
Exit: 관련 run 전부 conclusion=success.

## Merge record (2026-09-26)

- gh pr merge 325 --squash → origin/dev = eba67ec4 "desktop: integrated title bar +
  collapsible sidebar (Codex-style) (#325)".
