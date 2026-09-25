# ima2-gen常問問題

最後審核時間：2026-05-26

此常見問題收集了安裝或更新後往往出現的問題`ima2-gen`。自述文件很短；此頁面提供實用詳細資訊和恢復步驟。

韓語請參閱 [FAQ.ko.md](FAQ.ko.md)；正體中文請參閱 [FAQ.zh-TW.md](FAQ.zh-TW.md)；簡體中文請參閱 [FAQ.zh-CN.md](FAQ.zh-CN.md)。

## 快速修復

|症狀|先嘗試一下|
|---|---|
|伺服器無法存取|跑步`ima2 serve`， 然後`ima2 ping`. |
| GPT OAuth登入失敗|重新運行`ima2 setup`（選項 1），然後重新啟動`ima2 serve`. |
| API關鍵提供者說`API_KEY_REQUIRED` |配置一個API鍵，或切換回GPT OAuth提供者。|
|舊畫廊圖像看起來不見了|跑步`ima2 doctor`，然後看到[恢復舊生成的圖像](RECOVER_OLD_IMAGES.md). |
| GPT OAuth 上某個 GPT-6 模型失敗 | 用 `ima2 gpt login` 重新登入，檢查 `ima2 models --kind image`，再改用 `gpt-6-luna`。 |
|參考資料上傳失敗|使用JPEG/PNG，降低分辨率，並保留對 5 個或更少圖像的引用。|
|提示Studio控制不清楚|閱讀[提示工作室手冊](PROMPT_STUDIO.md)用於多模式、直接、推理和畫廊行為。|
|圖像生成返回`EMPTY_RESPONSE`或沒有影像數據|跑步`ima2 doctor image-probe --json`，然後收集下面的安全支援包。|
| `fetch failed` 在代理/VPN 網路上反覆出現 | 開啟代理用戶端的 TUN/TURN 類模式，或設定 `HTTPS_PROXY` 與 `NODE_USE_ENV_PROXY=1` 後啟動 `ima2 serve`。 |

## 安裝和更新

### 我需要什麼版本的節點？

請使用 Node.js 22 或更新版本。套件聲明 Node `>=22`，README 徽章遵循該要求。

### 我該如何安裝？

全域安裝npm:

```bash
npm install -g ima2-gen
ima2 setup
ima2 serve
```

如果舊安裝行為異常，請先更新：

```bash
npm install -g ima2-gen@latest
```

然後運行：

```bash
ima2 doctor
```

### Windows 說`spawn EINVAL`。我該怎麼辦？

更新到最新版本。舊版在生成時遇到問題npmWindows 上的 /npx 墊片。目前版本透過 Windows 安全路徑路由這些命令。

如果Codex在本機 Windows 上登入本身並不可靠，WSL 可能是更可預測的環境。

### Windows 說`EBUSY`或者`resource busy or locked`更新期間。我該怎麼辦？

這通常意味著npm無法替換全域包，因為正在運行
`ima2 serve`, 陳舊的`node.exe`、終端機、資源管理器視窗、防毒軟體或索引器
仍然保留著包資料夾。停止ima2，關閉相關終端，結束陳舊
`node.exe`如果需要，則進行處理，然後重試：

```bash
npm install -g ima2-gen@latest
```

如果鎖定仍然存在，請重新啟動 Windows 並在開始之前執行更新ima2
再次。

## 身份驗證和提供者

### 我需要一個OpenAI API鑰匙？

預設生成路徑為否。正常路徑使用您本地的Codex/ChatGPT OAuth會議。

如果您配置APIkey，圖像生成路線也可以使用`provider: "api"`透過回應API `image_generation`工具。

### 為什麼設定頁面顯示“API關鍵提供商可用」？

這意味著`ima2-gen`找到一個有效的API鑰匙。API-key 模式可以產生、編輯、運行多模式以及建立節點輸出。如果沒有配置金鑰，`provider: "api"`在上游之前失敗`API_KEY_REQUIRED`.

### 如果Codex CLI已經登入了，確實ima2-gen重用它嗎？

是的。`ima2-gen`檢查現有的Codex登入並使用本地GPT OAuth小路。如果偵測失敗或令牌過期，請執行：

```bash
ima2 setup     # re-run option 1 (GPT OAuth)
ima2 doctor
```

然後重新啟動`ima2 serve`.

### 如果我看到怎麼辦`Provided authentication token is expired`?

你的Codex/ChatGPT OAuth會話需要刷新。

```bash
ima2 setup     # re-run option 1 (GPT OAuth)
ima2 serve
```

如果這種情況發生在公司網路上，防火牆、VPN、代理商或強制入口網站也可能會阻止OAuth流動。

