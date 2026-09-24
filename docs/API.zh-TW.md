# API參考

本文檔列出了本地HTTP API暴露於`ima2 serve`.

根據URL:

```text
http://localhost:3333
```

## 供應商政策

圖像生成支持OAuth, API-鑰匙，Grok， 和Gemini (`agy`和`gemini-api`) 提供者。

- `provider: "oauth"`使用本地的Codex OAuth代理人。
- `provider: "api"`使用OpenAI回應API與託管的`image_generation`工具。
- `provider: "grok"`使用儲存在`~/.progrok/auth.json`的xAI OAuth工作階段直接呼叫`https://api.x.ai`，不再有本機代理程式。經典、節點和代理生成強制運行xAI網頁搜尋透過`/v1/responses`，然後運行`grok-4.5`計劃員與強製本地人通話`generate_image`函數，那麼ima2執行xAI `/v1/images/generations`. `grok-4.3`仍然可以作為顯式相容性覆蓋使用。如果附加了參考影像、節點父映像或代理目前影像，則最後一步將切換到xAI `/v1/images/edits`因此圖像到圖像的上下文被保留。
- `provider: "agy"`產生Antigravity CLI (`agy -p`）透過Google生成圖像Gemini's `default_api:generate_image`工具。型號是`nano-banana-2`。輸出固定為1024×1024JPEG。最多 3 個參考影像 (i2i)。沒有網路搜尋、品質、尺寸或遮罩控制。多模式返回單一影像。不支援影片（`AGY_VIDEO_UNSUPPORTED`).
- `provider: "grok-api"`使用直接xAI API密鑰而不是OAuth工作階段；缺少或為空的影像憑證會在准入前以`GROK_API_KEY_MISSING`拒絕，絕不改走OAuth通道。與相同的管道`grok`（網頁搜尋 → 策劃 →`/v1/images/generations`），相同的寬高比和解析度選項。需要一個xAI API透過網路配置的密鑰UI密鑰管理或`XAI_API_KEY`環境變數。也支援視頻生成。
- `provider: "gemini-api"`呼叫 Google 生成語言API直接（或Vertex AI使用服務帳戶JSON）。支援型號`nano-banana-2` (Gemini3.1 Flash 影像）和`nano-banana-pro` (Gemini3 專業圖像）。在兩個身份驗證路徑上支援可變寬高比（1:1 到 21:9）和四個解析度層（512px、1K、2K、4K）—直接API路徑發送`generation_config.response_format.image`（蛇_情況）而Vertex AI端點（`aiplatform.googleapis.com`) 發送`generationConfig.imageConfig`（駝峰式）。和`size: "auto"`影像配置被完全省略，模型決定比率/大小。授權：`GEMINI_API_KEY`環境變數、網絡UI密鑰管理（`/api/keys/gemini`），或一個Vertex AI服務帳戶JSON (`VERTEX_SERVICE_ACCOUNT_JSON`或者`/api/keys/vertex`）。當 Vertex 憑證和APIkey 已配置，Vertex 優先。選擇的身份驗證模式（`apikey`或者`vertex`）堅持`~/.ima2/config.json`作為`geminiAuthMode`並在伺服器啟動時恢復。每個模型的成本：`nano-banana-2`（快閃記憶體）：512=0.001 美元、1K=0.003 美元、2K=0.004 美元、4K=0.006 美元；`nano-banana-pro`：1K=0.007 美元，2K=0.007 美元，4K=0.013 美元。沒有網路搜尋或遮罩控制。
- API-金鑰產生涵蓋經典生成、編輯、掩模引導編輯、多模式和節點生成。
- 如果`provider: "api"`請求時沒有API關鍵，路由在上游之前失敗`401`和`API_KEY_REQUIRED`.
- Grok生成圖`size`到xAI `aspect_ratio`和`resolution`;它不發送OpenAI-風格`size`上游田地。Grok編輯用途xAI `/v1/images/edits`; Grok蒙版編輯仍然不受支援並返回`GROK_MASK_UNSUPPORTED`.
- 蒙版編輯是蒙版/選擇引導編輯，而不是像素完美的修復保證。

Grok影片生成用途`POST /api/video/generate` (SSE）。看影片
下面的生成部分提供了完整的端點規格。

## 健康狀況

|方法|小路|筆記|
|---|---|---|
| `GET` | `/api/health` |伺服器健康狀況、版本、路徑、提供者策略；包含`grok: { auth: "oauth" \| "none" }`，同樣寫入`~/.ima2/server.json`|
| `GET` | `/api/providers` |提供者可用性和運行時端口|
| `GET` | `/api/oauth/status` | OAuth代理狀態和可見模型|
| `GET` | `/api/grok/status` | xAI OAuth工作階段狀態和可見xAI影像模型。回傳`ready`、`no_image_model`、`error`或`offline`；沒有工作階段時原因是`login_required`|
| `GET` | `/api/billing` |計費/狀態探測，包括API配置時的密鑰來源|
| `GET` | `/api/quota` |供應商配額：回報`{ codex, grok }`。有資格的Grok建造xAIOIDC/外部身份驗證返回`weekly`百分比/重置視窗`GET /v1/billing?format=credits`。如果不可用，舊端點可能會返回`monthly`視窗加`billing: { usedUsd, limitUsd }`. |

## 帳戶切換

|方法|小路|筆記|
|---|---|---|
| `POST` | `/api/auth/switch` |啟動設備代碼OAuth流動。身體：`{ "provider": "grok" \| "codex" }`。退貨`{ sessionId, userCode, verificationUrl }`. |
| `GET` | `/api/auth/switch/:sessionId` |輪詢切換帳號會話狀態。退貨`{ status }`狀態是`pending`, `complete`, `error`， 或者`expired`. |

切換帳戶流程會開啟瀏覽器驗證URL。用戶完成設備代碼步驟後，伺服器將保存新憑證（Grok: `~/.progrok/auth.json`; Codex： 透過`codex login --device-auth`）並且會話轉換為`complete`。該端點顯示為**切換帳戶**設定配額卡中的按鈕Grok和Codex提供者。

## 貯存

|方法|小路|筆記|
|---|---|---|
| `GET` | `/api/storage/status` |匯總圖庫存儲狀態以提供支持UI |
| `POST` | `/api/storage/open-generated-dir` |要求伺服器進程打開生成的圖像資料夾|

`GET /api/storage/status`預設會傳回支援安全摘要，而不是原始遺留路徑陣列。

```json
{
  "ok": true,
  "data": {
    "generatedDirLabel": "~/.ima2/generated",
    "generatedCount": 0,
    "legacyCandidatesScanned": 18,
    "legacySourcesFound": 0,
    "legacyFilesFound": 0,
    "state": "not_found",
    "messageKind": "apology",
    "recoveryDocsPath": "docs/RECOVER_OLD_IMAGES.md",
    "doctorCommand": "ima2 doctor",
    "overrides": {
      "generatedDir": false,
      "configDir": false
    }
  }
}
```

貯存`state`價值觀：

|狀態|意義|
|---|---|
| `ok` |目前圖庫有文件或無需恢復通知|
| `recoverable` |舊資料夾/檔案仍然存在並且可以恢復|
| `not_found` |目前圖庫為空，未找到舊資料夾|
| `unknown` |儲存狀態檢查失敗或不完整|

`POST /api/storage/open-generated-dir`在運行的機器上打開生成的圖像資料夾`ima2 serve`。如果瀏覽器連接到遠端伺服器、VM、容器、WSL 實例或網路上的另一台計算機，則此操作針對的是該伺服器計算機，而不一定是瀏覽器設備。

## 飛行中的工作

|方法|小路|筆記|
|---|---|---|
| `GET` | `/api/inflight` |預設僅活動作業|
| `GET` | `/api/inflight?includeTerminal=1` |包括最近用於偵錯的終端作業|
| `DELETE` | `/api/inflight/:requestId` |取消或忘記正在進行的工作|
| `GET` | `/api/events` |執著的SSE所有非同步產生進度的多路復用通道（見下文）|

飛行日誌和回應使用`requestId`用於相關性。日誌不應包含原始提示、參考資料 URL、產生的 base64、令牌、cookie、驗證標頭或原始上游主體。

## 活動（SSE復用）

### `GET /api/events` (SSE復用）

單一持久性伺服器發送事件通道，用於承載所有非同步產生作業的進度。瀏覽器UI打開一個`EventSource`在這裡而不是保存每個請求SSE每個作業的連接，避免瀏覽器每個來源的連接限制。

|詢問|筆記|
|---|---|
| `lastEventId` |選修的。重新連接遊標；也透過`Last-Event-ID`請求頭|

**回覆**: `text/event-stream`（執著的）。每個框架均採用標準SSE領域`id`, `event`， 和`data` (JSON).

**連線限制**：當活躍監聽數達到512時，伺服器返回`503`和`SSE_CAPACITY`在打開流之前。

**心跳**：伺服器每15秒寫入一個評論框：

```text
: ping
```

**重播**：重新連線時，伺服器會重播記憶體中環形緩衝區（大小 2000）中的事件，以查找更新於`lastEventId`。重播時會省略大圖像有效負載（>1000 個字元）`_imageOmitted: true`在`data`有效負載。如果請求的 ID 早於最舊的緩衝事件，則伺服器會發出`replay-gap`直播扇出前的事件：

|事件|數據|描述|
|---|---|---|
| `replay-gap` | `{ lastEventId, oldestAvailableId }` |客戶端應該協調飛行狀態（例如透過`GET /api/inflight`) |

**作業路由**： 每一個`data`有效負載包括`jobId`（與工作的價值相同`requestId`）。活動機構也攜帶`requestId`適用時。客戶端透過匹配來過濾事件`data.jobId`或者`data.requestId`到他們開始的工作。

**事件類型**（扇出到所有連線的客戶端）：

|事件|發射者|描述|
|---|---|---|
| `phase` |節點、多模、視頻|生命週期階段變化|
| `partial` |節點，多模|漸進式預覽影像（base64 數據URL) |
| `image` |多模|最終保存`GenerateItem`對於一幅序列影像|
| `done` |節點、多模、視頻|終端成功有效負載（特定於路線的形狀）|
| `error` |所有生成路線|終端故障|
| `submitted` |影片|作業提交至xAI |
| `progress` |影片|進度分數 0.0–1.0|
| `planning` |影片|視訊規劃器運行|

例子SSE框架：

```text
id: 42
event: phase
data: {"requestId":"req_abc","jobId":"req_abc","phase":"streaming"}
```

### 非同步生成模式

`POST /api/node/generate`, `POST /api/generate/multimode`， 和`POST /api/video/generate`支援已持有的客戶端的非同步 POST 模式`GET /api/events`:

```json
{
  "async": true,
  "requestId": "req_xxx",
  "...": "other route fields"
}
```

|結果| HTTP |身體|
|---|---|---|
|公認| `202` | `{ "requestId": "req_xxx" }` |
|重複活動`requestId` | `409` | `REQUEST_ID_IN_USE` |
|超過配置的並發活動作業限制| `429` | `TOO_MANY_JOBS`和`Retry-After: 5`;預設限制是`24`透過`IMA2_MAX_PARALLEL` |

進展事件發佈於`GET /api/events`。 POST響應立即回傳；客戶一定不要期望SSE在 POST 連線上時`async: true`.

CLI和遺留客戶省略`async`並保持原始行為：每個請求SSE在同一個 POST 回應上（`Accept: text/event-stream`適用時）。伺服器在該模式下雙發射——它寫道SSE到 POST 回應，並在上發布相同的事件`GET /api/events`.

## 世代

## 雪碧阿特拉斯

精靈圖集導入需要精靈產生相容的清單和PNG阿特拉斯。在讀取/寫入往返過程中會保留未知的清單欄位。

|方法|小路|筆記|
|---|---|---|
| `POST` | `/api/sprite-atlas/import` | JSON `{ manifest, atlasBase64, runId?, name? }`;驗證顯式矩形並建立精靈運作以及代表性影像資源。|
| `GET` | `/api/sprite-atlas/:runId` |返回清單、可選管理和圖集URL. |
| `PUT` | `/api/sprite-atlas/:runId/curation` |以原子方式儲存 sprite-gen curation v1，而不更改來源幀。|
| `POST` | `/api/sprite-atlas/:runId/unpack` |使用清單矩形提取幀。|
| `POST` | `/api/sprite-atlas/:runId/bake` |應用管理並重建圖集、清單和報告。|
| `POST` | `/api/sprite-atlas/:runId/export/contact-sheet` |身體`{ state, columns? }`;創建一個PNG聯繫表。|
| `POST` | `/api/sprite-atlas/:runId/export/gif` |身體`{ state, fps?, loop? }`;透過 ffmpeg 創建並解碼驗證透明 GIF。|

導入時不返回清單`SPRITE_MANIFEST_REQUIRED`。 GIF 匯出退貨`FFMPEG_UNAVAILABLE`和HTTP503 當 ffmpeg 不可用時。

### `POST /api/generate`

文字到圖像和參考引導的根生成。

```json
{
  "prompt": "a shiba in space",
  "quality": "medium",
  "size": "1024x1024",
  "format": "png",
  "moderation": "low",
  "provider": "oauth",
  "model": "gpt-5.4",
  "references": [],
  "requestId": "optional-client-id",
  "storyboard": false
}
```

支援的品質值：`low`, `medium`, `high`.

支援的審核值：`auto`, `low`.

什麼時候`storyboard`是`true`，伺服器預先新增情節提要關鍵影格指令，以便影像
幾代人保持多鏡頭影片製作的角色和場景連續性。

當前應用程式預設值：`gpt-5.6-luna`. `gpt-5.5`和其他支持的GPT image當呼叫者明確選擇模型時，模型仍然可用。

什麼時候`provider`是`"grok"`，支援的型號有`grok-imagine-image`和
`grok-imagine-image-quality`。伺服器使用`grok-4.5`作為搜尋/規劃者
預設型號（`IMA2_GROK_PLANNER_MODEL`）和強制搜尋的時間和
規劃器步驟與影像呼叫分開（`IMA2_GROK_PLANNER_TIMEOUT_MS`).
為了`n > 1`，搜尋和計劃運行一次，計劃的提示將重複用於
圖像請求。成功的Grok經典世代報告一強制
元資料中的網路搜尋呼叫。

如果`references`存在於Grok經典請求，ima2仍然執行
強制搜索和`grok-4.5`規劃階段。規劃者收到
多模態參考影像`image_url`輸入及其強制
`generate_image.prompt`參數被指示為僅限英語，除了
使用者請求的精確可見文字。最終的圖像調用然後使用xAI
`/v1/images/edits`使用相同的參考圖像而不是
`/v1/images/generations`。這可以保持圖像到圖像/參考上下文的活力
通過三相管道。xAI目前最多記錄三個來源
用於圖像編輯的圖像，所以Grok超過三個的經典請求
參考文獻返回`GROK_REF_TOO_MANY`.

Grok尺寸映射：

|要求尺寸| xAI `aspect_ratio` | xAI `resolution` |
|---|---|---|
| `1024x1024` | `1:1` | `1k` |
| `1536x1024` | `3:2` | `1k` |
| `1024x1536` | `2:3` | `1k` |
| `1360x1024` | `4:3` | `1k` |
| `1024x1360` | `3:4` | `1k` |
| `1824x1024` | `16:9` | `1k` |
| `1024x1824` | `9:16` | `1k` |
| `2048x2048` | `1:1` | `2k` |
| `2048x1152` | `16:9` | `2k` |
| `1152x2048` | `9:16` | `2k` |
| `3840x2160` | `16:9` | `2k` |
| `2160x3840` | `9:16` | `2k` |
| `auto` | `auto` |省略|

客製尺寸縮小到最接近的尺寸xAI- 支援的寬高比和使用
`2k`當請求的最長邊緣或像素預算更接近 2K 影像。

### `POST /api/edit`

圖像編輯/圖像到圖像生成。

該請求包括提示和圖像負載。`provider: "api"`透過共享響應圖像適配器發送提示和圖像。可選蒙版作為蒙版指導轉發，而不是像素完美的編輯保證。

和`provider: "grok"`，編輯請求發送至xAI `/v1/images/edits`
使用OAuth工作階段直接傳送。蒙面Grok之前編輯被拒絕
上游與`GROK_MASK_UNSUPPORTED`.

Grokmultimode 目前將每個圖像請求直接發送到xAI圖片API
與映射的`aspect_ratio`/`resolution`;強制搜尋+規劃器
管道僅限於經典`/api/generate`.

### `POST /api/node/generate`

節點模式產生和子編輯。

身體領域：

```json
{
  "parentNodeId": "optional-server-node-id",
  "prompt": "continue this image",
  "quality": "medium",
  "size": "1024x1024",
  "format": "png",
  "moderation": "low",
  "model": "grok-imagine-image",
  "references": [],
  "externalSrc": "optional-history-url",
  "sessionId": "session-id",
  "clientNodeId": "client-node-id",
  "requestId": "request-id",
  "provider": "grok"
}
```

什麼時候`parentNodeId`如果存在，伺服器載入儲存的父節點映像並使用編輯路徑。根節點和子/編輯節點都允許節點本地引用；對於子/編輯節點，首先發送父圖像，然後發送引用，然後發送文字提示。

和`provider: "grok"`，Node模式使用相同xAI搜尋+`grok-4.5`規劃師+圖像API管道作為經典一代。父節點影像，`externalSrc`，或額外的參考傳遞給規劃者，然後傳遞給xAI `/v1/images/edits`;否則最終調用使用`/v1/images/generations`. Grok節點請求的上限為三個輸入影像，計算父/當前影像加上引用，然後返回`GROK_REF_TOO_MANY`當超過該限制時，在上游之前。`quality: "high"`將最終的影像模型提升為`grok-imagine-image-quality`.

當客戶端發送時，路由可以串流傳輸伺服器發送的事件`Accept: text/event-stream`。可能發生的事件包括`phase`, `partial`, `done`， 和`error`。或者，發送`{ "async": true, "requestId": "req_xxx" }`在體內接收`202 { requestId }`立即並追蹤進展`GET /api/events`（請參閱「活動」部分）。

Grok節點SSE回覆不包括回覆API `partial`影像事件是因為xAI圖片API調用是同步的JSON。他們仍然散發著`phase`和`done`/`error`事件所以節點UI可以使用相同的飛行生命週期。

### `POST /api/generate/multimode` (SSE)

多圖像序列生成。SSE-僅在 POST 回應上，除非使用非同步模式。

```json
{
  "prompt": "a story in four panels",
  "maxImages": 4,
  "quality": "medium",
  "size": "1024x1024",
  "format": "png",
  "moderation": "low",
  "model": "gpt-5.4",
  "provider": "oauth",
  "references": [],
  "requestId": "optional-client-id",
  "async": false
}
```

傳送`Accept: text/event-stream`對於每個請求SSE在 POST 連線上。或設定`"async": true`與客戶`requestId`要得到`202 { requestId }`並接收事件`GET /api/events`.

**SSE事件**:

|事件|數據|描述|
|---|---|---|
| `phase` | `{ requestId, phase, sequenceId?, maxImages? }` |生命週期階段|
| `partial` | `{ requestId, image, index }` |漸進式預覽|
| `image` |滿的`GenerateItem` |一張已儲存的序列影像|
| `done` |特定路線的摘要；可能包括`status: "partial"`超時後如果至少保存了一張圖像|序列完成|
| `error` | `{ requestId, error, code?, status? }` |生成失敗|

### `GET /api/node/:nodeId`

取得儲存的節點元資料和資產URL.

## 參考圖片

參考上傳的上限為 5 項。前端壓縮量大JPEG/PNG發送文件之前。 HEIC/HEIF 檔案被拒絕並帶有面向使用者的轉換提示。

伺服器端驗證可能會傳回這些參考代碼：

|程式碼|意義|
|---|---|
| `REF_NOT_ARRAY` | `references`不是一個陣列|
| `REF_TOO_MANY` |超過配置的引用計數|
| `REF_NOT_STRING` |參考項目不是字串|
| `REF_EMPTY` |參考項目為空|
| `REF_TOO_LARGE` |引用超出了配置的 base64 大小|
| `REF_NOT_BASE64` |引用的 base64 無效|
| `GROK_REF_TOO_MANY` | Grok經典一代收到三張以上參考圖|
| `GROK_MASK_UNSUPPORTED` | Grok請求編輯時帶有掩碼；xAI此版本中未連接蒙版編輯|

## 影片生成

### `POST /api/video/generate` (SSE)

透過生成視頻Grok視訊提供者。在 POST 連線上傳回伺服器傳送的事件，或接受非同步模式（`{ "async": true, "requestId": "req_xxx" }`） 為了`202 { requestId }`取得進展`GET /api/events`（請參閱「活動」部分）。

```json
{
  "prompt": "a cat playing piano",
  "provider": "grok",
  "model": "grok-imagine-video",
  "duration": 5,
  "resolution": "480p",
  "aspectRatio": "auto",
  "sourceImage": "<base64>",
  "referenceImages": ["<base64>", "<base64>"],
  "referenceFilenames": ["existing-file.png"],
  "continueFromVideo": "1780226256355_50252101.mp4",
  "continuityLineage": { "lineageId": "optional-client-hint", "entries": [] },
  "sessionId": "optional",
  "requestId": "optional-client-id"
}
```

**型號**: `grok-imagine-video-1.5`(預設),`grok-imagine-video`。遺產`grok-imagine-video-1.5-preview`string 被接受為相容性別名稱並在上游請求之前進行規範化。

**模式**從參考輸入自動檢測：

|輸入|模式|期限上限|
|---|---|---|
|沒有圖片|文字轉視頻| 1–15s |
|1 張圖片（`sourceImage`或者`sourceFilename`) |影像到視頻| 1–15s |
|2–14 張圖像 (`referenceImages` / `referenceFilenames`) |參考影片| 1.5: 1–15s / base: 1–10s |

