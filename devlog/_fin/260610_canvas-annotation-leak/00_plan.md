# Canvas annotation leak fix — plan (issue #96)

날짜: 2026-06-10
상태: P (plan)
이슈: https://github.com/lidge-ai/ima2-gen/issues/96
골 ID: 2fbd96ea-b47

## 배경 (Part 1 — 쉬운 설명)

Canvas 모드에서 메모/박스/펜 주석이 **이미지 픽셀로 합성된 채 모델에 전송**된다.
모델은 developer prompt의 "원본 보존" 지시에 따라 주석을 시각 요소로 보존하므로
결과 이미지에 노트가 남고, 메모에 적은 지시는 텍스트로 전달되지 않아 반영되지 않는다.

수정 원칙 (인터뷰 확정):
- **위치는 마스크가 전담, 지시는 텍스트가 전담, 이미지는 원본 그대로** (잔존 가능성 0)
- 모델로 가는 페이로드(edit 이미지 + 참조 attach)에서 주석 전부 제거
- UI/히스토리의 canvas 버전 저장본은 주석 포함 그대로 유지
- 메모 텍스트+좌표를 프롬프트 텍스트로 변환해 합성
- 일반 텍스트 프롬프트는 이번 범위에서 손대지 않음 (메모 경로가 우선)

## 누출 경로 (조사 확정)

| # | 경로 | 위치 |
|---|------|------|
| 1 | edit-with-mask 전송 이미지 = 주석 합성본 | `ui/src/components/canvas-mode/useCanvasModeSession.ts:192-196` (`lastMergedDataUrlRef`) |
| 2 | 참조 슬롯 attach = 주석 합성본 | `useCanvasModeSession.ts:123` → `ui/src/store/storeReferenceImpl.ts:155-182` |
| 3 | 메모 텍스트 미전달 | `useCanvasModeSession.ts:206` (prompt에 메모 미포함) |

합성 지점: `ui/src/lib/canvas/mergeRenderer.ts:50-53` (paths/boxes/memos 전부 래스터화).
`CanvasMemo`는 정규화 좌표 `x, y`(0..1)와 `text`를 보유 (`ui/src/types/canvas.ts:49-55`).

## 변경 목록 (Part 2 — diff 수준)

### NEW: `ui/src/lib/canvas/memoPrompt.ts`

순수 함수 2개:

```ts
import type { CanvasMemo } from "../../types/canvas";

const COLS = ["left", "center", "right"] as const;
const ROWS = ["top", "middle", "bottom"] as const;

export function describeMemoPosition(x: number, y: number): string {
  const col = COLS[Math.min(2, Math.max(0, Math.floor(x * 3)))];
  const row = ROWS[Math.min(2, Math.max(0, Math.floor(y * 3)))];
  const region = row === "middle" && col === "center" ? "center" : `${row} ${col}`;
  return `${region} area (x: ${Math.round(x * 100)}%, y: ${Math.round(y * 100)}% from top-left)`;
}

export function buildMemoEditInstructions(memos: CanvasMemo[]): string {
  const entries = memos
    .map((memo) => ({ ...memo, text: memo.text.trim() }))
    .filter((memo) => memo.text.length > 0);
  if (entries.length === 0) return "";
  return [
    "Apply the following annotation instructions at the specified image locations (percentages are relative to image width and height):",
    ...entries.map((memo, index) => `${index + 1}. At the ${describeMemoPosition(memo.x, memo.y)}: ${memo.text}`),
    "Do not render any annotation text, sticky notes, boxes, arrows, or markup in the output image.",
  ].join("\n");
}
```

### MODIFY: `ui/src/components/canvas-mode/CanvasModeWorkspace.tsx`

- L94 인근: `const lastCleanDataUrlRef = useRef<string | null>(null);` 추가
- L152 인근(세션 리셋): `lastCleanDataUrlRef.current = null;` 추가
- 세션 args(L276 인근)에 `lastCleanDataUrlRef` 전달

### MODIFY: `ui/src/components/canvas-mode/useCanvasModeSession.ts`

1. args 타입/구조분해에 `lastCleanDataUrlRef: MutableRefObject<string | null>` 추가
   - L53 인터페이스도 동기 수정: `attachCanvasVersionReference: (item: GenerateItem, overrideSource?: string) => Promise<void>`