### 我該如何使用Gemini提供者？

二Gemini提供者可用：

- **`agy`**— 使用Antigravity CLI (`agy -p`）沒有API需要鑰匙。需要`agy`要安裝並登入的二進位檔案。型號是`nano-banana-2`，輸出固定為1024×1024。

- **`gemini-api`**——稱為Google生成語言API直接地。添加一個`GEMINI_API_KEY`env var，或透過設定 > 配置金鑰API鑰匙。為了Vertex AI,新增服務帳號JSON透過設定或`VERTEX_SERVICE_ACCOUNT_JSON`環境變數。當兩者都APIkey 和 Vertex 憑證均存在，Vertex 優先。使用“設定”中的身份驗證模式下拉式選單在`apikey`和`vertex`;該選擇會自動儲存並恢復。

這`gemini-api`提供者支援兩種模型：`nano-banana-2` (Gemini3.1 Flash 影像）和`nano-banana-pro` (Gemini3 專業圖像）。網路UI顯示寬高比和解析度控制 (512px–4K)`gemini-api`;這些僅在直接上受到尊重Gemini API路徑並被忽略Vertex AI.

### 如何重新驗證Grok或者Codex無需重新啟動？

使用**切換帳戶**提供者的「設定」>「配額卡」中的按鈕。這會啟動一個裝置代碼OAuth流程：新的瀏覽器標籤開啟驗證URL，您完成登錄，伺服器會自動取得新憑證。對於電流Grok建造xAIauth，配額欄顯示伺服器計算的每週使用百分比和重設時間。舊版身份驗證回退到較舊的每月身份驗證`$used / $limit`帳單視圖（如果可用）。

## 型號及配額

### 我應該使用哪個模型？

GPT OAuth 預設使用 `gpt-6-luna`。此通道提供三個 GPT-6 模型：你選的模型負責規劃畫面，`gpt-image-2` 負責出圖。

- `gpt-6-luna`：預設模型。
- `gpt-6-sol`：另一個日常使用的 GPT-6 模型。
- `gpt-6-astra`：推理時間最長、速度最慢；推理強度 `none` 會以 `low` 執行。

舊的 OAuth 模型 ID（`gpt-5.6-sol`、`gpt-5.6-luna`、`gpt-5.6-terra`、`gpt-5.5`、`gpt-5.4`、`gpt-5.4-mini`）在已儲存的設定與腳本中仍可使用。`gpt-5.6-sol` 會以 `gpt-6-sol` 執行，其餘以 `gpt-6-luna` 執行。API key 通道（`provider: "api"`）保留自己的清單，預設是 `gpt-5.6-luna`。

### 為什麼只有某個 GPT-6 模型失敗？

GPT OAuth 通道使用你的 ChatGPT 方案開放的 GPT-6 模型。請更新 ima2-gen，以 `ima2 gpt login` 重新登入，再用 `ima2 models --kind image` 檢查。若某個模型持續失敗，請改用 `gpt-6-luna`。

### Plus 或 Pro 可以產生多少張影像？

不要將任何社區號碼視為保證。GPT OAuth產生可能會受到帳戶、後端功能、流量和策略變更的限制。`ima2-gen`不發布固定的 Plus/Pro 影像計數，因為該數字不夠穩定，無法作為承諾記錄。

## Prompt Studio 和多​​模式

### 有詳細的Prompt Studio手冊嗎？

是的。請參閱[提示工作室手冊](PROMPT_STUDIO.md)。它解釋了作曲家，
多模式老虎機、1:1 直接、模型/推理快速設定、最近歷史記錄、
畫廊收藏夾，以及哪些操作有意導入提示文字。

### 為什麼多模影像看起來不相關？

多模式從同一提示啟動多個單獨的影像請求。插槽
是候選輸出，而不是同一共享畫布內的面板，並且不是保證的
故事順序。要獲得相關的替代方案，請先寫出共同的主題，然後
然後命名允許的變化。要獲得一張多面板圖像，請使用普通
單一影像請求並要求兩面板、拼貼畫或聯絡表佈局。

### 選擇圖庫圖像是否應該更改我目前的提示？

被動影像選擇僅供檢視。它應該聚焦所選影像而無需
重寫作曲家。提示庫插入，“從此圖像繼續”，以及
其他明確重複使用操作是有意更改提示的操作
文字.

### 問題 #75 發生了什麼變化？

Prompt Studio 關閉修復了導航和狀態耦合回歸：
鍵盤移動現在遵循可見的近期歷史領域，即畫廊
條目仍然可以訪問，長提示不再讓圖像檢視器感到飢餓，
直接和多模式狀態同時可見，圖庫收藏夾保留
瀏覽視窗和被動圖像選擇不會重新填滿作曲家。

## 圖庫和產生的文件

### 生成的圖像儲存在哪裡？

目前版本將生成的圖像儲存在您的用戶資料資料夾中：

```text
macOS / Linux: ~/.ima2/generated
Windows: %USERPROFILE%\.ima2\generated
```

你可以用以下方法覆蓋它`IMA2_GENERATED_DIR`.

### 為什麼更新後舊的圖庫圖像看起來遺失了？

舊版將產生的映像儲存在已安裝的套件資料夾中。最新版本將庫移至用戶數據存儲，因此包更新不會將應用程式程式碼與運行時文件混合。

抱歉嚇到了。如果在更新期間取代了舊的全域安裝資料夾，則先前的全域安裝資料夾將被取代。`generated/`資料夾可能不再位於磁碟上。`ima2-gen`僅當舊資料夾仍然存在時才能恢復舊文件。

跑步：

```bash
ima2 doctor
```

然後跟隨[恢復舊生成的圖像](RECOVER_OLD_IMAGES.md).

### 做ima2-gen在此遷移過程中刪除我的舊映像嗎？

不。遷移僅是複製。它不會刪除或移動舊資料夾。如果找不到舊文件，可能的問題是磁碟上不再存在舊的全域安裝資料夾。

### 「打開資料夾」會打開什麼？

畫廊的**打開資料夾**按鈕打開運行機器上產生的圖像資料夾`ima2 serve`.

這通常是您自己的計算機。如果您使用遠端伺服器、SSH 會話、VM、容器、WSL 或網路上的其他計算機，則該資料夾將在該伺服器電腦上開啟或解析，而不一定會在瀏覽器裝置上開啟或解析。

### Card News 是穩定公開版本的一部分嗎？

還沒有。 Card News 仍處於開發階段且處於實驗階段。預設發布
運行時應將其隱藏，除非明確啟用它用於開發，
公共文件不應將其視為穩定功能。

## 參考圖片

### 我可以附上多少張參考圖？

最多 5 個。

### 什麼格式效果最好？

使用JPEG或者PNG。瀏覽器路徑不直接支援 HEIC/HEIF，因此在附加這些影像之前先轉換。

### 如果參考影像太大怎麼辦？

該應用程式壓縮較大JPEG/PNG上傳前的文件。如果檔案仍然失敗，請降低解析度或將其轉換為JPEG/PNG然後再試一次。

這API可能會報告參考錯誤，例如`REF_TOO_MANY`, `REF_TOO_LARGE`, `REF_NOT_BASE64`， 或者`REF_EMPTY`.

## 網路和OAuth錯誤

### 為什麼後端換到了另一個連接埠？

`ima2-gen` 是本機應用程式。若首選後端連接埠 `3333` 已被佔用，執行環境會改用下一個可用連接埠，並把實際 URL 記錄在：

```text
~/.ima2/server.json
```

執行下面的命令查看設定的與實際的後端 URL：

```bash
ima2 doctor
```

GPT OAuth 不佔用本機連接埠，伺服器會直接呼叫 ChatGPT。

### 前後端分開開發時，如何指向實際的後端？

把 `ima2 doctor` 回報的後端 URL 傳給 Vite：

```bash
VITE_IMA2_API_TARGET=http://localhost:3334 npm run ui:dev
```

### 什麼是`failed to fetch`意思是？

通常是以下其中之一：

- GPT OAuth 無法連線到 `chatgpt.com`，
- 伺服器已重新啟動，
- VPN/代理/防火牆阻止了請求，
- 一個自動啟動的Windows網路攔截工具，包含DNS/片段
SecretDNS等繞過工具，已損壞OAuth或串流影像傳輸，
- 網路斷線了Codex/ChatGPT OAuth正在被使用。

嘗試：

```bash
ima2 doctor
ima2 ping
```

然後重新啟動`ima2 serve`如果需要的話。

### 我該分享什麼時候GPT OAuth圖像生成沒有返回圖像？

在採取適度措施之前使用影像探針。`EMPTY_RESPONSE`意味著
響應路徑未生成圖像數據`ima2-gen`可以使用；它可以是
引起的OAuth能力、流解析、網路搜尋/工具選擇行為、
本地代理/網路傳輸、不支援的選項或真正的拒絕。

首先運行這個：

```bash
ima2 doctor
ima2 doctor image-probe --json > ima2-image-probe.json
```

如果`ima2 serve`正在運行，還捕獲一隻搜尋關閉的貓和一隻正常的貓
生成結果：

```bash
ima2 gen "고양이" --model oauth/gpt-6-luna --no-web-search --json > ima2-cat-no-search.json
ima2 gen "고양이" --model oauth/gpt-6-luna --json > ima2-cat-current.json
```

探頭JSON旨在安全地附加到公共問題上。據報道
診斷代碼、事件計數、工具呼叫摘要和位元組計數，但不包括
提示文字、驗證令牌、憑證 URL 或 base64 影像資料。

打開問題時，請包括：

- `ima2 doctor`輸出。
- `ima2-image-probe.json`.
- `ima2-cat-no-search.json`和`ima2-cat-current.json`，如果你捕獲了它們。
- `ima2-gen`版本和 Windows 版本。
- 無論您使用 VPN、企業代理、防毒 TLS 檢查還是自訂 CA。
- 是否正在執行 SecretDNS 等 Windows DNS/碎片繞過工具
自動地。
- 無論`provider: "api"`在同一台機器上工作，如果您已經有API鍵已配置。

請勿分享ChatGPT餅乾,OAuth令牌文件，API鍵，原始上游
回應、提示歷史記錄或產生的 base64。

如何讀取結果：

- 文字探測失敗：刷新OAuth並首先檢查代理/模型的可用性。
- 文字有效，但最小的非流圖像失敗：可能的帳戶，OAuth後端、模型或影像工具功能。
- 非流影像有效，但流影像失敗：可能是流解析或傳輸。
- 搜尋關閉生成有效，但正常生成失敗：可能是網路搜尋/工具選擇互動。
- 已讀取位元組但未解析任何事件：可能SSE分隔符號或`data:`解析。

### 在代理或 VPN 後面反覆出現 `fetch failed` 怎麼辦？

GPT OAuth 請求由 `ima2 serve` 行程直接送往 `chatgpt.com`，所以關鍵是這個行程的網路路徑。

若你的網路需要代理，請開啟代理用戶端的 TUN/TURN 類模式，讓終端機行程也能走代理。在 Windows 上，也可以暫時關閉開機自動啟動的 DNS 或封包分割繞過工具（例如 SecretDNS）後重試。若仍然不行，請在啟動 `ima2 serve` 的終端機設定代理。Node.js 22.21+ 與 24+ 只有同時設定 `NODE_USE_ENV_PROXY=1` 才會讀取 `HTTPS_PROXY`（更早的版本兩者都會忽略，請改用 TUN 模式）：

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
export NODE_USE_ENV_PROXY=1
ima2 serve
```

請使用你的代理用戶端的主機與連接埠。若 `ima2-gen` 仍然失敗，請在開新 issue 前收集確切的命令、作業系統、代理設定與終端機錯誤。

### 我應該在公司計算機上檢查什麼？

GPT OAuth可能需要訪問OpenAI和ChatGPT/Codex相關主機。公司防火牆、TLS 檢查、VPN 或代理商可能會中斷流量。如果登入並嘗試不同的網絡`failed to fetch`錯誤不斷重複。

## SSE多路復用

### 為什麼網路UI使用單一SSE聯繫？

瀏覽器限制併發數HTTP到同一來源的連線（通常是 6 個）。一次產生多個影像時，每個生成請求都用於保持伺服器發送事件連線開啟。當多模式、節點和影片同時運行時，瀏覽器將耗盡連接，圖庫縮圖將掛起。

網路UI現在打開一個持久的`GET /api/events` SSE連接和所有生成進度都透過它進行重複使用。產生請求使用`async: true`並立即收到`202 { requestId }`響應，立即釋放連線。這CLI不受影響——它仍然使用每個請求SSE什麼時候`async`未設定。

### 如果發生什麼情況SSE連接掉線？

事件通道客戶端以指數退避自動重新連線。重新連接時，它發送`Last-Event-ID`因此伺服器可以從其環形緩衝區重播錯過的事件（最多 2000 個條目）。如果事件已從緩衝區中逐出，伺服器會傳送一個`replay-gap`事件，以便客戶端知道某些更新可能已遺失。

### 最大並發作業數是多少？

伺服器將並發生成作業限制在配置的值`limits.maxParallel`值（預設`24`，可覆蓋`IMA2_MAX_PARALLEL`）。收到額外請求`429`和`Retry-After: 5`。這SSE端點本身的並發連接數上限為 512 個。

## CLI故障排除清單

按順序運行這些：

```bash
ima2 doctor
ima2 status
ima2 ping
ima2 ps
ima2 setup
npm install -g ima2-gen@latest
```

如果您在非預設連接埠上執行伺服器：

```bash
IMA2_SERVER=http://localhost:3333 ima2 ping
```
