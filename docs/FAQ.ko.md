# ima2-gen 자주 묻는 질문

마지막 확인: 2026-05-26

이 문서는 설치, 업데이트, GPT OAuth, 갤러리, 레퍼런스 이미지 관련 질문을 모아둔 FAQ입니다. README는 짧게 유지하고, 자세한 설명은 이곳에 둡니다.

English version: [FAQ.md](FAQ.md)

## 빠른 해결

| 증상 | 먼저 해볼 것 |
|---|---|
| 서버에 연결되지 않음 | `ima2 serve`를 켠 뒤 `ima2 ping`을 실행합니다. |
| GPT OAuth 로그인이 안 됨 | `ima2 setup`을 다시 실행하고(옵션 1) `ima2 serve`를 다시 시작합니다. |
| API key provider가 `API_KEY_REQUIRED`를 반환함 | API 키를 설정하거나 GPT OAuth 공급자로 다시 전환합니다. |
| 업데이트 후 예전 이미지가 안 보임 | `ima2 doctor`를 실행한 뒤 [예전 이미지 복구 안내](RECOVER_OLD_IMAGES.md)를 확인합니다. |
| GPT OAuth에서 GPT-6 모델 하나만 실패함 | `ima2 gpt login`으로 다시 로그인하고 `ima2 models --kind image`를 확인한 뒤 `gpt-6-luna`로 바꿔 보세요. |
| 레퍼런스 업로드 실패 | JPEG/PNG로 변환하고 해상도를 낮춰 보세요. 레퍼런스는 최대 5장입니다. |
| Prompt Studio 기능이 헷갈림 | [Prompt Studio 사용 설명서](PROMPT_STUDIO.ko.md)에서 멀티모드, Direct, 추론 강도, 갤러리 동작을 확인하세요. |
| 이미지 생성이 `EMPTY_RESPONSE` 또는 no image data로 끝남 | `ima2 doctor image-probe --json`을 실행한 뒤 아래의 안전한 지원 번들을 모아 주세요. |
| 프록시/VPN 환경에서 `fetch failed`가 반복됨 | 프록시 클라이언트의 TUN/TURN류 모드를 켜거나, `HTTPS_PROXY`와 `NODE_USE_ENV_PROXY=1`을 설정하고 `ima2 serve`를 시작하세요. |

## 설치와 업데이트

### Node.js 버전은 무엇이 필요한가요?

Node.js 22 이상이 필요합니다. 패키지 요구사항은 Node `>=22`입니다.

### 어떻게 설치하나요?

npm 전역 설치를 권장합니다.

```bash
npm install -g ima2-gen
ima2 setup
ima2 serve
```

예전 설치가 이상하게 동작하면 먼저 최신 버전으로 올려 주세요.

```bash
npm install -g ima2-gen@latest
ima2 doctor
```

### Windows에서 `spawn EINVAL`이 보여요.

최신 버전으로 업데이트하세요. 예전 버전에서는 Windows의 npm/npx shim 실행에서 문제가 날 수 있었습니다. 현재 버전은 Windows에서 더 안전한 실행 경로를 사용합니다.

Codex 로그인 자체가 Windows 네이티브 환경에서 불안정하다면 WSL이 더 예측 가능한 선택일 수 있습니다.

### Windows 업데이트 중 `EBUSY` 또는 `resource busy or locked`가 떠요.

대부분 실행 중인 `ima2 serve`, 남아 있는 `node.exe`, 터미널, Explorer, 백신,
인덱서가 global package 폴더를 잡고 있어서 생깁니다. ima2 서버와 관련
터미널을 닫고, 필요하면 작업 관리자에서 남은 `node.exe`를 종료한 뒤 다시
시도하세요.

```bash
npm install -g ima2-gen@latest
```

계속 실패하면 Windows를 재부팅한 뒤 ima2를 실행하기 전에 바로 업데이트하세요.

## 인증과 provider

### OpenAI API 키가 필요한가요?

기본 생성 경로에는 필요하지 않습니다. 기본 경로는 로컬 Codex/ChatGPT OAuth 세션을 사용합니다.

