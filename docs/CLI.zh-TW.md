# CLI參考

大多數伺服器路由`/api/*`有一個CLI包裝紙；代理模式（`/api/agent/*`) 是網路-UI-只有並且沒有`ima2`子命令。提示產生器HTTP路線 （`POST /api/prompt-builder/chat`）可透過`ima2 prompt build`。這CLI是本地伺服器上的一個薄殼，因此大多數命令都需要運行`ima2 serve`（少數例外——`serve`, `setup`, `doctor`, `status`, `open`, `reset`, `config`, `grok`, `skill`, `capabilities`, `backfill-thumbs`，以及本地的`defaults`檢查——無需實時伺服器即可工作）。

若要快速開始，請參閱[主要自述文件](../README.md)。對於端點映射，請參見[API.md](API.md).

## 伺服器命令

|命令|描述|
|---|---|
| `ima2 serve [--dev]` |啟動本地網路伺服器；`--dev`啟用詳細的伺服器診斷|
| `ima2 setup` / `ima2 login` |重新配置已儲存的身份驗證（互動式）|
| `ima2 status` |顯示配置和OAuth地位|
| `ima2 doctor` |診斷節點、套件、配置和身份驗證|
| `ima2 doctor image-probe [--json]` |運行即時清理的響應影像探針`EMPTY_RESPONSE`支援|
| `ima2 open` |開啟網路UI在瀏覽器中|
| `ima2 grok login/status/logout` |管理`Grok`提供者使用的xAI OAuth工作階段|
| `ima2 reset` |刪除已儲存的配置|
| `ima2 backfill-thumbs` |產生影像和影片缺少的圖庫縮圖（離線，無需運行伺服器）|

## 常用標誌

這些適用於大多數客戶端命令：

|旗幟|意義|
|---|---|
| `--server <url>` |覆蓋伺服器發現（預設使用`~/.ima2/server.json`，回落到`IMA2_SERVER`環境）|
| `--json` |發出機器可讀的JSON而不是人類格式的輸出|
| `-h`, `--help` |顯示子命令幫助|

## 代理發現

代理應該從打包的技能和能力命令開始，而不是從分散的幫助文本中猜測。

|命令|描述|
|---|---|
| `ima2 skill` |列印核心 Markdown 技能（`skills/ima2/SKILL.md`) |
| `ima2 skill front` |列印前端實現技巧（`skills/ima2-front/SKILL.md`) |
| `ima2 skill uiux` |列印設計方向技巧（`skills/ima2-uiux/SKILL.md`) |
| `ima2 skill ls` |列出所有可用的打包技能|
| `ima2 skill --json` |列印一個JSON圍繞核心技能內容的包裝|
| `ima2 skill front --json` |列印一個JSON前端技能的包裝|
| `ima2 skill uiux --json` |列印一個JSON圍繞設計技巧的包裝|
| `ima2 skill path` |列印核心技能文件路徑|
| `ima2 skill front path` |列印前端技能文件路徑|
| `ima2 skill uiux path` |列印設計技能文件路徑|
| `ima2 skill front refs` |列出前端技能的參考模組（名稱+行數）|
| `ima2 skill uiux refs` |列出設計技能的參考模組|
| `ima2 skill front ref <name>` |按名稱列印一個參考模組（例如`motion`, `stacks/react`) |
| `ima2 skill uiux ref <name>` |按名稱列印一個參考模組（例如`design-isms`) |
| `ima2 skill install --dir <path>` |將所有技能安裝到代理商的技能目錄中|
| `ima2 skill install --tmp` |安裝到`$TMPDIR/ima2-skills/`（短暫的後備）|
| `ima2 skill front refs --json` | JSON參考模組列表|
| `ima2 skill front ref motion --json` | JSON一個參考模組的包裝器|
| `ima2 capabilities --json` |列印支援的命令、模型/品質/推理值和建議限制|
| `ima2 defaults --json` |列印正在運行的伺服器的有效模型/推理預設值，當沒有伺服器可存取時回退到本機配置|
| `ima2 defaults --local --json` |列印本地有效預設值，無需聯繫伺服器|

