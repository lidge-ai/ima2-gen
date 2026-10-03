---
created: 2026-09-08
updated: 2026-09-08
tags: [ima2-gen, devlog, ui, video, audio, drag-drop, wp35]
---

# 030 — WP3.5 GUI 입력 확장 (D14, D15, D16)

서버와 CLI가 이미 하는 일을 GUI만 못 하고 있다. 보이스 선택, 동영상 입력,
그리고 이미지 아닌 파일을 끌어다 놓았을 때의 침묵을 고친다.

## 지금 무엇이 막고 있나

세 곳에서 같은 검사가 반복된다.

| 위치 | 코드 | 결과 |
|---|---|---|
| `PromptComposer.tsx:200` | `f.type.startsWith("image/")` | 드롭한 mp3/mp4가 조용히 사라진다 |
| `PromptComposer.tsx:486` | `accept="image/*"` | 파일 선택창에 오디오/영상이 안 보인다 |
| `storeReferenceImpl.ts:170` | 같은 검사 | 메타데이터 경로도 동일 |

셋 다 **필터링만 하고 아무 말도 하지 않는다.** 사용자 입장에서는 드래그가
실패한 건지 파일이 잘못된 건지 알 수 없다. 이건 상한 초과와 다르다 —
`toast.refLimitExceeded`는 이유를 말해준다.

## 설계 원칙

첨부 가능한 것은 **현재 선택된 모드가 결정한다.** 하나의 트레이에 아무거나 받게
하면 "이미지 14장 + 보이스 3개 + 영상 1개"라는 불가능한 조합이 만들어진다.
xAI는 모드를 요청 파라미터로부터 유도하며, ref2v와 영상 편집은 **결합할 수
없다**(ref2v 문서 명시). 그러므로 UI도 모드를 먼저 정하고 그에 맞는 입력만 연다.

```
비디오 모델 선택됨
├─ 영상 첨부 없음
│  ├─ 이미지 0장           -> text-to-video
│  ├─ 이미지 1장 (선택식)  -> image-to-video | reference-to-video
│  └─ 이미지 2-14장        -> reference-to-video
│     └─ + 보이스 0-3개 (grok-imagine-video-1.5 전용)
└─ 영상 1개 첨부           -> edit | extend (grok-imagine-video 전용)
                              이미지/보이스 첨부 불가
```

## MODIFY: ui/src/components/PromptComposer.tsx — 드롭 분기 (D16)

```diff
-    const files = Array.from(e.dataTransfer.files).filter((f) =>
-      f.type.startsWith("image/"),
-    );
-    if (files.length > 0) void handleImageFiles(files);
+    const dropped = Array.from(e.dataTransfer.files);
+    if (dropped.length === 0) return;
+    // Sort by what the current mode can actually consume, then say why anything
+    // was left out. Silently dropping a file the user deliberately dragged is the
+    // bug being fixed here, so the rejection path must be as loud as the accept path.
+    const sorted = sortDroppedByKind(dropped, { videoModelSelected, videoModel });
+    if (sorted.images.length > 0) void handleImageFiles(sorted.images);
+    if (sorted.audios.length > 0) void handleAudioFiles(sorted.audios);
+    if (sorted.videos.length > 0) void handleVideoFile(sorted.videos[0]);
+    if (sorted.rejected.length > 0) showToast(rejectionMessage(sorted.rejected), true);
```

### NEW: ui/src/lib/droppedMedia.ts

분류 규칙을 컴포넌트 밖에 둔다. 같은 규칙을 `Canvas.tsx`, `ImageNode.tsx`,
`AgentComposer.tsx`가 각자 복제하고 있어서, 한 곳에서 정의하지 않으면 표면마다
다르게 동작한다.

```ts
export type DroppedKind = "image" | "audio" | "video" | "rejected";

export interface SortedDrop {
  images: File[];
  audios: File[];
  videos: File[];
  rejected: { file: File; reason: DropRejection }[];
}

export type DropRejection =
  | "not-media"          // 지원하지 않는 MIME
  | "audio-upload-unsupported"  // 오디오 업로드는 composer에서 실제 생성 입력으로 쓸 수 없음
  | "video-needs-base"   // 영상인데 1.5 선택됨
  | "video-single-only"; // 영상 2개 이상
```