1080p 可接受`grok-imagine-video-1.5`僅提示文字到視頻和圖像到視頻，具有一個圖像/幀源，包括`continueFromVideo`伺服器提取父影片的最後一幀後。僅提示 1.5 文字到影片在上游請求之前使用內部白色畫布圖像到影片 shim。 1.5 不新增 Ref2V、V2V 編輯或擴充支援。

**參數**:

|場地|類型|預設|筆記|
|---|---|---|---|
| `prompt` |細繩| — |必需的|
| `provider` |細繩| `"grok"` | `"grok"`或者`"grok-api"` |
| `model` |細繩| `grok-imagine-video-1.5` |視訊模型|
| `duration` |整數| `5` |1–15 秒（為了參考視頻，限制為 10 秒）|
| `resolution` |細繩| `"480p"` | `480p`, `720p`， 或者`1080p` (`1080p`使用 1.5 T2V 帆布墊片或 I2V）|
| `aspectRatio` |細繩| `"auto"` |1:1、16:9、9:16、4:3、3:4、3:2、2:3、自動|
| `sourceImage` |細繩| — |用於影像轉影片的 Base64 影像|
| `sourceFilename` |細繩| — |用於影像到影片的現有生成文件|
| `referenceImages` |細繩[] | — |用於視訊參考的 Base64 影像|
| `referenceFilenames` |細繩[] | — |現有產生的影片參考文件|
| `continueFromVideo` |細繩| — |產生`.mp4`父母；伺服器提取最後一幀並從 sidecar 重建譜系|
| `continuityLineage` |目的| — |可選的客戶端提示；僅當`continueFromVideo`缺席|
| `plannerModel` |細繩| `grok-4.5` | Grok視訊規劃器模型覆蓋範圍；`grok-4.3`保持相容（也可以透過設定UI或者`IMA2_GROK_PLANNER_MODEL`) |
| `storyboard` |布林值| `false` |啟用故事板模式 - 保持連續剪輯中的角色/場景連續性|

