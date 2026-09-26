# 010 — wp2: PR #325 리뷰 + polish

Scope: PR #325 diff (+605/-217, 35 files) 전수 리뷰. 확인된 지적만 PR 브랜치에 push.

## MODIFY / NEW / DELETE map

리뷰 대상 (PR이 이미 변경한 파일; polish는 이 범위 안에서만 발생):
- desktop/preload.cjs — 비-file: 브랜치가 platform + openSettings를 노출 (D1-1 최고위험).
  window-open.mjs 네비게이션 가드가 main window를 127.0.0.1에 묶는지 확인.
- desktop/lib/windows.mjs — titleBarStyle hiddenInset(darwin)/default(기타),
  TRAFFIC_LIGHT_POSITION {x:16,y:13}. CSS --chrome-top-h: 40px와 일치 검증.
- desktop/lib/menu.mjs — focused() retarget이 비어있지 않은 host webContents를 처리하는지.
- desktop/lib/titlebar.mjs, desktop/pages/titlebar.html/js, desktop/lib/ipc.mjs,
  desktop/lib/context-menu.mjs, desktop/lib/edit-menu.mjs
- ui/src/App.tsx, components/{NavRail,RightPanel,Sidebar,SidebarTopStrip}.tsx,
  hooks/useSidebarCollapse.ts, lib/desktopShell.ts — Cmd/Ctrl+B editable-target guard,
  desktopBridge() 게이트, app--macos 조건부 drag region, localStorage 키
  (ima2.sidebarCollapsed, rightPanelOpen) 충돌 여부.
- ui/src/styles/{top-strip,right-panel,responsive-mobile}.css, index.css —
  pointer-events:none/auto 조합, Windows 무traffic-light 레이아웃 붕괴 여부.
- ui/src/i18n/{en,ko,zh-Hans,zh-Hant}.json — 새 문자열 4개 로케일 동시 존재.
- tests/desktop-titlebar-contract.test.ts, ui-touch-target, radius-scale, gallery-navigation —
  계약 테스트가 실제 새 동작을 묶는지.

수정 방식: 확인된 지적만. 각 수정은 별도 커밋, push 전 lint+typecheck 통과.

## TESTS

- npm run typecheck && npm run typecheck:tests
- npm run lint (0 errors)
- npm test (preexisting nai-subscription-contract env failure 1건은 허용 — PR body 기록 baseline)
- npm run test:inventory && npm run lint:pkg
- cd ui && npm run build
- tests/desktop-titlebar-contract.test.ts 단독 실행

## Verification (C)

1. gh pr view 325 --json headRefOid → 최종 head SHA 기록 (각 polish push 후 갱신).
2. gh api repos/lidge-ai/ima2-gen/commits/<SHA>/check-runs?per_page=100 — 전 check SUCCESS.
3. 리뷰 지적 표: 지적/판정(fix|rebut)/근거 file:line.
Exit: 0 failures, pending 없음, exact head SHA 일치.

## Review outcome (2026-09-26)

- 독립 리뷰(kimi Galileo) + main 리뷰: VERDICT PASS, blockers=0. preload 최소 브리지
  (platform+openSettings만)와 will-navigate/isTrustedSender 가드가 유지됨을 확인.
- Low #1 dead exports 수정: App.tsx가 isMacDesktop()을 쓰도록, readSidebarCollapsed의
  불필요한 export 제거.
- Low #2 loading drag strip이 Windows/Linux에서 dead space였던 것을 :root[data-platform]
  게이트로 darwin 전용화 (loading.js가 bridge platform을 기록).
- Low #3 (.right-panel.collapsed CSS) 반박: 모바일 드로어 경로가 아직 collapsed 클래스를
  사용하므로 dead code가 아님. 이 PR의 regression도 아니어서 후속 과제로 남김.
- Polish 커밋: 1e4df794 (PR 브랜치 push). 로컬 게이트: tsc x2 clean, eslint 0 errors,
  계약 테스트 41/41 pass.
