---
created: 2026-09-23
tags: [ima2-gen, pr256, wp3, diagnostics, security]
---

# 031 — WP3 재검증과 실행 계획 (dev `8d037035`)

wp2 D 결론 인용: "WP2 머지 완료(#267, dev 8d037035). 다음은 WP3 안전한 진단." 방향 변경 없음.

## 현재 트리 사실

- 이미지 항목 오류의 code/type/param은 이미 `safeDiagnosticLabel`로 라벨화되어 `outputItemSummary`에 있다
  (lib/responsesParse.ts:247-249). 원시 `error.message`는 읽지 않는다.
- 스트림 `type:error`는 `makeStreamError`가 `upstreamCode`=라벨로 싣는다(lib/responsesParse.ts:316-318).
- `emptyResponseError`(lib/responsesErrors.ts:71-84)는 이미지 항목 code/type을 오류 객체에 옮기지 않는다 —
  빠진 연결 1.
- `errorCodeFrom`(lib/generationErrors.ts:108-111)은 응답 진단 코드와 EMPTY_RESPONSE를 먼저 반환하므로
  `upstreamCode`/`upstreamType`을 채워도 최종 분류는 바뀌지 않는다. RESPONSE_DIAGNOSTIC 분기(:202-213)는 두
  필드를 라벨로 다시 걸러 finalErr에 복사하고, API 오류 봉투(lib/nodeGeneration.ts:479-481)가 이를 내보낸다.
- `node.final_error` 로그(lib/nodeGeneration.ts:341-352)는 upstreamCode만 싣고 upstreamType이 없다 — 빠진 연결 2.
- `emptyResponseError`가 `outputItemSummary`의 이미지 항목 라벨을 읽지 않는다 — 빠진 연결 3(= 연결 1과 같은 지점).
- `safeDiagnosticLabel`(lib/responsesParse.ts:152-160)은 bearer, sk-, URL, @, data:image, 개행만 막아 xai-/AIza/JWT/
  ghp_/password: 형식이 라벨로 통과하고, generate·edit 응답이 responseDiagnostics를 이미 돌려준다(아래 S4).

## 거부하는 원본 동작 (의도적 제외)

fd3ea788의 `safeDiagnosticMessage`와 `upstreamErrorMessage`, 오류 문장 이어 붙이기, final_error 로그의
`upstreamMessage`, 46921f06의 `upstreamItemCode/Type` 신규 필드. 패턴 제거로는 프롬프트·자격 증명 비노출을
증명할 수 없다. 원본 파서의 NUL 바이트 블롭은 복사하지 않는다.

## 변경

| 파일 | 변경 |
|---|---|
| lib/responsesParse.ts | `safeDiagnosticLabel`의 UNSAFE 패턴 확장(S4). 030:22의 "기존 라벨 계약 유지"를 의도적으로 더 엄격하게 바꾼다 — 제거만 늘고 통과는 늘지 않는다 |
| lib/responsesErrors.ts | emptyResponseError가 outputItemSummary의 첫 image_generation_call 라벨을 기존 `upstreamCode`/`upstreamType`에 싣는다 |
| lib/nodeGeneration.ts | final_error 로그에 `upstreamType` |
| tests/responses-parse-diagnostics.test.ts | 아래 활성 시나리오 |
| structure/03, 01 | 진단 계약(허용 필드 목록) 기술, 줄 수 재생성 |

허용 공개 필드: code(ima2 분류), upstreamCode, upstreamType, upstreamParam(모두 라벨), diagnosticReason, eventType,
eventCount. 원시 본문·문장 없음. 커밋: 원 기능의 코드/타입 부분은 TuanTicker 작성자 + Original-Commit, 거부 사실은
본문에 명시.

## 활성 시나리오 (테스트)

