# 040 — wp5: 타이틀바 레이아웃 수정 (PR #327)

Trigger: 머지 후 실기에서 사이드바 로고 행 깨짐 ("ima2"가 "'2"로 클리핑, 셀렉트 과밀).

## Root cause (측정 근거)

- .logo 행 scrollWidth 242px vs clientWidth 227px (260px 사이드바 - 패딩).
- .logo-copy가 flex 축소로 width 0까지 collapse → 워드마크 클리핑.
- PR #325가 .logo를 40px로 pin하면서 과밀이 표면화 (selects는 이전부터 같은 행).

## Fix (브랜치 codex/fix-titlebar-layout)

- Sidebar.tsx: .logo는 BrandMark + 워드마크(+ desktop logo-host)만, 컨트롤은
  새 .sidebar-controls 행으로 분리 (OpenCodex/ZCode 패턴: 브랜드 행은 깨끗하게,
  컨트롤은 아래 행).
- sidebar.css: .logo-actions → .sidebar-controls; 셀렉트 flex: 1 1 0 + ellipsis.
- 리뷰 반영: flex-wrap 유지 (catalog-state/에러 행의 basis 100% wrap 보존).

## Verification

- 라이브 측정: .logo/.sidebar-controls overflow 0, gpm flex-wrap=wrap.
- 게이트: tsc x2, eslint 0 errors, 계약 테스트 41/41, ui:build.
- 스크린샷: pr-assets 867ad9cc 260927-titlebar-fix/ (corner + full).
