---
created: 2026-09-23
tags: [ima2-gen, pr256, wp4, templates, file-boundary]
---

# 041 — WP4 재검증과 실행 계획 (dev `51738f72`)

wp3 D 결론 인용: "WP3 머지 완료(#268). 다음은 WP4 이식 가능한 템플릿." 방향 변경 없음. 원본은 6a596ea0의 템플릿
경로만(lib/wfChain.ts, radius manifest 변경 제외).

## 현재 트리 사실

- 템플릿은 SQLite assets(kind=template)에 저장. `nodeTemplateStore.create`가 `stripGraphForTemplate`로 비밀 키(SECRET_KEY),
  결과·URL·요청 키(REMOVE_KEY)를 지우고 미디어 키는 `{placeholder, unresolved}`로 바꾸고 노드·엣지 ID를 재부여한다
  (lib/nodeTemplateStore.ts:15-79). 이름 1-80자, 태그 20개. create 경로는 `assertStrictGraph`(:108)를 쓰며 그 메시지는 엣지 ID를 담는다.
- 남는 런타임 식별자: serverNodeId, parentServerNodeId, extraParentServerNodeIds, clientId, pendingRequestId, pendingPhase,
  partialImageUrl(MEDIA_KEY 아님), templateProvenance, recovery 관련 키 — 이식 경계에서 제거 대상.
- 서버 JSON 본문 한도 50mb(config.ts:151) → import 라우트가 자체 2MB 한도를 둔다.
- routes/nodeTemplates.ts 100줄. 충돌하는 POST /:id·GET /:id 라우트는 없어 등록 순서는 기능상 무관하나 /import를 먼저 둔다.
- UI: NodeStudioOverlays.tsx:38이 Picker를 그린다(WP7 Runner 없음). useNodeTemplateController.ts의 mutations에 export/import 추가.

## 변경

| 파일 | 변경 |
|---|---|
| NEW lib/nodeTemplateFile.ts | 영어 이름. `TEMPLATE_FILE_KIND`, `TEMPLATE_FILE_VERSION=1`, `TEMPLATE_FILE_LIMITS`(노드·엣지 = 파일 한도 300/1200과 config 한도 중 작은 값, 2MB, 중첩 깊이 16, 설명 2000자, 태그 20개×40자), `buildTemplateFile`, `portableTemplateGraph`, `templateFileName`, `parseTemplateFile`, `uniqueTemplateName` |
| MODIFY server.ts | `/api/node-templates/import` 전용 express.json 2MB + 오류 매퍼(T6) |
| MODIFY routes/nodeTemplates.ts | `POST /api/node-templates/import`, `GET /api/node-templates/:id/export`(res.attachment) |
| MODIFY ui/src/lib/api-node-templates.ts | `exportNodeTemplate`, `importNodeTemplate`, DTO |
| MODIFY ui/src/components/node-canvas/{NodeTemplatePicker.tsx,useNodeTemplateController.ts,useNodeStudioController.ts,NodeStudioOverlays.tsx} | 카드별 내보내기(seed 포함), 가져오기 버튼+파일 입력, 파일 크기 선검사, 오류 코드→문구 |
| MODIFY ui/src/i18n ×4 | nodeStudio.templates.{export,import,importHint,exported,exportError,imported,importError,importNotTemplate,importNewerVersion,importTooLarge,importBadName,importInvalidGraph} |
| NEW tests/node-template-portable.test.ts | 아래 활성 시나리오 |
| NEW ui/e2e/node-template-portability.spec.ts | 내보내기 다운로드→가져오기→목록·토스트·포커스, 잘못된 파일 오류가 목록을 가리지 않고 성공 후 사라짐 |
| docs/API.md, structure/03/04/05, 01, inventory | 계약·경로 기재 |

필수 정정(030→040): `version === 1`(정수 1만), 바이트 한도는 전용 파서가 실제 바이트로 강제(T6, 문자열 길이 검사 없음),
`name.slice(0, 80 - suffix.length) + suffix`, 내보내기는 이식용 그래프.

이식 정제(`portableTemplateGraph`): 규칙은 아래 T3가 정본이다(키 목록, imageUrl → null, 요소 노드 elementId → null·missing: true,
자리표시자 보존). 저장소 계약은 바꾸지 않는다.

엄격 검증(`parseTemplateFile`): 객체 아님/kind 불일치/version≠1/이름 비정상/설명·태그 초과/노드 0개/한도 초과/노드 ID
중복·비문자열/엣지 ID 중복/끊긴 엣지/순환/중첩 깊이 초과 → 고정 코드와 고정 메시지(원문 값 미포함).
가져오기는 새 ID로 저장(store.create), 자동 실행·인스턴스화 없음. sourceId는 정보용(저장하지 않음).

## 활성 시나리오 (테스트)