| 시나리오 | 증거 |
|---|---|
| 이미지 항목 failed + code/type + 비밀·프롬프트 섞인 message | 진단 code/type 라벨, emptyResponseError.upstreamCode/Type, normalizeGenerationFailure 결과에 전달, JSON 직렬화(오류 own props + responseDiagnostics)에 비밀·문장 없음 |
| 스트림 type:error + message | 기존 upstreamCode 라벨, 문장 비노출 |
| 빈 응답, 잘못된 SSE, 웹검색만 | 안정 코드(EMPTY_RESPONSE / STREAM_PARSE_FAILED / WEB_SEARCH_ONLY_RESPONSE), upstreamCode 없음 |
| 코드·유형·파라미터 자리에 비밀 형식 | Bearer, sk-, sk_live_/sk_test_, xai-/xai_, AIza, AKIA, JWT(eyJ….), gh[pousr]_, password/secret/token/api_key 키=값, 32자 이상 영숫자 연속, URL, 공백 문장 → `_redacted` 또는 null |
| 정상 코드 회귀 | moderation_blocked, content_policy_violation, rate_limit_exceeded, image_generation_user_error, max_output_tokens, token_expired, input_tokens, tools[0].size, gpt-image-2 → 그대로 |
| 비밀 아닌 평범한 문장 | 전달되지 않음 |

검증: 집중 테스트, typecheck/typecheck:tests, 빌드 후 전체, hosted CI(CodeQL 포함), 보안 검토자가 최종 diff 검토.


## Architect consultation (보안, `01a0cc07-17aa-7910-9f8c-2d3513cd0679`) — 처분

- S1 수용: 기존 upstreamCode/upstreamType 재사용. errorCodeFrom이 진단 코드를 먼저 돌려줘 분류·재시도 불변
  (generationErrors.ts:111-115, :133-137). moderation_blocked 테스트로 순서를 고정한다(errorClassify.ts:29).
- S2 수용(의도된 가시 변화): 노드 오류 봉투와 final_error가 IMAGE_TOOL_FAILED 대신 공급자 코드를 보인다
  (nodeHelpers.ts:110, nodeGeneration.ts:345).
- S3 수용 — 변경 표 수정: ResponseDiagnostics에 새 필드를 만들지 않는다. emptyResponseError가 outputItemSummary의
  첫 image_generation_call 라벨을 읽어 upstreamCode/upstreamType에 싣는다. final_error에 upstreamType 추가는 유지.
- S4 수용(수정): safeDiagnosticLabel의 UNSAFE 패턴을 넓힌다 — 이미 generate·edit 응답이 responseDiagnostics를
  돌려주므로(routeHelpers.ts:53, generatePipeline.ts:633/708, routes/edit.ts:407) 기존 노출도 줄어든다.
  추가: `xai-[A-Za-z0-9]{8,}`, `AIza[0-9A-Za-z_-]{10,}`, `eyJ[A-Za-z0-9_-]+\.`(JWT), `gh[pousr]_[A-Za-z0-9]{10,}`,
  `(password|passwd|secret|token|api[_-]?key)\s*[:=]`(키=값 형식만; 단독 단어 token은 정상 코드·파라미터라 허용),
  숫자와 글자가 섞인 32자 이상 영숫자 연속(엔트로피 근사). 정상 코드 회귀 테스트(moderation_blocked,
  content_policy_violation, max_output_tokens, image_generation_user_error, rate_limit_exceeded)를 함께 둔다.
- S5 수용: 직렬화·스캔 대상 = 파서 diagnostics 전체, emptyResponseError와 normalizeGenerationFailure 결과의
  `{...err, message}`, upstreamErrorFields, nodeErrorDetails, final_error 로그 줄(logEvent 캡처 가능 여부 확인).
- S6 기록(범위 밖 잔여 노출): OAuth 패스스루가 upstream.message를 유지하고(oauthProxy/errors.ts:101, 테스트
  oauth-proxy-error-safety.test.ts:61), 걸러지지 않은 upstreamCode(:105)가 nodeHelpers.ts:110로 봉투에 닿을 수 있다.
  이번 슬라이스는 이 경로를 고치지 않는다 — 020 후속 목록과 structure/03에 남은 노출로 적는다.
