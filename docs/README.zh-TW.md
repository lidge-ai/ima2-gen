# ima2-gen

<!-- runtime-install:generated:start -->
| Contract | Value |
|---|---|
| Node engine | `>=22` |
| npm toolchain | `npm@11.18.0` |
| Release Node | `24.17.0` |
| CLI entry | `bin/ima2.js` |
| OpenAI SDK | `^7.4.0` |
| Express | `^5.1.0` |
<!-- runtime-install:generated:end -->

安裝程式從套件中繼資料讀取 Node.js 最低版本，並在啟動伺服器前執行離線安裝檢查。

<p align="center">
  <img src="../assets/logo.png" alt="ima2" width="160">
</p>

<p align="center">
  <strong>為使用者與程式設計代理打造的本機圖片與影片工作室。</strong>
</p>

[![npm 版本](https://img.shields.io/npm/v/ima2-gen)](https://www.npmjs.com/package/ima2-gen)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![授權條款：MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

> **線上網站**：[lidge-jun.github.io/ima2-gen](https://lidge-jun.github.io/ima2-gen/) · [한국어](https://lidge-jun.github.io/ima2-gen/ko/)
>
> **開發者文件**：[文件網站](https://lidge-jun.github.io/ima2-gen/docs) · [한국어](https://lidge-jun.github.io/ima2-gen/ko/docs)
>
> **閱讀其他語言版本**：[English](../README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [正體中文](README.zh-TW.md) · [简体中文](README.zh-CN.md)

`ima2-gen` 是面向使用者與程式設計代理的本機優先視覺生成執行環境與工作室，支援跨多個供應商的可重現圖片與影片工作流程。

全域安裝後，可在 OpenAI OAuth/API、Grok OAuth/API、Antigravity CLI、Gemini API、AtlasCloud、MiniMax、NovelAI 與 ComfyUI 工作流程組成的 10 個 core lane 中生成圖片與影片。Runway 與 Higgsfield 屬於獨立的 MCP integration。

![ima2-gen 經典工作區（淺色模式），畫布上顯示生成結果。](../assets/screenshots/classic-generate-light.png)

## 快速入門

### Mac 應用程式（Apple Silicon）

在 Apple Silicon Mac 上，桌面應用程式是最快的上手方式。它在 Mac 視窗與選單列圖示中執行同樣的本機伺服器與工作室，並已通過 Apple 簽署與公證。

1. 從最新的 [ima2 Desktop 發行版本](https://github.com/lidge-jun/ima2-gen/releases?q=desktop&expanded=true) 下載 `ima2-<version>-mac-arm64.dmg`。
2. 開啟 DMG，把 **ima2** 拖進 **應用程式** 資料夾。
3. 啟動 ima2，在歡迎畫面選擇一個供應商。

應用程式內建執行環境，不需要另外安裝 Node.js。總和檢查碼、更新與設定請參閱 [Mac App 指南](https://lidge-jun.github.io/ima2-gen/docs/desktop)。在 Intel Mac、Windows 或 Linux 上，請使用下方的 npm 或一鍵安裝。

### npm

```bash
npm install -g ima2-gen
ima2 setup
ima2 serve
```

接著在瀏覽器開啟 `http://localhost:3333`。

### Docker

```bash
docker build -t ima2-gen .
docker run -d -p 3333:3333 -e IMA2_LAN_TOKEN=change-me -v ima2-data:/data ima2-gen
```

請參閱 [DOCKER.md](DOCKER.md)，了解 Compose 用法、必要環境變數與限制。

若要從 CLI 產生內容，可以先查看目前可用的模型清單，並設定圖片／影片的預設模型：

```bash
ima2 models
ima2 defaults set image oauth/gpt-5.6-luna
ima2 defaults set video grok/grok-imagine-video-1.5
ima2 gen "a clean product photo of a red guitar pedal"
ima2 video "a cat playing piano" --duration 5 --resolution 720p
ima2 video "animate this scene" --ref photo.png --duration 10
```

在設定 CLI 目標前，`ima2 gen` 與生成模式的 `ima2 video` 會以 `NO_DEFAULT_MODEL` 安全失敗；除非該次呼叫指定 `--model <lane>/<model>` 或明確指定 `--provider <lane>`。這能避免升級後不知情地切換提供者或計費路徑。

如果 `3333` 已被其他程式使用，`ima2-gen` 會改用下一個可用的連接埠，並把實際網址寫入 `~/.ima2/server.json`。請使用 `ima2 open`，或開啟終端機列出的網址，不要假設連接埠一定是 `3333`。

> **想使用 npx？**請參閱 [NPX_QUICKSTART.md](NPX_QUICKSTART.md) 的 `npx ima2-gen serve` 使用方式。

### 一鍵安裝（不需要 npm）

如果沒有 Node.js 或 npm，可以使用對應平台的安裝腳本。腳本會偵測環境、視需要安裝 Node LTS，最後安裝 ima2-gen。

**macOS：**
```bash
curl -fsSL https://lidge-jun.github.io/ima2-gen/install-mac.sh | bash
```

**Windows（PowerShell）：**
```powershell
irm https://lidge-jun.github.io/ima2-gen/install-windows.ps1 | iex
```

**Linux/WSL：**
```bash
curl -fsSL https://lidge-jun.github.io/ima2-gen/install-linux.sh | bash
```

每個腳本都會檢查支援的 Node 版本，必要時使用 nvm、fnm、Homebrew 或 winget 安裝 Node LTS。npm 安裝只嘗試一次，通過 `ima2 doctor --installation --json` 後才啟動伺服器。腳本不會終止其他程序或刪除全域鎖定檔案。

### 設定

`ima2 setup` 提供四種驗證方式：

1. **GPT OAuth** — 使用 ChatGPT 帳戶登入（免費，僅支援圖片）
2. **Grok OAuth** — 使用 xAI／Grok 帳戶登入（支援圖片與影片）
3. **兩者皆用** — 同時使用 GPT OAuth 與 Grok OAuth（完整功能）
4. **Web 設定** — 在 Web UI 中設定所有選項

影片生成需要 Grok OAuth（選項 2 或 3）。如果已經設定 GPT OAuth、想再加入影片支援，請另外執行 `ima2 grok login`；預設會使用手動貼上驗證資訊的流程。

### 更新中

使用 Ctrl+C 停止執行中的伺服器，然後執行：

```bash
npm install -g ima2-gen@latest
```

按下 Ctrl+C 會關閉資料庫、停止子程序並釋放檔案鎖定。如果 Windows 顯示 `EBUSY`，請先手動停止對應的 ima2 服務，再重新安裝。安裝器不會自動終止程序或提高權限。

## 功能總覽

- **經典模式**：產生、編輯、重複使用目前圖片、貼上參考圖，或從歷史記錄繼續工作。
- **節點模式**：從一張好圖片分支出多個方向，同時保留原始結果。
- **多階段批次**：從一個提示詞啟動多個經典模式結果，逐一查看進度，再從最佳結果繼續。
- **影片生成**：使用文字、單張圖片或多張參考圖，透過 Grok 影片模型建立短片。SSE 串流會顯示「規劃 → 已提交 → 進度百分比 → 完成」；影片影格按鈕（第一格／中間格／最後一格）可擷取並複製關鍵影格。
- **分鏡模式**：在編輯器中開啟分鏡模式，維持連續影格中的角色與場景一致性。圖片與影片生成都支援此模式；圖片關鍵影格可用於影片製作，影片片段則會沿用角色／環境鎖定規則。
- **畫布模式**：縮放、平移、加註解、擦除、清理背景、預覽透明圖片，並匯出透明度或指定底色的版本。
- **本機圖庫**：將產生的資產保存在電腦上，並以工作階段管理歷史記錄。圖庫預設顯示目前工作階段；切換「所有圖片」即可查看完整歷史記錄，而且範圍設定會跨工作階段保留。每張圖片的產生時間與推理強度都會記錄在結果中繼資料裡，重新載入後仍可查看。
- **參考圖片**：拖放、貼上並附加最多 5 張圖片參考，或最多 14 張影片參考；大型圖片會在上傳前自動壓縮。
- **提示詞庫匯入**：將本機提示詞包、GitHub 資料夾、精選來源與 GPT 圖片提示詞提示包匯入內建提示詞庫。
- **行動版介面**：在小螢幕上使用應用程式列、撰寫面板與精簡設定切換。
- **可觀測的工作**：透過安全日誌與請求 ID 追蹤目前及最近的工作。

### 代理技巧

ima2-gen 內建三套提供給 AI 程式碼代理使用的技能。這些 Markdown 指令檔案可協助代理建立圖片／影片的結構化工作流程、製作前端資產，以及探索設計方向。

|技能|命令|它涵蓋什麼|
|-------|---------|----------------|
| **核** | `ima2 skill` | CLI參考、提示協定、提供者路由、韓文文字、影片工作流程|
| **前端** | `ima2 skill front` | 資產流程（平行產生、變體選擇、提供者路由）、Web 動態／影片、響應式設計、無障礙、防止 AI 味設計，以及 30 多份參考文件 |
| **UI／UX 設計** | `ima2 skill uiux` | 以圖片為核心的設計方向探索、UX 狀態、設計語彙、產品個性、DESIGN.md 工作流程，以及 21 份參考文件 |

```bash
ima2 skill ls            # list available skills
ima2 skill front         # print the frontend skill
ima2 skill uiux          # print the design skill
ima2 skill front path    # print file path (for agents)
ima2 skill front --json  # JSON wrapper (for agents)
ima2 skill front refs    # list reference modules (32 files)
ima2 skill front ref motion        # load one reference module
ima2 skill install --dir <path>     # install skills to agent's skill dir
ima2 skill install --tmp            # install to temp dir (fallback)
```

前端與 UI／UX 技能是針對 ima2 工作流程整理的正式產品設計工程指南，涵蓋字體、色彩系統、版面配置、韓文 UX 模式、動態編排與視覺驗證；每個資產產生步驟都對應到 `ima2 gen`、`ima2 video` 與 `ima2 multimode` 指令。

### SSE多路復用

Web UI 使用單一 `GET /api/events` 伺服器發送事件（SSE）連線，接收所有生成進度。多階段、節點與影片請求會以非同步 POST（`202 { requestId }`）提交，進度事件則透過共用事件匯流排多工傳送。這避免了瀏覽器最多 6 條連線的限制，不再因同時生成而讓圖庫卡住。未傳送 `async: true` 的 CLI 用戶端仍會收到每個請求各自的 SSE 串流，以維持向下相容性。

## 提供者路徑

圖片生成可以使用本機 Codex／ChatGPT OAuth、已設定的 OpenAI API 金鑰、內建 Grok 提供者，或透過 Antigravity CLI 使用 Gemini 提供者。

- `provider: "oauth"` 使用本機 Codex OAuth 代理程式。
- `provider: "api"` 使用 OpenAI Responses API 的 `image_generation` 工具。
- `provider: "grok"`使用`~/.progrok/auth.json`中的xAI OAuth工作階段直接呼叫`https://api.x.ai`, 強制運行xAI網路搜尋加上規劃者通行證（預設：`grok-4.3`，可在設定中配置或透過`--planner-model`），然後調用xAI圖片API。也可以選擇`grok-4.5`和`grok-4.6`。用`ima2 grok login`或網頁UI登入一次；權杖在過期前 2 分鐘自動更新。
- `provider: "grok-api"`稱為xAI圖片API直接與`XAI_API_KEY`（使用API金鑰而不是OAuth工作階段）。
- `provider: "agy"` 啟動 Antigravity CLI（`agy -p`），透過 Google Gemini 的 `default_api:generate_image` 工具產生圖片（模型：`nano-banana-2`）。輸出固定為 1024×1024 JPEG，最多 3 張參考圖，不提供網路搜尋、品質或尺寸控制。
- `provider: "gemini-api"` 直接呼叫 Google Generative Language API。支援 `nano-banana-2`（Gemini 3.1 Flash Image）與 `nano-banana-pro`（Gemini 3 Pro Image）；驗證方式包括 `GEMINI_API_KEY` 環境變數、Web UI 金鑰管理，或 Vertex AI 服務帳戶 JSON（`VERTEX_SERVICE_ACCOUNT_JSON`）。同時設定 API 金鑰與 Vertex 憑證時，優先使用 Vertex。支援 1:1 至 21:9 的長寬比與 512px、1K、2K、4K 四種解析度；這些控制只有直接 API 路徑有效，Vertex AI 端點不接受 `response_format` 欄位，因此會忽略長寬比與尺寸設定。
- API 金鑰產生支援經典模式的產生、編輯、遮罩導向編輯、多階段與節點產生。
- Grok 產生支援經典、節點與代理模式。如果有經典參考圖、節點父圖片或代理模式目前圖片，ima2 會將最後一次 Grok 呼叫切換為 xAI 圖片編輯，以保留圖片轉圖片的上下文。

如果未指定提供者，應用程式將保留目前的GPT OAuth/預設行為。GPT OAuth和API-金鑰產生預設為`gpt-5.6-luna`;這API-key路徑也預設為`low`推理和`1024x1024`除非請求通過了經過驗證的選項。Grok影像生成預設為`grok-imagine-image-2.0`.

關於OAuth Grok通道有一點需要說明：xAI只把`/v1/me`記錄為接受OAuth權杖的端點，所以用該權杖呼叫`api.x.ai`的影像與影片介面走的是未文件化的路徑。它目前可用——progrok一直依賴同一條路徑——但沒有任何相容性承諾。如果xAI關閉這條路徑，用`XAI_API_KEY`的`provider: "grok-api"`是有文件的方案，且不受影響。

Grok圖像生成公開了模型選擇器（`grok-imagine-image` / `grok-imagine-image-quality`）和尺寸選擇器（長寬比 + 1k/2k 解析度）。設定頁面更喜歡Grok建立每週積分百分比並重置時間`GET /v1/billing?format=credits`;如果該來源不可用，則會退回到傳統的每月計費窗口，並且`$used/$limit`. A **切換帳戶**按鈕啟動設備代碼OAuth流動 （`POST /api/auth/switch`）無需離開應用程式即可重新進行身份驗證。

Grok影片產生預設為規範`grok-imagine-video-1.5`; `grok-imagine-video`仍可用於僅限基本型號的 Ref2V、V2V 編輯和擴展路徑，以及舊版本`grok-imagine-video-1.5-preview`字串被接受作為別名。根據引用計數自動偵測三種模式：文字到影片（0 引用）、圖像到影片（1 引用）和引用到影片（2-14 引用；grok-imagine-video-1.5 最長 15 秒，grok-imagine-video 最長 10 秒）。 1080p 可用於`grok-imagine-video-1.5`僅提示文字到影片和單圖像/幀圖像到影片；僅提示 1.5 在上游請求之前使用內部白色畫布 I2V 填充程式。視訊控制包括持續時間（1-15秒）、解析度（480p、720p、1080p（如果支援））和寬高比（1:1、16:9、9:16、4:3、3:4、3:2、2:3、自動）。

![設定工作區顯示GPT OAuth活躍和API可用的密鑰提供者。](../assets/screenshots/settings-oauth-generation.png)

## 型號指導

該應用程式預設為**`gpt-5.6-luna`**用於影像生成和 Prompt Builder 規劃。較舊的受支援型號仍保留明確的兼容性選擇。

- `gpt-5.6-luna`— 目前影像和提示產生器預設值。
- `gpt-6-astra`— 最新的 GPT 影像模型；可選，但不是預設值。
- `gpt-5.6-terra` / `gpt-5.6-sol`- 目前的GPT-5.6當您的帳戶暴露它們時的替代方案。
- `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`- 支援的相容性選擇。

應用程式也提供品質（`low`、`medium`、`high`）與內容審查（`auto`、`low`）控制。

## 工作流程

### 經典模式

如果想快速取得一個完整結果，請使用經典模式。

1. 輸入提示詞。
2. 視需要附加或貼上參考圖。
3. 選擇模型、品質、尺寸、格式與內容審查模式。
4. 產生一張圖片，或開啟多階段模式，從同一個提示詞產生多個候選結果。
5. 複製、下載、從結果繼續，或將結果送到畫布模式。

有關 Prompt Studio、多模式配方、直接模式的逐一控制指南，
推理努力和畫廊最喜歡的行為，請參閱
[提示工作室手冊](PROMPT_STUDIO.md).

![多模式序列，具有四個候選槽位，由側邊欄中的一個提示和活動作業歷史記錄產生。](../assets/screenshots/multimode-sequence.png)

### 節點模式

當您想要探索分支時，請使用節點模式。

![具有連接的生成卡和緊湊的每個節點元資料的節點模式。](../assets/screenshots/node-graph-branching.png)

每個節點都有自己的提示和結果。根節點可以附加本地引用；子節點使用父圖像作為其來源。已完成的作業透過請求 ID 與節點匹配，因此重新載入和圖形版本衝突可以恢復完成的結果。

### 畫布模式

當產生的影像已接近但需要在下一個提示之前進行有針對性的清理時，請使用畫布模式。

- 將視窗平移與選擇分開，以便您可以在縮放影像中移動而不會意外變更註釋。
- 使用註釋、橡皮擦、多選、分組、撤消/重做和便簽，同時保持原始圖庫圖像可用。
- 選擇背景清理種子，預覽蒙版，並將清理儲存為畫布版本。
- 偵測透明影像並顯示棋盤預覽；使用保留的 alpha 或選擇的霧面顏色匯出。
- 儲存的畫布版本對 Gallery 和 HistoryStrip 保持隱藏狀態，但 Canvas 模式可以重複使用它們並附加畫布版本作為下一個參考。

![帶有縮放控制項、註解標記、便籤和畫布工具列的畫布模式。](../assets/screenshots/canvas-mode-cleanup.png)

### 提示詞庫與匯入

現在可以從本機檔案、GitHub 資料夾、精選來源與 GPT 圖片提示詞包填入提示詞庫。匯入的提示詞會在本機建立索引，因此搜尋與排序不必在每個工作階段重新匯入相同來源。

![用於將提示導入庫的提示導入對話框，顯示GitHub匯入前的資料夾控制項、精選來源和搜尋提示候選者。](../assets/screenshots/prompt-import-dialog.png)

### 實驗卡新聞模式

Card News 仍處於開發階段且處於實驗階段。預設是隱藏的
除非明確啟用開發，否則發布運行時，且不應該
尚未被視為穩定的公共功能。

### 設定

設定工作區將帳戶、模型、外觀與語言選項集中管理，讓生成側欄保持精簡。

![具有帳戶導航和產生模型控制項的設定工作區。](../assets/screenshots/settings-workspace.png)

## CLI命令

### 伺服器

|命令|描述|
|---|---|
| `ima2 serve [--dev]` |啟動本地網路伺服器；`--dev`啟用詳細的伺服器診斷|
| `ima2 setup` |重新配置已儲存的身份驗證|
| `ima2 status` | 顯示設定與 OAuth 狀態 |
| `ima2 doctor` |診斷節點、套件、配置和身份驗證|
| `ima2 doctor image-probe [--json]` |運行經過淨化的影像探針進行無影像診斷|
| `ima2 open` |開啟網路UI |
| `ima2 reset` |刪除已儲存的配置|

### 用戶端

以下指令都需要先執行 `ima2 serve`。CLI 覆蓋伺服器提供的各項功能；下面列出最常用的指令，完整清單請參閱 [CLI 參考](CLI.md)（包含產生、歷史記錄、工作階段、提示詞庫、註解、Card News、可觀測性與設定）。

|命令|描述|
|---|---|
| `ima2 models [--kind image\|video] [--lane <lane>] [--json]` |列出即時車道、狀態、型號 ID 和功能|
| `ima2 defaults set image\|video <lane>/<model>` |堅持失敗關閉CLI影像或影片生成目標|
| `ima2 defaults reset image\|video` |刪除一個持久化的CLI世代目標|
| `ima2 gen <prompt> [--model <lane>/<model>]` |生成自CLI;需要明確的目標或已儲存的影像預設值|
| `ima2 edit <file> --prompt <text>` |編輯現有影像|
| `ima2 multimode <prompt>` |多影像SSE世代|
| `ima2 video <prompt> [--model <lane>/<model>]` |透過生成視頻Grok或者MCP車道;需要明確的目標或已儲存的視訊預設值|
| `ima2 ls [--session <id>] [--favorites]` |列出最近的歷史記錄|
| `ima2 show <name> [--metadata]` |顯示產生的資產|
| `ima2 prompt ls -q <search>` |搜尋提示庫|
| `ima2 inflight ls [--terminal]` |列出目前和最近的工作（別名`ps`) |
| `ima2 config set <key> <value>` | 寫入 `~/.ima2/config.json` |
| `ima2 ping` |健康檢查正在運行的伺服器|

伺服器會將實際連接埠寫入 `~/.ima2/server.json`。如果 `3333` 忙碌，後端會改用 `3334` 以上的連接埠，CLI 指令也會遵循公告網址。你可以用 `--server <url>` 或 `IMA2_SERVER=http://localhost:3333` 覆寫自動偵測結果。

```bash
ima2 models --kind image
ima2 gen "poster" --model oauth/gpt-5.6-luna --reasoning-effort high
ima2 edit input.png --prompt "make it rainy" --web-search
ima2 multimode "two cats playing" -n 2
ima2 video "a cat playing piano" --model grok/grok-imagine-video-1.5 --duration 5 --resolution 720p
ima2 video "animate this" --model grok/grok-imagine-video-1.5 --ref photo.png --aspect-ratio 16:9
ima2 inflight ls --terminal
ima2 config set imageModels.reasoningEffort high
```

完整參考：[docs/CLI.md](CLI.md).

## 配置

配置優先權：

```text
environment variables > ~/.ima2/config.json > built-in defaults
```

| 環境變數 | 預設值 | 說明 |
|---|---:|---|
| `IMA2_PORT` / `PORT` | `3333` | Web 伺服器連接埠 |
| `IMA2_HOST` | `127.0.0.1` |Web伺服器綁定主機|
| `IMA2_OAUTH_PROXY_PORT` / `OAUTH_PORT` | `10531` | OAuth代理端口|
| `IMA2_SERVER` | — | CLI目標覆蓋|
| `IMA2_CONFIG_DIR` | `~/.ima2` |配置和 SQLite 位置|
| `IMA2_ADVERTISE_FILE` | `~/.ima2/server.json` |運行時發現文件|
| `IMA2_GENERATED_DIR` | `~/.ima2/generated` |產生的圖片目錄|
| `IMA2_IMAGE_MODEL_DEFAULT` | `gpt-5.6-luna` |伺服器後備映像模型|
| `IMA2_REASONING_EFFORT` | `medium` |默認的默認推理工作（GPT OAuth） 小路;之一`none`, `low`, `medium`, `high`, `xhigh` |
| `IMA2_NO_OAUTH_PROXY` | — |放`1`停用自動啟動OAuth代理人|
| `IMA2_LOG_LEVEL` | `info` |正常服務預設為`info`;開發模式預設為`debug`;支持`debug`, `info`, `warn`, `error`， 或者`silent` |
| `IMA2_INFLIGHT_TERMINAL_TTL_MS` | `300000` |調試視圖的最近終端作業保留|
| `OPENAI_API_KEY` | — | API的關鍵`provider: "api"`回應API影像路徑和輔助API- 主要特點|
| `XAI_API_KEY` | — | API關鍵是`provider: "grok-api"`直接的xAI圖片API小路|
| `IMA2_API_IMAGE_MODEL_DEFAULT` | `gpt-5.6-luna` |預設影像模型`provider: "api"` |
| `IMA2_API_REASONING_EFFORT` | `low` |默認推理工作`provider: "api"` |
| `IMA2_API_IMAGE_SIZE` | `1024x1024` |預設尺寸為`provider: "api"` |
| `IMA2_API_ALLOW_WEB_SEARCH` | `true` |切換網路搜尋`provider: "api"` |
| `IMA2_GROK_PLANNER_MODEL` | `grok-4.3` | Grok搜尋/規劃器模型（也可透過設定進行配置UI或者`--planner-model` CLI旗幟）|
| `IMA2_GROK_PLANNER_TIMEOUT_MS` | `900000` |超時時間為Grok搜尋和規劃呼叫|
| `IMA2_GROK_IMAGE_MODEL_DEFAULT` | `grok-imagine-image-2.0` |預設最終Grok影像模型|
| `IMA2_GROK_VIDEO_MODEL_DEFAULT` | `grok-imagine-video-1.5` |預設Grok視訊模型|
| `IMA2_GROK_GENERATION_TIMEOUT_MS` | `300000` | Grok 圖片 API 最終呼叫的逾時 |
| `IMA2_OAUTH_MASKED_EDIT_ENABLED` | `false` |針對屏蔽編輯請求的選擇加入功能標誌OAuth路徑（#31，僅基礎）|
| `GEMINI_API_KEY` | — | API關鍵是`provider: "gemini-api"`直接生成語言API小路|
| `VERTEX_SERVICE_ACCOUNT_JSON` | — |谷歌服務帳戶JSON為了Vertex AI授權與`provider: "gemini-api"`;優先於`GEMINI_API_KEY`當兩者都設定時|
| `IMA2_AGY_BIN` | `agy`在路徑上|顯式路徑Antigravity CLI二進制為`provider: "agy"` |
| `IMA2_MAX_PARALLEL` | `24` |伺服器範圍的平行產生上限|

`IMA2_GROK_PROXY_HOST`、`IMA2_GROK_PROXY_PORT`、`IMA2_NO_GROK_PROXY`和`IMA2_GROK_RESTART_*`已隨本機Grok代理在 3.16 中移除，不再被讀取；即使保留這些值也不會有任何影響。

### 記錄模式

`ima2 serve`故意保持終端輸出安靜：啟動 URL、警告和錯誤保持可見，而 request/node/OAuth結構化日誌預設隱藏。

使用`ima2 serve --dev`, `npm run dev`， 或者`IMA2_LOG_LEVEL=debug ima2 serve`當您需要請求 ID、節點產生階段時，OAuth流診斷或飛行狀態轉換。顯式的`IMA2_LOG_LEVEL`和`~/.ima2/config.json`值仍然會覆蓋內建預設值。

## API參考

端點清單移至[docs/API.md](API.md)因此本自述文件可以集中於首次運作使用。

有用的參考：

- [開發者文件網站](https://lidge-jun.github.io/ima2-gen/docs)— 概述、快速入門、架構、模式、提供者、CLI、設定和伺服器API
- [CLI參考](CLI.md)
- [API參考](API.md)
- [提示工作室手冊](PROMPT_STUDIO.md)
- [常問問題](FAQ.md)
- [恢復舊影像](RECOVER_OLD_IMAGES.md)
- [韓文自述文件](README.ko.md)
- [日文自述文件](README.ja.md)
- [中文自述文件](README.zh-CN.md)

## 故障排除

**`ima2 ping`說伺服器無法存取**
開始`ima2 serve`，然後檢查`~/.ima2/server.json`。你也可以運行`ima2 ping --server http://localhost:3333`.

**GPT OAuth登入不起作用**
重新運行`ima2 setup`（選項1），確認`ima2 status`，然後重新啟動`ima2 serve`.

**`fetch failed`在代理/VPN 網路上重複**
檢查本地OAuth代理可達。在需要代理的網路上，啟用代理客戶端的 TUN/TURN 式模式，然後重試`openai-oauth --port 10531`。如果仍然失敗，請設定`HTTP_PROXY`和`HTTPS_PROXY`在運作的同一個終端中`ima2 serve`或者`openai-oauth`。在 Windows 上，也要檢查自動啟動的網路攔截工具，包括 SecretDNS 等 DNS/碎片繞過工具，因為它們可能會破壞OAuth或串流圖像回應，即使瀏覽器顯示為已連線。

**影像失敗`API_KEY_REQUIRED`**
放`OPENAI_API_KEY`或配置一個API使用前按鍵`provider: "api"`。預設GPT OAuth路徑仍然有效，無需API鑰匙。

**圖像生成返回`EMPTY_RESPONSE`或沒有影像數據**
跑步`ima2 doctor image-probe --json > ima2-image-probe.json`並附上保險箱JSON打開問題時。為了GPT OAuth案例，也捕獲`ima2 gen "고양이" --model oauth/gpt-5.6-luna --no-web-search --json`和`ima2 gen "고양이" --model oauth/gpt-5.6-luna --json`儘管`ima2 serve`正在運行。請勿分享ChatGPT餅乾,OAuth令牌文件，API鍵、原始上游回應、提示歷史記錄或產生的 base64。請參閱[常見問題支援包](FAQ.md#what-should-i-share-when-gpt-oauth-image-generation-returns-no-image).

**大參考影像失敗**
該應用程式壓縮較大JPEG/PNG上傳前參考。如果文件仍然失敗，請將其轉換為JPEG或者PNG降低解析度並重試。瀏覽器路徑不支援 HEIC/HEIF 檔案。

**更新後舊圖庫影像遺失**
最新版本將產生的映像從已安裝的套件資料夾移至`~/.ima2/generated`。跑步`ima2 doctor`並看到[恢復舊影像](RECOVER_OLD_IMAGES.md).

**`gpt-5.5`失敗但其他模型可以工作**
更新Codex CLI首先，然後重試。如果仍然失敗，您的帳戶或後端路由可能無法公開相同的映像能力或配額`gpt-5.5`然而;使用`gpt-5.4`作為穩定的後備。

**該應用程式在不同的連接埠上打開**
如果請求的伺服器連接埠繁忙，`ima2-gen`回退到下一個可用連接埠並將其記錄在`~/.ima2/server.json`。如果連接埠意外`3457`，你的shell也可能繼承了`PORT=3457`來自另一個本地工具。跑步`unset PORT`或開始於`IMA2_PORT=3333 ima2 serve`.

**港口`10531`已經在 Windows 上使用**
一些 Windows 安全性工具，包括`AnySign4PC.exe`，可以佔用預設值OAuth代理端口。當前版本追蹤實際的回退OAuth港口。如果您仍然需要手動超控，請從`IMA2_OAUTH_PROXY_PORT=11531 ima2 serve`並檢查`ima2 doctor`.

有關更多適合初學者的答案，請參閱[常問問題](FAQ.md).

## 發展

```bash
git clone https://github.com/lidge-jun/ima2-gen.git
cd ima2-gen
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run dev`建立UI並開始TypeScript伺服器條目與`--watch`和詳細的伺服器診斷。`npm run typecheck`, `npm run build:server`， 和`npm run build:cli`驗證TypeScript遷移和包發出路徑。 Node模式和Canvas模式是打包的一部分UI預設情況下。

## 貢獻者

- [@lidge-jun](https://github.com/lidge-jun)— 維護者
- [@ree9622](https://github.com/ree9622)— 審核控制、Windows 修復、結構化日誌記錄
- [@Charley-Peng](https://github.com/Charley-Peng) — API快取修復（#74）
- [@philiptaron](https://github.com/philiptaron)— 尼克斯薄片 (#81)
- [@傲英](https://github.com/aorying)— 上游驗證錯誤浮出水面（告知 TS 遷移方向）
- [@樸正民](https://github.com/PARKJONGMlN)— 批次比較矩陣設計 (#80)

## 執照

麻省理工學院
