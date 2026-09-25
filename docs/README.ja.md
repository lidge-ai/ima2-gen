<p align="center">
  <img src="../assets/brand/banner.png" alt="ima2 — 人とコーディングエージェントのためのローカル画像・動画スタジオ" width="100%">
</p>

<h3 align="center">画像と動画を、自分のマシンで生成し、枝分かれさせ、仕上げる。</h3>
<p align="center">GPT、Grok、Gemini、NovelAI、ComfyUI をひとつにまとめたローカルスタジオです。<br>ブラウザ、Mac アプリ、CLI から使うことも、コーディングエージェントに任せることもできます。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ima2-gen"><img src="https://img.shields.io/npm/v/ima2-gen?style=flat-square&labelColor=18181b&color=3f3f46&logo=npm&label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/ima2-gen"><img src="https://img.shields.io/npm/dm/ima2-gen?style=flat-square&labelColor=18181b&color=3f3f46&label=downloads" alt="npm downloads"></a>
  <img src="https://img.shields.io/node/v/ima2-gen?style=flat-square&labelColor=18181b&color=3f3f46&logo=node.js&label=node" alt="Node.js version">
  <a href="https://github.com/lidge-ai/ima2-gen/stargazers"><img src="https://img.shields.io/github/stars/lidge-ai/ima2-gen?style=flat-square&labelColor=18181b&color=3f3f46&logo=github&label=stars" alt="GitHub stars"></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT-3f3f46?style=flat-square&labelColor=18181b" alt="MIT license"></a>
</p>

```bash
npm install -g ima2-gen
ima2 serve
```

<p align="center">
  <a href="https://github.com/lidge-ai/ima2-gen/releases?q=desktop&expanded=true"><img src="https://img.shields.io/badge/macOS-Apple%20Silicon%20.dmg-18181b?style=for-the-badge&logo=apple&logoColor=white" alt="Mac アプリをダウンロード (.dmg)"></a>
  <a href="#one-line-installers"><img src="https://img.shields.io/badge/Windows%20%C2%B7%20Linux-one--line%20installer-18181b?style=for-the-badge&logo=gnubash&logoColor=white" alt="Windows と Linux 向けワンライナーインストール"></a>
</p>

<table>
<tr>
<td width="42%" valign="middle">

### 作成

プロンプトを書き、参照画像を添えて、レーンとモデルを選ぶだけです。結果ごとにプロンプト、所要時間、設定が残るので、そのままコピーしたり、続きから作ったり、動画にしたりできます。

</td>
<td width="58%">
  <img src="../assets/screenshots/readme-create.webp" alt="ダークモードの作成画面。左にプロンプト入力、中央にクロームの彫刻、右に GPT OAuth 設定" width="100%">
</td>
</tr>
<tr>
<td width="42%" valign="middle">

### ノードグラフで枝分かれ

気に入った一枚を残したまま、複数の方向へ同時に広げられます。各ブランチは親を覚えているので、元画像が上書きされることはありません。

</td>
<td width="58%">
  <img src="../assets/screenshots/readme-node.webp" alt="クロームの彫刻から金、大理石、森の3つに分岐したノードグラフ" width="100%">
</td>
</tr>
<tr>
<td width="42%" valign="middle">

### Canvas Mode で仕上げ

注釈、消しゴム、背景除去を行い、本物のアルファチャンネルで書き出せます。GPT 透過ボタンは、サーバーが実際の透明度を確認してから結果を伝えます。

</td>
<td width="58%">
  <img src="../assets/screenshots/readme-canvas.webp" alt="市松模様の上に透過背景のカメラが置かれた Canvas Mode とツールバー" width="100%">
</td>
</tr>
<tr>
<td width="42%" valign="middle">

### ホームから始める

準備できたレーンを確認し、すぐにプロンプトを入力し、最近の作品をフォルダを探さずに再開できます。

</td>
<td width="58%">
  <img src="../assets/screenshots/readme-home.webp" alt="レーンの準備状況、プロンプト入力、最近の作品グリッドが並ぶホーム画面" width="100%">
</td>
</tr>
</table>

<p align="center">
  <a href="../README.md">English</a> · <a href="README.ko.md">한국어</a> · <b>日本語</b> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">正體中文</a> · <a href="https://lidge-ai.github.io/ima2-gen/"><b>Web サイト</b></a> · <a href="https://lidge-ai.github.io/ima2-gen/docs"><b>ドキュメント →</b></a>
</p>

`ima2-gen` は、人とコーディングエージェントが複数のプロバイダーで再現可能な画像・動画ワークフローを実行するための、ローカルファーストなビジュアル生成ランタイム兼スタジオです。自分のマシンで小さなサーバーを動かし、すべての成果物を `~/.ima2/generated` に保存し、接続したプロバイダーとだけ通信します。対応先は OpenAI OAuth/API、Grok OAuth/API、Antigravity CLI、Gemini API、AtlasCloud、MiniMax、NovelAI、登録済みの ComfyUI ワークフローで、Runway と Higgsfield は別の MCP 連携です。プロンプトと参照画像は、ジョブごとに選んだプロバイダーにだけ送られます。