- S7 수용: 테스트는 .ts 원본을 import한다.

Reflection: 보안 architect MISALIGNED(본문 잔재) → 변경 표·연결 3·시나리오 행 수정, 030 계약 강화 명시.
S5 로그 캡처: `configureLogger({ sink })`(lib/logger.ts:131). 추가 형식 4개(sk_live_, AKIA, xai_, 긴 글자 연속)를 패턴에
넣는다. 기밀성 주장은 위 표에 적은 형식으로 한정하며, 그 밖의 형식은 공급자를 신뢰하지 않는다는 전제의 잔여 위험이다.

## A — 독립 보안 감사 (`01a0cc0a-1b44-7812-a8be-0b2335e2b4fb`) VERDICT: NEAR-PASS — 처분(전부 수용)

1. MAJOR 자르기 뒤 검사 → 120자를 넘는 값은 전체를 `_redacted`로(정규식 전 길이 상한 유지). 경계 테스트(100·112 위치 비밀).
2. MAJOR 가시 변화 범위 → S2 확장: generate/edit(`upstreamErrorFields`, routeHelpers.ts:35-36), edit(routes/edit.ts:390-391),
   multimode(multimodePipeline.ts:519), 노드 catch(nodeGeneration.ts:479-480), 노드 봉투(nodeHelpers.ts:110), final_error.
   IMAGE_TOOL_FAILED에서 null이던 upstreamCode/upstreamType이 공급자 라벨이 된다. upstreamErrorFields 테스트 추가.
3. MAJOR final_error의 upstreamCode·upstreamType을 로그 지점에서 라벨 필터 → nodeHelpers.ts에 `finalErrorUpstreamLabels(lastErr)`
   헬퍼를 두고 nodeGeneration이 사용. OAuth 원시값(oauthProxy/errors.ts:64-65, :105-106)도 로그에서는 걸러진다. 로그 캡처는
   `configureLogger({ sink })`로 필수 테스트.
4. MINOR 긴 연속 규칙 → 구분자 없는 영숫자 32자 이상 전부(글자만 포함)를 가린다. 글자만 32자 이상 라벨이 가려지는 것을
   의도로 테스트에 고정.
5. MINOR /i 확장 → 대소문자 무시로 넓게 막는 것을 의도로 수용(제거만 늘어남, 정상 라벨 충돌 없음 확인됨).
6. MINOR → `errorCode`가 있는 첫 image_generation_call 요약을 쓴다. 뒤쪽 요약에만 코드가 있는 경우 테스트.
7. MINOR → responsesTransport.normalizedCode 분류(invalid_api_key, moderation_blocked, rate_limit_exceeded) 불변 테스트,
   기존 tests/responses-parse-diagnostics.test.ts:80-110 무변경.

## B 중 결정

- nodeHelpers가 필터를 쓰려고 responsesParse를 import하자 inflight·런타임 설정까지 끌려와,
  tests/node-store-metadata.test.ts(의존성을 mock으로 막는 부모 노드 테스트)가 깨졌다. 필터를 의존성 없는
  lib/diagnosticLabel.ts로 옮기고 responsesParse는 다시 export한다(기존 호출부 유지).
- nodeErrorDetails(노드 오류 봉투)도 upstreamCode/Type/Param을 같은 필터에 통과시킨다 — S6의 OAuth 원시 코드가
  봉투로 가는 경로를 함께 줄인다(메시지 경로는 여전히 범위 밖).
- tests/node-diagnostics-contract.test.js의 소스 문자열 검사를 새 헬퍼 사용 확인으로 바꾸고 값 검사는
  responses-parse-diagnostics 테스트가 맡는다.