`ima2 capabilities --json`區分支援和不支援的模型 ID。代理商只能使用`valid.imageModels.supported`用於生成/預設選擇。`limits.maxGeneratedImages`報告配置的每個請求圖像計數限制，以及`limits.maxParallel`報告強制執行的伺服器端飛行容量防護。

## 世代

|命令|描述|
|---|---|
| `ima2 gen <prompt>` |生成自CLI |
| `ima2 edit <file> --prompt <text>` |編輯現有影像|
| `ima2 multimode <prompt>` |多影像SSE生成（流`phase` / `partial` / `image`事件）|
| `ima2 video <prompt>` |視訊生成透過Grok (SSE串流有進度）|
| `ima2 node generate` |節點模式生成（SSE;支持`--no-stream`) |
| `ima2 node show <nodeId>` |讀取節點元數據|

從3.0.0開始，`ima2 gen`和生成模式`ima2 video`是**故障關閉**: 他們解決了他們的
通過車道目錄的目標（`GET /api/models`) 並退出 2`NO_DEFAULT_MODEL`當沒有
`--model <lane>/<model>`, `--provider <lane>`，或堅持`ima2 defaults set image|video`
目標適用。他們的`--provider`僅接受明確的車道
(`oauth|api|grok|grok-api|agy|gemini-api|atlascloud|minimax|runway|higgsfield`); `--provider auto`退出 2
`PROVIDER_AUTO_REMOVED`。檢查車道和模型`ima2 models [--kind image|video] [--lane <lane>] [--json]`.

`edit`, `multimode`， 和`node generate`暫時保留舊表面：`--provider <auto|oauth|api|grok|grok-api|agy|gemini-api|atlascloud|minimax>`, `--reasoning-effort {none\|low\|medium\|high\|xhigh\|max}`, `--web-search` / `--no-web-search`, `--model`, `--mode`, `--moderation`, `--ref <file>`（可重複，支援時最多 5 個），`-q low|medium|high`, `-n <count>`, `-o <file>`.

提供者覆蓋語義：