返回空白提示`PROMPT_REQUIRED`與一個`guidance`細繩。活躍的
提示應描述視覺流、運動流、聲音/音樂/無音樂，
對話/無對話、結束幀和持續時間節奏。影片策劃者使用
將選定的持續時間作為完整剪輯的運行時間，並將短請求擴展為
具有開場構圖、關聯動作/情緒的製作級序列
變化，以及適合延續的穩定的結束框架。對於多字元
場景中，策劃者透過視覺外觀（服裝、體格、
位置、道具）而不是名稱，並相應地為每個對話行賦予屬性。

什麼時候`continueFromVideo`存在，伺服器處理產生的`.mp4`
sidecar 具有權威性。客戶`continuityLineage`無法覆蓋它。這
保存的子 sidecar 包括`videoContinuity`，一個分支本地 max-4 堆疊，使用
`keep-start-plus-latest-3`保留。

`videoContinuity`形狀：

```json
{
  "lineageId": "lineage:parent",
  "parentFilename": "parent.mp4",
  "sourceFrame": "last",
  "maxEntries": 4,
  "retention": "keep-start-plus-latest-3",
  "entries": [
    {
      "id": "clip:parent.mp4",
      "ordinal": 1,
      "role": "start",
      "filename": "parent.mp4",
      "userPrompt": "original user prompt",
      "revisedPrompt": "planner prompt actually sent to Grok video",
      "createdAt": 1780300000000
    }
  ]
}
```

