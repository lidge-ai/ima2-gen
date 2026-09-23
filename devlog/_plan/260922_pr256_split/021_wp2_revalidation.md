---
created: 2026-09-23
tags: [ima2-gen, pr256, wp2, node-ui]
---

# 021 — WP2 재검증과 실행 계획 (dev `9d4383dc`)

wp1 D 결론 인용: "WP1 머지 완료(#259, dev 9d4383dc). 다음은 로드맵대로 WP2 노드 UI." 방향 변경 없음.
020의 추출 목록을 현재 트리에서 다시 확인했다. 기여자 PR 헤드는 e3a731cb → aa116f84로 움직였으나 추출은
고정 SHA(7b32f495, 65dcdae0, 450aa45b, 0ebf2389, 253ce44c) 기준이라 영향 없다.

## 현재 트리 사실

- ui/src/components/ImageNode.tsx 446줄(한도 500). 확대·헤더를 직접 넣으면 한도에 닿는다 → 020대로 분리.
- `AssetMediaLightbox`(ui/src/components/assetgen/AssetMediaLightbox.tsx:31)는 `useAgentDialogFocus(true, close)`
  (:41)로 포커스·닫기를 처리하고 role=dialog, aria-modal. 에셋 작업 버튼(키잉 :45, 벡터화 :52, 큐레이터 :49)이
  조건부로 붙는다. 노드 모드에는 해당 패널이 없으므로 노드에서 열 때는 숨긴다(아래 N2).
- 노드는 React Flow의 transform: scale() 안에 있어 lightbox를 `createPortal(document.body)`로 내보내야 한다(65dcdae0).
- CSS: radius는 manifest로 동결(tests/ui-radius-scale-contract) → 새 border-radius 선언 금지. 색은
  tests/ui-color-token-contract가 var() 참조를 검사 → 새 색은 기존 토큰 사용, 하드코딩 rgba/#fff 대신 토큰.

## 변경 (파일 지도)

| 파일 | 변경 | 출처 |
|---|---|---|
| NEW ui/src/components/node-canvas/NodeImagePreview.tsx | 이미지 + 확대 버튼 + portal lightbox, 열림 상태는 로컬 | 7b32f495, 65dcdae0 |
| NEW ui/src/components/node-canvas/NodeIdentityHeader.tsx | ID 텍스트(드래그 가능, 말줄임, 툴팁) + 복사 아이콘 버튼(nodrag) | 450aa45b 일부, 0ebf2389, 253ce44c |
| MODIFY ui/src/components/ImageNode.tsx | 미리보기 이미지 분기를 NodeImagePreview로, 헤더 삽입, ▶ → 필름 SVG | 위 + 65dcdae0 |
| NEW ui/src/styles/node-image-preview.css | .image-node__zoom, .image-node__id*, 호버 없는 기기에서 확대 버튼 표시, 토큰 색 | 위 (N6) |
| MODIFY ui/src/index.css | 새 CSS import(:286 뒤) | N6 |
| MODIFY ui/src/components/assetgen/AssetMediaLightbox.tsx | 선택 prop showAssetActions(기본 true) | N2 |
| MODIFY ui/src/i18n/{en,ko,zh-Hans,zh-Hant}.json | node.zoomImage, node.copyId. 복사 실패는 기존 toast.copyFailed 재사용 | 7b32f495, 450aa45b |
| NEW ui/e2e/node-image-preview.spec.ts | 확대 열기/Esc 닫기/포커스 복귀, lightbox가 노드보다 큼, 복사 ID, ID 드래그로 노드 이동, 복사 아이콘 드래그는 이동 없음, 스크린샷 1280×720 + 좁은 뷰포트 | 020 Proof |
| NEW tests/node-image-preview-contract.test.ts | 소스 계약: portal, .nokey 래퍼, nodrag 위치, 로케일 키 4개, lightbox showAssetActions 기본 true | 0ebf2389/253ce44c 테스트 취지, N2, N3 |
| structure/04, 05, 01 | 새 컴포넌트 등록, 줄 수 재생성 | 020 |

제외: 빈 슬롯 생성 차단(placeholderLeft), 노드 label·역할 선택, 동영상 확대, storeTypes.label — WP7/WP8 몫.
기여자 코드의 베트남어 주석은 영어로 옮기고 의미를 보존한다. 커밋 작성자는 TuanTicker, Original-Commit 트레일러.

## 검증

로컬: typecheck, typecheck:tests, test:inventory, structure check, 빌드 후 npm test, ui build(E2E typecheck).
hosted: exact-head 전 체크, E2E 스크린샷 두 장 확인. 머지는 --match-head-commit, 이후 dev CI.

## 조건부 경로

| 경로 | 활성 | 증거 |
|---|---|---|
| 확대 버튼 표시 | 호버·포커스·(hover:none) 기기 | E2E 키보드 포커스 후 Enter로 열기 |
| portal | 열림 | E2E: dialog 폭 > 노드 폭 |
| 닫기·포커스 복귀 | Esc | E2E: dialog 사라짐, 확대 버튼에 포커스 |
| 복사 | 복사 아이콘 클릭 | E2E: clipboard stub에 노드 ID |
| 드래그 분리 | ID 텍스트 드래그 vs 복사 아이콘 드래그 | E2E: 노드 위치 변화 / 불변 |
| 에셋 작업 숨김 | 노드에서 lightbox 열기 | E2E: dialog 안에 키잉·벡터화 버튼 없음. 계약: 기존 호출부 기본 true |
| 노드 키 처리 차단 | dialog 열린 상태의 화살표·Delete | E2E: 노드 위치·개수 불변 |
| 복사 실패 | clipboard 쓰기 거부 | toast.copyFailed 토스트(단위 수준에서 확인 어려워 E2E stub이 reject하도록 한 번 더 확인) |