- `api`迫使API-key 回應路徑並需要配置API鑰匙。
- `oauth` 強制使用 GPT OAuth：伺服器直接呼叫 ChatGPT，GPT-6 規劃、`gpt-image-2` 出圖。
- `grok`使用`~/.progrok/auth.json`中的xAI OAuth工作階段直接呼叫`https://api.x.ai`。經典一代首次運行強制xAI透過回應進行網路搜尋API，然後詢問`grok-4.5`打電話ima2是當地的`generate_image`工具，那麼ima2執行xAI `/v1/images/generations`. `grok-4.3`仍然可以作為顯式相容性覆蓋使用。如果`--ref`附加圖像，最後一步使用xAI `/v1/images/edits`相反，圖像到圖像/參考上下文被保留。型號：`grok-imagine-image`, `grok-imagine-image-quality`。大小映射到xAI `aspect_ratio`和`resolution`;這UI網路搜尋切換是OpenAI-僅提供者因為Grok搜尋始終在此路徑中進行。
- `agy`產生Antigravity CLI透過Google生成Gemini (`nano-banana-2`）。固定1024×1024JPEG輸出，最多 3 個參考值沒有網路搜尋、品質、尺寸或遮罩控制。如果`agy`不在伺服器進程 PATH 上，ima2也檢查常見的用戶本地安裝，例如`~/.local/bin/agy`;放`IMA2_AGY_BIN=/absolute/path/to/agy`強制使用特定的二進位。
- `gemini-api`呼叫 Google 生成語言API直接地。型號：`nano-banana-2` (Gemini3.1 Flash 影像）和`nano-banana-pro` (Gemini3 專業圖像）。使用`--model nano-banana-2`或者`--model nano-banana-pro`來選擇。支援`--size`對於直接的寬高比和解析度 (512px–4K)API小路;Vertex AI忽略方面/大小。需要`GEMINI_API_KEY`或一個Vertex AI服務帳戶（`VERTEX_SERVICE_ACCOUNT_JSON`）。切換自`agy`或者`gemini-api`提供者自動選擇相應的Gemini模型;切換離開重置為GPT預設.
- `atlascloud`致電 Atlas Cloud 媒體API直接地。型號：`openai/gpt-image-2/text-to-image`用於文字到圖像和`openai/gpt-image-2/edit`當附有參考文獻時。需要`ATLASCLOUD_API_KEY`;網路搜尋、推理、遮罩和視訊控制將被忽略。
- `minimax`稱為MiniMax影像生成API直接在`POST /v1/image_generation`。型號：`image-01`用於文字到圖像和`image-01-live`當附加參考影像時（映射到`subject_reference`場地）。區域選擇全域（`https://api.minimax.io/v1`，預設）或中國（`https://api.minimaxi.com/v1`, `IMA2_MINIMAX_REGION=cn_zh`） 根據URL. `--size`映射到最接近的支持`aspect_ratio`;回應以 URL 或 base64 形式傳回。需要`MINIMAX_API_KEY`;網路搜尋、推理、遮罩和影片控制被忽略，影像到影像最多支援一個主題參考。
- `runway` / `higgsfield`（僅限生成/視訊）路線MCP非同步管道（`POST /api/mcp/generate` + SSE等待）。Runway需要一個MCP聯繫;Higgsfield僅保留目錄（`locked`）直到付費計劃。MCP車道接受`-n 1`僅，圖庫檔案名`--ref`，並拒絕僅核心標誌`FLAG_NOT_SUPPORTED`.
- `auto`保留路由預設行為並目前解析為GPT OAuth除非伺服器路由發生變化（僅限編輯/多模式/節點；在 3.0.0 中從 gen/video 中刪除）。

Grok通道不需要本機代理，也不需要另外安裝。使用`ima2 grok login`
一次授權xAI OAuth；裝置代碼流程會印出一個URL和驗證碼，儲存下來的
工作階段在過期前 2 分鐘自動更新。工作階段存放在`~/.progrok/auth.json`，
如果你剛好裝了progrok CLI，兩者共用同一個檔案。`ima2 grok status --probe`
會向xAI核對工作階段，`ima2 grok logout`刪除它。

Grok尺寸映射如下xAI的形象API， 不是OpenAI's `size`場地。ima2
將請求的大小保留在本地元資料中，但發送`aspect_ratio`例如
`1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`， 或者`2:3`，加上`解析度：
"1k"` or `"2k"` where applicable. The 3840 presets map to `解析度：“2k”`
因為xAI目前曝光`1k`和`2k`解析度控制。

為了Grok經典一代與`--ref`, ima2最多發送三個引用到
這`grok-4.5`planner作為圖像輸入，向planner詢問英語期末考試
圖像提示，然後將相同的引用發送到xAI圖像編輯。多於
三Grok引用被拒絕`GROK_REF_TOO_MANY`, 匹配xAI's
記錄多影像編輯限制。

```bash
ima2 models --kind image
ima2 defaults set image oauth/gpt-6-luna
ima2 gen "a poster of a samurai cat" --model api/gpt-5.4 --reasoning-effort high
ima2 grok login
ima2 gen "a cinematic neon city" --model grok/grok-imagine-image-quality
ima2 gen "campaign still" --model runway/gen-4 --ref 1780000000000_abcd.png
ima2 edit input.png --prompt "make it rainy" --provider oauth --web-search
ima2 multimode "two cats playing" --max-images 2 --ref cat.png --mode direct
ima2 node generate --node n_abc --prompt "add neon lights" --no-stream
```

### 使用可見文字進行提示

GPT Image 2可以在生成的圖像中呈現可見文字。如果輸出需要
文本，包括目標語言和腳本中的確切單詞，而不是模糊的
諸如“韓語文本”或“日語單字”之類的短語。

明確指定所需的可見文字有助於減少亂碼，
錯誤的語言替換，並發明了佔位符詞。

直接使用風格詞，例如`manga panel`, `webtoon style`,`兒童的
書籍插圖`, `逼真的產品照片`, or `逼真的包裝
樣機`。

對於密集或關鍵的文本，請保持文本大而明確。準確放置，
小文本和像素完美的排版仍然需要迭代或後期編輯。

多模式特定標誌包括`--max-images <1..24>`預設情況下（可透過配置`IMA2_MAX_GENERATED_IMAGES`), `--ref <file>`（可重複，最多 5 個），`--mode <auto|direct>`, `--provider <auto|oauth|api|grok|grok-api|agy|gemini-api|atlascloud|minimax>`， 和`--show-partial`. `ima2 edit --mask`仍然故意推遲到#31，因為當前的掩碼管道是引導編輯而不是保證真正的掩碼/修復語義。

## 影片

|命令|描述|
|---|---|
| `ima2 video <prompt>` |透過生成視頻Grok (SSE串流有進度）|
| `ima2 video edit <prompt> --video <value>` |編輯現有影片（V2V）；將結果儲存為產生的影片工件|
| `ima2 video extend <prompt> --video <value> [--duration 6]` |從最後一幀開始擴展現有視頻|
| `ima2 video continue <prompt> --video <generated-file>` |使用分支本地從生成的影片的最後一幀生成新剪輯`revisedPrompt`血統|
| `ima2 video frame <generated-file> [--last] [-o frame.png]` |提取一個PNG產生的幀`.mp4` |
| `ima2 video analyze <generated-file>` |使用配置的規劃器模型分析第一幀/最後一幀（Grok預設4.5）|

影片生成標誌：

|旗幟|意義|
|---|---|
| `--duration <1..15>` |持續時間（以秒為單位）（預設值：5）|
| `--resolution <480p\|720p\|1080p>` |視訊解析度（預設：480p）。 1080p 需要`--model grok-imagine-video-1.5`;僅提示 1.5 使用內部白色畫布 I2V 墊片|
| `--aspect-ratio <ratio\|auto>` |1:1、16:9、9:16、4:3、3:4、3:2、2:3、自動（預設：自動）|
| `--model <name>` | `grok-imagine-video`或者`grok-imagine-video-1.5`; `grok-imagine-video-1.5-preview`被接受為相容性別名|
| `--planner-model <name>` | Grok規劃器覆蓋（預設：`grok-4.5`; `grok-4.3`保持相容；也在設定中UI和`IMA2_GROK_PLANNER_MODEL`) |
| `--storyboard` |啟用故事板模式 - 保持連續剪輯中的角色/場景連續性|
| `--ref <file>` |附加來源/參考影像（可重複，最多 7 個）|
| `-o, --out <file>` |輸出檔案路徑|
| `-d, --out-dir <dir>` |輸出目錄|
| `--timeout <sec>` |超時以秒為單位（預設值：600）|
| `--session <id>` |會話ID|

空白影片提示被拒絕。提示應包括視覺流、攝影機或
主題運動、聲音/非音樂意圖、對話/非對話意圖、結束
幀和持續時間節奏。選定的秒數應該感覺自然地填充：
開頭的構圖，相連的動作/情感變化，然後是穩定的結局
畫面最後一幀。範例：`from the last frame, she turns toward camera, rain grows
louder, no background music, says "기다려", use the full duration for the turn
and rain build, end on a still close-up after the line finishes`。

影片編輯/擴充標誌：

|旗幟|意義|
|---|---|
| `--video <value>` |來源影片HTTPS URL, xAI `file_id`， 數據URL，或產生的檔名|
| `--duration <2..10>` |僅延長持續時間（預設值：6）|
| `-o, --out <file>` |將編輯或擴充的影片下載到檔案中|
| `--json` |列印JSON結果|
| `--timeout <sec>` |超時以秒為單位（預設值：600）|

影片繼續標誌：

|旗幟|意義|
|---|---|
| `--video <generated-file>` |父級生成`.mp4`;伺服器提取最後一幀|
| `--duration <1..15>` |新剪輯持續時間（預設值：5）|
| `--resolution <480p\|720p\|1080p>` |新的剪輯解析度（預設值：720p）。 1080p 需要`--model grok-imagine-video-1.5` |
| `--aspect-ratio <ratio\|auto>` |新的剪輯長寬比|
| `--model <name>` |可選的視訊生成模型|

影片繼續也接受`--planner-model`和`--storyboard`.

自動偵測影片模式`--ref`數數：

|參考文獻|模式|
|---|---|
| 0 |文字轉視頻|
| 1 |影像到視頻|
| 2–14 |參考影片（grok-imagine-video-1.5 最長 15 秒，grok-imagine-video 最長 10 秒）|

`grok-imagine-video-1.5`支援 1080p 僅提示文字到影片和單圖像/幀圖像到影片。僅提示 1.5 文字到影片透過內部白色畫布圖像到影片 shim 提交，因為上游 1.5 拒絕原始 T2V。舊的`grok-imagine-video-1.5-preview`name 在上游請求之前被接受為別名並進行規範化。 1.5 不支持`reference_images`影片參考、V2V 編輯或影片擴充。對於 2 個以上參考，請使用`grok-imagine-video`;如果ima2自動重試向基本模型發出 1.5 Ref2V 請求，讀取`video.effectiveModel`和`video.modelFallback`從CLI `--json`， 或者`effectiveModel`和`modelFallback`從SSE.

SSE事件：`planning` → `submitted` → `progress` (0–100%) → `done`或者`error`.

```bash
ima2 defaults set video grok/grok-imagine-video-1.5   # once; bare calls fail closed without it
ima2 video "a cat playing piano"
ima2 video "animate this" --ref photo.png --duration 10
ima2 video "animate this in high detail" --ref photo.png --model grok-imagine-video-1.5 --resolution 1080p
ima2 video "cinematic" --model grok/grok-imagine-video-1.5 --resolution 720p --aspect-ratio 16:9 -o out.mp4
ima2 video "product reveal, slow dolly-in" --model runway/veo-3.1 --duration 8
ima2 video "style transfer" --ref a.png --ref b.png --ref c.png --model grok-imagine-video
ima2 video edit "make the lighting warm sunset" --video 1780226256355_50252101.mp4 -o edited.mp4
ima2 video extend "camera slowly pulls back" --video 1780226256355_50252101.mp4 --duration 6
ima2 video continue "from the last frame, the actor crosses the room, footsteps only, no dialogue, end on the door closing" --video 1780226256355_50252101.mp4
ima2 video frame 1780226256355_50252101.mp4 --last -o lastframe.png
ima2 video analyze 1780226256355_50252101.mp4 --json
```

編輯/擴充接受HTTPS網址，xAI `file_id`, `data:video/*`URL，或產生的`.mp4`文件名。產生的文件輸入僅限於真實的`.mp4`生成的目錄下的檔案。`ima2 video continue`, `ima2 video analyze`， 和`ima2 video frame`有意接受生成的`.mp4`僅文件；遠端分析 URL 被拒絕，因此伺服器不會透過以下方式取得任意 URL`ffmpeg`.

`ima2 video continue`不同於`ima2 video extend`: `extend`來電xAI's
本機擴充端點並傳回組合的原始+擴充視訊。
`continue`來電ima2最後生成伺服器提取的父視頻
框架並堅持`videoContinuity`最多可堆疊四個`revisedPrompt`
條目（`keep-start-plus-latest-3`）以便將來繼續。

JSON輸出註：`ima2 video --json`用 local 包裹最終結果
下載字段，例如`ok`, `path`， 和`filename`. `ima2影片繼續
--json` prints the server SSE `完畢` payload directly, including `檔案名稱`,
`url`, `video`, `revisedPrompt`， 和`videoContinuity`.

## 診斷

`ima2 doctor image-probe`運行即時響應探針來幫助對影像進行分類
發電故障，例如`EMPTY_RESPONSE`。它的目的是為了支持
捆綁，特別是當OAuth是綠色的，但簡單的提示不會產生影像。

```bash
ima2 doctor image-probe --json > ima2-image-probe.json
```

使用`--matrix`當維護者要求當前有效負載比較探測：

```bash
ima2 doctor image-probe --matrix --json > ima2-image-probe.json
```

這JSON輸出已針對問題附件進行清理。它包括診斷
程式碼、事件計數、工具呼叫摘要、位元組計數、提供者/模型標籤、
和探測狀態。它不包括提示文字、身份驗證令牌、帶有以下內容的 URL
憑證、原始上游響應或 base64 影像資料。

為了GPT OAuth無圖像報告，一個有用的支援包是：

```bash
ima2 doctor
ima2 doctor image-probe --json > ima2-image-probe.json
ima2 gen "고양이" --model oauth/gpt-6-luna --no-web-search --json > ima2-cat-no-search.json
ima2 gen "고양이" --model oauth/gpt-6-luna --json > ima2-cat-current.json
```

請勿分享ChatGPT餅乾,OAuth令牌文件，API鍵、提示歷史記錄、原始
上游響應，或產生的 base64。分享`ima2-gen`版本、作業系統版本、
以及是否為 VPN、企業代理、防毒 TLS 檢查、自訂 CA 或
Windows DNS/碎片繞過工具（例如 SecretDNS）正在使用。

## 歷史和元數據

|命令|描述|
|---|---|
| `ima2 ls [--session <id>] [--favorites]` |列出最近的歷史記錄；`--favorites`在分頁之前使用伺服器端收藏夾過濾|
| `ima2 show <name> [--metadata]` |顯示產生的資產；可選的嵌入元資料讀取|
| `ima2 history rm <name> [--permanent]` |軟刪除（預設）或永久刪除|
| `ima2 history restore --trash-id <id>` |從垃圾箱中恢復|
| `ima2 history favorite <name>` |切換收藏夾（發送`X-Ima2-Browser-Id`) |
| `ima2 history import <file>` |導入本機影像（原始影像）PNG/JPEG/WEBP）進入歷史|
| `ima2 metadata <file>` |從任何本地圖像讀取嵌入的元資料（讀取本身不需要伺服器往返，但路由位於伺服器上）|

## 會話和圖表

|命令|描述|
|---|---|
| `ima2 session ls / show <id> / create <title> / rm <id> / rename <id> <title>` |會話增刪改查|
| `ima2 session graph save <id> --file <graph.json>` |儲存圖表（使用 GET-then-PUT 和`If-Match`防範`GRAPH_VERSION_CONFLICT`) |
| `ima2 session graph load <id>` |閱讀最新的圖表快照|
| `ima2 session style-sheet get <id> / put <id> --file <style.json> / enable <id> / disable <id> / extract <id>` |樣式表操作（進階；UI不再表面這個 - 保留API級工作流程）|