## クイックスタート

### Mac アプリ (Apple Silicon)

デスクトップアプリは、同じローカルサーバーとスタジオを Mac のウィンドウとメニューバーアイコンで動かします。Developer ID で署名され Apple の公証を受けており、ランタイムを同梱しているので Node.js は不要です。

1. 最新の [ima2 Desktop リリース](https://github.com/lidge-ai/ima2-gen/releases?q=desktop&expanded=true) から `ima2-<version>-mac-arm64.dmg` をダウンロードします。
2. DMG を開き、**ima2** を **アプリケーション** フォルダへドラッグします。
3. ima2 を起動し、ウェルカム画面でプロバイダーを選びます。

チェックサム、アップデート、設定は [Mac アプリガイド](https://lidge-ai.github.io/ima2-gen/docs/desktop) にあります。Intel Mac、Windows、Linux では npm かワンライナーを使ってください。

### npm

```bash
npm install -g ima2-gen
ima2 setup
ima2 serve
```

その後 `http://localhost:3333` を開きます。`3333` が使用中なら次の空きポートで起動し、実際の URL を `~/.ima2/server.json` に書き込むので、`ima2 open` は常に正しいアドレスを開きます。

### CLI で最初の一枚

画像と動画のデフォルトを一度だけ決めてから生成します。

```bash
ima2 models
ima2 defaults set image oauth/gpt-5.6-luna
ima2 defaults set video grok/grok-imagine-video-1.5
ima2 gen "a clean product photo of a red guitar pedal"
ima2 video "a cat playing piano" --duration 5 --resolution 720p
```

`ima2 gen` と生成モードの `ima2 video` は、CLI の対象が決まるまで `NO_DEFAULT_MODEL` で停止します。呼び出しに `--model <lane>/<model>` か `--provider <lane>` を明示した場合は例外です。アップグレードでプロバイダーや課金レーンが勝手に切り替わることはありません。

<a id="one-line-installers"></a>

### ワンライナーインストール (npm 不要)

各スクリプトはパッケージが定める Node.js の最低バージョンを確認し、必要なら Node LTS を入れ、ima2-gen を一度インストールし、オフラインのインストール検査を通してから `ima2 serve` を起動します。無関係なプロセスを止めたり、グローバルロックを消したりはしません。

**macOS**

```bash
curl -fsSL https://lidge-ai.github.io/ima2-gen/install-mac.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://lidge-ai.github.io/ima2-gen/install-windows.ps1 | iex
```

**Linux / WSL**

```bash
curl -fsSL https://lidge-ai.github.io/ima2-gen/install-linux.sh | bash
```

<details>
<summary><b>Docker</b></summary>

```bash
docker build -t ima2-gen .
docker run -d -p 3333:3333 -e IMA2_LAN_TOKEN=change-me -v ima2-data:/data ima2-gen
```

compose の使い方、必要な環境変数、制限は [DOCKER ドキュメント](DOCKER.md) を参照してください。

</details>

<details>
<summary><b>セットアップ、アップデート、npx</b></summary>

`ima2 setup` では4つの認証方法から選べます。

1. **GPT OAuth** — ChatGPT アカウントでログイン (画像)
2. **Grok OAuth** — xAI/Grok アカウントでログイン (画像と動画)
3. **Both** — GPT OAuth と Grok OAuth の両方
4. **Web setup** — Web UI ですべて設定

動画生成には Grok OAuth (2 か 3) が必要です。すでに GPT OAuth を使っている場合は `ima2 grok login` で動画を追加できます。既定は手動貼り付け方式です。

アップデートするには Ctrl+C でサーバーを止め (別のターミナルなら `ima2 stop`)、次を実行します。

```bash
npm install -g ima2-gen@latest
```

Ctrl+C はデータベースを閉じ、子プロセスを止め、ファイルロックを解放してきれいに終了します。インストールに失敗したら npm の権限メッセージを確認するか、該当する `ima2` プロセスを自分で止めてください。インストーラーがプロセスを一括で片付けることはありません。

npx で使う場合は [npx クイックスタート](NPX_QUICKSTART.md) を参照してください。

</details>

## できること

- **作成**: 生成、編集、現在の画像の再利用、参照画像の貼り付け、履歴からの続き。マルチモードをオンにすると、ひとつのプロンプトから複数の候補を同時に走らせ、枠ごとに埋まっていく様子を見られます。すべてのコントロール、マルチモードのレシピ、Direct モード、reasoning effort は [Prompt Studio マニュアル](PROMPT_STUDIO.md) にまとまっています。 参照画像は画像生成で最大5枚、動画で最大14枚まで添付でき、大きな画像はアップロード前に圧縮されます。
- **ノードグラフ**: 良い画像を複数の方向へ枝分かれさせます。ルートノードはローカルの参照画像を、子ノードは親の画像を元にします。完了したジョブはリクエスト ID でノードに戻されるので、リロードやグラフのバージョン競合があっても結果は失われません。
- **Canvas Mode**: ズーム、パン、ホバーでハイライトされる注釈、消しゴム、グループ、元に戻す、付箋、背景の整理、アルファ保持またはマット色での書き出し。自己完結したキャンバス文書には **SVG (embedded raster)**、本物のベクターパスには **Trace to SVG (vector)** を選びます。**GPT transparency** ボタンは OAuth i2i レーンで背景を消し、デコードしたバイトから `alphaVerified` を報告します。 保存したキャンバスのバージョンはギャラリーと履歴ストリップには出ませんが、Canvas Mode で開き直したり、次の参照画像として添付したりできます。
- **動画**: Grok の動画モデルでテキスト→動画、画像→動画、参照→動画を作成し、進捗表示と First/Mid/Last フレームのコピーボタンを備えます。**Storyboard mode** は連続するフレームで人物とシーンの一貫性を保ちます。 進捗は SSE で planning → submitted → 進捗率 → done の順に表示されます。ストーリーボードでは画像のキーフレームを動画制作向けに構成し、動画クリップは人物と環境の固定ルールを引き継ぎます。
- **ラスター→ベクター**: `ima2 vectorize`、AssetGen/Assets、Canvas の書き出しから、フラットなラスター画像を本物の SVG パスに変換します。
- **NovelAI のデュアルプロンプト**: NovelAI を選ぶと、作成、ホーム、モバイルの作成シートに **Positive prompt** と **Undesired content** が並んで表示されます。 作成エリアが 719px より狭いときは上下に積み重なります。
- **プロンプトライブラリ**: ローカルのプロンプトパック、GitHub フォルダ、厳選した GPT-image ヒントを取り込み、ローカルで検索できます。
- **Prompt Builder**: テキストバックエンドで意図を磨きます。Settings > Providers で Auto のままにするか、バックエンドとモデルを固定でき、**via &lt;backend&gt;** バッジが実際に応答したバックエンドを示します。 GPT バックエンドを選んだときの既定モデルは `gpt-5.6-luna` です。
- **ローカルギャラリー**: すべての画像と動画が手元に残り、セッション別の履歴、生成時間、reasoning effort がメタデータに記録されます。 既定では現在のセッションだけを表示し、All Images トグルで全履歴を開けます。選んだ既定の範囲はセッションをまたいで維持されます。
- **ライト・ダークテーマ**: AA コントラストを守るトークンベースのパレットで、ライト・ダーク・システムをちらつきなく切り替えられます。
- **モバイルシェル**と**ジョブの可視化**: 小さな画面向けのアプリバー、作成シート、コンパクトな設定トグル、安全なログとリクエスト ID 付きの実行中・最近のジョブ一覧。

Card News は開発用の実験機能で、公開ランタイムでは非表示です。

### エージェントスキル

ima2-gen には、コーディングエージェントが読み込む Markdown スキルが3つ同梱されています。画像・動画生成、フロントエンド用アセット、デザインの方向性探しを手順立てて案内します。

| スキル | コマンド | 内容 |
|------|------|------|
| **Core** | `ima2 skill` | CLI リファレンス、プロンプトの書き方、プロバイダーの振り分け、韓国語テキスト、動画ワークフロー |
| **Frontend** | `ima2 skill front` | アセットパイプライン (並列生成、候補選択、プロバイダーの振り分け)、Web 向けモーションと動画、レスポンシブ、アクセシビリティ、anti-slop、30以上の参照ファイル |
| **UI/UX Design** | `ima2 skill uiux` | 画像起点のデザイン方向探索、UX の状態、design-ism、プロダクトの性格、DESIGN.md ワークフロー、21の参照ファイル |

```bash
ima2 skill ls                   # スキル一覧
ima2 skill front path          # ファイルパスを表示 (エージェント向け)
ima2 skill front --json        # JSON ラッパー (エージェント向け)
ima2 skill front refs           # 参照モジュール一覧
ima2 skill front ref motion     # 参照モジュールをひとつ読み込む
ima2 skill install --dir <path> # エージェントのスキルフォルダにインストール
ima2 skill install --tmp        # 一時フォルダにインストール (代替)
```

## プロバイダーとモデル

| レーン | 認証 | 画像 | 動画 | メモ |
|---|---|:-:|:-:|---|
| `oauth` | ローカル Codex OAuth プロキシ経由の ChatGPT ログイン | ✓ | | 既定のレーン、`gpt-5.6-luna` |
| `api` | `OPENAI_API_KEY` | ✓ | | Responses API の `image_generation` ツール、マスク・マルチモード・ノード |
| `grok` | xAI OAuth (`ima2 grok login`) | ✓ | ✓ | Images API の前に Web 検索とプランナー |
| `grok-api` | `XAI_API_KEY` | ✓ | ✓ | xAI Images API を直接呼び出し |
| `gemini-api` | `GEMINI_API_KEY` または Vertex サービスアカウント | ✓ | | `nano-banana-2`、`nano-banana-pro`、512px〜4K |
| `agy` | Antigravity CLI | ✓ | | `agy -p` で Gemini `nano-banana-2` / `nano-banana-pro` |
| `nai` | NovelAI API トークン | ✓ | | NAI Diffusion モデル4種、テキスト→画像 |
| `comfy` | ローカル ComfyUI | ✓ | ✓ | 登録済みの画像・動画ワークフロー |
| `atlascloud` | AtlasCloud API キー | ✓ | | `openai/gpt-image-2` の生成と編集 |
| `minimax` | MiniMax API キー | ✓ | | `image-01`、`image-01-live` |
| `runway`、`higgsfield` | MCP 接続 | ✓ | ✓ | 別の MCP 連携 |

GPT レーンの既定の画像モデルは **`gpt-5.6-luna`** です。`gpt-6-astra` は最新の GPT 画像モデルとして選択でき、`gpt-5.6-terra` と `gpt-5.6-sol` はアカウントで使える場合に表示されます。`gpt-5.5`、`gpt-5.4`、`gpt-5.4-mini` は互換用に残っています。アプリでは品質 (`low`、`medium`、`high`) とモデレーション (`auto`、`low`) も選べます。

<details>
<summary><b>プロバイダーの詳細 (English)</b></summary>

- `provider: "oauth"` uses the local Codex OAuth proxy.
- `provider: "api"` calls the OpenAI Responses API with the hosted `image_generation` tool.
- `provider: "grok"` calls `https://api.x.ai` directly with the xAI OAuth session stored in `~/.progrok/auth.json`, running mandatory xAI Web Search plus a planner pass (default: `grok-4.3`, configurable in settings or via `--planner-model`) before the xAI Images API call. `grok-4.5` and `grok-4.6` are also selectable. Log in once with `ima2 grok login` or the Settings **Switch Account** button; the session refreshes itself two minutes before expiry.
- `provider: "grok-api"` calls the xAI Images API directly with `XAI_API_KEY` (no OAuth session involved).
- `provider: "nai"` calls the NovelAI image API with a persistent API token (saved in Settings > API Keys or `NOVELAI_API_KEY`; no fixed token prefix is required). Four models: `nai-diffusion-5-full`, `nai-diffusion-5-curated`, `nai-diffusion-4-5-full`, `nai-diffusion-4-5-curated`. Responses arrive as a ZIP archive that ima2 decodes to PNG. Text-to-image only — reference images, edits, and masks are refused rather than silently dropped. Browser and CLI surfaces expose negative prompt, sampler/schedule, steps/guidance/CFG rescale, seed, presets, Auto SMEA, Decrisper, Variety+, and V5 alpha.
- `provider: "agy"` spawns the Antigravity CLI (`agy -p`) to generate images via Google Gemini's `default_api:generate_image` tool (models: `nano-banana-2` and `nano-banana-pro`). Output is fixed at 1024×1024 JPEG, max 3 reference images. No web search, quality, or size controls.
- `provider: "gemini-api"` calls the Google Generative Language API directly. Supports two models: `nano-banana-2` (Gemini 3.1 Flash Image) and `nano-banana-pro` (Gemini 3 Pro Image). Auth is via `GEMINI_API_KEY` env var, web UI key management, or a Vertex AI service account JSON (`VERTEX_SERVICE_ACCOUNT_JSON`). When both an API key and Vertex credentials are configured, Vertex takes priority. Supports variable aspect ratios (1:1 through 21:9) and four resolution tiers (512px, 1K, 2K, 4K); these controls are only honored on the direct API path — the Vertex AI endpoint ignores aspect/size because it does not accept the `response_format` field. Per-model cost differs: `nano-banana-2` (Flash): 512=$0.001, 1K=$0.003, 2K=$0.004, 4K=$0.006; `nano-banana-pro`: 1K=$0.007, 2K=$0.007, 4K=$0.013. No web search or mask controls.
- API-key generation supports classic generate, edit, mask-guided edit, multimode, and node generation.
- Grok generation supports Classic, Node, and Agent flows. If a Classic reference, Node parent image, or Agent current image is present, ima2 switches the final Grok call to xAI image edit so image-to-image context is preserved.

If no provider is specified, the app keeps the current GPT OAuth/default behavior. GPT OAuth and API-key generation default to `gpt-5.6-luna`; the API-key path also defaults to `low` reasoning and `1024x1024` unless the request passes validated options. Grok image generation defaults to `grok-imagine-image-2.0`.

One caveat on the OAuth Grok lane: xAI documents only `/v1/me` as accepting an OAuth token, so image and video calls to `api.x.ai` with that token ride an undocumented path. It works today — progrok relied on the same path — but it carries no compatibility promise. If xAI closes it, `provider: "grok-api"` with `XAI_API_KEY` is the documented route and stays unaffected.

Grok image generation exposes a Fast/Best model picker (`grok-imagine-image` / `grok-imagine-image-quality`; new sessions start on `grok-imagine-image-2.0`) and a size picker (aspect ratio + 1k/2k resolution). The Settings page prefers the Grok Build weekly credits percentage and reset time from `GET /v1/billing?format=credits`; if that source is unavailable, it falls back to the legacy monthly billing window and `$used/$limit`. A **Switch Account** button starts a device-code OAuth flow (`POST /api/auth/switch`) for re-authenticating without leaving the app.

Grok video generation defaults to canonical `grok-imagine-video-1.5`; `grok-imagine-video` remains available for base-model-only Ref2V, V2V edit, and extension paths, and the legacy `grok-imagine-video-1.5-preview` string is accepted as an alias. Three modes are auto-detected from reference count: text-to-video (0 refs), image-to-video (1 ref), and reference-to-video (2-14 refs; up to 15s on grok-imagine-video-1.5, 10s on grok-imagine-video). 1080p is available for `grok-imagine-video-1.5` prompt-only text-to-video and single image/frame image-to-video; prompt-only 1.5 uses the internal white-canvas I2V shim before the upstream request. Video controls include duration (1-15s), resolution (480p, 720p, 1080p when supported), and aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, auto).

</details>

## CLI

<details>
<summary><b>サーバーコマンド (English)</b></summary>

| Command | Description |
|---|---|
| `ima2 serve [--dev]` | Start the local web server; `--dev` enables verbose server diagnostics |
| `ima2 stop [--force]` | Stop the running server safely — graceful admin-API stop first, then SIGTERM/SIGKILL; verifies the advertised pid against `/api/health` so a recycled pid is never killed |
| `ima2 service <sub>` | Background service: `install`/`uninstall`/`start`/`stop`/`restart`/`status`/`logs`/`repair` — launchd on macOS, systemd user unit on Linux, auto-start on login with crash restart |
| `ima2 setup` | Reconfigure saved auth |
| `ima2 status` | Show config and OAuth status |
| `ima2 doctor` | Diagnose Node, package, config, and auth |
| `ima2 doctor image-probe [--json]` | Run sanitized image probes for no-image diagnostics |
| `ima2 open` | Open the web UI |
| `ima2 reset` | Remove saved config |

</details>

<details>
<summary><b>クライアントコマンド (English)</b></summary>

These require a running `ima2 serve`. The CLI covers every server route. The most common ones are below — the [full CLI reference](CLI.md) lists everything (generation, history, sessions, prompt library, annotations, Card News, observability, config).

| Command | Description |
|---|---|
| `ima2 models [--kind image\|video] [--lane <lane>] [--json]` | List live lanes, status, model IDs, and capabilities |
| `ima2 defaults set image\|video <lane>/<model>` | Persist the fail-closed CLI target for image or video generation |
| `ima2 defaults reset image\|video` | Remove a persisted CLI generation target |
| `ima2 gen <prompt> [--model <lane>/<model>]` | Generate from the CLI; requires an explicit target or saved image default |
| `ima2 edit <file> --prompt <text>` | Edit an existing image |
| `ima2 vectorize <input.png> [-o output.svg]` | Trace PNG/JPEG/WebP into a real SVG locally; no server or provider required |
| `ima2 prompt build --message <text> [--backend <backend>] [--model <model>]` | Refine prompt intent through the configured or explicitly selected Prompt Builder backend; requires the local server |
| `ima2 multimode <prompt>` | Multi-image SSE generation |
| `ima2 video <prompt> [--model <lane>/<model>]` | Generate video through a Grok or MCP lane; requires an explicit target or saved video default |
| `ima2 ls [--session <id>] [--favorites]` | List recent history |
| `ima2 show <name> [--metadata]` | Reveal a generated asset |
| `ima2 prompt ls -q <search>` | Search the prompt library |
| `ima2 inflight ls [--terminal]` | List active and recent jobs (alias of `ps`) |
| `ima2 config set <key> <value>` | Write to `~/.ima2/config.json` |
| `ima2 ping` | Health-check the running server |

The server advertises its actual port at `~/.ima2/server.json`. If `3333` is busy, the backend falls back to `3334+` and CLI commands follow the advertised URL. Override discovery with `--server <url>` or `IMA2_SERVER=http://localhost:3333`.

```bash
ima2 models --kind image
ima2 gen "poster" --model oauth/gpt-5.6-luna --reasoning-effort high
ima2 gen "1girl, blue hair" --model nai/nai-diffusion-5-full --nai-negative-prompt "lowres, watermark"
ima2 vectorize logo.png -o logo.svg --json
ima2 prompt build --message "Make this prompt production-ready" --backend auto --model auto
ima2 edit input.png --prompt "make it rainy" --web-search
ima2 multimode "two cats playing" -n 2
ima2 video "a cat playing piano" --model grok/grok-imagine-video-1.5 --duration 5 --resolution 720p
ima2 video "animate this" --model grok/grok-imagine-video-1.5 --ref photo.png --aspect-ratio 16:9
ima2 inflight ls --terminal
ima2 config set imageModels.reasoningEffort high
```

Full reference: [CLI.md](CLI.md).

</details>

## 設定

設定の優先順位は `環境変数 > ~/.ima2/config.json > 既定値` です。Prompt Builder の設定は `promptBuilder.backend` (`auto`、`oauth`、`grok`、`api`、`grok-api`) と `promptBuilder.model` に保存されます。Auto では GPT OAuth、Grok、OpenAI API、Grok API の順に試し、最初に準備できたレーンを使います。明示的に選んだバックエンドは固定され、使えないときは型付きのエラーを返します。

<details>
<summary><b>環境変数 (English)</b></summary>

| Variable | Default | Description |
|---|---:|---|
| `IMA2_PORT` / `PORT` | `3333` | Web server port |
| `IMA2_HOST` | `127.0.0.1` | Web server bind host |
| `IMA2_OAUTH_PROXY_PORT` / `OAUTH_PORT` | `10531` | OAuth proxy port |
| `IMA2_SERVER` | — | CLI target override |
| `IMA2_CONFIG_DIR` | `~/.ima2` | Config and SQLite location |
| `IMA2_ADVERTISE_FILE` | `~/.ima2/server.json` | Runtime discovery file |
| `IMA2_GENERATED_DIR` | `~/.ima2/generated` | Generated image directory |
| `IMA2_IMAGE_MODEL_DEFAULT` | `gpt-5.6-luna` | Server fallback image model |
| `IMA2_PROMPT_BUILDER_BACKEND` | `auto` | Prompt Builder text backend (`auto`, `oauth`, `grok`, `api`, or `grok-api`); Settings persists the same value as `promptBuilder.backend` |
| `IMA2_PROMPT_BUILDER_MODEL` | `auto` with Auto backend | Backend-scoped Builder model; Settings persists the same value as `promptBuilder.model` |
| `IMA2_REASONING_EFFORT` | `medium` | Default reasoning effort for the default (GPT OAuth) path; one of `none`, `low`, `medium`, `high`, `xhigh` |
| `IMA2_NO_OAUTH_PROXY` | — | Set `1` to disable the auto-started OAuth proxy |
| `IMA2_LOG_LEVEL` | `info` | Normal serve defaults to `info`; dev mode defaults to `debug`; supports `debug`, `info`, `warn`, `error`, or `silent` |
| `IMA2_INFLIGHT_TERMINAL_TTL_MS` | `300000` | Recent terminal job retention for debug views |
| `OPENAI_API_KEY` | — | API key for the `provider: "api"` Responses API image path and auxiliary API-key features |
| `XAI_API_KEY` | — | API key for `provider: "grok-api"` direct xAI Images API path |
| `NOVELAI_API_KEY` | — | NovelAI persistent API token for `provider: "nai"` |
| `IMA2_NAI_IMAGE_MODEL_DEFAULT` | `nai-diffusion-5-full` | Default NovelAI image model |
| `IMA2_NAI_DEFAULT_AUTO_SMEA` | `false` | Default NovelAI Auto SMEA state |
| `IMA2_NAI_DEFAULT_DECRISPER` | `false` | Default NovelAI Decrisper (`dynamic_thresholding`) state |
| `IMA2_API_IMAGE_MODEL_DEFAULT` | `gpt-5.6-luna` | Default image model for `provider: "api"` |
| `IMA2_API_REASONING_EFFORT` | `low` | Default reasoning effort for `provider: "api"` |
| `IMA2_API_IMAGE_SIZE` | `1024x1024` | Default size for `provider: "api"` |
| `IMA2_API_ALLOW_WEB_SEARCH` | `true` | Toggle web search for `provider: "api"` |
| `IMA2_GROK_PLANNER_MODEL` | `grok-4.3` | Grok search/planner model; `grok-4.5`, `grok-4.6` and GPT planners are selectable (settings UI or `--planner-model`) |
| `IMA2_GROK_PLANNER_TIMEOUT_MS` | `900000` | Timeout for the Grok planner call |
| `IMA2_GROK_SEARCH_TIMEOUT_MS` | `300000` | Timeout for the Grok web-search brief (degrades instead of failing) |
| `IMA2_GROK_VIDEO_PLAN_TOTAL_TIMEOUT_MS` | `1500000` | Ceiling on the whole video planning phase (clamped above search + planner) |
| `IMA2_GROK_IMAGE_MODEL_DEFAULT` | `grok-imagine-image-2.0` | Default final Grok image model |
| `IMA2_GROK_VIDEO_MODEL_DEFAULT` | `grok-imagine-video-1.5` | Default Grok video model |
| `IMA2_GROK_GENERATION_TIMEOUT_MS` | `300000` | Timeout for the final Grok Images API call |
| `IMA2_OAUTH_MASKED_EDIT_ENABLED` | `false` | Opt-in feature flag for masked-edit requests on the OAuth path (#31, groundwork only) |
| `GEMINI_API_KEY` | — | API key for `provider: "gemini-api"` direct Generative Language API path |
| `VERTEX_SERVICE_ACCOUNT_JSON` | — | Google service account JSON for Vertex AI auth with `provider: "gemini-api"`; takes priority over `GEMINI_API_KEY` when both are set |
| `IMA2_AGY_BIN` | `agy` on PATH | Explicit path to the Antigravity CLI binary for `provider: "agy"` |
| `IMA2_MAX_PARALLEL` | `24` | Server-wide parallel generation cap |

`IMA2_GROK_PROXY_HOST`, `IMA2_GROK_PROXY_PORT`, `IMA2_NO_GROK_PROXY`, and `IMA2_GROK_RESTART_*` were removed in 3.16 together with the local Grok proxy; they are no longer read, and setting them is harmless.

</details>

<details>
<summary><b>ログモード (English)</b></summary>

`ima2 serve` keeps terminal output intentionally quiet: startup URLs, warnings, and errors stay visible, while request/node/OAuth structured logs are hidden by default.

Use `ima2 serve --dev`, `npm run dev`, or `IMA2_LOG_LEVEL=debug ima2 serve` when you need request IDs, node generation phases, OAuth stream diagnostics, or inflight state transitions. Explicit `IMA2_LOG_LEVEL` and `~/.ima2/config.json` values still override the built-in defaults.

</details>

## トラブルシューティング

<details>
<summary><b><code>ima2 ping</code> がサーバーにつながらない</b></summary>

先に `ima2 serve` を起動し、`~/.ima2/server.json` を確認してください。`ima2 ping --server http://localhost:3333` で直接指定することもできます。

</details>

<details>
<summary><b>GPT OAuth でログインできない</b></summary>

`ima2 setup` を再実行し (1番)、`ima2 status` を確認してから `ima2 serve` を再起動してください。

</details>

<details>
<summary><b>プロキシ/VPN 環境で <code>fetch failed</code> が繰り返される</b></summary>

ローカルの OAuth プロキシに到達できるか確認してください。プロキシが必要なネットワークでは、プロキシクライアントの TUN/TURN 系モードを有効にしてから `openai-oauth --port 10531` を再試行します。それでも失敗する場合は、`ima2 serve` または `openai-oauth` を実行する同じターミナルで `HTTP_PROXY` と `HTTPS_PROXY` を設定してください。Windows では SecretDNS のような DNS・パケット分割回避ツールを含む、自動起動のネットワーク傍受ツールも確認してください。ブラウザがつながって見えても、OAuth や画像のストリーミングが壊れることがあります。

</details>

<details>
<summary><b><code>API_KEY_REQUIRED</code> で失敗する</b></summary>

`provider: "api"` を使うには `OPENAI_API_KEY` を設定するか API キーを登録してください。既定の GPT OAuth 経路は API キーなしで動きます。

</details>

<details>
<summary><b><code>EMPTY_RESPONSE</code> が返る、または画像データがない</b></summary>

`ima2 doctor image-probe --json > ima2-image-probe.json` を実行し、サニタイズ済みの JSON を Issue に添付してください。GPT OAuth の場合は、`ima2 serve` を起動した状態で `ima2 gen "고양이" --model oauth/gpt-5.6-luna --no-web-search --json` と `ima2 gen "고양이" --model oauth/gpt-5.6-luna --json` の結果も残してください。ChatGPT の Cookie、OAuth token ファイル、API キー、生のアップストリーム応答、プロンプト履歴、生成された base64 は共有しないでください。詳しくは [FAQ のサポートバンドル](FAQ.md#what-should-i-share-when-gpt-oauth-image-generation-returns-no-image) を参照してください。

</details>

<details>
<summary><b>大きな参照画像が失敗する</b></summary>

大きな JPEG/PNG はアップロード前に自動で圧縮されます。それでも失敗する場合は、解像度を下げた JPEG か PNG に変換して再試行してください。ブラウザ経路では HEIC/HEIF に対応していません。

</details>

<details>
<summary><b>アップデート後に以前のギャラリー画像が見えない</b></summary>

最近のバージョンは生成画像をインストール先のパッケージフォルダから `~/.ima2/generated` へ移しました。`ima2 doctor` を実行し、[以前の画像の復旧](RECOVER_OLD_IMAGES.md) を参照してください。

</details>

<details>
<summary><b><code>gpt-5.5</code> だけ失敗し、他のモデルは動く</b></summary>

まず Codex CLI を更新して再試行してください。それでも失敗する場合、アカウントやバックエンド経路で `gpt-5.5` の画像機能や上限がまだ開放されていない可能性があるので、安定した代替として `gpt-5.4` を使ってください。

</details>

<details>
<summary><b>アプリが別のポートで開いた</b></summary>

要求したポートが使用中だと次の空きポートで起動し、`~/.ima2/server.json` に記録します。ポートが予期せず `3457` なら、シェルが別のローカルツールから `PORT=3457` を引き継いでいる可能性があります。`unset PORT` を実行するか、`IMA2_PORT=3333 ima2 serve` で起動してください。

</details>

<details>
<summary><b>Windows でポート <code>10531</code> が使用中</b></summary>

`AnySign4PC.exe` などの Windows セキュリティツールが既定の OAuth プロキシポートを占有することがあります。最新のビルドは実際に使われた代替ポートを追跡します。手動で変える場合は `IMA2_OAUTH_PROXY_PORT=11531 ima2 serve` で起動し、`ima2 doctor` を確認してください。

</details>

その他の回答は [FAQ](FAQ.md) にあります。

## ドキュメント

- [開発者ドキュメントサイト](https://lidge-ai.github.io/ima2-gen/docs) — 概要、クイックスタート、アーキテクチャ、モード、プロバイダー、CLI、設定、サーバー API
- [CLI リファレンス](CLI.md) · [API リファレンス](API.md) · [Prompt Studio](PROMPT_STUDIO.md) · [FAQ](FAQ.md) · [以前の画像の復旧](RECOVER_OLD_IMAGES.md)

## 開発

```bash
git clone https://github.com/lidge-ai/ima2-gen.git
cd ima2-gen
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run dev` は UI をビルドし、TypeScript サーバーを `--watch` と詳細な診断ログで起動します。`npm run typecheck`、`npm run build:server`、`npm run build:cli` で TypeScript のビルド経路を確認できます。 Node mode と Canvas Mode は既定でパッケージ UI に含まれています。

Web UI はすべての進捗を `GET /api/events` の Server-Sent Events 接続ひとつで受け取ります。マルチモード、ノード、動画のリクエストは非同期 POST (`202 { requestId }`) で送られ、共有イベントバスで多重化されるので、同時実行のジョブがブラウザの接続数上限6に引っかかることはありません。`async: true` を送らない CLI クライアントは、これまでどおりリクエストごとの SSE ストリームを受け取ります。

### 動作要件

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

インストーラーはパッケージのメタデータから Node.js の最低バージョンを読み取り、サーバーを起動する前にオフラインのインストール検査を行います。

<details>
<summary><b>デスクトップアプリのビルド (Electron, English)</b></summary>

`desktop/` wraps the same local server and UI in a menubar/tray app for macOS, Windows, and Linux. It supervises `server.js` as a child process (attaching to an already-running server on the configured port instead of starting a second one) and adds a native settings window: port, open at login, start hidden, menubar-only (macOS), keep-server-on-close, log level, config directory.

```bash
cd desktop
npm install
npm run prepare:app     # builds server + CLI + UI at the repo root
npm start               # run unpackaged
npm run dist:mac        # dmg + zip (Apple Silicon / arm64)
npm run dist:win        # nsis + zip
npm run dist:linux      # AppImage + deb
```

Only the macOS app is distributed today, for Apple Silicon. `.github/workflows/desktop.yml` runs in three ways: a push to `dev` builds an unsigned macOS validation build, a manual dispatch builds signed and notarized installers without publishing anything, and a `desktop-v*` tag push builds, verifies, and publishes the desktop release. Trusted macOS builds require `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`; missing or invalid authentication fails the build instead of producing an unsigned success.

For a signed macOS verification build without publishing, run:

```bash
gh workflow run desktop.yml --ref <reviewed-branch> -f platform=mac
```

The workflow verifies Developer ID, team, architecture (arm64), hardened runtime, secure timestamp, nested signatures, Gatekeeper and stapled notarization tickets. It checks the apps recovered from the final ZIP and DMG against the original signed content, then exports `ima2-macos-signature-proof` reports and installer SHA-256 hashes. Failed verification blocks installer upload. Only a `desktop-v*` tag push creates and publishes a release.

Signing credential imports run on disposable GitHub-hosted macOS. The builder cleans successfully imported keychains; if import/setup fails before its cleanup registration, runner destruction is the final cleanup boundary. Local recovery should reuse an existing login-keychain identity in the same unlocked session, rather than importing credential packages into a persistent machine. This does not require changing automatic locking or key access rules.

Windows Authenticode remains separate and uses `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`; Windows builds without them are unsigned.

</details>

## コントリビューター

- [@lidge-jun](https://github.com/lidge-jun) — maintainer
- [@ree9622](https://github.com/ree9622) — moderation controls, Windows fixes, structured logging
- [@Charley-Peng](https://github.com/Charley-Peng) — API cache fix (#74)
- [@philiptaron](https://github.com/philiptaron) — Nix flake (#81)
- [@aorying](https://github.com/aorying) — upstream validation error surfacing (informed TS migration direction)
- [@PARKJONGMlN](https://github.com/PARKJONGMlN) — batch comparison matrix design (#80)

## ライセンス

MIT