入口`role`是`start`, `ancestor`, `parent`， 或者`current`。第一個剪輯是
保留為起始錨點；後人只保留最近的三個條目。
`lineageId`使用產生的影片基本名稱，不含`.mp4`擴大。
該元資料儲存在生成的`.mp4.json`邊車並返回
歷史行和視頻`done`事件；`/generated/*.json`仍然是私有的。

Grok視訊 API 使用的提示介面：

|表面|模型|責任|
|---|---|---|
|影片策劃師| `grok-4.5`（透過覆蓋`plannerModel`) |將使用者提示、搜尋上下文、參考和可選的連續性沿襲轉換為最終的英語影片提示。它必須建立核心主題、動作/運動、攝影機/構圖、環境/風格、對話/音訊、結束幀切換和約束。多字符對話使用基於外觀的說話者識別。|
|影片生成| xAI視訊模型|收到計劃者提示加上`sourceImage`或者`referenceImages`當存在時。|
|影片分析| `grok-4.5` |讀取第一幀/最後一幀影像`/api/video/analyze`並返回娛樂/繼續指導。|

**SSE事件**:

|事件|數據|描述|
|---|---|---|
| `planning` | `{ requestId }` |準備視頻生成|
| `submitted` | `{ requestId, xaiVideoRequestId, requestedModel, effectiveModel, modelFallback }` |提交至xAI |
| `progress` | `{ requestId, progress, stalled }` |進度 0.0–1.0|
| `done` | `{ requestId, filename, url, mediaType, revisedPrompt, elapsed, usage, requestedModel, effectiveModel, modelFallback, video, videoContinuity }` |影片準備就緒|
| `error` | `{ error, code, status, requestId, guidance? }` |生成失敗|

**視訊錯誤代碼**:

|程式碼|意義|
|---|---|
| `VIDEO_PROVIDER_UNSUPPORTED` |提供者不是`"grok"` |
| `PROMPT_REQUIRED` |提示為空或缺失|
| `INVALID_GROK_VIDEO_MODEL` |模型不在有效集中|
| `INVALID_VIDEO_RESOLUTION` |解析度不是 480p/720p/1080p，或外部請求 1080p`grok-imagine-video-1.5`僅提示 T2V / I2V|
| `INVALID_VIDEO_ASPECT_RATIO` |寬高比不在有效集中|
| `INVALID_VIDEO_DURATION` |持續時間不是 1–15 整數|
| `GROK_VIDEO_REF_TOO_MANY` |超過 7 張參考圖片|
| `GROK_VIDEO_FAILED` |上游xAI視訊生成失敗|
| `GROK_VIDEO_FRAME_FAILED` |伺服器無法提取父視訊的最後一幀|

### `POST /api/video/edit`

透過編輯現有視頻GrokV2V。這是一個阻塞JSON啟動的端點xAI編輯作業，輪詢它，下載最終的 MP4，並將其儲存為產生的視訊工件。

```json
{
  "prompt": "make it sunset",
  "videoUrl": "https://vidgen.x.ai/.../clip.mp4",
  "model": "grok-imagine-video"
}
```

`videoUrl`可能是一個HTTPS影片URL, xAI `file_id`, `data:video/*` URL，或生成`.mp4`文件名。產生的文件輸入僅限於真實的`.mp4`生成的目錄下的檔案。

### `POST /api/video/extend`

從最後一幀開始擴展影片（最後一幀→I2V 編排）。這是一個非同步作業端點：它會傳回HTTP202 立即並串流生命週期事件（`queued → extracting-frame → planning → submitted/progress → persisting → done`或者`error`） 超過`GET /api/events`。伺服器提取父視訊的最後一幀，將其作為圖像到視訊來源注入，並在子工件上記錄持久的沿襲。

```json
{
  "sourceVideoId": "1780226256355_50252101.mp4",
  "requestId": "vext_optional",
  "prompt": "camera pulls back (optional — inherits parent prompt when empty)",
  "provider": "grok",
  "model": "grok-imagine-video",
  "duration": 6
}
```

立即回應：

```json
{ "ok": true, "requestId": "vext_...", "sourceVideoId": "1780226256355_50252101.mp4", "workflow": "last-frame-i2v" }
```

航廈`done`有效載荷攜帶`video.operation: "extend"`, `video.sourceFrame: "last"`， 和`videoLineage` (`id`, `parentId`, `rootId`, `seriesId`, `sequenceIndex`）。複製`requestId`返回 409。幀提取失敗映射到`VIDEO_FRAME_EXTRACT_UNAVAILABLE` (503), `VIDEO_FRAME_EXTRACT_TIMEOUT`（504，可重試），或`VIDEO_FRAME_EXTRACT_FAILED` (500).

### `POST /api/video/extend/native`

舊的提供者本機擴充（阻止JSON）。開始xAI擴展作業，輪詢它，下載組合輸出 MP4，並將其儲存為產生的視訊工件。更喜歡`/api/video/extend`用於新的整合。

```json
{
  "prompt": "camera pulls back",
  "videoUrl": "1780226256355_50252101.mp4",
  "duration": 6,
  "model": "grok-imagine-video"
}
```

`duration`必須是 2 到 10 秒之間的整數。編輯和本機擴展支持`grok-imagine-video`僅有的;`grok-imagine-video-1.5`這些端點不接受其​​預覽別名。

### `GET /api/video/frame`

提取一個PNG產生的幀`.mp4`文件。

|詢問|筆記|
|---|---|
| `file` |所需生成`.mp4`檔案名稱或產生的目錄絕對路徑|
| `position` | `last`（預設）或非負秒|

### `POST /api/video/analyze`

分析產生的第一幀和最後一幀`.mp4`使用配置的規劃器模型（`grok-4.5`預設情況下）。這不會將視頻作為時間視頻上傳；它提取兩個PNG框架並要求視覺模型推斷可能的運動。

```json
{
  "videoUrl": "1780226256355_50252101.mp4"
}
```

遠端 URL 和`data:`故意拒絕輸入以避免伺服器端URL獲取透過`ffmpeg`.

## 產生請求日誌

|方法|小路|筆記|
|---|---|---|
| `GET` | `/api/generation-requests` |退貨`{ items: GenerationRequestLogEntry[] }`— 最近 200 次產生嘗試（提示、請求/成功標誌、錯誤）。出現在網路上UI開發面板（`GenerationRequestLogPanel`）；不CLI包裝器（#95）。|

## 歷史

|方法|小路|筆記|
|---|---|---|
| `GET` | `/api/history` |列出產生的資產|
| `GET` | `/api/history?groupBy=session` |按會話標題將資產分組|
| `DELETE` | `/api/history/:filename` |墓碑是生成的資產|
| `POST` | `/api/history/:filename/restore` |恢復最近刪除的資產|

歷史行可以包含節點元數據，例如`sessionId`, `nodeId`, `clientNodeId`, `requestId`， 和`refsCount`.

## 資產庫

產生檔案上的持久性庫目錄（階段 050）。記錄參考
裡面的文件`generated/`;刪除資產永遠不會刪除檔案。

|方法|小路|筆記|
|---|---|---|
| `GET` | `/api/assets` |列出/搜尋資產（`kind`, `folderId`, `tag`, `q`, `cursor`, `limit`) |
| `GET` | `/api/assets/:id` |透過ID獲取一項資產；回報`404 ASSET_NOT_FOUND`當缺席時|
| `POST` | `/api/assets` |推廣/創建資產（`filePath`, `kind`, `name?`, `folderId?`, `tags?`, `metadata?`) |
| `POST` | `/api/assets/promote-element` |將圖庫結果推廣到`element`資產 （`result.path`或者`filePath`, `elementKind`, `name?`, `notes?`, `folderId?`, `tags?`) |
| `POST` | `/api/assets/derived` |保存派生資產（原始資產`image/png`身體;詢問`source`, `kind=keyed-png`, `projectId?`, `name?`, `meta?` JSON）——寫道`<src>-keyed-<ts>.png`+ 邊車與`derivedFrom`並登記資產記錄 `kind=vector-svg` 不傳送請求主體：伺服器直接讀取已驗證的 `source` 並透過 `lib/vectorizeImage.ts` 轉換，寫出 `<src>-vector-<ts>.svg`（查詢參數 `preset?`、`colorPrecision?`、`filterSpeckle?`、`cornerThreshold?`；非點陣來源以 `DERIVED_SOURCE_NOT_RASTER` 拒絕）。產生的 SVG 附帶嚴格 CSP 與 `nosniff`。 |
| `POST` | `/api/video/keying` |從生成的綠幕 mp4 匯出 alpha WebM (`source`, `keyParams{tolerance,softness,keyColor?}`, `projectId?`, `name?`) — 回應`202 {requestId, filePath}`，發布`keying-start/progress/done/error`在事件總線上，寫入 sidecar`derivedFrom`並註冊視訊資產|
| `PATCH` | `/api/assets/:id` |更新名稱/資料夾/註釋/標籤/元數據|
| `POST` | `/api/assets/:id/test-sheet` |運行元素測試表；目前返回`501 TEST_SHEET_NOT_IMPLEMENTED`驗證元素資產後|
| `DELETE` | `/api/assets/:id` |僅刪除目錄行（檔案不變）|
| `DELETE` | `/api/assets/all` |刪除所有資產記錄（檔案不變）|
| `GET` | `/api/assets/folders` |列出資料夾（平面；樹形組裝客戶端）|
| `POST` | `/api/assets/folders` |建立資料夾（`name`, `parentId?`) |
| `PATCH` | `/api/assets/folders/:id` |重新命名/移動資料夾（循環安全）|
| `DELETE` | `/api/assets/folders/:id` |刪除一個空資料夾|
| `GET` | `/api/assets/tags` |不同的標籤|