## 註釋和畫布

|命令|描述|
|---|---|
| `ima2 annotate get <name>` |讀取影像的註釋|
| `ima2 annotate set <name> --body <json\|@file\|->` |寫註釋（發送`X-Ima2-Browser-Id`) |
| `ima2 annotate rm <name>` |刪除註釋|
| `ima2 canvas-versions save <imagefile> [--source <name>] [--prompt <text>]` |保存原始PNG帆布版|
| `ima2 canvas-versions update <name> <imagefile>` |更新現有畫布版本|

## 提示庫

|命令|描述|
|---|---|
| `ima2 prompt ls [-q <search>] [--folder <id>] [--favorites]` |列出提示|
| `ima2 prompt show <id>` |閱讀一篇提示|
| `ima2 prompt create --name <n> --text <t> [--folder <id>] [--tags <a,b>]` |創造|
| `ima2 prompt edit <id> [--name] [--text] [--folder] [--tags]` |編輯|
| `ima2 prompt rm <id>` |刪除|
| `ima2 prompt favorite <id>` |切換收藏夾|
| `ima2 prompt export [-o <file>]` |將所有提示匯出到JSON |
| `ima2 prompt folder ls / create <name> / rename <id> <name> / rm <id> [--strategy moveToRoot\|deleteItems]` |資料夾增刪改查|
| `ima2 prompt import sources` |列出配置的導入來源|
| `ima2 prompt import refresh --source <id>` |重新索引來源|
| `ima2 prompt import curated --source <id> --q <query>` |精選導入（提交提示）|
| `ima2 prompt import discovery --q <query> --seed <repo>...` |發現導入（僅限某些伺服器上的管理者）|
| `ima2 prompt import folder <localpath>` |導入提示的本機資料夾|
| `ima2 prompt import json <file\|@file\|-> [--folder <id>]` |導入一個JSON導出主體透過`/api/prompts/import` |
| `ima2 prompt import preview <file\|@file\|-> [--filename <name>]` |無需提交即可預覽本地 Markdown/文字候選|
| `ima2 prompt build --message <text> [--ref <file>] [--model <id>] [--json]` |透過建構結構化圖像提示`/api/prompt-builder/chat` |
| `ima2 prompt build --messages <file\|@file\|-> [--json]` |從訊息轉錄檔案或標準輸入構建|