라운드트립(seed·user, 새 ID, 노드·엣지 순서), 80자 이름 중복 → "…(2)" 80자 이내, kind 오류, version 0/-1/1.5/2/"1",
유니코드 다바이트로 2MB 초과, 잘못된 JSON(라우트), 순환/끊긴 엣지/중복 ID, 깊은 중첩, 중첩된 비밀·런타임 미디어·
서버 ID 제거(내보내기와 가져오기 양쪽), 가져온 템플릿이 실행 요청을 만들지 않음, 오류 응답에 원문 페이로드 없음,
직접 HTTP로 UI 크기 검사를 우회해도 서버가 거부. config 엣지 한도 초과, 요소 노드 정제, 깊은 중첩이 500이 아닌 400,
2MB 초과·깨진 본문이 전용 파서를 거쳐 고정 코드로 거부.

## 검증

집중 테스트, typecheck/typecheck:tests, inventory, structure, 빌드 후 전체, UI build, hosted E2E + 스크린샷.


## Architect consultation (`01a0cc50-3cf5-7791-aed5-0e75223cb0f0`) — 처분 (전부 수용)

- T1: API·오류 코드는 제안대로, 메시지는 모두 고정 문구(원본 버전 오류는 원값을 담아 거부).
- T2: 엣지 한도는 config 한도(config.ts:163-164, 1000)와 파일 한도 중 작은 값. 노드도 같은 방식.
- T3: `portableTemplateGraph` 제거 목록 = clientId, serverNodeId, parentServerNodeId, extraParentServerNodeIds, pendingRequestId,
  recoveryRequestId, pendingPhase, pendingStartedAt, partialImageUrl, referenceImages, error, errorInfo, elapsed, webSearchCalls,
  videoContinuity, videoLineage, canvas*Filename, templateProvenance, revision, diagnostics + SECRET_KEY(스토어에서 export).
  미디어: imageUrl → null, thumbnailUrl/outputUrl/url/src 제거, seed 자리표시자 {placeholder, unresolved} 보존.
  요소 노드: elementId → null, missing: true. 보존: 프롬프트·공급자·모델·위치·크기·엣지 순서·핸들·viewport·manifest.
  내보내기와 가져오기(create 전) 모두 같은 정제.
- T4: 서버 로컬 Kahn 순환 검사, 재귀 전에 명시적 스택으로 중첩 깊이 측정(최대 16).
- T5(계획 정정): create 경로에 assertStrictGraph가 있다(nodeTemplateStore.ts:108). 그 메시지가 엣지 ID를 담으므로
  가져오기 파서가 먼저 거부한다. create에는 골라낸 필드만 넘긴다(stripOptions 불가).
- T6: server.ts에 `/api/node-templates/import` 전용 `express.json({ limit: 2MB })`와 오류 매퍼(entity.too.large →
  TEMPLATE_FILE_TOO_LARGE 413, entity.parse.failed → TEMPLATE_FILE_INVALID 400)를 MCP 전용 파서 옆에 둔다(파일 지도에 server.ts 추가).
  Buffer.byteLength(JSON.stringify) 이중 검사는 제거(실제 바이트는 파서가 셈, 재귀 위험).
- T7: `res.attachment(slug)`, ASCII 슬러그 80자, 빈 결과는 "template".
- T8: 클라이언트는 2MB 초과를 file.text() 전에 거부하고 원문 텍스트를 그대로 POST. jsonFetch의 .code 매핑 사용.
  UI 결함 수정: 템플릿 오류가 목록 전체를 숨김(NodeTemplatePicker.tsx:95) → 가져오기 오류는 버튼 옆 별도 role=alert,
  성공 시 오류 초기화, 다운로드 앵커를 문서에 붙여 클릭 후 setTimeout으로 URL 해제.
- T9: E2E는 startApp/seedBrowser 기반, download 이벤트로 내보내기 파일 확보, filechooser로 가져오기, 카드·토스트·오류·포커스 확인.
  원본 NTX-11(소스 문자열) 대신 E2E, NTX-08은 POST 전용 회귀로 유지.
- T10: docs/API.md(:803-807 부근), structure/01:307-308, 03/04/05, inventory, 4개 로케일.
- 위험(기록): 기존 템플릿의 imageUrl 자리표시자 객체가 normalizeTemplateNode(nodeStudioGraph.ts:45-47)로 data에 퍼지는 문제는
  기존 동작 — 가져온 템플릿은 imageUrl null이라 해당 없음. 동시 가져오기 이름 경쟁은 수용(치명적이지 않음).

Reflection: architect MISALIGNED(본문 잔재 8건) → 15·19·26·32·35행, 파일 지도(server.ts), 정제 절(T3 정본), 시나리오 보강으로 정리(rev 2).

## A — 독립 감사 1차 (`01a0cc53-7aaa-7cb1-9ff8-ee1ce080e990`) VERDICT: FAIL → 재계획 (rev 3)

BLOCKER: 노드·엣지 최상위 키(style, className, domAttributes, parentId, hidden, extent …)가 어디서도 정제되지 않고 React Flow가
DOM에 적용한다(nodeTemplateStore.ts:66-69 `...node`, nodeStudioGraph.ts:41, @xyflow/react index.js:2351/2364/2366) — 원격
요청(backgroundImage url)·캔버스 붕괴 가능. 수용: 정제를 차단 목록에서 **허용 목록**으로 바꾼다. 이 절이 T3를 대체한다.