거부 사유를 문자열이 아니라 유니온으로 두면 i18n 4개 언어가 각 사유에 대응하는
문구를 갖도록 타입이 강제한다. 문자열이면 번역 누락이 런타임에만 드러난다.

## 오디오 입력 (D14)

### 두 가지 오디오 경로를 구분한다

xAI의 `reference_audios`는 두 형태를 받는다.

| 형태 | 상태 | UI 조치 |
|---|---|---|
| `{voice_id: "eve"}` 프리셋 | **일반 사용 가능** | 이번에 구현 |
| `{url: "data:audio/..."}` 업로드 클립 | 'trusted partners on request' 게이팅 | 구현하되 실패를 정직하게 안내 |

우리 계정이 파트너 등급인지 모르는 상태에서 업로드 UI를 전면에 두면, 사용자가
파일을 고르고 생성까지 기다린 뒤에야 거부를 만난다. 그러므로 **프리셋 선택이
기본 경로**이고, 업로드는 접힌 보조 경로로 둔 뒤 첫 400을 받으면 그 사실을
기록해 이후 세션에서 비활성화한다.

### NEW: ui/src/components/VoicePicker.tsx

`VideoControlsPanel` 안, ref2v 모드에서만 보이는 섹션이다.

```
[ 보이스 ]  최대 3개 · grok-imagine-video-1.5 전용
( eve ) ( leo ) ( ara ) ( rex ) ... 26개 칩
선택된 것은 <AUDIO_0>, <AUDIO_1>, <AUDIO_2> 순서로 프롬프트에 삽입
```

프리셋 26개는 **capabilities에서 받는다** (`valid.videoModels.referenceAudio.knownPresets`).
UI에 하드코딩하면 xAI가 로스터를 바꿀 때 또 갈라진다. `presetsAreAuthoritative:
false`이므로 목록 끝에 커스텀 보이스 id 직접 입력 필드를 둔다 — 400 본문이
`/v1/custom-voices`로 만든 id도 받는다고 명시한다.

칩을 고르면 프롬프트 캐럿 위치에 `<AUDIO_0>` 태그를 삽입한다. 레퍼런스 이미지의
`insertAttachmentTags`와 같은 방식이다. **태그 없이 보이스만 붙이면 모델이 어느
화자에 쓸지 모른다** — ref2v 문서가 태그 규약을 명시하는 이유다.

### 모델 게이팅

base 모델에서 보이스 섹션은 **숨기지 않고 비활성화**하고, 이유를 붙인다.
숨기면 사용자는 기능이 없다고 결론짓는다. 비활성화하고 "grok-imagine-video-1.5
필요"라고 쓰면 모델을 바꾸면 된다는 걸 안다. 1080p 해상도 칩이 이미 같은 패턴을
쓰고 있다(`resolutionItems`의 `disabled`).

### store

```diff
+  videoReferenceVoices: string[];           // 최대 3
+  addVideoReferenceVoice: (id: string) => void;
+  removeVideoReferenceVoice: (id: string) => void;
```

생성 요청 조립부에서 `referenceAudios: videoReferenceVoices`로 실어 보낸다.
서버는 `routes/video.ts:523`에서 이미 문자열 배열을 받는다 — **서버 변경 불필요.**

## 동영상 입력 (D15)

### 진입점

영상 파일이 드롭되거나 파일 선택창에서 골라지면 트레이가 아니라 **전용 소스
슬롯**으로 간다. 이미지 트레이와 섞으면 "@ref 태그를 가진 영상"이라는, 서버에
보낼 수 없는 상태가 만들어진다.

```
[ 소스 영상 ]  sample.mp4  ×
  ( ) 편집 — 프롬프트대로 내용을 바꾼다
  ( ) 연장 — 마지막 프레임에서 이어붙인다   [ 길이 6초 ]
  grok-imagine-video 전용 · 출력은 소스의 비율/해상도를 따름 (최대 720p)
```