## 卡新聞（門控）

卡新聞需要伺服器啟動`IMA2_CARD_NEWS=1`（或者`features.cardNews: true`在`~/.ima2/config.json`）。當禁用時，CLI退出 2 並帶有明確的訊息，而不是產生 404。

|命令|描述|
|---|---|
| `ima2 cardnews templates` |列出圖像模板和角色模板|
| `ima2 cardnews template preview <id>` |預覽影像模板|
| `ima2 cardnews sets` |列出卡組|
| `ima2 cardnews set show <id>` / `set manifest <id>` |顯示集合或其清單|
| `ima2 cardnews draft / generate / export [--data <json>]` |傳遞體（伺服器轉發`req.body`) |
| `ima2 cardnews job create [--data <json>]` |創建+開始工作|
| `ima2 cardnews job show <jobId>` |顯示一份工作|
| `ima2 cardnews job retry <jobId> [--cards <id,id>]` |重試作業（可選特定卡）|
| `ima2 cardnews card regenerate <cardId> [--data <json>]` |重新產生單張卡|

## 可觀察性和工作

|命令|描述|
|---|---|
| `ima2 ps` |別名為`inflight ls`（保留向後相容性）|
| `ima2 cancel <id>` |別名為`inflight rm` |
| `ima2 inflight ls [--kind classic\|node\|multimode] [--session <id>] [--terminal]` |列出具有階段/模型/提示的活動（以及可選的終端）作業|
| `ima2 inflight rm <requestId>` |強制刪除卡住的作業|
| `ima2 storage status` |入庫檢查（豐富於`doctor`) |
| `ima2 storage open` |在作業系統檔案管理器（POST）中開啟產生的目錄|
| `ima2 billing` | API使用探針通過`/api/billing` (OpenAI/API- 配置後的金鑰積分）。Grok和NovelAI配額僅在網頁UI中透過`GET /api/quota`：目前的每週百分比/重置Grok建造xAIauth，每月遺留`usedUsd`/`limitUsd`倒退。|
| `ima2 providers` |配置的提供者|
| `ima2 oauth status` | GPT OAuth 狀態|
| `ima2 grok status` |儲存的xAI OAuth工作階段狀態，加`--probe`可查看影像模型可見性|
| `ima2 ping` |健康檢查正在運行的伺服器|

## 配置

`config`讀/寫`~/.ima2/config.json`（文件層）。有效值如下`env > file > defaults`.

|命令|描述|
|---|---|
| `ima2 config path` |列印設定檔路徑|
| `ima2 config ls [--effective]` |列印檔案層（預設），或將有效配置與`--effective` |
| `ima2 config get <key>` |從有效配置讀取一個點分鍵；秘密匹配`/token\|secret\|apikey\|password/i`被編輯|
| `ima2 config set <key> <value>` |寫入檔案層；拒絕未知密鑰，拒絕驗證密鑰（`provider`, `apiKey`)，當環境變數覆蓋相同的鍵時發出警告，列印需要重新啟動的註釋|
| `ima2 config rm <key> [--yes]` |從檔案層中刪除一個key；非 TTY 代理程式必須透過`--yes` |
| `ima2 config keys [--json]` |列出可寫鍵和覆蓋它們的環境變量|