`portableTemplateGraph`(내보내기·가져오기 공통, 원본을 복사하지 않고 새 객체를 만든다):
- 노드 키: id(문자열 1-128), type("imageNode"|"elementReferenceNode", 그 밖은 imageNode), position{x,y 유한수}, width/height(유한 양수,
  선택), data. 그 밖의 키는 버린다.
- 엣지 키: id(문자열 1-128), source, target, sourceHandle/targetHandle(문자열 ≤64 또는 null), label(문자열 ≤80, 선택).
- data 허용 목록: kind(≤40), nodeType(≤40), prompt(≤20000), provider(≤80), model(≤120), size(≤40), reasoningEffort(열거),
  status → "idle"로 정규화, elementName(≤120), video{duration 유한수, resolution/aspectRatio/topic 문자열 ≤80}, media는
  {placeholder: 문자열 ≤80, unresolved: true} 형태일 때만. 요소 노드는 elementId를 싣지 않고 missing: true. 형식이 틀린 값은 버린다.
  (감사 3: filename/parentFilename/imageFilename 등 미래 필드도 허용 목록 밖이라 자동 제외.)
- viewport{x,y,zoom 유한수} 또는 생략, manifest{requiredPlaceholders 문자열[≤50]×≤80, expectedTerminalResults 정수 0-1000} 또는 생략.
- 새 객체는 리터럴로 만들어 `__proto__` 대입 경로가 없다. 그에 더해 감사 2: 깊이 측정 단계에서 모든 수준의 `__proto__`,
  `constructor`, `prototype` 키를 INVALID_TEMPLATE_GRAPH로 거부한다.

감사 4: 노드 형태 검증(위치 유한수, data 평범한 객체, 문자열 길이)을 parseTemplateFile에 둔다 — 위반은 거부(가져오기) /
버림(내보내기 시 저장된 값이 이상하면 기본값으로).
감사 5: 전용 파서는 server.ts:263 전역 파서보다 먼저 등록(이미 읽은 본문은 전역 파서가 건너뜀).
감사 6: 오류 매퍼는 body-parser의 모든 오류(type이 entity.*, charset.*, encoding.* 또는 status 4xx)를 고정 코드
TEMPLATE_FILE_INVALID(400) / TEMPLATE_FILE_TOO_LARGE(413)로 바꾸고 원문·헤더를 싣지 않는다. import 라우트의 오류 응답은 코드별 고정 문구.
감사 7: 깊이 검사(명시적 스택)를 파싱 직후 가장 먼저 실행 — 복제·로그·stringify보다 앞.
감사 8: uniqueTemplateName은 코드 포인트(Array.from) 단위로 잘라 접미사 포함 80자, 99회 뒤 대체 접미사도 80자 이내.
create에는 {name, description, tags, graph}만 넘긴다(thumbnail·stripOptions 제외).
감사 9: seed 카드에도 내보내기 버튼(카드 액션 레이아웃 조정), 파일 입력 value 초기화, 다운로드 파일명은 클라이언트가 만든다.
감사 10 테스트 추가: 노드·엣지 최상위 주입(style/className/domAttributes/parentId) 제거(내보내기·가져오기), __proto__ 거부,
비수치 위치 거부, charset 415 → 고정 코드, 교차 사이트 POST 거부(Sec-Fetch-Site: cross-site, localAccessPolicy.ts:129-137).

## A — 재감사 (같은 감사자) VERDICT: NEAR-PASS — 처분(전부 수용)

1. MAJOR 시드 변형 소실 → data 허용 목록에 variation(정수 1-16), style(문자열 ≤40) 추가. data.style은 텍스트이며 React Flow는
   node.style만 DOM에 적용한다. 시드 라운드트립 테스트가 두 값을 확인.
2. MINOR 요소 노드 → refCount(정수 0-100, 없으면 0)와 missing: true를 정제기가 명시적으로 만든다(elementId는 싣지 않음).
3. MINOR 규칙 통일 → 구조 위반(노드·엣지 ID, 위치, data가 객체 아님, 금지 키, 중복, 끊김, 순환, 깊이, 개수)은 거부,
   선택적 스칼라의 형식 오류는 그 값만 버린다.
4. MINOR 크기 상한 → width/height ≤ 4000, |position.x|,|position.y| ≤ 100000, viewport.zoom 0.05-8.

## B 기록

- 파일명 규칙을 UI 순수 모듈 ui/src/lib/nodeTemplateFileName.ts로 분리(테스트 설정에 JSX가 없어 api-node-templates.ts를
  직접 import할 수 없음). 서버·클라이언트 동일성은 계약 테스트로 묶는다.
- registerNodeTemplateRoutes(app, ctx) 시그니처 변경에 맞춰 node-studio-ui-contract 소스 검사 갱신.
- 가져오기 버튼은 footer의 기존 버튼 스타일을 쓴다(새 CSS·radius manifest 변경 없음). 가져오기 오류는 목록을 가리지 않는
  별도 role=alert.