`kind`是其中之一`image | video | element | preset | template`. `filePath`是
需要用於`image`/`video`，必須待在裡面`generated/`，並且被存儲
相對於它。遊標分頁順序`created_at DESC, id DESC`;錯誤
使用帶有代碼的標準信封，例如`INVALID_ASSET_KIND`,
`INVALID_FILENAME`, `INVALID_PARENT`, `FOLDER_CYCLE`, `FOLDER_NOT_EMPTY`.

## 會話和圖表

|方法|小路|筆記|
|---|---|---|
| `GET` | `/api/sessions` |列出圖表會話|
| `POST` | `/api/sessions` |建立會話|
| `GET` | `/api/sessions/:id` |載入會話和圖表|
| `PATCH` | `/api/sessions/:id` |重新命名會話|
| `DELETE` | `/api/sessions/:id` |刪除會話|
| `PUT` | `/api/sessions/:id/graph` |儲存圖表快照|

`PUT /api/sessions/:id/graph`需要一個`If-Match`包含目前圖形版本的標頭。

版本不符返回`GRAPH_VERSION_CONFLICT`和當前版本。這僅意味著客戶端保存的是陳舊的圖形版本；這並不能證明另一個瀏覽器標籤更改了圖表。

## 節點模板

節點圖模板（higgsfield120）。種子模板隨應用程式一起提供，並且是唯讀的；使用者範本是從畫布創建的。

|方法|小路|筆記|
|---|---|---|
| `GET` | `/api/node-templates` |清單模板摘要（種子+使用者）|
| `POST` | `/api/node-templates` |建立使用者模板（`201 { template }`) |
| `POST` | `/api/node-templates/:id/instantiate` |傳回具有新節點 ID 的圖形副本（從不自動執行）|
| `PATCH` | `/api/node-templates/:id` |重新命名使用者模板（種子→`403`) |
| `DELETE` | `/api/node-templates/:id` |刪除使用者模板（種子 →`403`) |

圖形保存請求可能包含可觀察性標頭：

```text
X-Ima2-Graph-Save-Id
X-Ima2-Graph-Save-Reason
X-Ima2-Tab-Id
```

## 樣式表

|方法|小路|筆記|
|---|---|---|
| `GET` | `/api/sessions/:id/style-sheet` |載入會話樣式表|
| `PUT` | `/api/sessions/:id/style-sheet` |儲存樣式表|
| `PATCH` | `/api/sessions/:id/style-sheet/enabled` |切換樣式表的使用|
| `POST` | `/api/sessions/:id/style-sheet/extract` |從提示/參考中提取樣式字段|

樣式表提取可能需要API鑰匙/openai客戶。圖像生成還支持`provider: "api"`透過共享回應API圖像適配器時API密鑰已配置。

## 提示庫

支持者`routes/prompts.ts`和 SQLite 提示表`lib/db.ts`.

|方法|小路|筆記|
|---|---|---|
| `GET` | `/api/prompts` |列出提示（`folderId`, `q`, `favoritesOnly`、分頁）|
| `POST` | `/api/prompts` |建立提示|
| `GET` | `/api/prompts/:id` |取得一個提示|
| `PATCH` | `/api/prompts/:id` |更新提示字段|
| `DELETE` | `/api/prompts/:id` |刪除提示|
| `POST` | `/api/prompts/:id/favorite` |切換收藏夾|
| `POST` | `/api/prompts/import` |舊版批次導入 (JSON身體)|
| `GET` | `/api/prompts/export` |匯出提示庫JSON |
| `GET` | `/api/prompts/folders` |列出資料夾|
| `POST` | `/api/prompts/folders` |建立資料夾|
| `PATCH` | `/api/prompts/folders/:id` |重新命名資料夾|
| `DELETE` | `/api/prompts/folders/:id` |刪除資料夾|

## 即時導入

預覽/提交本地文件的導入流程，GitHub文件夾、精選資源和發現審查。實施於`routes/promptImport.ts`.

|方法|小路|筆記|
|---|---|---|
| `GET` | `/api/prompts/import/curated-sources` |列出精選的源註冊表項|
| `GET` | `/api/prompts/import/discovery` |列出發現審核隊列|
| `POST` | `/api/prompts/import/discovery-search` |搜尋GitHub對於即時包候選人|
| `POST` | `/api/prompts/import/discovery-review` |批准/拒絕發現候選者|
| `POST` | `/api/prompts/import/curated-search` |搜尋索引精選來源|
| `POST` | `/api/prompts/import/curated-refresh` |刷新策劃索引快取|
| `POST` | `/api/prompts/import/folder-files` |列出 a 中的文件GitHub資料夾|
| `POST` | `/api/prompts/import/folder-preview` |預覽已選擇GitHub資料夾檔案|
| `POST` | `/api/prompts/import/preview` |預覽本地/GitHub導入候選人|
| `POST` | `/api/prompts/import/commit` |將選定的候選提交到提示庫中|

## 卡新聞（開發門控）

僅當註冊時`config.features.cardNews`是真的（`routes/cardNews.ts`）。網路UI需要`VITE_IMA2_CARD_NEWS=1`或者`VITE_IMA2_DEV=1`; CLI用途`ima2 cardnews …`.