편집/연장은 이미 `routes/videoExtended.ts`와 `ima2 video edit|extend`가 구현한
기능이다. **GUI는 그 라우트를 호출하는 진입점만 만든다.** 새 서버 기능이 아니다.

연장 길이 슬라이더는 1-15초이고(020의 D11 실측), 라벨에 '추가되는 구간의 길이'를
적는다. 총 길이가 아니라는 걸 문서가 명시적으로 경고하는 지점이다.

### 이미 있는 것을 재사용한다

`Canvas.tsx`가 생성된 영상을 드래그할 때 `buildVideoDragPayload`로
`application/ima2-ref`를 싣는다. 그 경로가 이미 존재하므로, 히스토리의 영상을
소스로 끌어오는 흐름은 payload를 소스 슬롯에서도 받게 하는 것으로 끝난다.

## MODIFY: accept 속성

```diff
-        accept="image/*"
+        accept={composerAcceptAttr({ videoModelSelected, videoModel })}
```

이미지 모드면 `image/*`, 비디오 1.5면 `image/*,audio/*`, 비디오 base면
`image/*,video/mp4`. 파일 선택창이 고를 수 없는 걸 보여주지 않게 한다.

## 접근성

- 보이스 칩은 `role="group"` + `aria-label`, 선택 상태는 `aria-pressed`.
- 드롭존 안내문은 모드에 따라 문구가 바뀌므로 `aria-live="polite"`.
- 거부 토스트는 기존 토스트 경로를 쓴다(이미 스크린리더에 노출된다).

## i18n

4개 언어(ko, en, zh-Hans, zh-Hant) 전부에 키를 추가한다. 하나라도 빠지면 그
언어에서 키 문자열이 그대로 보인다.

```
prompt.dropHereVideo, prompt.dropHereAudio
prompt.rejectNotMedia, prompt.rejectAudioUploadUnsupported,
prompt.rejectVideoNeedsBase, prompt.rejectVideoSingleOnly
video.voiceSection, video.voiceLimit, video.voiceNeeds15, video.voiceCustomPlaceholder
video.sourceVideo, video.modeEdit, video.modeExtend, video.extendDurationLabel
```

## 테스트

### NEW: tests/dropped-media-sorting-contract.test.ts

```
- image/png 은 images 로
- audio/mpeg 은 모든 composer 모드에서 rejected(audio-upload-unsupported)
- composer file picker는 실제 업로드/생성 입력으로 이어지지 않는 audio/* 를 제안하지 않음
- video/mp4 은 base 선택 시 videos, 1.5 선택 시 rejected(video-needs-base)
- video 2개는 첫 개만 videos, 나머지 rejected(video-single-only)
- application/pdf 는 rejected(not-media)
- 모든 DropRejection 값에 4개 언어 i18n 키가 존재한다
```

마지막 항목이 중요하다. 유니온을 늘리고 번역을 잊는 게 가장 흔한 실수다.

### NEW: tests/voice-picker-contract.test.ts

```
- 프리셋 목록이 capabilities 응답에서 온다 (하드코딩 금지: 소스에 26개 id 배열이 없다)
- 4개 초과 선택이 불가능하다
- base 모델에서 비활성 + 사유 노출
- 선택 시 <AUDIO_n> 태그가 0-based 로 삽입된다
```

## 검증

```bash
npm run typecheck && npm run typecheck:tests && npm test
cd ui && npm run build
```

빌드 통과만으로는 UI가 동작한다는 증거가 아니다. 서버를 띄우고 실제로
드래그앤드랍 3종(이미지/오디오/영상)과 보이스 선택을 확인한 뒤 그 결과를
`031_wp35_verification.md`에 기록한다.

## 완료 조건

- 이미지 아닌 파일을 드롭했을 때 **항상** 결과(수용 또는 사유)가 보인다.
- 보이스 3개까지 선택되고 `<AUDIO_0..2>` 태그가 프롬프트에 들어간다.
- 영상 1개를 드롭하면 편집/연장을 고를 수 있고 기존 라우트로 간다.
- 모델과 모드에 맞지 않는 입력은 비활성 + 이유가 함께 보인다.
- 프리셋 로스터가 서버 응답에서 온다.

