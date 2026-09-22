---
created: 2026-09-23
tags: [ima2-gen, pr256, wp1, integration, node-graph]
---

# 012 — WP1 dev 통합과 드롭 핸들 정규화

PR #259(WP1)는 dev가 14커밋 움직여 충돌했고, 이전 헤드 `aeb9b56d`의 hosted E2E
`node-multi-parent.spec.ts`가 실패해 PR fast gate가 빨갛다(run 35730836981). 이 사이클은 #259를
현재 dev `0d45bcdc`에 통합하고 그 실패의 원인을 고쳐 스쿼시 머지까지 간다.

## 원인 (증거)

- 실패 시점 DOM(`pr-fast-e2e-failure-context`의 error-context.md)에 엣지가 0개다. 라벨 문제가 아니라
  두 연결 모두 만들어지지 않았다.
- `ImageNode`는 네 방향마다 target/source 핸들을 같은 자리에 그린다(ui/src/components/ImageNode.tsx:234, :434).
  target 핸들은 `opacity:0; pointer-events:none`, source 핸들은 z-index 2에 `::before inset:-9px` 히트 영역
  (ui/src/styles/node-polish.css:14-28).
- @xyflow/system 0.0.82 `isValidHandle`은 포인터 아래 핸들을 가장 가까운 핸들보다 우선한다
  (node_modules/@xyflow/system/dist/esm/index.js:2624-2629). 보이는 점 위에 놓으면 그 요소는 source 핸들이라
  connection.targetHandle = `source-left`가 된다.
- `resolveNodePort(target, "source-left", "input")`은 null(ui/src/lib/nodePortCatalog.ts:78-83) →
  `isValidFlowConnection` false → React Flow는 onConnect를 부르지 않고, onConnectEnd는 toNode가 있어
  조용히 끝난다. 사용자는 점 위에 정확히 놓으면 연결되지 않고, 점에서 14~32px 떨어져 놓아야만 된다.
  dev에도 있던 결함이며 WP1의 다중 부모 드래그에서 핵심 경로다.

## 변경

1. `git merge origin/dev`(이미 수행, 커밋 전): 유일한 충돌 `docs/migration/runtime-test-inventory.md`는
   생성 파일이라 `node scripts/classify-tests.mjs`로 재생성(Total 502 = 브랜치 497 + dev 신규 5).
   검토된 커밋 보존, force-push 없음, 최종은 스쿼시.
2. 드롭 핸들 정규화: image 노드의 source 핸들에 떨어진 입력 쪽 연결을 같은 위치의 target 핸들로 바꾼다
   (`source-left` → `target-left`). 검증(`isValidFlowConnection`)과 저장(`onConnect` → `connectNodes`)이
   같은 정규화를 거쳐 저장 엣지는 항상 `target-*`를 쓴다. 위치: ui/src/lib/nodeConnectionValidation.ts에
   `normalizeFlowConnection`을 두고 useNodeConnectionController.ts의 두 경로에서 사용.
3. 테스트: tests/node-cycle-contract.test.ts에 — source 핸들 드롭이 유효하고 정규화된 targetHandle을 내는지,
   target-*·요소 노드·알 수 없는 핸들은 그대로이고 뒤 둘은 거부되는지, source-* 대상의 자기·사이클 연결은
   거부되는지. E2E(ui/e2e/node-multi-parent.spec.ts)는 저장된 두 엣지의 target 핸들이 `target-*`인지 확인.

## 검증

로컬: typecheck, typecheck:tests, test:inventory, structure line-count check, 빌드 후 npm test, ui build(E2E
typecheck 포함). hosted: PR의 exact-head check-runs 전부, 특히 PR frontend checks(E2E)와 스크린샷
artifact `wp12-multi-parent-ko.png` 확인. 머지는 `--match-head-commit`, 이후 dev CI.

## 조건부 경로

| 경로 | 활성 | 증거 |
|---|---|---|
| source 핸들 드롭 정규화 | targetHandle이 image 노드의 source-* | 단위 테스트 + hosted E2E의 실제 드래그와 저장 엣지의 target-* 핸들 |
| 정규화 대상 아님 | element 노드, 이미 target-*, 알 수 없는 핸들 | 단위 테스트(변경 없음/거부) |
| 사이클 거부 유지 | target→base 드래그 | E2E 기존 단계, 단위 테스트 |


## Architect consultation (Locke, `01a0cb57-f9c2-7e52-8122-f72fae015ef3`)

- W1 수용 — `normalizeFlowConnection(connection, nodes)`를 nodeConnectionValidation.ts에 둔다. target 노드가
  imageNode이고 targetHandle이 그 노드의 `source-X`이며 `target-X`가 입력으로 해석될 때만 바꾼다. 유효성은
  판단하지 않는다. `resolveNodePort`는 방향 엄격성을 유지(onConnectEnd·팔레트가 의존).
- W2 수용 — isValidFlowConnection은 정규화 후 해석, onConnect는 한 번 정규화한 결과로 resolve·canConnect·
  connectNodes까지 진행(원본을 connectNodes에 넘기지 않는다).
- W3 수용 — connectNodesImpl 무변경.
- W4 수용 — CSS/핸들 순서 대안은 드래그 시작을 깨거나 xyflow 내부 클래스에 의존해 기각.
- W5 수용 — 팔레트·템플릿·자식 추가·끊기·분기는 이미 정식 핸들을 쓴다.
- W6 후속 — 2026-04-27~07-24 사이 저장된 `source-*` target 핸들 엣지는 남아 있을 수 있다. loose 모드가
  source 핸들도 찾아 그리기는 정상이고 부모 계산은 핸들을 보지 않지만, 중복 판정(nodeCompatibility.ts:55-61)이
  어긋날 수 있다. 로드 시 재작성은 저장 그래프를 바꾸므로 이번 범위 밖. 추적: 아래 "후속" 절.
- 테스트: node-cycle-contract.test.ts에 (1) source-left 드롭 유효 + target-left 정규화 (2) target-*/요소 노드/
  알 수 없는 핸들 무변경, 뒤 둘은 거부 유지 (3) source-* 대상의 자기·사이클 연결 거부 유지. E2E는 저장 엣지의
  target 핸들이 `target-*`인지 확인(서버 edge 형태 확인 후).

## 후속

- [ ] 과거 `source-*` target 핸들 엣지: 로드 시 `target-*`로 정규화할지, 중복 판정만 동치로 볼지 결정(W6).

Reflection: Locke ALIGNED, 작은 gap 3건(§3 본문, 그리기 서술, W6 추적 위치) → 반영(rev 2).

## A — 독립 감사 (Ohm, `01a0cb59-cb04-7f33-9bf4-b48045db1c4c`) VERDICT: NEAR-PASS

블로커 없음. 원인 분석, 끊기 버튼 이름(NodeBatchBar.tsx:49-50), 사이클 단계, 인벤토리 병합(494+3+5=502) 확인.
처분: (1) 히트 반경 수치 — 호버 시 약 16px, 본문 서술은 근사로 둔다. (5) 끊기 단계 경쟁 — 수용, 마지막 엣지
읽기를 `expect.poll`로 감싼다. (6) readEdges 타입 — 수용, `targetHandle` 추가. (9) W6 — 수용, connectNodesImpl
:425-428이 같은 두 노드의 새 엣지를 핸들과 무관하게 건너뛰므로 과거 엣지로 중복 저장은 생기지 않고 최악은
조용한 무동작이다. 후속 항목은 그 정도의 UX 문제로 낮춘다.