API 키를 설정하면 이미지 생성 엔드포인트도 `provider: "api"`로 Responses API `image_generation` 도구를 사용할 수 있습니다.

### 설정 화면의 "API key provider available"은 무슨 뜻인가요?

`ima2-gen`이 유효한 API 키를 찾았다는 뜻입니다. API-Key 모드는 생성, 편집, 멀티모드, 노드 출력을 지원합니다. 키가 없으면 `provider: "api"` 요청은 upstream 호출 전에 `API_KEY_REQUIRED`로 실패합니다.

### Codex CLI에 이미 로그인되어 있으면 자동으로 잡히나요?

네. `ima2-gen`은 기존 Codex 로그인 상태를 확인하고 로컬 GPT OAuth 경로를 사용합니다. 감지에 실패하거나 토큰이 만료되면 다음을 실행하세요.

```bash
ima2 setup     # 옵션 1 (GPT OAuth) 다시 실행
ima2 doctor
```

그다음 `ima2 serve`를 다시 시작합니다.

### `Provided authentication token is expired`가 떠요.

Codex/ChatGPT OAuth 세션을 다시 로그인해야 합니다.

```bash
ima2 setup     # 옵션 1 (GPT OAuth) 다시 실행
ima2 serve
```

회사 네트워크라면 방화벽, VPN, 프록시, 보안 프로그램이 OAuth 흐름을 막고 있을 수도 있습니다.

## 모델과 한도

### 어떤 모델부터 쓰면 좋나요?

GPT OAuth에서는 `gpt-6-luna`로 시작합니다. 이 레인에는 GPT-6 모델이 세 개 있고, 고른 모델이 이미지를 기획하면 `gpt-image-2`가 그립니다.

- `gpt-6-luna`: 기본값입니다.
- `gpt-6-sol`: 또 하나의 일상용 GPT-6 모델입니다.
- `gpt-6-astra`: 가장 오래 추론하는 대신 가장 느립니다. 추론 강도 `none`은 `low`로 실행됩니다.

예전 OAuth 모델 ID(`gpt-5.6-sol`, `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`)는 저장된 설정과 스크립트에서 그대로 동작합니다. `gpt-5.6-sol`은 `gpt-6-sol`로, 나머지는 `gpt-6-luna`로 실행됩니다. API 키 레인(`provider: "api"`)은 자체 목록을 유지하고 기본값은 `gpt-5.6-luna`입니다.

### GPT-6 모델 하나만 실패하는 이유는 뭔가요?

GPT OAuth 레인은 ChatGPT 요금제에 열린 GPT-6 모델을 씁니다. ima2-gen을 업데이트하고 `ima2 gpt login`으로 다시 로그인한 뒤 `ima2 models --kind image`로 확인하세요. 특정 모델만 계속 실패하면 `gpt-6-luna`로 바꿔 보세요.

### Plus/Pro는 몇 장까지 생성할 수 있나요?

커뮤니티에서 말하는 숫자를 보장으로 받아들이면 안 됩니다. GPT OAuth 생성은 계정, 백엔드 capability, 트래픽, 정책 변경의 영향을 받을 수 있습니다. `ima2-gen` 문서에서는 고정된 Plus/Pro 생성 횟수를 약속하지 않습니다.

## Prompt Studio와 멀티모드

### Prompt Studio 상세 설명서가 있나요?

네. [Prompt Studio 사용 설명서](PROMPT_STUDIO.ko.md)를 확인하세요. 작성창,
멀티모드 슬롯, 1:1 Direct, 모델/추론 빠른 설정, 최근 생성, 갤러리 즐겨찾기,
어떤 액션이 프롬프트를 의도적으로 가져오는지 정리했습니다.

### 멀티모드 이미지가 서로 관계없게 나오는 이유는 뭔가요?

멀티모드는 같은 프롬프트로 여러 개의 독립 이미지 요청을 시작합니다. 각 슬롯은
후보 이미지이지, 한 캔버스 안의 패널이나 보장된 연속 장면이 아닙니다. 서로
관련 있는 대안을 원하면 공통 대상을 먼저 쓰고 바뀌어도 되는 요소를 따로
적어 주세요. 한 장 안의 2패널, 콜라주, contact sheet가 필요하면 일반 한 장
생성에서 그렇게 요청하는 편이 맞습니다.

