---
created: 2026-07-12
tags: [ima2-gen, ux, uiux, higgsfield, devlog, roadmap]
aliases: [higgsfield ux lane, ima2 studio ux, 힉스필드 UX 레인]
---

# 260712 Higgsfield-급 스튜디오 UX — 레인 허브

ima2 웹 UI의 전반적인 UX를 힉스필드급 스튜디오 수준으로 끌어올리는 레인.
SaaS 전환, 팀 협업, 과금/거버넌스는 전부 스코프 밖이다. 로컬 개인 스튜디오라는
정체성은 유지하고, "쓰는 감각"만 상용 스튜디오급으로 만든다.

사이트(<https://lidge-ai.github.io/ima2-gen/>)는 이미 리브랜딩 완료·배포
상태다. `site/src/styles/global.css`의 디자인 언어(근검정 `#0b0b0f`, 노이즈
오버레이, 글래스 패널, 프리즘 그라데이션, Clash Display/Satoshi/IBM Plex Mono)가
이 레인의 시각 기준점이고, 앱 UI를 그 질감에 맞춘다. 사이트 작업은 이 레인에
없다.

## 근거 (2026-07-12 cxc-search Tier 3, sol 3기 병렬 서치)

세 탐색 레인 모두 Tier 2 소스 오픈 검증까지 완료.

1. **힉스필드 기능 인벤토리** — 힉스필드의 실체는 멀티모델 허브(Seedance/
   Kling/Veo/Sora/Wan + 자체 Soul 2.0) 위에 얹은 세 겹: 50+ 카메라 모션
   프리셋, Soul ID(영속 캐릭터), 프리셋형 스튜디오 앱 + Supercomputer 에이전트.
   타임라인 편집기 없음, 공개 REST API 없음(MCP/CLI만).
   출처: <https://higgsfield.ai/ai-video>, <https://higgsfield.ai/camera-controls>,
   <https://higgsfield.ai/canvas-intro>, <https://higgsfield.ai/skills>
2. **스튜디오 UI/UX 패턴 카탈로그** (Runway/Krea/Leonardo/Freepik/Kling/HF) —
   2026년 AI 스튜디오는 "점진적 복잡도" 레이어로 수렴: 프리셋 갤러리 진입 →
   세션/피드 반복 → 영속 라이브러리 → 캔버스 직접 편집 → 노드 그래프.
   비용은 실행 직전 지점에 표시.
   출처: <https://help.runwayml.com/hc/en-us/articles/24298206897043>,
   <https://www.krea.ai/features/nodes>, <https://kling.ai/quickstart/klingai-element-library-3-user-guide>,
   <https://ru.freepik.com/ai/docs/getting-started-with-spaces>
3. **스튜디오급 기능 기준선** — 격차는 생성 품질이 아니라 프리셋 어휘,
   영속 참조 자산, 결과물 체이닝, 리니지에 있다. 1급 리니지/버전 비교는
   시장 전체가 비어 있는 차별화 기회.
   출처: <https://higgsfield.ai/blog/sould-id-best-character-consistency>,
   <https://help.runwayml.com/hc/en-us/articles/40042718905875>,
   <https://intercom.help/leonardo-ai/en/articles/10501488>

## ima2 현재 위치

이미 있는 것: 멀티 프로바이더 라우팅(GPT/Grok/Gemini/Antigravity), 노드
캔버스, 비동기 큐 + SSE 멀티플렉싱, 비용 표시(`CostEstimate`), Agent Mode,
XMP 메타데이터 복원, 프롬프트 라이브러리, first/mid/last 프레임, 모바일 대응.
뼈대는 힉스필드와 겹친다. 없는 것은 **언어 레이어**(프리셋 어휘)와
**자산 레이어**(영속 참조·라이브러리), 그리고 이 둘을 잇는 **진입 동선**.

## 문서 구조

- **001~009**: 주제별 스펙(무엇을/왜). 실행 순서 아님.
- **010~090**: 실행 phase(언제/어떤 단위로). 명확한 순수 디자인 변경부터
  작게 시작하고, 기능 추가는 뒤로. 디자인이 기능을 요구하면 그 지점에서만
  기능을 앞당긴다. 미결정 항목은 phase에 넣지 않고 090 원장에 둔다.

## Phase Roadmap

| Phase | 내용 | 성격 | 참조 스펙 |
|---|---|---|---|
| `010_design-tokens.md` | 토큰/질감 이식 + 다크 단일화 — 동작 무변경 | 디자인 | 001 |
| `020_controls-refresh.md` | 컨트롤 킷 통일 — 토글/드롭다운/셀렉트/칩 방식 변경 | 디자인 | 001 |
| `025_settings-redesign.md` | 설정 워크스페이스 재설계 — 6섹션→3그룹, 슬롭 제거 | 디자인·IA | 이 문서 내 Design Read |
| `026_contrast-deboxing.md` | WCAG AA 대조 정합 + 박스 분할 완화 | 디자인 | 026 문서 |
| `030_shell-rail.md` | 좌측 레일 + 해시 라우팅 + 모바일 탭바 | 구조 | 002 |
| `040_gallery-chaining.md` | 갤러리 호버 체이닝 + 가상화 (서버 무변경) | UX | 004 |
| `050_assets-library.md` | Assets 저장 계층 + 워크스페이스 (첫 기능 추가) | 기능 | 004 |
| `060_home-presets.md` | 홈 진입면 + 프리셋 컴파일러 + 시드 | 기능 | 003 |
| `070_elements.md` | @멘션 영속 요소 | 기능 | 005 |
| `080_node-video-ux.md` | 노드 템플릿/팔레트 + 비디오 모션 칩/extend | UX·기능 | 006, 007 |
| `090_closeout.md` | 검증 게이트, 미결정 원장, _fin 이동 기준 | — | 009 |

008(리니지)은 phase로 확정하지 않는다 — 미결정. 단, id 기록 필드는
040~070에서 공짜로 심어두고 뷰는 090 원장에서 재결정한다.

## Non-goals

- SaaS/멀티테넌트/계정·과금 시스템, 팀 협업(권한/댓글/승인), 거버넌스.
- 타임라인(NLE) 편집기 — 힉스필드도 없다. 생성형 편집 흐름만 유지.
- LoRA 학습 파이프라인 — 참조 자산은 멀티 레퍼런스 주입으로 시작(005 참고).
- 사이트(`site/`) 변경 — 완료·배포됨. 읽기 전용 기준점.