|方法|小路|筆記|
|---|---|---|
| `GET` | `/api/cardnews/image-templates` |列出圖片模板|
| `GET` | `/api/cardnews/image-templates/:templateId/preview` |模板預覽影像|
| `GET` | `/api/cardnews/role-templates` |內建角色模板|
| `GET` | `/api/cardnews/sets` |列出卡片新聞集|
| `GET` | `/api/cardnews/sets/:setId` |取一套|
| `GET` | `/api/cardnews/sets/:setId/manifest` |設定清單JSON |
| `POST` | `/api/cardnews/draft` |建立規劃草稿|
| `POST` | `/api/cardnews/generate` |開始卡片生成工作|
| `POST` | `/api/cardnews/jobs` |建立工作記錄|
| `GET` | `/api/cardnews/jobs/:jobId` |投票工作狀態|
| `POST` | `/api/cardnews/jobs/:jobId/retry` |重試失敗的作業|
| `POST` | `/api/cardnews/cards/:cardId/regenerate` |重新生成一張卡|
| `POST` | `/api/cardnews/export` |匯出已完成的設定資產|

## GitHub Star

工作室的一次性 Star 提示透過使用者自己的 `gh` 登入替儲存庫加星；ima2 不保存任何 GitHub 權杖。這些路由只回應本機（回送位址）請求，區域網路用戶端會收到 `403 LOCAL_ONLY`。提示狀態檔與 CLI 提示共用（`<configDir>/state/star-prompt.json`）。

| 方法 | 路徑 | 結果 |
|---|---|---|
| `GET` | `/api/github/star` | `{ state: "starred" \| "not-starred" \| "unauthenticated" \| null, prompted, repo, url }`，未安裝或未登入 `gh` 時為 `unauthenticated`；已提示後為 `null`（不再呼叫 gh） |
| `POST` | `/api/github/star` | 透過 `gh api -X PUT /user/starred/lidge-jun/ima2-gen` 加星並標記已提示；`409 GH_UNAUTHENTICATED`、`502 GH_FAILED` |
| `POST` | `/api/github/star/dismiss` | 不加星，只標記已提示 |


## 常見錯誤代碼

|程式碼|意義|
|---|---|
| `API_KEY_REQUIRED` | `provider: "api"`請求時未配置API鑰匙|
| `APIKEY_DISABLED` |舊版中的遺留/已棄用的硬塊程式碼|
| `INVALID_IMAGE_MODEL` |型號名稱未知或不受支援|
| `IMAGE_MODEL_UNSUPPORTED` |模型存在但無法使用影像生成|
| `INVALID_REQUEST` |上游請求參數無效；原始提供者詳細資訊可能包含為`upstreamCode`, `upstreamType`， 和`upstreamParam` |
| `INVALID_MODERATION` |審核值不是`auto`或者`low` |
| `SAFETY_REFUSAL` |上游安全拒絕|
| `MODERATION_REFUSED` |內容生成被審核拒絕|
| `AUTH_CHATGPT_EXPIRED` | Codex/ChatGPT OAuth會話已過期|
| `AUTH_API_KEY_INVALID` | API金鑰無效、已撤銷、超出配額或組織錯誤|
| `NETWORK_FAILED` |網路、代理、VPN 或防火牆故障|
| `OAUTH_UNAVAILABLE` |當地的OAuth代理不可用|
| `OPEN_GENERATED_DIR_FAILED` |伺服器無法開啟生成的圖像資料夾|
| `GRAPH_VERSION_REQUIRED` |缺圖表`If-Match`標頭|
| `GRAPH_VERSION_CONFLICT` |過時的圖表版本|
| `GRAPH_TOO_LARGE` |圖超出節點/邊限制|
| `NODE_NOT_FOUND` |未找到節點元數據|
| `INVALID_GROK_IMAGE_MODEL` | A Grok請求使用外部模型`grok-imagine-image`或者`grok-imagine-image-quality` |
| `GROK_RATE_LIMITED` | xAI回傳了速率限制回應|
| `GROK_AUTH_FAILED` | xAI請求驗證失敗（OAuth工作階段無效或已過期，需要重新`ima2 grok login`）|
| `GROK_SEARCH_TIMEOUT` / `GROK_PLANNER_TIMEOUT` / `GROK_IMAGE_TIMEOUT` |這Grok搜尋、規劃器或圖片API步驟超出了其超時預算|
| `AGY_GENERATION_FAILED` | Gemini(agy) 影像生成失敗|
| `AGY_TIMEOUT` |阿吉CLI進程超過 360 秒逾時|
| `AGY_PROCESS_ERROR` |阿吉CLI二進位檔案無法啟動或崩潰|
| `AGY_QUOTA_EXHAUSTED` | Gemini API配額已用完（速率限制）|
| `AGY_PARSE_FAILED` |無法從 agy 輸出解析工件路徑|
| `AGY_ARTIFACT_NOT_FOUND` |Agy 報告了不存在的工件路徑|
| `AGY_PATH_REJECTED` |Agy 工件路徑位於允許的目錄之外|
| `AGY_VIDEO_UNSUPPORTED` |不支援影片生成Gemini（agy）提供者|
| `AGY_MASK_UNSUPPORTED` |不支援基於蒙版的編輯Gemini（agy）提供者|
| `AGY_REF_TOO_MANY` |agy 的參考影像太多（最多 3 張）|
| `GEMINI_API_KEY_MISSING` | Gemini API鍵或Vertex AI未配置憑證|
| `GEMINI_API_RATE_LIMITED` | Gemini API速率有限 (429)|
| `GEMINI_API_BAD_REQUEST` | Gemini API錯誤請求 (400/403)|
| `GEMINI_API_SAFETY_BLOCKED` | Gemini API安全過濾器阻止發電|
| `GEMINI_API_NO_IMAGE` | Gemini API沒有返回任何圖像作為響應|
| `VIDEO_PROVIDER_UNSUPPORTED` |視訊生成需要提供者`"grok"`或者`"grok-api"` |
| `SSE_CAPACITY` |併發數超過512`GET /api/events`聽眾|
| `REQUEST_ID_IN_USE` |非同步 POST 使用了`requestId`已經有一份活躍的工作|
| `TOO_MANY_JOBS` |超過配置的並發活動產生作業限制（`Retry-After: 5`;預設`24`) |

## 密鑰管理

API用於在運行時透過 Web 設定提供者憑證的關鍵管理端點UI或者HTTP API.

|端點|方法|描述|
|---|---|---|
| `/api/keys/status` |得到|傳回所有提供者的配置/有效/屏蔽金鑰狀態（openai, xai, gemini, 頂點) 加`geminiAuthMode` (`"apikey"`或者`"vertex"`) |
| `/api/keys/:provider` |放|保存一個API鑰匙。身體：`{ "apiKey": "..." }`。在保存之前驗證金鑰格式和上游config.json。提供者：`openai`, `xai`， 或者`gemini`. |
| `/api/keys/:provider` |刪除|刪除配置來源API鑰匙。無法刪除源自環境的金鑰（`ENV_KEY_IMMUTABLE`). |
| `/api/keys/vertex` |放|保存一個Vertex AI服務帳戶JSON。身體：`{ "serviceAccountJson": "..." }`。驗證JSON結構 （`type: "service_account"`, `project_id`必需的）。|
| `/api/keys/vertex` |刪除|刪除配置來源Vertex AI服務帳戶。|
| `/api/keys/gemini-auth-mode` |放|堅持Gemini在設定下拉清單中選擇身份驗證模式。身體：`{ "mode": "apikey" \| "vertex" }`。保存至`config.json`並熱更新。|

透過 PUT 保存的密鑰儲存在`config.json`並在運行時上下文中進行熱更新（無需重新啟動伺服器）。從環境變數載入的金鑰（`OPENAI_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY`, `VERTEX_SERVICE_ACCOUNT_JSON`）優先並且透過以下方式不可變API.

## 縮圖回填

|端點|方法|描述|
|---|---|---|
| `/api/history/backfill-thumbnails` |郵政|生成缺失`.thumb.jpg`產生目錄中所有圖像和影片的縮圖。退貨`{ ok, total, created, skipped, failed }`。也可透過以下方式離線使用`ima2 backfill-thumbs`. |

縮圖也會在伺服器啟動時自動為任何缺少縮圖的媒體檔案產生。

## 代理模式