## Architect consultation (Locke, `01a0cb57-f9c2-7e52-8122-f72fae015ef3`) — 처분

- N1 수용: `NodeImagePreview({ imageUrl, prompt })`(준비된 비디오 아닌 이미지에서만), `NodeIdentityHeader({ nodeId })`,
  복사는 기존 `copyTextToClipboard`(ui/src/lib/clipboard.ts:1)로 실패 처리, 클래스는 `image-node__id-text`, d.label 제외.
- N2 수용(위 "현재 트리 사실"의 판단을 뒤집음): 노드 모드에는 KeyingPanel/VectorizePanel이 마운트되지 않아(App.tsx:177-178)
  노드에서 누른 에셋 작업은 보이지 않는 전역 대상만 남긴다. `AssetMediaLightbox`에 선택 prop
  `showAssetActions?: boolean`(기본 true)을 더해 canKey/canVectorize/canCurate를 막고, 기존 두 호출부는 그대로.
- N3 수용: portal 내용을 `<div className="nokey" onClick={stop}>`로 감싸 React Flow 노드 키 처리(Delete·화살표·Esc)를
  막는다. keydown 전파는 멈추지 않는다(useModalFocus의 문서 수준 Escape 유지).
- N4 수용: 포커스 복귀는 useModalFocus가 처리(:44, :102-103). 확대 버튼은 hover·focus-visible·focus-within에서 표시.
- N5 수용: `@media (hover: none), (pointer: coarse)`에서 opacity 1, 32px 이상. border-radius 추가 없음.
- N6 수용: 새 파일 ui/src/styles/node-image-preview.css(index.css:286 뒤 import), `--scrim`/`--scrim-strong`/`--on-scrim`,
  복사 아이콘 `--text-muted`→hover `--accent`. 파일 지도의 node-workspace.css 행은 이 새 파일로 대체.
- N7 수용: addInitScript로 clipboard.writeText를 기록 함수로 바꿔 정확한 ID 확인.
- N8 수용: 드래그는 bounding box 비교(ID 텍스트 > 60px 이동, 복사 아이콘 ≤ 1px), 키보드로 확대 열기, dialog 폭 > 노드 폭,
  Esc 후 포커스 복귀, dialog 열린 상태에서 화살표·Delete가 노드를 움직이거나 지우지 않음. WF-13 취지는
  tests/node-image-preview-contract.test.ts로.
- N9 수용: structure/05:18, :51, structure/04:185, lightbox prop 설명, 01 재생성.
- 위험(수용): dialog 열린 채 그래프 재로드·세션 전환으로 노드가 언마운트되면 포커스 복귀 대상이 없다. N3는
  dialog 안의 키보드 삭제만 막는다.

Reflection: Locke ALIGNED, gap 5건(17-18행, 파일 지도, N2/N3 증거, 복사 실패 키, 언마운트 서술) → 반영(rev 2).

## A — 독립 감사 (Poincare, `01a0cb9e-3821-7fe0-909d-bee63544d7e1`) VERDICT: NEAR-PASS

처분(전부 수용):
1. MAJOR portal 키가 NodeCanvas.tsx:114의 onKeyDown(graphHistoryChord, nodeStudioKeyboard.ts:26-32)으로 올라가 Cmd/Ctrl+Z가
   그래프를 되돌린다 → 래퍼 onKeyDown에서 Escape·Tab 외 키의 전파를 멈춘다(두 키는 문서 수준 useModalFocus 몫).
   E2E: dialog 안 Cmd/Ctrl+Z 뒤 그래프 불변.
2. MAJOR node.animateTitle이 네 사전 모두 없고 KNOWN_MISSING(tests/i18n-dictionary-contract.test.ts:264)에 있다 →
   네 로케일에 추가하고 KNOWN_MISSING에서 제거.
3. MINOR vectorize-panel-contract.test.ts:19가 canVectorize 식 줄을 고정 → 식은 두고 렌더 지점에서 showAssetActions로 막는다.
4. MINOR .image-node__preview에 position: relative 추가(새 CSS 파일).
5. MINOR 새 테스트 파일 → docs/migration/runtime-test-inventory.md 재생성.
6. MINOR 키 차단 E2E는 노드가 .selected인지 먼저 확인.
7. MINOR 복사 성공에 기존 toast.metadataCopied 토스트.
8. MINOR clipboard stub은 page.goto 전 addInitScript, navigator.clipboard는 Object.defineProperty로 교체.

## B 중 관찰

첫 hosted 실행(run 35801885466)에서 E2E가 undo 기록을 만들려고 누른 "자식 노드 추가" 뒤에도 노드가 1개였다
(실패 컨텍스트에 DOM 스냅샷 없음). 원인은 확인하지 못했다. 이 경로를 증명 수단에서 빼고 WP1에서 hosted로
검증된 드래그 연결을 undo 기록으로 쓴다. 후속: hosted에서 자식 추가 버튼이 노드를 만드는지 별도 확인.