`defaults`是持久圖像模型和推理策略的代理友好包裝器。兩者都寫OAuth和API-provider 預設金鑰，因此面向使用者的「預設模型」在提供者路徑中保持一個概念。

|命令|描述|
|---|---|
| `ima2 defaults` / `ima2 defaults ls` |顯示預設模型/推理值|
| `ima2 defaults --json` |喜歡運行伺服器預設值；回退到本地有效配置|
| `ima2 defaults --local --json` |只讀取本地有效配置|
| `ima2 defaults set model <model>` |寫`imageModels.default`和`apiProvider.defaultImageModel` |
| `ima2 defaults set reasoning <effort>` |寫`imageModels.reasoningEffort`和`apiProvider.defaultReasoningEffort` |
| `ima2 defaults set image <lane>/<model>` |堅持失敗關閉CLI影像目標（`defaults.image`）；驗證針對`ima2 models`, 鎖定車道被拒絕|
| `ima2 defaults set video <lane>/<model>` |堅持失敗關閉CLI視訊目標（`defaults.video`) |
| `ima2 defaults reset model` |刪除保留的模型預設值|
| `ima2 defaults reset reasoning` |刪除持久的推理預設值|
| `ima2 defaults reset image` / `reset video` |刪除保留的CLI發電目標|

