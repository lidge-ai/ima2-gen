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

安装程序从包元数据读取 Node.js 最低版本，并在启动服务器前执行离线安装检查。

<p align="center">
  <img src="../assets/logo.png" alt="ima2" width="160">
</p>

<p align="center">
  <strong>面向用户和编码智能体的本地图像与视频工作室。</strong>
</p>

[![npm版本](https://img.shields.io/npm/v/ima2-gen)](https://www.npmjs.com/package/ima2-gen)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![许可证：麻省理工学院](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

> **在线站点**: [lidge-jun.github.io/ima2-gen](https://lidge-jun.github.io/ima2-gen/) · [한국어](https://lidge-jun.github.io/ima2-gen/ko/)
>
> **开发者文档**: [文档站点](https://lidge-jun.github.io/ima2-gen/docs) · [한국어](https://lidge-jun.github.io/ima2-gen/ko/docs)
>
> **阅读其他语言版本**：[English](../README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [正體中文](README.zh-TW.md) · [简体中文](README.zh-CN.md)

`ima2-gen` 是面向用户和编码智能体的本地优先视觉生成运行时与工作室，支持跨多个提供商的可复现图像和视频工作流。

全局安装后，可在 OpenAI OAuth/API、Grok OAuth/API、Antigravity CLI、Gemini API、AtlasCloud、MiniMax、NovelAI 和 ComfyUI 工作流组成的 10 个 core lane 中生成图像和视频。Runway 与 Higgsfield 属于独立的 MCP integration。

![ima2-gen 经典工作区（浅色模式），画布上显示生成结果。](../assets/screenshots/classic-generate-light.png)

## 快速入门

### Mac 应用（Apple Silicon）

在 Apple Silicon Mac 上，桌面应用是最快的上手方式。它在 Mac 窗口和菜单栏图标中运行同样的本地服务器和工作室，并已通过 Apple 签名与公证。

1. 从最新的 [ima2 Desktop 发布](https://github.com/lidge-jun/ima2-gen/releases?q=desktop&expanded=true) 下载 `ima2-<version>-mac-arm64.dmg`。
2. 打开 DMG，把 **ima2** 拖入 **应用程序** 文件夹。
3. 启动 ima2，在欢迎界面选择一个提供商。

应用自带运行时，无需安装 Node.js。校验和、更新与设置请参阅 [Mac App 指南](https://lidge-jun.github.io/ima2-gen/docs/desktop)。在 Intel Mac、Windows 或 Linux 上，请使用下方的 npm 或一键安装。

### npm

```bash
npm install -g ima2-gen
ima2 setup
ima2 serve
```

然后打开`http://localhost:3333`.

### Docker

```bash
docker build -t ima2-gen .
docker run -d -p 3333:3333 -e IMA2_LAN_TOKEN=change-me -v ima2-data:/data ima2-gen
```

看[docs/DOCKER.md](DOCKER.md)了解 compose 的用法、所需的环境和限制。

生成自CLI，检查实时车道目录并选择显式图像/视频默认值一次：

```bash
ima2 models
ima2 defaults set image oauth/gpt-5.6-luna
ima2 defaults set video grok/grok-imagine-video-1.5
ima2 gen "a clean product photo of a red guitar pedal"
ima2 video "a cat playing piano" --duration 5 --resolution 720p
ima2 video "animate this scene" --ref photo.png --duration 10
```

`ima2 gen`和生成模式`ima2 video`失败关闭`NO_DEFAULT_MODEL`直到一个CLI目标已配置，除非该调用通过`--model <lane>/<model>`或明确的`--provider <lane>`。这可以防止升级时默默地切换提供商或计费通道。

如果`3333`已经被占用了，`ima2-gen`绑定下一个可用端口并写入实际的URL到`~/.ima2/server.json`。使用`ima2 open`或URL在终端中打印而不是假设端口。

> **使用npx？**看[docs/NPX_QUICKSTART.md](NPX_QUICKSTART.md)为`npx ima2-gen serve`工作流程。

### 一键安装（无npm必需的）

没有Node.js或者npm？使用平台安装脚本 — 它会检测您的环境，根据需要安装 Node LTS，然后安装ima2-gen.

**苹果系统：**
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

每个脚本都会检查支持的 Node 版本，必要时使用 nvm/fnm/brew/winget 安装 Node LTS。npm 安装只尝试一次，`ima2 doctor --installation --json` 通过后才启动服务器。脚本不会终止其他进程或删除全局锁文件。

### 设置

`ima2 setup`提供四种身份验证选择：

1. **GPT OAuth**— 登录方式ChatGPT帐户（免费，仅图像）
2. **Grok OAuth**— 登录方式xAI/Grok帐户（图片+视频）
3. **两个都** — GPT OAuth + Grok OAuth（全功能访问）
4. **网页设置**— 配置网络中的所有内容UI

视频生成需要Grok OAuth（选项 2 或 3）。跑步`ima2 grok login`如果您已经有，请单独GPT OAuth配置并想要添加视频支持；它默认为手动粘贴流程。

### 更新中

使用 Ctrl+C 停止正在运行的服务器，然后：

```bash
npm install -g ima2-gen@latest
```

Ctrl+C 会关闭数据库、停止子进程并释放文件锁。如果 Windows 报告 `EBUSY`，请先手动停止对应的 ima2 服务再重试安装。安装器不会自动终止进程或提升权限。

## 它的作用

- **经典模式**：生成、编辑、重用当前图像、粘贴引用并从历史记录继续。
- **节点模式**：将好的图像分支到多个方向，而不丢失原始图像。
- **多模式批次**：从一个提示启动多个经典输出，逐个观察插槽进度，然后从最佳结果继续。
- **视频生成**：通过文本、单个图像或多个参考图像创建短视频Grok视频模型。SSE流媒体显示计划→提交→进度％→完成。视频帧复制按钮（第一个/中间/最后一个）可让您从生成的视频中提取和复制关键帧。
- **故事板模式**：在编辑器中切换故事板模式，以保持连续帧之间的角色和场景连续性。适用于图像和视频生成 - 为视频制作组合图像关键帧，视频剪辑继承角色/环境锁定规则。
- **画布模式**：缩放、平移、注释、擦除、清理背景、保持透明预览以及导出 Alpha 或遮罩版本。
- **当地画廊**：将生成的资产保留在您的计算机上并具有会话感知历史记录。默认情况下，图库显示当前会话，所有图像切换显示完整历史记录；默认范围是跨会话的粘性。每个图像都会在结果元数据中记录其生成时间和推理工作，因此它们在重新加载后仍然存在。
- **参考图片**：拖放、粘贴和附加最多 5 个参考文献（图像）或最多 14 个参考（视频）；大图像在上传之前会被压缩。
- **提示库导入**：导入本地提示包，GitHub文件夹和策划GPT-图像提示提示进入内置提示库。
- **手机壳**：在较小的屏幕上使用应用栏、撰写表和紧凑设置切换。
- **可观察的职位**：使用安全日志和请求 ID 跟踪活动的和最近的作业。

### 代理技巧

ima2-gen为 AI 编码代理提供了三种打包技能。这些是 Markdown
代理加载的指令文件以获得图像/视频的结构化工作流程
生成、前端资产生产和设计方向发现。

|技能|命令|它涵盖什么|
|-------|---------|----------------|
| **核** | `ima2 skill` | CLI参考、提示协议、提供商路由、韩文文本、视频工作流程|
| **前端** | `ima2 skill front` |资产管道（并行生成、变体选择、提供商路由）、网络运动/视频、响应式、a11y、防倾斜、30 多个参考文件|
| **UI/UX设计** | `ima2 skill uiux` |图像优先的设计方向发现，UX状态、设计主义、产品个性、DESIGN.md工作流程，21 个参考文件|

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

前端和UI/UX技能是生产级设计工程指南
适应于ima2工作流程。它们涵盖版式、色彩系统、布局
纪律, 韩语UX模式、动作编排和视觉验证，
每个资产生成步骤都映射到`ima2 gen`, `ima2 video`， 和
`ima2 multimode`命令。

### SSE多路复用

网络UI使用单个`GET /api/events`所有生成进度的服务器发送事件连接。多模式、节点和视频请求作为异步 POST 提交（`202 { requestId }`）和进度事件通过共享事件总线进行多路复用。这消除了之前在并发生成期间导致图库挂起的浏览器 6 个连接限制。CLI不发送的客户`async: true`仍然收到每个请求SSE流以实现向后兼容性。

## 提供者路径

图像生成可以通过本地运行Codex/ChatGPT OAuth路径，配置的OpenAI API键，捆绑的Grok提供者，或Gemini提供者通过Antigravity CLI.

- `provider: "oauth"`使用本地的Codex OAuth代理人。
- `provider: "api"`称为OpenAI回应API与托管的`image_generation`工具。
- `provider: "grok"`使用`~/.progrok/auth.json`中的xAI OAuth会话直接调用`https://api.x.ai`, 强制运行xAI网络搜索加上规划者通行证（默认：`grok-4.3`，可在设置中配置或通过`--planner-model`），然后调用xAI图片API。也可以选择`grok-4.5`和`grok-4.6`。用`ima2 grok login`或网络UI登录一次；令牌在过期前 2 分钟自动刷新。
- `provider: "grok-api"`称为xAI图片API直接与`XAI_API_KEY`（使用API密钥而不是OAuth会话）。
- `provider: "agy"`产生Antigravity CLI (`agy -p`）通过Google生成图像Gemini's `default_api:generate_image`工具（型号：`nano-banana-2`）。输出固定为1024×1024JPEG，最多 3 个参考图像。没有网络搜索、质量或大小控制。
- `provider: "gemini-api"`调用 Google 生成语言API直接地。支持两种型号：`nano-banana-2` (Gemini3.1 Flash 图像）和`nano-banana-pro` (Gemini3 专业图像）。身份验证是通过`GEMINI_API_KEY`环境变量、网络UI密钥管理，或Vertex AI服务帐户JSON (`VERTEX_SERVICE_ACCOUNT_JSON`）。当两者都APIkey 和 Vertex 凭证已配置，Vertex 优先。支持可变宽高比（1:1 至 21:9）和四个分辨率级别（512px、1K、2K、4K）；这些控制仅在直接上受到尊重API路径——Vertex AI端点忽略方面/大小，因为它不接受`response_format`场地。每个型号的成本不同：`nano-banana-2`（闪存）：512=0.001 美元、1K=0.003 美元、2K=0.004 美元、4K=0.006 美元；`nano-banana-pro`：1K=0.007 美元，2K=0.007 美元，4K=0.013 美元。没有网络搜索或掩码控制。
- API-密钥生成支持经典生成、编辑、掩码引导编辑、多模式和节点生成。
- Grok生成支持经典流、节点流和代理流。如果存在经典参考、节点父映像或代理当前映像，ima2切换最后的Grok打电话给xAI图像编辑，以便保留图像到图像的上下文。

如果未指定提供商，应用程序将保留当前的GPT OAuth/默认行为。GPT OAuth和API-密钥生成默认为`gpt-5.6-luna`;这API-key路径也默认为`low`推理和`1024x1024`除非请求通过了经过验证的选项。Grok图像生成默认为`grok-imagine-image-2.0`.

关于OAuth Grok通道有一点需要说明：xAI只把`/v1/me`记录为接受OAuth令牌的端点，所以用该令牌调用`api.x.ai`的图像与视频接口走的是未文档化的路径。它目前可用——progrok一直依赖同一条路径——但没有任何兼容性承诺。如果xAI关闭这条路径，用`XAI_API_KEY`的`provider: "grok-api"`是有文档的方案，且不受影响。

Grok图像生成公开了模型选择器（`grok-imagine-image` / `grok-imagine-image-quality`）和尺寸选择器（长宽比 + 1k/2k 分辨率）。设置页面更喜欢Grok建立每周积分百分比并重置时间`GET /v1/billing?format=credits`;如果该来源不可用，则会退回到传统的每月计费窗口，并且`$used/$limit`. A **切换账户**按钮启动设备代码OAuth流动 （`POST /api/auth/switch`）无需离开应用程序即可重新进行身份验证。

Grok视频生成默认为规范`grok-imagine-video-1.5`; `grok-imagine-video`仍然可用于仅限基本模型的 Ref2V、V2V 编辑和扩展路径，以及旧版本`grok-imagine-video-1.5-preview`字符串被接受作为别名。根据引用计数自动检测三种模式：文本到视频（0 引用）、图像到视频（1 引用）和引用到视频（2-14 引用；grok-imagine-video-1.5 最长 15 秒，grok-imagine-video 最长 10 秒）。 1080p 可用于`grok-imagine-video-1.5`仅提示文本到视频和单图像/帧图像到视频；仅提示 1.5 在上游请求之前使用内部白色画布 I2V 填充程序。视频控制包括持续时间（1-15秒）、分辨率（480p、720p、1080p（如果支持））和宽高比（1:1、16:9、9:16、4:3、3:4、3:2、2:3、自动）。

![设置工作区显示GPT OAuth活跃和API可用的密钥提供者。](../assets/screenshots/settings-oauth-generation.png)

## 型号指导

该应用程序默认为**`gpt-5.6-luna`**用于图像生成和 Prompt Builder 规划。较旧的受支持型号仍保留明确的兼容性选择。

- `gpt-5.6-luna`— 当前图像和提示生成器默认值。
- `gpt-6-astra`— 最新的 GPT 图像模型；可选，但不是默认值。
- `gpt-5.6-terra` / `gpt-5.6-sol`- 当前的GPT-5.6当您的帐户暴露它们时的替代方案。
- `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`- 支持的兼容性选择。

该应用程序还暴露了质量（`low`, `medium`, `high`）和适度（`auto`, `low`）控制。

## 工作流程

### 经典模式

当您想要快速获得强大的结果时，请使用经典。

1. 写一个提示。
2. 如果需要，附加或粘贴参考文献。
3. 选择型号、质量、尺寸、格式和审核。
4. 生成一个图像，或启用多模式以从同一提示中扇出多个候选插槽。
5. 复制、下载、继续结果或将其发送到画布模式。

有关 Prompt Studio、多模式配方、直接模式的逐个控制指南，
推理努力和画廊最喜欢的行为，请参阅
[提示工作室手册](PROMPT_STUDIO.md).

![多模式序列，具有四个候选槽位，由侧边栏中的一个提示和活动作业历史记录生成。](../assets/screenshots/multimode-sequence.png)

### 节点模式

当您想要探索分支时，请使用节点模式。

![具有连接的生成卡和紧凑的每个节点元数据的节点模式。](../assets/screenshots/node-graph-branching.png)

每个节点都有自己的提示和结果。根节点可以附加本地引用；子节点使用父图像作为其源。已完成的作业通过请求 ID 与节点匹配，因此重新加载和图形版本冲突可以恢复完成的结果。

### 画布模式

当生成的图像已接近但需要在下一个提示之前进行有针对性的清理时，请使用画布模式。

- 将视口平移与选择分开，以便您可以在缩放图像中移动而不会意外更改注释。
- 使用注释、橡皮擦、多选、分组、撤消/重做和便签，同时保持原始图库图像可用。
- 选择背景清理种子，预览蒙版，并将清理保存为画布版本。
- 检测透明图像并显示棋盘预览；使用保留的 alpha 或选择的哑光颜色导出。
- 保存的画布版本对 Gallery 和 HistoryStrip 保持隐藏状态，但 Canvas 模式可以重用它们并附加画布版本作为下一个参考。

![带有缩放控件、注释标记、便签和画布工具栏的画布模式。](../assets/screenshots/canvas-mode-cleanup.png)

### 提示库和导入

现在可以从本地文件填充提示库，GitHub文件夹、精选资源以及GPT-图像提示包。导入的提示在本地建立索引，因此搜索和排名无需在每个会话中重新导入相同的源。

![用于将提示导入库的提示导入对话框，显示GitHub导入前的文件夹控件、精选源和搜索提示候选者。](../assets/screenshots/prompt-import-dialog.png)

### 实验卡新闻模式

Card News 仍处于开发阶段且处于实验阶段。默认情况下是隐藏的
除非明确启用开发，否则发布运行时，并且不应该
尚未被视为稳定的公共功能。

### 设置

设置工作区使帐户、模型、外观和语言控件远离生成侧边栏。

![具有帐户导航和生成模型控件的设置工作区。](../assets/screenshots/settings-workspace.png)

## CLI命令

### 服务器

|命令|描述|
|---|---|
| `ima2 serve [--dev]` |启动本地网络服务器；`--dev`启用详细的服务器诊断|
| `ima2 setup` |重新配置保存的身份验证|
| `ima2 status` |显示配置和OAuth地位|
| `ima2 doctor` |诊断节点、包、配置和身份验证|
| `ima2 doctor image-probe [--json]` |运行经过净化的图像探针进行无图像诊断|
| `ima2 open` |打开网络UI |
| `ima2 reset` |删除保存的配置|

### 客户端

这些都需要运行`ima2 serve`。这CLI覆盖每条服务器路线。最常见的如下 -[完整 CLI 参考](CLI.md)列出所有内容（生成、历史、会话、提示库、注释、卡片新闻、可观察性、配置）。

|命令|描述|
|---|---|
| `ima2 models [--kind image\|video] [--lane <lane>] [--json]` |列出实时车道、状态、型号 ID 和功能|
| `ima2 defaults set image\|video <lane>/<model>` |坚持失败关闭CLI图像或视频生成目标|
| `ima2 defaults reset image\|video` |删除一个持久化的CLI一代目标|
| `ima2 gen <prompt> [--model <lane>/<model>]` |生成自CLI;需要明确的目标或保存的图像默认值|
| `ima2 edit <file> --prompt <text>` |编辑现有图像|
| `ima2 multimode <prompt>` |多图像SSE一代|
| `ima2 video <prompt> [--model <lane>/<model>]` |通过生成视频Grok或者MCP车道;需要明确的目标或保存的视频默认值|
| `ima2 ls [--session <id>] [--favorites]` |列出最近的历史记录|
| `ima2 show <name> [--metadata]` |显示生成的资产|
| `ima2 prompt ls -q <search>` |搜索提示库|
| `ima2 inflight ls [--terminal]` |列出当前和最近的工作（别名`ps`) |
| `ima2 config set <key> <value>` |写信给`~/.ima2/config.json` |
| `ima2 ping` |健康检查正在运行的服务器|

服务器公布其实际端口为`~/.ima2/server.json`。如果`3333`正忙，后端回落到`3334+`和CLI命令遵循广告URL。覆盖发现`--server <url>`或者`IMA2_SERVER=http://localhost:3333`.

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

完整参考：[docs/CLI.md](CLI.md).

## 配置

配置优先级：

```text
environment variables > ~/.ima2/config.json > built-in defaults
```

| 变量 | 默认 | 描述 |
|---|---:|---|
| `IMA2_PORT` / `PORT` | `3333` |网络服务器端口|
| `IMA2_HOST` | `127.0.0.1` |Web服务器绑定主机|
| `IMA2_OAUTH_PROXY_PORT` / `OAUTH_PORT` | `10531` | OAuth代理端口|
| `IMA2_SERVER` | — | CLI目标覆盖|
| `IMA2_CONFIG_DIR` | `~/.ima2` |配置和 SQLite 位置|
| `IMA2_ADVERTISE_FILE` | `~/.ima2/server.json` |运行时发现文件|
| `IMA2_GENERATED_DIR` | `~/.ima2/generated` |生成的图片目录|
| `IMA2_IMAGE_MODEL_DEFAULT` | `gpt-5.6-luna` |服务器后备映像模型|
| `IMA2_REASONING_EFFORT` | `medium` |默认的默认推理工作（GPT OAuth） 小路;之一`none`, `low`, `medium`, `high`, `xhigh` |
| `IMA2_NO_OAUTH_PROXY` | — |放`1`禁用自动启动OAuth代理人|
| `IMA2_LOG_LEVEL` | `info` |正常服务默认为`info`;开发模式默认为`debug`;支持`debug`, `info`, `warn`, `error`， 或者`silent` |
| `IMA2_INFLIGHT_TERMINAL_TTL_MS` | `300000` |调试视图的最近终端作业保留|
| `OPENAI_API_KEY` | — | API的关键`provider: "api"`回应API图像路径和辅助API- 主要特点|
| `XAI_API_KEY` | — | API关键是`provider: "grok-api"`直接的xAI图片API小路|
| `IMA2_API_IMAGE_MODEL_DEFAULT` | `gpt-5.6-luna` |默认图像模型`provider: "api"` |
| `IMA2_API_REASONING_EFFORT` | `low` |默认推理工作`provider: "api"` |
| `IMA2_API_IMAGE_SIZE` | `1024x1024` |默认尺寸为`provider: "api"` |
| `IMA2_API_ALLOW_WEB_SEARCH` | `true` |切换网络搜索`provider: "api"` |
| `IMA2_GROK_PLANNER_MODEL` | `grok-4.3` | Grok搜索/规划器模型（也可通过设置进行配置UI或者`--planner-model` CLI旗帜）|
| `IMA2_GROK_PLANNER_TIMEOUT_MS` | `900000` |超时时间为Grok搜索和规划呼叫|
| `IMA2_GROK_IMAGE_MODEL_DEFAULT` | `grok-imagine-image-2.0` |默认最终Grok图像模型|
| `IMA2_GROK_VIDEO_MODEL_DEFAULT` | `grok-imagine-video-1.5` |默认Grok视频模型|
| `IMA2_GROK_GENERATION_TIMEOUT_MS` | `300000` | Grok 图片 API 最终调用的超时 |
| `IMA2_OAUTH_MASKED_EDIT_ENABLED` | `false` |针对屏蔽编辑请求的选择加入功能标志OAuth路径（#31，仅基础）|
| `GEMINI_API_KEY` | — | API关键是`provider: "gemini-api"`直接生成语言API小路|
| `VERTEX_SERVICE_ACCOUNT_JSON` | — |谷歌服务帐户JSON为了Vertex AI授权与`provider: "gemini-api"`;优先于`GEMINI_API_KEY`当两者都设置时|
| `IMA2_AGY_BIN` | `agy`在路径上|显式路径Antigravity CLI二进制为`provider: "agy"` |
| `IMA2_MAX_PARALLEL` | `24` |服务器范围的并行生成上限|

`IMA2_GROK_PROXY_HOST`、`IMA2_GROK_PROXY_PORT`、`IMA2_NO_GROK_PROXY`和`IMA2_GROK_RESTART_*`已随本地Grok代理在 3.16 中移除，不再被读取；即使保留这些值也不会有任何影响。

### 记录模式

`ima2 serve`故意保持终端输出安静：启动 URL、警告和错误保持可见，而 request/node/OAuth结构化日志默认隐藏。

使用`ima2 serve --dev`, `npm run dev`， 或者`IMA2_LOG_LEVEL=debug ima2 serve`当您需要请求 ID、节点生成阶段时，OAuth流诊断或飞行状态转换。显式的`IMA2_LOG_LEVEL`和`~/.ima2/config.json`值仍然会覆盖内置默认值。

## API参考

端点列表移至[docs/API.md](API.md)因此本自述文件可以集中于首次运行使用。

有用的参考：

- [开发者文档网站](https://lidge-jun.github.io/ima2-gen/docs)— 概述、快速入门、架构、模式、提供商、CLI、配置和服务器API
- [CLI参考](CLI.md)
- [API参考](API.md)
- [提示工作室手册](PROMPT_STUDIO.md)
- [常问问题](FAQ.md)
- [恢复旧图像](RECOVER_OLD_IMAGES.md)
- [韩文自述文件](README.ko.md)
- [日语自述文件](README.ja.md)
- [繁體中文 README](README.zh-TW.md)

## 故障排除

**`ima2 ping`说服务器无法访问**
开始`ima2 serve`，然后检查`~/.ima2/server.json`。你也可以运行`ima2 ping --server http://localhost:3333`.

**GPT OAuth登录不起作用**
重新运行`ima2 setup`（选项1），确认`ima2 status`，然后重新启动`ima2 serve`.

**`fetch failed`在代理/VPN 网络上重复**
检查本地OAuth代理可达。在需要代理的网络上，启用代理客户端的 TUN/TURN 式模式，然后重试`openai-oauth --port 10531`。如果仍然失败，请设置`HTTP_PROXY`和`HTTPS_PROXY`在运行的同一个终端中`ima2 serve`或者`openai-oauth`。在 Windows 上，还要检查自动启动的网络拦截工具，包括 SecretDNS 等 DNS/碎片绕过工具，因为它们可能会破坏OAuth或流图像响应，即使浏览器显示为已连接。

**图像失败`API_KEY_REQUIRED`**
放`OPENAI_API_KEY`或配置一个API使用前按键`provider: "api"`。默认GPT OAuth路径仍然有效，无需API钥匙。

**图像生成返回`EMPTY_RESPONSE`或没有图像数据**
跑步`ima2 doctor image-probe --json > ima2-image-probe.json`并附上保险箱JSON打开问题时。为了GPT OAuth案例，还捕获`ima2 gen "고양이" --model oauth/gpt-5.6-luna --no-web-search --json`和`ima2 gen "고양이" --model oauth/gpt-5.6-luna --json`尽管`ima2 serve`正在运行。请勿分享ChatGPT曲奇饼，OAuth令牌文件，API键、原始上游响应、提示历史记录或生成的 base64。请参阅[常见问题解答支持包](FAQ.md#what-should-i-share-when-gpt-oauth-image-generation-returns-no-image).

**大参考图像失败**
该应用程序压缩较大JPEG/PNG上传前参考。如果文件仍然失败，请将其转换为JPEG或者PNG降低分辨率并重试。浏览器路径不支持 HEIC/HEIF 文件。

**更新后旧图库图像丢失**
最新版本将生成的图像从已安装的包文件夹移动到`~/.ima2/generated`。跑步`ima2 doctor`并看到[恢复旧图像](RECOVER_OLD_IMAGES.md).

**`gpt-5.5`失败但其他模型可以工作**
更新Codex CLI首先，然后重试。如果仍然失败，您的帐户或后端路由可能无法公开相同的图像能力或配额`gpt-5.5`然而;使用`gpt-5.4`作为稳定的后备。

**该应用程序在不同的端口上打开**
如果请求的服务器端口繁忙，`ima2-gen`回退到下一个可用端口并将其记录在`~/.ima2/server.json`。如果端口意外`3457`，你的shell也可能继承了`PORT=3457`来自另一个本地工具。跑步`unset PORT`或开始于`IMA2_PORT=3333 ima2 serve`.

**港口`10531`已经在 Windows 上使用**
一些 Windows 安全工具，包括`AnySign4PC.exe`，可以占用默认值OAuth代理端口。当前版本跟踪实际的回退OAuth港口。如果您仍然需要手动超控，请从`IMA2_OAUTH_PROXY_PORT=11531 ima2 serve`并检查`ima2 doctor`.

有关更多适合初学者的答案，请参阅[常问问题](FAQ.md).

## 发展

```bash
git clone https://github.com/lidge-jun/ima2-gen.git
cd ima2-gen
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run dev`建立UI并开始TypeScript服务器条目与`--watch`和详细的服务器诊断。`npm run typecheck`, `npm run build:server`， 和`npm run build:cli`验证TypeScript迁移和包发出路径。 Node模式和Canvas模式是打包的一部分UI默认情况下。

## 贡献者

- [@lidge-jun](https://github.com/lidge-jun)— 维护者
- [@ree9622](https://github.com/ree9622)— 审核控制、Windows 修复、结构化日志记录
- [@Charley-Peng](https://github.com/Charley-Peng) — API缓存修复（#74）
- [@philiptaron](https://github.com/philiptaron)— 尼克斯薄片 (#81)
- [@傲英](https://github.com/aorying)— 上游验证错误浮出水面（告知 TS 迁移方向）
- [@朴正民](https://github.com/PARKJONGMlN)— 批量比较矩阵设计 (#80)

## 执照

麻省理工学院