代理模式是一個對話式影像工作區（網絡UI僅有——沒有CLI）。所有路線均在`/api/agent/*`並得到以下支持`routes/agent.ts` + `lib/agent*.ts`.

|方法|小路|筆記|
|---|---|---|
| `GET` | `/api/agent/tools` |斜杠命令和工具元數據|
| `GET` | `/api/agent/sessions` |列出會話 (`?limit=`) |
| `POST` | `/api/agent/sessions` |建立會話（`title`, `currentImage`, `webSearchEnabled`) → `201` |
| `GET` | `/api/agent/sessions/:sessionId` |取得一個會話|
| `PATCH` | `/api/agent/sessions/:sessionId` |更新標題，`webSearchEnabled`, `generationSettings`, `currentImage`, 鎖|
| `DELETE` | `/api/agent/sessions/:sessionId` |刪除會話|
| `POST` | `/api/agent/sessions/:sessionId/compact` |會話壓縮|
| `GET` | `/api/agent/sessions/:sessionId/manifest` |XML 清單匯出|
| `POST` | `/api/agent/sessions/:sessionId/turns` |同步轉動（`prompt`、提供者、品質、尺寸、型號…）|
| `GET` | `/api/agent/sessions/:sessionId/errors` |最近的錯誤（`?limit=`，預設10)|
| `GET` | `/api/agent/sessions/:sessionId/queue` |每個會話隊列項目|
| `POST` | `/api/agent/sessions/:sessionId/queue` |將異步轉動/斜線指令入隊 →`202` |
| `GET` | `/api/agent/queue` |全域隊列列表|
| `POST` | `/api/agent/queue/:itemId/cancel` |取消排隊項目|
| `POST` | `/api/agent/queue/:itemId/retry` |重試失敗的項目|

## 端點 →CLI測繪

大多數伺服器路由`/api/*`有一個CLI包裝紙。例外的是**代理模式** (`/api/agent/*`），即伺服器+網路-UI-只有並且沒有`ima2`子命令。提示產生器HTTP路線 （`POST /api/prompt-builder/chat`) 被包裹著`ima2 prompt build`。使用此表查找呼叫給定端點的命令。 （看README.md完整標誌清單的「客戶端」部分。 ）

