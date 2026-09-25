# Issue #95 — 로그 기능 추가요청

- **Issue**: https://github.com/lidge-ai/ima2-gen/issues/95
- **Contributor**: Sanguk Ko ([@ChatPoongKun](https://github.com/ChatPoongKun)) `<samko@samlab.co.kr>` — fork: `ChatPoongKun/ima2-gen` branch `codex/classic-workflow-improvements`
- **Co-authored-by**: `Sanguk Ko <samko@samlab.co.kr>`
- **Status**: plan — contributor reference implementation 검토 완료, upstream 통합 대기

## 요청 내용

생성 요청 기록(로그)을 서버에 저장하고 UI에서 열람할 수 있는 기능.

## Contributor 구현 분석

ChatPoongKun이 포크에서 16 커밋(2026-06-07~12)으로 구현한 내용 중 로그 관련 코어:

### Backend

| File | Description |
|------|-------------|
| `lib/generationRequestLog.ts` | JSON-file 기반 로그 저장 (max 200 entries, atomic write, serialized queue) |
| `routes/generationRequestLog.ts` | `GET /api/generation-requests` — 로그 목록 조회 |

- `GenerationRequestLogEntry` 타입: `id`, `requestId`, `createdAt`, `prompt`, `requested`, `succeeded`, `error`
- `atomicWriteJson` + `writeQueue` 패턴으로 동시 쓰기 안전성 확보
- 저장 경로: `ctx.config.storage.generationRequestLogFile`

### Frontend

| File | Description |
|------|-------------|
| `ui/src/components/GenerationRequestLogPanel.tsx` | 로그 패널 — 생성 완료 시 자동 갱신, 클릭 시 프롬프트 복사 |
| `ui/src/lib/clipboard.ts` | 클립보드 복사 fallback 유틸리티 |
| `ui/src/lib/api.ts` | `getGenerationRequestLog()` API 호출 추가 |
| `ui/src/i18n/{en,ko}.json` | `generationLog.*` i18n 키 추가 |

- `activeGenerations` store 변경 감지 → 자동 refresh
- 성공/실패 카운트 (`succeeded/requested`) + 에러 시 tooltip

### Tests

| File | Description |
|------|-------------|
| `tests/generation-request-log.test.ts` | 백엔드 로그 읽기/쓰기 단위 테스트 |
| `tests/multimode-request-logging.test.ts` | 멀티모드 생성 시 로그 통합 테스트 |

## Contributor 포크 기타 변경사항 (로그 외)

| Area | Changes |
|------|---------|
| Docker/Synology | Dockerfile, docker-compose.synology.yml, entrypoint.sh, README |
| Classic workflow | 배치 스트리밍, 프롬프트 UX, 결과 프리뷰 리사이즈 |
| Network settings | NetworkAccessSettings 컴포넌트 + 라우트 |
| Gallery UX | 키보드 단축키 중복 방지, 네비게이션 개선 |
| CSS | index.css (195줄), result-preview.css 스타일 보완 |

## 통합 계획

1. 로그 모듈 upstream 반영 시 ChatPoongKun을 `Co-authored-by`로 크레딧
2. JSON-file 방식은 MVP로 적합; 추후 SQLite/DB 마이그레이션 가능
3. `MAX_ENTRIES = 200` 상한은 합리적 — 로테이션 방식 유지
4. Docker/Synology 관련 변경은 별도 이슈로 분리 검토
5. Classic workflow 개선은 upstream 최신과 충돌 여부 확인 필요