### 갤러리 이미지를 선택하면 현재 프롬프트가 바뀌어야 하나요?

단순 이미지 선택은 보기 전용입니다. 선택 이미지를 보여줄 뿐 작성창을 바꾸지
않아야 합니다. 프롬프트 라이브러리 삽입, "이 이미지에서 이어가기", 명시적인
재사용 액션만 프롬프트를 의도적으로 바꾸는 동작입니다.

### Issue #75에서 무엇이 정리됐나요?

Prompt Studio의 navigation/state coupling 회귀를 정리했습니다. 키보드 이동은
보이는 최근 생성 범위를 따르고, 갤러리 진입 버튼은 계속 접근 가능하며, 긴
프롬프트가 이미지 뷰어를 과하게 줄이지 않고, Direct와 멀티모드 상태가 동시에
보이며, 갤러리 즐겨찾기와 탭 전환은 보던 위치를 유지하고, 단순 이미지 선택은
작성창을 자동으로 채우지 않습니다.

## 갤러리와 생성 파일

### 생성 이미지는 어디에 저장되나요?

현재 버전은 사용자 데이터 폴더에 저장합니다.

```text
macOS / Linux: ~/.ima2/generated
Windows: %USERPROFILE%\.ima2\generated
```

`IMA2_GENERATED_DIR`로 다른 위치를 지정할 수 있습니다.

### 업데이트 후 예전 갤러리 이미지가 안 보여요.

예전 버전은 생성 이미지를 설치된 패키지 폴더 안에 저장했습니다. 최근 버전은 패키지 업데이트와 사용자 파일이 섞이지 않도록 갤러리 저장 위치를 사용자 데이터 폴더로 옮겼습니다.

놀라게 해드려 죄송합니다. 업데이트 중 예전 전역 설치 폴더가 교체되었다면 이전 `generated/` 폴더가 디스크에 남아 있지 않을 수 있습니다. `ima2-gen`은 예전 폴더가 아직 있을 때만 파일을 복사해 복구할 수 있습니다.

먼저 실행하세요.

```bash
ima2 doctor
```

그다음 [예전 이미지 복구 안내](RECOVER_OLD_IMAGES.md)를 확인하세요.

### 이 마이그레이션이 예전 이미지를 삭제하나요?

아니요. 마이그레이션은 copy-only입니다. 예전 폴더를 삭제하거나 이동하지 않습니다. 예전 파일을 찾지 못했다면, 예전 전역 설치 폴더가 이미 디스크에 남아 있지 않은 상황일 수 있습니다.

### "Open folder"는 어떤 폴더를 여나요?

갤러리의 **Open folder** 버튼은 `ima2 serve`가 실행 중인 머신의 생성 이미지 폴더를 엽니다.

보통은 내 컴퓨터입니다. 하지만 원격 서버, SSH, VM, 컨테이너, WSL, 같은 네트워크의 다른 머신에서 서버를 돌리고 있다면 브라우저를 보고 있는 기기가 아니라 서버 머신 기준으로 열리거나 처리됩니다.

### Card News는 공개 안정 기능인가요?

아직 아닙니다. Card News는 dev-only / experimental 작업면입니다. 기본 배포
런타임에서는 명시적으로 개발용 플래그를 켜지 않는 한 숨겨져 있어야 하며,
공개 문서에서도 안정 기능처럼 다루지 않습니다.

## 레퍼런스 이미지

### 레퍼런스 이미지는 몇 장까지 붙일 수 있나요?

최대 5장입니다.

### 어떤 형식이 좋나요?

JPEG 또는 PNG가 가장 안전합니다. 브라우저 경로에서는 HEIC/HEIF를 직접 지원하지 않으므로 먼저 변환해 주세요.

### 이미지가 너무 크다고 나와요.

앱이 큰 JPEG/PNG를 업로드 전에 자동 압축합니다. 그래도 실패하면 해상도를 낮추거나 JPEG/PNG로 변환해 다시 시도하세요.

