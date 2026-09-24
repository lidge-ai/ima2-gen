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

インストーラーはパッケージメタデータから Node.js の最低バージョンを読み、サーバー起動前にオフライン検査を行います。

<p align="center">
  <img src="../assets/logo.png" alt="ima2" width="160">
</p>

<p align="center">
  <strong>人とコーディングエージェントのためのローカル画像・動画スタジオ。</strong>
</p>

[![npm version](https://img.shields.io/npm/v/ima2-gen)](https://www.npmjs.com/package/ima2-gen)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

> **Live site**: [lidge-jun.github.io/ima2-gen](https://lidge-jun.github.io/ima2-gen/) · [한국어](https://lidge-jun.github.io/ima2-gen/ko/)
>
> **開発者ドキュメント**: [ドキュメントサイト](https://lidge-jun.github.io/ima2-gen/docs) · [한국어](https://lidge-jun.github.io/ima2-gen/ko/docs)
>
> **他の言語で読む**: [English](../README.md) · [한국어](README.ko.md) · [正體中文](README.zh-TW.md) · [简体中文](README.zh-CN.md)

`ima2-gen` は、人とコーディングエージェント向けのローカルファーストなビジュアル生成ランタイム兼スタジオです。複数プロバイダーで再現可能な画像・動画ワークフローを扱います。

グローバルインストール後、OpenAI OAuth/API、Grok OAuth/API、Antigravity CLI、Gemini API、AtlasCloud、MiniMax、NovelAI、ComfyUI ワークフローの 10 の core lane で画像と動画を生成できます。Runway と Higgsfield は別枠の MCP integration です。

![プロンプト入力、生成画像、モデル表示、結果メタデータが見える ima2-gen classic 画面](../assets/screenshots/classic-generate-light.png)

## Quick Start

### Mac アプリ (Apple Silicon)

Apple Silicon の Mac ではデスクトップアプリが一番手早い方法です。同じローカルサーバーとスタジオを Mac のウィンドウとメニューバーアイコンで動かし、Apple の署名と公証を受けています。

1. 最新の [ima2 Desktop リリース](https://github.com/lidge-jun/ima2-gen/releases?q=desktop&expanded=true) から `ima2-<version>-mac-arm64.dmg` をダウンロードします。
2. DMG を開き、**ima2** を **アプリケーション** フォルダへドラッグします。
3. ima2 を起動し、ウェルカム画面でプロバイダーを選びます。

ランタイムを同梱しているので Node.js のインストールは不要です。チェックサム、アップデート、設定は [Mac App ガイド](https://lidge-jun.github.io/ima2-gen/docs/desktop) を参照してください。Intel Mac、Windows、Linux では下の npm かワンクリックインストールを使います。

### npm

```bash
npm install -g ima2-gen
ima2 setup
ima2 serve
```

その後、`http://localhost:3333` を開きます。

CLI で動画生成:

```bash
ima2 video "猫がピアノを弾く" --duration 5 --resolution 720p
ima2 video "このシーンをアニメ化" --ref photo.png --duration 10
```

`3333` がすでに使われている場合、次に空いているポートで起動し、実際の URL は `~/.ima2/server.json` に書き込まれます。ポートを決め打ちせず、terminal に表示された URL または `ima2 open` を使ってください。

> **npx を使いたい場合は?** [NPX_QUICKSTART.md](NPX_QUICKSTART.md) を参照してください。

### ワンクリックインストール（npm 不要）

Node.js や npm がなくても、プラットフォーム用インストールスクリプトが環境を検出し、必要なら Node LTS を入れてから ima2-gen をインストールします。

**macOS:**
```bash
curl -fsSL https://lidge-jun.github.io/ima2-gen/install-mac.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://lidge-jun.github.io/ima2-gen/install-windows.ps1 | iex
```

**Linux / WSL:**
```bash
curl -fsSL https://lidge-jun.github.io/ima2-gen/install-linux.sh | bash
```

各スクリプトは対応する Node バージョンを確認し、必要に応じて nvm/fnm/brew/winget で Node LTS を入れます。npm のインストールは一度だけ試し、`ima2 doctor --installation --json` が成功してからサーバーを起動します。プロセスの強制終了やグローバルロックの削除は行いません。

### セットアップ

`ima2 setup` では認証方式を4つ選べます:

1. **GPT OAuth** — ChatGPT アカウントでログイン（無料、画像のみ）
2. **Grok OAuth** — xAI/Grok アカウントでログイン（画像 + 動画）
3. **Both** — GPT + Grok 両方（全機能）
4. **Web setup** — Web UI で設定

動画生成には Grok OAuth（2 または 3）が必要です。GPT OAuth だけ設定済みで動画を追加する場合は `ima2 grok login` を別途実行してください。

### アップデート

実行中の server を Ctrl+C で止めてから:

```bash
npm install -g ima2-gen@latest
```

Ctrl+C は DB クローズ、子プロセス停止、ファイルロック解放まで行うクリーンシャットダウンです。インストールに失敗した場合は表示された npm 権限を確認するか、対象の `ima2` プロセスを手動で停止してください。インストーラーは無関係なプロセスやグローバルロックを操作しません。

## できること

- **Classic mode**: すばやく生成し、編集し、現在の画像を次の参照として使えます。
- **Node mode**: 良い画像を起点に、複数の方向へ分岐して試せます。
- **Multimode batches**: 1つのプロンプトから複数候補を同時に走らせ、slot ごとの進行を見ながら最も良い結果から作業を継続できます。
- **Canvas Mode**: zoom/pan、annotation、eraser、background cleanup、transparent checkerboard preview、alpha/matte export をサポートします。
- **Video generation**: テキスト、画像、複数参照から短い動画を生成。SSE で planning→submitted→progress→done。First/Mid/Last フレームコピー対応。
- **Storyboard mode**: コンポーザーの storyboard トグルで連続フレームのキャラクター・シーン連続性を維持（画像・動画両対応）。
- **Local gallery**: 生成物をローカル保存。デフォルトは現在セッション、All Images トグルで全履歴。生成時間と reasoning effort をメタデータに記録。
- **Reference images**: ドラッグ/ペースト/ファイル選択。画像最大5、動画最大14。大きい画像は自動圧縮。
- **Prompt library imports**: local prompt pack、GitHub folder、curated GPT-image hint を built-in prompt library に取り込めます。
- **Mobile shell**: 小さい画面では app bar、compose sheet、compact settings toggle で操作できます。
- **Observable jobs**: 進行中の生成と最近の生成を request ID で追跡できます。

### SSE マルチプレキシング

Web UI は単一の `GET /api/events` Server-Sent Events 接続で全生成の進行を受信します。Multimode、node、video リクエストは非同期 POST（`202 { requestId }`）で送信され、共有イベントバス経由で進行イベントがマルチプレクスされます。これにより、同時生成時のブラウザ 6 接続制限によるギャラリー hang が解消されます。`async: true` を送らない CLI クライアントは、後方互換のため従来どおりリクエストごとの SSE ストリームを受け取れます。

## 画像生成は OAuth と API key をサポートします

既定の画像生成は、ローカルの Codex/ChatGPT OAuth 経路で実行されます。

API key が env/config に存在する場合、生成エンドポイントで `provider: "api"` を指定すると Responses API の `image_generation` tool を使用できます。

- `provider: "grok-api"` — `XAI_API_KEY` で xAI Images API を直接呼び出し
- `provider: "agy"` — ローカル Antigravity CLI (`IMA2_AGY_BIN`)
- `provider: "gemini-api"` — `GEMINI_API_KEY` または Vertex (`VERTEX_SERVICE_ACCOUNT_JSON`、Vertex 優先)

Settings に **API key provider available** と表示される場合、API key が検出され、生成・編集・multimode・node request に使用できるという意味です。

Grok 動画の既定値は正式名 `grok-imagine-video-1.5` です。`grok-imagine-video` は Ref2V、V2V edit、extension の互換パスで引き続き使用し、従来の `grok-imagine-video-1.5-preview` も互換 alias として受け付けます。参照数に応じて T2V(0)、I2V(1)、Ref2V(2-14、grok-imagine-video-1.5 は最大15秒 / grok-imagine-video は最大10秒)が自動選択され、1080p は `grok-imagine-video-1.5` の prompt-only T2V と単一画像/フレーム I2V で有効です。duration(1-15s)、resolution(480p/720p/対応時 1080p)、aspect ratio を設定できます。

設定画面の QuotaCard に Grok billing `$used/$limit` バーと **Switch Account** ボタン（`POST /api/auth/switch`）が表示されます。

![OAuth active と API key provider available の状態を示す settings 画面](../assets/screenshots/settings-oauth-generation.png)

## モデルの選び方

画像生成と Prompt Builder の既定値は **`gpt-5.6-luna`** です。旧モデルは互換オプションとして残ります。

- `gpt-5.6-luna` — 現在の画像・Prompt Builder 既定値。
- `gpt-6-astra` — 最新の GPT 画像モデル。選択できますが既定値ではありません。
- `gpt-5.6-terra` / `gpt-5.6-sol` — アカウントで利用できる GPT-5.6 オプション。
- `gpt-5.5` / `gpt-5.4` / `gpt-5.4-mini` — 互換オプション。

Quality は `low`, `medium`, `high`、moderation は `auto`, `low` をサポートします。

## ワークフロー

### Classic mode

1枚をすばやく作って調整したいときに使います。

1. プロンプトを書きます。
2. 必要なら参照画像を追加します。
3. モデル、quality、size、format、moderation を選びます。
4. 1枚を生成するか、multimode で同じプロンプトから複数候補を出します。
5. 生成後、copy、download、continue、Canvas Mode cleanup を選べます。

![1つのプロンプトから4つの candidate slot が生成中で、sidebar に active job history が見える multimode sequence 画面](../assets/screenshots/multimode-sequence.png)

### Node mode

アイデアを枝分かれさせながら比較したいときに使います。

![接続された生成カードとノードごとのメタデータが見える Node mode 画面](../assets/screenshots/node-graph-branching.png)

各ノードは独自のプロンプトと結果を持ちます。ルートノードにはローカル参照画像を付けられ、子ノードは親画像をソースとして使います。完了した生成は request ID で再接続されるため、リロードや graph version conflict の後でも結果を復元できます。

### Canvas Mode

生成結果がほぼ良いが、部分的な修正や背景整理が必要なときに使います。

- ズーム状態でのビューポート移動（Pan）と選択ツールが分離されているため、アノテーションを誤操作することなく画面を移動できます。
- annotation、eraser、multiselect、group、undo/redo、sticky note を使えます。
- background cleanup seed を選び、mask preview を確認して canvas version として保存できます。
- 透明画像は checkerboard preview で確認でき、export は alpha 保持または matte color 合成を選べます。
- 保存された canvas version は Gallery/HistoryStrip には表示されませんが、Canvas Mode では再利用したり次の reference として添付できます。

![zoom controls, annotation marks, sticky note, canvas toolbar が見える Canvas Mode 画面](../assets/screenshots/canvas-mode-cleanup.png)

### Prompt library と import

Prompt library は local files、GitHub folders、curated sources、GPT-image hint packs から取り込めます。取り込んだ prompt は local index に保存され、毎セッション再 import しなくても検索と ranking に使えます。

![Prompt library に取り込む前に GitHub folder、curated sources、検索候補 prompt を確認する prompt import dialog](../assets/screenshots/prompt-import-dialog.png)

### Experimental Card News Mode

Card News はまだ開発用の実験機能です。既定の公開ランタイムでは、開発用途として明示的に有効化しない限り非表示であり、安定した公開機能として扱うべきではありません。

### Settings

Settings ワークスペースでは、アカウント、モデル、テーマ、言語設定が生成パネルから独立しています。

![Account と Generation model controls が見える Settings workspace](../assets/screenshots/settings-workspace.png)

## CLI commands

### Server

| Command | Description |
|---|---|
| `ima2 serve [--dev]` | ローカル Web サーバーを起動。`--dev` は詳細な server diagnostics を表示 |
| `ima2 setup` | 認証設定を再構成 |
| `ima2 status` | config と OAuth 状態を表示 |
| `ima2 doctor` | Node、package、config、auth を診断 |
| `ima2 doctor image-probe [--json]` | 画像なし診断用 sanitized probe |
| `ima2 open` | Web UI を開く |
| `ima2 reset` | 保存済み config を削除 |

### Client

以下は `ima2 serve` が起動しているときに使えます。CLI はサーバーのすべてのルートを ラップしています。よく使うコマンドのみ抜粋しました。完全なリストは [CLI リファレンス（英語）](CLI.md) を参照してください（generation、history、sessions、prompt library、annotations、Card News、observability、config を網羅）。

| Command | Description |
|---|---|
| `ima2 gen <prompt>` | CLI から画像生成 |
| `ima2 edit <file> --prompt <text>` | 既存画像を編集 |
| `ima2 multimode <prompt>` | マルチイメージ SSE 生成 |
| `ima2 video <prompt>` | Grok 動画生成（SSE 進捗） |
| `ima2 ls [--session <id>] [--favorites]` | ローカル履歴を表示 |
| `ima2 show <name> [--metadata]` | 生成ファイルを開く |
| `ima2 prompt ls -q <検索>` | プロンプトライブラリ検索 |
| `ima2 inflight ls [--terminal]` | 進行中 / 直近完了ジョブ（`ps` のエイリアス）|
| `ima2 config set <key> <value>` | `~/.ima2/config.json` に書き込み |
| `ima2 ping` | サーバー疎通確認 |

サーバーポートは `~/.ima2/server.json` に保存されます。`3333` が埋まっている場合は `3334+` に fallback するため、terminal に表示された URL または `ima2 open` を優先してください。`--server <url>` または `IMA2_SERVER=http://localhost:3333` で上書きできます。

完全なコマンド一覧とフラグは [docs/CLI.md](CLI.md) にあります。

## Configuration

優先順位:

```text
environment variables > ~/.ima2/config.json > built-in defaults
```

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
| `IMA2_NO_OAUTH_PROXY` | — | `1` で OAuth proxy の自動起動を無効化 |
| `IMA2_LOG_LEVEL` | `info` | 通常の `serve` は `info`、dev mode は `debug`。`debug`, `info`, `warn`, `error`, `silent` をサポート |
| `IMA2_INFLIGHT_TERMINAL_TTL_MS` | `300000` | デバッグ用の recent job retention |
| `OPENAI_API_KEY` | — | `provider: "api"` の Responses 画像パスと補助機能用 |
| `XAI_API_KEY` | — | `provider: "grok-api"` 直接 xAI Images API |
| `GEMINI_API_KEY` | — | `provider: "gemini-api"` Generative Language API |
| `VERTEX_SERVICE_ACCOUNT_JSON` | — | Vertex AI サービスアカウント JSON（API キーより優先） |
| `IMA2_AGY_BIN` | PATH の `agy` | `provider: "agy"` バイナリパス |

### Logging modes

`ima2 serve` は通常ユーザー向けに terminal output を静かに保ちます。起動 URL、warning、error は表示されますが、request/node/OAuth structured logs は既定で隠されます。

request ID、Node generation phases、OAuth stream diagnostics、inflight state transitions を確認したい場合は、`ima2 serve --dev`、`npm run dev`、または `IMA2_LOG_LEVEL=debug ima2 serve` を使ってください。

## API Reference

Endpoint 一覧は [API Reference](API.md) に分離しました。

詳しいFAQは [FAQ](FAQ.md) にまとめています。アップデート後に以前のギャラリー画像が見えない場合は、まず [Recover Old Generated Images](RECOVER_OLD_IMAGES.md) を確認してください。

## Troubleshooting

**`ima2 ping` が server unreachable になる**
まず `ima2 serve` を起動し、`~/.ima2/server.json` を確認してください。`ima2 ping --server http://localhost:3333` も使えます。

**OAuth login がうまくいかない**
`ima2 setup` を再実行（オプション 1）し、`ima2 status` を確認してから `ima2 serve` を再起動してください。

**proxy/VPN 環境で `fetch failed` が繰り返される**
ローカル OAuth proxy に到達できるか確認してください。プロキシ必須のネットワークでは、プロキシクライアントの TUN/TURN 系モードを有効にしてから `openai-oauth --port 10531` を再試行してください。それでも失敗する場合は、`ima2 serve` や `openai-oauth` を実行する同じ terminal で `HTTP_PROXY` と `HTTPS_PROXY` を設定してください。Windows では SecretDNS など DNS/断片化バイパス系ツールが OAuth やストリーミング画像応答を壊すことがあります。

**画像生成が `API_KEY_REQUIRED` で失敗する**
`provider: "api"` request に使う API key が設定されていません。API key を設定するか OAuth provider に切り替えてください。

**画像生成が `EMPTY_RESPONSE` になる、または画像データが返らない**
`ima2 doctor image-probe --json > ima2-image-probe.json` を実行し、issue 作成時に安全な JSON を添付してください。GPT OAuth の場合は、`ima2 serve` 実行中に `ima2 gen "猫" --no-web-search --json` と `ima2 gen "猫" --json` も取得してください。ChatGPT cookie、OAuth トークンファイル、API key、生の upstream 応答、プロンプト履歴、生成 base64 は共有しないでください。詳細は [FAQ サポートバンドル](FAQ.md#what-should-i-share-when-gpt-oauth-image-generation-returns-no-image) を参照してください。

**大きな参照画像が失敗する**
JPEG/PNG は送信前に自動圧縮されます。それでも失敗する場合は、解像度を下げた JPEG/PNG に変換してください。HEIC/HEIF は browser path ではサポートしていません。

**更新後に以前のギャラリー画像が見えない**
最近のバージョンでは、生成画像の保存先がインストール済みパッケージ内から `~/.ima2/generated` に移動しました。`ima2 doctor` を実行し、[古い画像の復旧ガイド](RECOVER_OLD_IMAGES.md) を確認してください。

**`gpt-5.5` だけ失敗する**
まず Codex CLI を最新版に更新してから再試行してください。それでも失敗する場合は、現在のアカウントやバックエンド経路で `gpt-5.5` の image capability または使用量枠がまだ異なる可能性があります。安定した代替として `gpt-5.4` を使ってください。

**別のポートでアプリが開く**
要求した server ポートが使用中の場合、ima2-gen は次の空きポートに fallback し、`~/.ima2/server.json` に記録します。ポートが想定外の `3457` になる場合、shell が別ツールの `PORT=3457` を引き継いでいる可能性があります。`unset PORT` するか、`IMA2_PORT=3333 ima2 serve` で起動してください。

**Windows でポート `10531` が既に使われている**
Windows のセキュリティツール（`AnySign4PC.exe` など）が既定 OAuth proxy ポートを占有することがあります。現在のビルドは実際の fallback OAuth ポートを追跡します。手動上書きが必要な場合は `IMA2_OAUTH_PROXY_PORT=11531 ima2 serve` で起動し、`ima2 doctor` で確認してください。

より詳しい確認手順は [FAQ](FAQ.md) を参照してください。

## Development

```bash
git clone https://github.com/lidge-jun/ima2-gen.git
cd ima2-gen
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run dev` は UI を build し、TypeScript server entry を `--watch` で起動して verbose diagnostics を表示します。`npm run typecheck`, `npm run build:server`, `npm run build:cli` で TypeScript migration と package emit path を確認できます。

## License

MIT