允許的鍵（白名單）：

```
imageModels.default          imageModels.reasoningEffort
apiProvider.defaultImageModel apiProvider.defaultReasoningEffort
grokProvider.plannerModel     grokProvider.plannerTimeoutMs
grokProvider.defaultImageModel
log.level                    features.cardNews
cardNewsPlanner.{enabled,model,timeoutMs,deterministicFallback}
comfy.{defaultUrl,uploadTimeoutMs,maxUploadBytes}
storage.{generatedDir,generatedDirName}
server.{port,host,bodyLimit}
oauth.{proxyPort,statusTimeoutMs,restartDelayMs}
limits.{maxRefCount,maxGeneratedImages,maxParallel}
history.{defaultPageSize,maxPageCap}
```

改變`provider` / `apiKey`， 跑步`ima2 setup`或者`ima2 login`反而。

## 其他

|命令|描述|
|---|---|
| `ima2 comfy export <filename>` |導出一個ComfyUI工作流程（`POST /api/comfy/export-image`) |

## 發現

伺服器寫入`~/.ima2/server.json`開始時。CLI命令讀取此文件以查找實際連接埠（後端可以從`3333`到`3334+`）。覆蓋發現`--server <url>`或者`IMA2_SERVER=http://localhost:3333`.

## 範例

```bash
# Generation with reasoning effort and web search
ima2 gen "poster" --model gpt-5.4 --moderation low --reasoning-effort high
ima2 edit input.png --prompt "make it rainy" --web-search
ima2 multimode "two cats playing" --max-images 2 --ref cat.png --mode direct -o cat.png

# History and metadata
ima2 ls --session sess_abc --favorites
ima2 show img_xyz.png --metadata
ima2 history import ./local.png

# Prompts
ima2 prompt ls -q sunset
ima2 prompt import refresh --source curated
ima2 prompt import preview ./prompts.md --json
ima2 prompt import json ./prompts-export.json --folder __root__

# Observability
ima2 inflight ls --terminal
ima2 storage status --json

# Config
ima2 skill --json
ima2 skill ls
ima2 skill front --json
ima2 skill uiux path
ima2 skill front refs
ima2 skill front ref motion
ima2 skill install --dir ~/.codex/skills
ima2 skill install --tmp
ima2 capabilities --json
ima2 defaults set model gpt-5.5
ima2 defaults set reasoning high
ima2 config set imageModels.reasoningEffort high
ima2 config get log.level
ima2 config keys --json
ima2 config ls --effective --json
```