API에서는 `REF_TOO_MANY`, `REF_TOO_LARGE`, `REF_NOT_BASE64`, `REF_EMPTY` 같은 reference 오류가 나올 수 있습니다.

## 네트워크와 OAuth 오류

### 백엔드가 왜 다른 포트로 열리나요?

`ima2-gen`은 로컬 앱입니다. 기본 백엔드 포트 `3333`이 이미 사용 중이면 다음 사용 가능한 포트로 fallback하고, 실제 URL은 아래 파일에 기록됩니다.

```text
~/.ima2/server.json
```

아래 명령으로 설정한 백엔드 URL과 실제 URL을 확인하세요.

```bash
ima2 doctor
```

GPT OAuth는 로컬 포트를 쓰지 않습니다. 서버가 ChatGPT를 직접 호출합니다.

### 프런트엔드를 따로 개발할 때 실제 백엔드는 어떻게 가리키나요?

`ima2 doctor`가 알려 주는 백엔드 URL을 Vite에 넘기세요.

```bash
VITE_IMA2_API_TARGET=http://localhost:3334 npm run ui:dev
```

### `failed to fetch`는 무슨 뜻인가요?

보통 아래 중 하나입니다.

- GPT OAuth가 `chatgpt.com`에 닿지 못했습니다.
- 서버가 재시작되었습니다.
- VPN, 프록시, 방화벽이 요청을 막았습니다.
- Windows에서 자동 실행되는 DNS/파편화 우회 프로그램(예: SecretDNS)이 OAuth 또는 스트리밍 이미지 응답을 깨뜨렸습니다.
- Codex/ChatGPT OAuth 사용 중 네트워크가 끊겼습니다.

먼저 확인하세요.

```bash
ima2 doctor
ima2 ping
```

필요하면 `ima2 serve`를 다시 시작합니다.

### GPT OAuth 이미지 생성이 이미지 없이 끝나면 무엇을 공유해야 하나요?

먼저 moderation으로 단정하지 말고 image probe를 실행하세요. `EMPTY_RESPONSE`는
Responses 경로에서 `ima2-gen`이 사용할 수 있는 이미지 데이터가 나오지 않았다는
뜻입니다. 원인은 OAuth capability, stream parsing, web-search/tool-choice
상호작용, 로컬 프록시/네트워크 transport, 지원되지 않는 옵션, 실제 refusal 등으로
나뉠 수 있습니다.

먼저 실행하세요.

```bash
ima2 doctor
ima2 doctor image-probe --json > ima2-image-probe.json
```

`ima2 serve`가 실행 중이면 검색을 끈 생성과 일반 생성 결과도 하나씩 저장하세요.

```bash
ima2 gen "고양이" --model oauth/gpt-6-luna --no-web-search --json > ima2-cat-no-search.json
ima2 gen "고양이" --model oauth/gpt-6-luna --json > ima2-cat-current.json
```

probe JSON은 공개 이슈에 첨부할 수 있도록 설계되어 있습니다. 진단 코드,
event count, tool-call 요약, byte count는 담지만 prompt text, auth token,
credential URL, base64 image data는 담지 않습니다.

이슈를 열 때 포함해 주세요.

- `ima2 doctor` 출력
- `ima2-image-probe.json`
- 저장했다면 `ima2-cat-no-search.json`, `ima2-cat-current.json`
- `ima2-gen` 버전과 Windows 버전
- VPN, 회사 프록시, 백신 TLS 검사, custom CA 사용 여부
- Windows에서 SecretDNS 같은 DNS/파편화 우회 프로그램이 자동 실행 중인지 여부
- API 키가 이미 설정되어 있다면 같은 PC에서 `provider: "api"`가 동작하는지

ChatGPT 쿠키, OAuth token 파일, API key, raw upstream response, prompt history,
generated base64는 공유하지 마세요.

결과는 이렇게 분류합니다.