|端點| CLI |
|---|---|
| `POST /api/generate` | `ima2 gen` |
| `POST /api/edit` | `ima2 edit` |
| `POST /api/generate/multimode` (SSE) | `ima2 multimode` |
| `POST /api/video/generate` (SSE) | `ima2 video` |
| `POST /api/video/generate`和`continueFromVideo` | `ima2 video continue` |
| `POST /api/video/edit` | `ima2 video edit` |
| `POST /api/video/extend` | `ima2 video extend` |
| `GET /api/video/frame` | `ima2 video frame` |
| `POST /api/video/analyze` | `ima2 video analyze` |
| `POST /api/node/generate` (SSE) / `GET /api/node/:id` | `ima2 node generate` / `ima2 node show` |
| `GET /api/history` | `ima2 ls` |
| `DELETE /api/history/:name` / `…/permanent` | `ima2 history rm [--permanent]` |
| `POST /api/history/:filename/restore` | `ima2 history restore --trash-id` |
| `POST /api/history/favorite` | `ima2 history favorite` |
| `POST /api/history/import-local` | `ima2 history import` |
| `POST /api/metadata/read` | `ima2 metadata` / `ima2 show --metadata` |
| `GET/POST/PUT/DELETE /api/sessions[/…]` | `ima2 session ls/show/create/rm/rename` |
| `GET/PUT /api/sessions/:id/graph` | `ima2 session graph load/save` |
| `GET/PUT /api/sessions/:id/style-sheet[/…]` | `ima2 session style-sheet …` |
| `GET/PUT/DELETE /api/annotations/:name` | `ima2 annotate get/set/rm` |
| `POST /api/canvas-versions` / `PUT /api/canvas-versions/:name` | `ima2 canvas-versions save/update` |
| `GET/POST/PUT/DELETE /api/prompts[/…]` | `ima2 prompt …` |
| `GET/POST/PATCH/DELETE /api/prompts/folders[/…]` | `ima2 prompt folder …` |
| `…/api/prompts/import/…` | `ima2 prompt import sources/refresh/curated/discovery/folder` |
| `…/api/cardnews/…`（選通於`features.cardNews`) | `ima2 cardnews …` |
| `POST /api/comfy/export-image` | `ima2 comfy export` |
| `GET /api/inflight` / `DELETE /api/inflight/:id` | `ima2 inflight ls`（別名`ps`) / `ima2 inflight rm`（別名`cancel`) |
| `GET /api/events` (SSE復用）|網路UI僅（持續`EventSource`;不CLI包裝紙）|
| `GET /api/storage/status` / `POST /api/storage/open-generated-dir` | `ima2 storage status` / `ima2 storage open` |
| `GET /api/billing` / `GET /api/providers` / `GET /api/oauth/status` / `GET /api/grok/status` | `ima2 billing` / `ima2 providers` / `ima2 oauth status` / `ima2 grok status` |
| `GET /api/quota` |網路UI僅有的 （Grok設定中的配額欄）|
| `POST /api/auth/switch` / `GET /api/auth/switch/:sessionId` |網路UI僅（設定 > QuotaCard > 切換帳號）|
| `GET /api/health` | `ima2 ping` |
| `GET /api/capabilities` | `ima2 capabilities` |
| `GET /api/config/grok-planner` | — (Grok規劃器模型查詢）|
| `PATCH /api/config/grok-planner` | — (Grok規劃器模型更新）|
| `GET /api/agy/status` | — (Antigravity CLI安裝狀態）|
| `POST /api/history/backfill-thumbnails` | `ima2 backfill-thumbs` |
| `GET /api/keys/status`, `PUT/DELETE /api/keys/:provider`, `PUT/DELETE /api/keys/vertex` |網路UI僅（設定 >API按鍵）|
| `GET/POST/PATCH/DELETE /api/agent/*`（會話、輪流、隊列）|—（代理模式；網絡UI僅有、沒有CLI) |
| `POST /api/prompt-builder/chat` | `ima2 prompt build` |

筆記：
- `ima2 history favorite`和`ima2 annotate …`傳送`X-Ima2-Browser-Id: cli-<sha1prefix>`從配置目錄派生，所以CLI活動不會與瀏覽器會話發生衝突。
- `ima2 session graph save`執行 GET-then-PUT 操作`If-Match: "<version>"`防範`GRAPH_VERSION_CONFLICT`.
- `ima2 history import`和`ima2 canvas-versions save/update`傳送原始位元組`Content-Type: image/<png|jpeg|webp>`;這SSE端點（`multimode`, `node generate`, `video`） 使用`Accept: text/event-stream`。網路UI相反使用`GET /api/events`加`async: true`在 POST 路線上。
- `ima2 cardnews …`檢查`runtimeConfig.features.cardNews`在調用門控端點之前；當禁用時CLI退出 2 並帶有明確的訊息，而不是產生 404。

## CLI發現

伺服器在以下位置寫入廣告檔案：

```text
~/.ima2/server.json
```

CLI命令如`ima2 ping`, `ima2 gen`， 和`ima2 ls`使用此文件，除非`--server`或者`IMA2_SERVER`提供。

目前形狀：

```json
{
  "port": 3334,
  "url": "http://localhost:3334",
  "pid": 12345,
  "startedAt": 1777180000000,
  "version": "1.0.0",
  "backend": {
    "configuredPort": 3333,
    "actualPort": 3334,
    "url": "http://localhost:3334"
  },
  "oauth": {
    "configuredPort": 10531,
    "actualPort": 10532,
    "url": "http://127.0.0.1:10532",
    "status": "ready"
  }
}
```

頂級`port`和`url`為老年人保留CLI客戶。新程式碼應該更喜歡`backend.url`.

---

## 雪碧配方路線

### `GET /api/sprite-recipes`

列出所有精靈配方。退貨`{ recipes: SpriteRecipeRecord[] }`.

### `POST /api/sprite-recipes`

建立一個新的精靈配方。身體：`SpriteRecipeDefinition`。退貨`201 { recipe }`.

### `GET /api/sprite-recipes/:id`

取得單一食譜。退貨`{ recipe }`或者`404 { error }`.

### `PATCH /api/sprite-recipes/:id`

更新配方欄位。退貨`{ recipe }`.

### `DELETE /api/sprite-recipes/:id`

刪除食譜。退貨`{ ok: true }`.

### `POST /api/sprite-recipes/:id/anchor/approve`

批准一名閒置候選人作為身分錨。身體：`{ assetId }`。退貨`{ recipe }`.

### `POST /api/sprite-recipes/:id/anchor/generate`

產生一個空閒的候選錨點。非同步：返回`202 { requestId }`, 進展透過`/api/events`.

### `POST /api/sprite-recipes/:id/generate`

為核准的食譜產生精靈行。身體：`{ states?, async, requestId }`。非同步：`202 { requestId }`.

## MCP提供者連接

遠端訂閱MCP提供者（Runway, Higgsfield）透過編譯連接
註冊表——任意端點都會被拒絕。所有回應都是無秘密的：令牌
僅存在於版本化中`${configDir}/mcp/<provider>.json`記錄 (0600)，綁定到
提供者端點和即時回調來源。

伺服器選擇並發布其實際連接埠後，會自動恢復
每個啟用的提供者都有一個完整的相同綁定令牌包。這條路徑不
打開瀏覽器。遺失、損壞、僅待處理、停用或綁定不符的記錄
不發送承載請求並且不會被靜默刪除。不符報告為
`auth_required`;再次啟動 Connect 以授權新的端點/來源。OAuth狀態
和 PKCE 是僅記憶體的，因此因重新啟動而中斷的瀏覽器流程必須重新啟動。

### `GET /api/mcp/providers`

列出註冊表提供者以及每個提供者的連線狀態。

### `POST /api/mcp/temp-references`

將本機參考來源（資料 URL）暫存為臨時圖庫批次，以便MCP
一代可以透過檔案名稱上傳它們。退貨`{ ok, batchId, files[] }`.

### `DELETE /api/mcp/temp-references/:batchId`

刪除分階段臨時參考批次後MCP工作完成。

### `GET /api/models`

規範車道目錄CLI/代理路由。退貨
`{ ok, lanes: { [lane]: { status, reason?, defaults: { image?, video? }, models: { image[], video[] } } } }`
對於六個核心通道（`oauth|api|grok|grok-api|agy|gemini-api`) 加MCP車道
(`runway|higgsfield`）。狀態是其中之一`ready|locked|disconnected|key-missing`
優先`locked > key-missing|disconnected > ready`. MCP靜態快照
型號始終列出；動態的 （`models_explore`）模型僅在以下情況出現
連接。消耗於`ima2 models`, `ima2 defaults set image|video`，以及
CLI模型解析器。

### `GET /api/mcp/providers/:id/status`

連線狀態：`disconnected | connecting | auth_required | connected | offline | error`.
可選的`detail`是一個穩定、無秘密的診斷代碼。`connected`意味著
目前發電/運輸可用；`offline`表示終端傳輸故障
已觀察到並且最多安排一次重新連接；`error`是一個無法恢復的故障。

### `POST /api/mcp/providers/:id/connect`

啟動或恢復連線。退貨`202 { status: { state: "auth_required", authorizationUrl } }`
當用戶必須批准時OAuth在瀏覽器中；`202`連接時；`200`一次
連接。終端響應保留狀態：`409 disconnected`, `503 offline`， 或者
`502 error`. `ok`僅適用於`connected`.

### `GET /api/mcp/oauth/callback`

OAuth重定向目標（`?state=&code=`）。免除 LAN 令牌保護；受保護
一次使用的OAuth `state`+ PKCE。無效狀態 →`400`沒有代幣交換。
完成HTML僅在經理到達後才返回`connected`;否則
回呼返回狀態的對應 202/409/503/502 回應和失敗頁面。

### `POST /api/mcp/providers/:id/refresh`

關閉並重新使用儲存的令牌（刷新令牌路徑）重新建立會話。它使用
相同的狀態到HTTP映射為連接並且無法覆蓋較新的斷開連接或
連接生成。

### `DELETE /api/mcp/providers/:id/connection`

清除本機令牌並關閉會話。回覆說明明確指出這是
僅限本地；它不會撤銷提供者方的授予。墓碑可以防止老人變老
透過重新建立憑證進行連線、回呼、復原或刷新工作。

傳輸復原從不重播主機`callTool`要求。特別是，突變或
連線管理器不會自動重試計費媒體操作。

### `POST /api/mcp/generate`

透過連結生成媒體MCP提供者。身體：
`{ provider: "runway", kind: "image"|"video", prompt, model?, ratio?, startFrameUrl?, requestId? }`.
非同步：返回`202 { requestId }`;進步 （`submitted`, `provider-queued`,
`provider-running`, `downloading`）和終端`done`/`error`到達`/api/events`.
此路由是單一持久性所有者：結果被提交給產生的
之前的庫（文件+嚴格sidecar+縮圖）`done`被發射。限目錄
提供者（例如Higgsfield免費計劃）返回`409 MCP_EXECUTION_LOCKED`.
`startFrameFilename`接受現有的生成庫圖像：將其上傳到
提供者並用作圖像到視頻的起始幀，錄製
`parent: { filename, mediaType, role: "start-frame" }`邊車中的血統。

### `POST /api/mcp/media-action`

執行媒體工作流程操作。身體：`{ action: "stitch"|"upscale-video"|"upscale-image"|"edit-video"|"extend"|"reframe", files: [generated filenames], prompt?, provider? }`.
工作流程路由器決定每個工具：`native`（提供者工具即時顯示
匹配模式），`fallback` (`stitch`→本地ffmpeg連線；`extend`→ 最後一幀
I2V），或`unavailable` (`409 MEDIA_ACTION_UNAVAILABLE`，例如重新構建，同時
提供者僅提供目錄）。非同步：`202 { requestId, mode, plan }`;結果提交
透過同一個持久性所有者`parent`/`inputs`血統。

### `POST /api/mcp/tasks/:taskId/recover`

### `POST /api/mcp/multishot`

透過生成多鏡頭（多場景）視頻Runway MCP。身體：
`{ prompt?: string, shots?: string[] (3-5), duration?: 5|10|15, resolution?: "720p"|"1080p", aspectRatio?, sound?: boolean, firstSceneFilename?, requestId? }`.
`prompt`映射到自動模式（storyPrompt）；`shots[]`映射到自訂模式。
之一`prompt`或者`shots`是必須的 （`400 INVALID_MULTISHOT`否則）。
非同步：`202 { requestId, provider }`;生命週期事件`/api/events`.
結果提交`workflow: "video.multishot"`和`mcpParameters`.

重新下載遠端成功MCP任務到生成的庫中。身體：
`{ provider?: "runway", kind?: "video"|"image" }`。一代後使用
下載/提交步驟暫時失敗 - 提供者資產仍可獲取
〜24-48小時。重新投票`get_task`，需要`SUCCEEDED`有輸出URL
(`error` SSE事件與`MCP_TASK_NOT_SUCCEEDED`否則），然後運行相同的
下載（重試 + IPv4 回退）→ 單一持久性提交路徑作為
正常一代。非同步：`202 { requestId, taskId }`; `done`攜帶
`recovered: true`.
僅目錄提供者（例如Higgsfield免費計劃）返回
`409 MCP_EXECUTION_LOCKED`，與`/api/mcp/generate`.

## 合約發現

人工智慧代理的機器可讀工具合約（`ima2 tools` CLI回到這些）。

### `GET /api/contracts`

完整目錄摘要：`{ ok, data: { tools: [{ id, namespace, availability, executable, description }] }, catalogVersion, schemaVersion, cliVersion, requestId, generatedAt }`.
可用性從即時連線狀態提升：`callable`需要連接
會話加上連接後攝取證據；捆綁快照單獨留下`documented`.

### `GET /api/contracts/:id`

一種工具的完整合同，包括`execution`綁定塊：綁定工具攜帶
`{ binding, endpoint, inputContract }`— 標準化模式`ima2 tools call`
接受（原始上游`inputSchema`僅供參考）。