2. `saveCanvasVersionAndUseReference` 내:
   - merged 렌더(주석 포함, 저장/표시용)는 **그대로 유지**
   - 클린 베이스 생성 추가: 원본 소스 파일에서 로드
     ```ts
     const cleanDataUrl = await loadCleanSourceDataUrl(source); // fetch(원본 URL) → blob → dataUrl
     lastCleanDataUrlRef.current = cleanDataUrl;
     ```
     URL 조립 (agentApi.ts:33-37 패턴, 헬퍼는 `canvasModeHelpers.ts`에 colocation):
     ```ts
     export function resolveCleanSourceUrl(source: GenerateItem): string {
       const filename = source.canvasSourceFilename ?? source.filename;
       if (filename) return `/generated/${filename}`;
       return source.url ?? source.image;
     }
     ```
     blob→dataUrl은 기존 `blobToDataUrl` (maskRenderer.ts:59) 재사용.
     (연쇄 편집 시 imageElement는 이전 합성본을 표시하므로 imageElement 캡처 대신 **소스 파일 fetch**로 해석)
   - `attachCanvasVersionReference(savedItem)` → `attachCanvasVersionReference(savedItem, cleanDataUrl)` (주석 합성본 대신 클린본을 참조로)
3. `handleEditWithMask` 내:
   - 함수 시작부에서 메모 캡처: `const memosForPrompt = annotations.memos;` (save가 `resetLocal()`을 호출하기 전에 캡처 — boxes가 이미 같은 클로저 타이밍에 의존)
   - `editImage = lastMergedDataUrlRef.current` → `lastCleanDataUrlRef.current` 사용. 폴백도 표시 이미지 캡처 대신 클린 소스 fetch.
   - 프롬프트 합성:
     ```ts
     const memoInstructions = buildMemoEditInstructions(memosForPrompt);
     const basePrompt = canvasDisplayImage.prompt ?? currentImage?.prompt ?? "";
     const prompt = [basePrompt.trim(), memoInstructions].filter(Boolean).join("\n\n");
     ```
   - 빈 프롬프트 가드: `if (!prompt.trim())` — 메모만 있어도 진행 가능해짐 (memoInstructions가 prompt가 됨)

### MODIFY: `ui/src/store/storeTypes.ts` L224

```ts
attachCanvasVersionReference: (item: GenerateItem, overrideSource?: string) => Promise<void>;
```

### MODIFY: `ui/src/store/storeReferenceImpl.ts` L155

`attachCanvasVersionReferenceImpl(item, set, get, overrideSource?: string)` —
`compressReferenceSource(overrideSource ?? item.image, ...)`로 변경. 기본 동작 불변
(→ `useCanvasBackgroundCleanup.ts:375`의 기존 호출은 영향 없음. 배경 클린업 결과물은 주석이 아니라 실제 결과 이미지이므로 그대로 attach가 맞음).

### MODIFY: `ui/src/store/useAppStore.ts` L206

`attachCanvasVersionReference: (item, overrideSource) => attachCanvasVersionReferenceImpl(item, set, get, overrideSource)`

## 동작 변화 요약

| 흐름 | 변경 전 | 변경 후 |
|------|---------|---------|
| edit-with-mask 전송 이미지 | 주석 합성본 | **클린 원본** |
| edit-with-mask 프롬프트 | 원본 prompt만 | 원본 prompt + **메모 지시 블록(위치 % 포함)** |
| 참조 attach (canvas apply) | 주석 합성본 | **클린 원본** |
| UI/히스토리 canvas 버전 | 주석 포함 | 주석 포함 (불변) |
| 배경 클린업 attach | 클린업 결과물 | 클린업 결과물 (불변) |
| 메모만 있고 prompt 없음 | 에러 (noPromptToFork) | 메모 지시만으로 진행 |

## 범위 밖 (명시)

- `buildEditTextPrompt`/developer prompt 백엔드 변경 없음 (프론트 전용 수정)
- 일반 텍스트 프롬프트 품질 개선 없음 (유저 책임 영역, 인터뷰 확정)
- canvas 버전 저장 포맷 변경 없음 (주석은 계속 픽셀로 저장 — UI 표시용)
- 알려진 한계: apply → 일반 생성 경로에서는 메모 지시가 프롬프트에 자동 주입되지 않음
  (참조만 클린본으로 교체). 필요 시 후속 작업으로 insertedPrompts 주입 검토.

## 검증 계획 (성공 기준, 인터뷰 확정)

1. `cd ui && npx tsc --noEmit -p tsconfig.app.json` (또는 프로젝트 표준 빌드) 통과
2. `npx tsc --noEmit` (루트) 통과
3. E2E 수동 검증 (cli-jaw browser, 에이전트가 직접 수행):
   - 메모 3개를 서로 다른 위치(예: 좌상/중앙/우하)에 임의 배치 + 박스 1개
   - edit-with-mask 실행
   - 확인 항목: ① 결과에 노트/박스/펜 잔존 0개 ② 메모 지시 반영 ③ **지정 위치에 생성**
   - 네트워크 페이로드(또는 서버 로그)로 전송 이미지가 클린본인지, 프롬프트에 메모 블록이 포함됐는지 확인