- text probe도 실패: OAuth 재로그인, 프록시, 모델 접근성을 먼저 봅니다.
- text는 되지만 minimal non-stream image가 실패: 계정, OAuth backend, model, image-tool capability 가능성이 큽니다.
- non-stream image는 되지만 stream image가 실패: stream parsing 또는 transport 가능성이 큽니다.
- 검색 끈 생성은 되지만 일반 생성이 실패: web-search/tool-choice 상호작용 가능성이 큽니다.
- bytes는 읽었지만 event가 없음: SSE delimiter 또는 `data:` parsing 가능성이 큽니다.

### 프록시나 VPN 환경에서 `fetch failed`가 계속 나면 어떻게 하나요?

GPT OAuth 요청은 `ima2 serve` 프로세스에서 `chatgpt.com`으로 바로 나갑니다. 그래서 그 프로세스의 네트워크 경로가 중요합니다.

프록시가 필요한 네트워크라면 터미널 프로세스도 프록시를 타도록 프록시 클라이언트의 TUN/TURN류 모드를 켜세요. Windows에서는 SecretDNS처럼 부팅 때 자동 실행되는 DNS/파편화 우회 프로그램도 잠시 끄고 재시도해 보세요. 그래도 안 되면 `ima2 serve`를 시작하는 터미널에 프록시를 설정하세요. Node.js는 `NODE_USE_ENV_PROXY=1`이 함께 있어야 `HTTPS_PROXY`를 읽습니다.

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
export NODE_USE_ENV_PROXY=1
ima2 serve
```

호스트와 포트는 사용하는 프록시 클라이언트 값에 맞춰 바꾸세요. 그래도 `ima2-gen`이 계속 실패하면, 새 이슈를 열 때 실행 명령, OS, 프록시 설정, 터미널 오류를 함께 남겨 주세요.

### 회사 컴퓨터에서는 무엇을 확인해야 하나요?

GPT OAuth는 OpenAI와 ChatGPT/Codex 관련 호스트 접근이 필요할 수 있습니다. 회사 방화벽, TLS 검사, VPN, 프록시가 흐름을 깨뜨릴 수 있습니다. 로그인 실패와 `failed to fetch`가 반복되면 다른 네트워크에서도 시도해 보세요.

## SSE 멀티플렉싱

### 왜 웹 UI가 단일 SSE 연결을 쓰나요?

브라우저는 같은 origin에 대해 동시 HTTP 연결 수를 제한합니다(보통 6개). 여러 이미지를 동시에 생성할 때 각 요청이 SSE 연결을 점유하면, multimode+node+video가 동시에 돌아갈 때 연결이 포화되어 갤러리 썸네일이 멈췄습니다.

이제 웹 UI는 `GET /api/events`로 하나의 SSE 연결만 열고, 모든 생성 진행 이벤트를 멀티플렉싱합니다. 생성 요청은 `async: true`로 보내면 즉시 `202 { requestId }` 응답을 받아 연결을 바로 해제합니다. CLI는 영향 없이 기존 per-request SSE를 그대로 사용합니다.

### SSE 연결이 끊기면 어떻게 되나요?

이벤트 채널 클라이언트가 지수 백오프로 자동 재연결합니다. 재연결 시 `Last-Event-ID`를 보내서 서버의 링 버퍼(최대 2000건)에서 놓친 이벤트를 재전송받습니다. 버퍼에서 이미 사라진 이벤트가 있으면 `replay-gap` 이벤트로 알려줍니다.

### 동시 작업 상한은 얼마인가요?

서버는 동시 생성 작업을 설정값 `limits.maxParallel` 기준으로 제한합니다(기본 `24`, `IMA2_MAX_PARALLEL`로 변경 가능). 초과 요청은 `429`와 `Retry-After: 5`를 받습니다. SSE 엔드포인트 자체는 512개 동시 연결까지 지원합니다.

## CLI 점검 순서

아래 순서대로 확인해 보세요.

```bash
ima2 doctor
ima2 status
ima2 ping
ima2 ps
ima2 setup
npm install -g ima2-gen@latest
```

서버를 기본 포트가 아닌 곳에서 실행 중이라면:

```bash
IMA2_SERVER=http://localhost:3333 ima2 ping
```
