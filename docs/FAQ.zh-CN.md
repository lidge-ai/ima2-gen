# ima2-gen常问问题

最后审核时间：2026-05-26

此常见问题解答收集了安装或更新后往往出现的问题`ima2-gen`。自述文件很短；此页面提供实用详细信息和恢复步骤。

韩语请参阅 [FAQ.ko.md](FAQ.ko.md)；繁体中文请参阅 [FAQ.zh-TW.md](FAQ.zh-TW.md)；简体中文请参阅 [FAQ.zh-CN.md](FAQ.zh-CN.md)。

## 快速修复

|症状|先尝试一下|
|---|---|
|服务器无法访问|跑步`ima2 serve`， 然后`ima2 ping`. |
| GPT OAuth登录失败|重新运行`ima2 setup`（选项 1），然后重新启动`ima2 serve`. |
| API关键提供商说`API_KEY_REQUIRED` |配置一个API键，或切换回GPT OAuth提供者。|
|旧画廊图像看起来不见了|跑步`ima2 doctor`，然后看到[恢复旧生成的图像](RECOVER_OLD_IMAGES.md). |
| GPT OAuth 上某个 GPT-6 模型失败 | 用 `ima2 gpt login` 重新登录，检查 `ima2 models --kind image`，再改用 `gpt-6-luna`。 |
|参考资料上传失败|使用JPEG/PNG，降低分辨率，并保留对 5 个或更少图像的引用。|
|提示Studio控件不清楚|阅读[提示工作室手册](PROMPT_STUDIO.md)用于多模式、直接、推理和画廊行为。|
|图像生成返回`EMPTY_RESPONSE`或没有图像数据|跑步`ima2 doctor image-probe --json`，然后收集下面的安全支持包。|
| `fetch failed` 在代理/VPN 网络上反复出现 | 开启代理客户端的 TUN/TURN 类模式，或设置 `HTTPS_PROXY` 和 `NODE_USE_ENV_PROXY=1` 后启动 `ima2 serve`。 |

## 安装和更新

### 我需要什么版本的节点？

请使用 Node.js 22 或更高版本。软件包声明 Node `>=22`，README 徽章遵循该要求。

### 我该如何安装？

全局安装npm:

```bash
npm install -g ima2-gen
ima2 setup
ima2 serve
```

如果旧安装行为异常，请先更新：

```bash
npm install -g ima2-gen@latest
```

然后运行：

```bash
ima2 doctor
```

### Windows 说`spawn EINVAL`。我应该怎么办？

更新到最新版本。旧版本在生成时遇到问题npmWindows 上的 /npx 垫片。当前版本通过 Windows 安全路径路由这些命令。

如果Codex在本机 Windows 上登录本身并不可靠，WSL 可能是更可预测的环境。

### Windows 说`EBUSY`或者`resource busy or locked`更新期间。我应该怎么办？

这通常意味着npm无法替换全局包，因为正在运行
`ima2 serve`, 陈旧的`node.exe`、终端、资源管理器窗口、防病毒软件或索引器
仍然保留着包文件夹。停止ima2，关闭相关终端，结束陈旧
`node.exe`如果需要，则进行处理，然后重试：

```bash
npm install -g ima2-gen@latest
```

如果锁定仍然存在，请重新启动 Windows 并在开始之前运行更新ima2
再次。

## 身份验证和提供商

### 我需要一个OpenAI API钥匙？

默认生成路径为否。正常路径使用您本地的Codex/ChatGPT OAuth会议。

如果您配置APIkey，图像生成路线还可以使用`provider: "api"`通过回应API `image_generation`工具。

### 为什么设置页面显示“API关键提供商可用”？

这意味着`ima2-gen`找到一个有效的API钥匙。API-key 模式可以生成、编辑、运行多模式以及创建节点输出。如果没有配置密钥，`provider: "api"`在上游之前失败`API_KEY_REQUIRED`.

### 如果Codex CLI已经登录了，确实ima2-gen重用它吗？

是的。`ima2-gen`检查现有的Codex登录并使用本地GPT OAuth小路。如果检测失败或令牌过期，请运行：

```bash
ima2 setup     # re-run option 1 (GPT OAuth)
ima2 doctor
```

然后重新启动`ima2 serve`.

### 如果我看到怎么办`Provided authentication token is expired`?

你的Codex/ChatGPT OAuth会话需要刷新。

```bash
ima2 setup     # re-run option 1 (GPT OAuth)
ima2 serve
```

如果这种情况发生在公司网络上，防火墙、VPN、代理或强制门户也可能会阻止OAuth流动。

### 我该如何使用Gemini提供商？

二Gemini提供者可用：

- **`agy`**— 使用Antigravity CLI (`agy -p`）没有API需要钥匙。需要`agy`要安装并登录的二进制文件。型号是`nano-banana-2`，输出固定为1024×1024。

- **`gemini-api`**——称为谷歌生成语言API直接地。添加一个`GEMINI_API_KEY`env var，或通过设置 > 配置密钥API钥匙。为了Vertex AI,添加服务帐号JSON通过设置或`VERTEX_SERVICE_ACCOUNT_JSON`环境变量。当两者都APIkey 和 Vertex 凭证均存在，Vertex 优先。使用“设置”中的身份验证模式下拉菜单在`apikey`和`vertex`;该选择会自动保存并恢复。

这`gemini-api`提供商支持两种模型：`nano-banana-2` (Gemini3.1 Flash 图像）和`nano-banana-pro` (Gemini3 专业图像）。网络UI显示宽高比和分辨率控件 (512px–4K)`gemini-api`;这些仅在直接上受到尊重Gemini API路径并被忽略Vertex AI.

### 如何重新验证Grok或者Codex无需重新启动？

使用**切换账户**提供商的“设置”>“配额卡”中的按钮。这会启动一个设备代码OAuth流程：新的浏览器选项卡打开验证URL，您完成登录，服务器会自动获取新凭据。对于电流Grok建造xAIauth，配额栏显示服务器计算的每周使用百分比和重置时间。旧版身份验证回退到较旧的每月身份验证`$used / $limit`帐单视图（如果可用）。

## 型号及配额

### 我应该使用哪个模型？

GPT OAuth 默认使用 `gpt-6-luna`。该通道提供三个 GPT-6 模型：你选择的模型负责规划画面，`gpt-image-2` 负责出图。

- `gpt-6-luna`：默认模型。
- `gpt-6-sol`：另一个日常使用的 GPT-6 模型。
- `gpt-6-astra`：推理时间最长、速度最慢；推理强度 `none` 会按 `low` 执行。

旧的 OAuth 模型 ID（`gpt-5.6-sol`、`gpt-5.6-luna`、`gpt-5.6-terra`、`gpt-5.5`、`gpt-5.4`、`gpt-5.4-mini`）在已保存的设置和脚本中仍然可用。`gpt-5.6-sol` 会以 `gpt-6-sol` 运行，其余以 `gpt-6-luna` 运行。API key 通道（`provider: "api"`）保留自己的列表，默认是 `gpt-5.6-luna`。

### 为什么只有某个 GPT-6 模型失败？

GPT OAuth 通道使用你的 ChatGPT 方案开放的 GPT-6 模型。请更新 ima2-gen，用 `ima2 gpt login` 重新登录，再用 `ima2 models --kind image` 检查。如果某个模型持续失败，请改用 `gpt-6-luna`。

### Plus 或 Pro 可以生成多少张图像？

不要将任何社区号码视为保证。GPT OAuth生成可能会受到帐户、后端功能、流量和策略更改的限制。`ima2-gen`不发布固定的 Plus/Pro 图像计数，因为该数字不够稳定，无法作为承诺记录。

## Prompt Studio 和多​​模式

### 有详细的Prompt Studio手册吗？

是的。请参阅[提示工作室手册](PROMPT_STUDIO.md)。它解释了作曲家，
多模式老虎机、1:1 直接、模型/推理快速设置、最近历史记录、
画廊收藏夹，以及哪些操作有意导入提示文本。

### 为什么多模图像看起来不相关？

多模式从同一提示启动多个单独的图像请求。插槽
是候选输出，而不是同一共享画布内的面板，并且不是保证的
故事顺序。要获得相关的替代方案，请先写出共同的主题，然后
然后命名允许的变化。要获得一张多面板图像，请使用普通
单图像请求并要求两面板、拼贴画或联系表布局。

### 选择图库图像是否应该更改我当前的提示？

被动图像选择仅供查看。它应该聚焦所选图像而无需
重写作曲家。提示库插入，“从此图像继续”，以及
其他显式重用操作是有意更改提示的操作
文本。

### 问题 #75 发生了什么变化？

Prompt Studio 关闭修复了导航和状态耦合回归：
键盘移动现在遵循可见的近期历史领域，即画廊
条目仍然可以访问，长提示不再让图像查看器感到饥饿，
直接和多模式状态同时可见，图库收藏夹保留
浏览视口和被动图像选择不会重新填充作曲家。

## 图库和生成的文件

### 生成的图像存储在哪里？

当前版本将生成的图像存储在您的用户数据文件夹中：

```text
macOS / Linux: ~/.ima2/generated
Windows: %USERPROFILE%\.ima2\generated
```

你可以用以下方法覆盖它`IMA2_GENERATED_DIR`.

### 为什么更新后旧的图库图像看起来丢失了？

旧版本将生成的图像存储在已安装的包文件夹中。最新版本将库移至用户数据存储，因此包更新不会将应用程序代码与运行时文件混合。

抱歉吓到了。如果在更新期间替换了旧的全局安装文件夹，则之前的全局安装文件夹将被替换。`generated/`文件夹可能不再位于磁盘上。`ima2-gen`仅当旧文件夹仍然存在时才能恢复旧文件。

跑步：

```bash
ima2 doctor
```

然后跟随[恢复旧生成的图像](RECOVER_OLD_IMAGES.md).

### 做ima2-gen在此迁移过程中删除我的旧映像吗？

不。迁移仅是复制。它不会删除或移动旧文件夹。如果未找到旧文件，可能的问题是磁盘上不再存在旧的全局安装文件夹。

### “打开文件夹”会打开什么？

画廊的**打开文件夹**按钮打开运行机器上生成的图像文件夹`ima2 serve`.

这通常是您自己的计算机。如果您使用远程服务器、SSH 会话、VM、容器、WSL 或网络上的其他计算机，则该文件夹将在该服务器计算机上打开或解析，而不一定在浏览器设备上打开或解析。

### Card News 是稳定公开版本的一部分吗？

还没有。 Card News 仍处于开发阶段且处于实验阶段。默认发布
运行时应将其隐藏，除非显式启用它用于开发，
公共文档不应将其视为稳定功能。

## 参考图片

### 我可以附上多少张参考图片？

最多 5 个。

### 什么格式效果最好？

使用JPEG或者PNG。浏览器路径不直接支持 HEIC/HEIF，因此在附加这些图像之前先对其进行转换。

### 如果参考图像太大怎么办？

该应用程序压缩较大JPEG/PNG上传前的文件。如果文件仍然失败，请降低分辨率或将其转换为JPEG/PNG然后再试一次。

这API可能会报告参考错误，例如`REF_TOO_MANY`, `REF_TOO_LARGE`, `REF_NOT_BASE64`， 或者`REF_EMPTY`.

## 网络和OAuth错误

### 为什么后端换到了另一个端口？

`ima2-gen` 是本地应用。如果首选后端端口 `3333` 已被占用，运行时会改用下一个可用端口，并把实际 URL 记录在：

```text
~/.ima2/server.json
```

运行下面的命令查看配置的和实际的后端 URL：

```bash
ima2 doctor
```

GPT OAuth 不占用本地端口，服务器会直接调用 ChatGPT。

### 前后端分开开发时，如何指向实际的后端？

把 `ima2 doctor` 报告的后端 URL 传给 Vite：

```bash
VITE_IMA2_API_TARGET=http://localhost:3334 npm run ui:dev
```

### 什么是`failed to fetch`意思是？

通常是以下之一：

- GPT OAuth 无法连接到 `chatgpt.com`，
- 服务器已重新启动，
- VPN/代理/防火墙阻止了请求，
- 一个自动启动的Windows网络拦截工具，包括DNS/碎片
SecretDNS等绕过工具，已损坏OAuth或流式图像传输，
- 网络掉线了Codex/ChatGPT OAuth正在被使用。

尝试：

```bash
ima2 doctor
ima2 ping
```

然后重新启动`ima2 serve`如果需要的话。

### 我应该分享什么时候GPT OAuth图像生成没有返回图像？

在采取适度措施之前使用图像探针。`EMPTY_RESPONSE`意味着
响应路径未生成图像数据`ima2-gen`可以使用；它可以是
引起的OAuth能力、流解析、网络搜索/工具选择行为、
本地代理/网络传输、不支持的选项或真正的拒绝。

首先运行这个：

```bash
ima2 doctor
ima2 doctor image-probe --json > ima2-image-probe.json
```

如果`ima2 serve`正在运行，还捕获一只搜索关闭的猫和一只正常的猫
生成结果：

```bash
ima2 gen "고양이" --model oauth/gpt-6-luna --no-web-search --json > ima2-cat-no-search.json
ima2 gen "고양이" --model oauth/gpt-6-luna --json > ima2-cat-current.json
```

探头JSON旨在安全地附加到公共问题上。据报道
诊断代码、事件计数、工具调用摘要和字节计数，但不包括
提示文本、身份验证令牌、凭据 URL 或 base64 图像数据。

打开问题时，请包括：

- `ima2 doctor`输出。
- `ima2-image-probe.json`.
- `ima2-cat-no-search.json`和`ima2-cat-current.json`，如果你捕获了它们。
- `ima2-gen`版本和 Windows 版本。
- 无论您使用 VPN、企业代理、防病毒 TLS 检查还是自定义 CA。
- 是否正在运行 SecretDNS 等 Windows DNS/碎片绕过工具
自动地。
- 无论`provider: "api"`在同一台机器上工作，如果您已经有API键已配置。

请勿分享ChatGPT曲奇饼，OAuth令牌文件，API键，原始上游
响应、提示历史记录或生成的 base64。

如何读取结果：

- 文本探测失败：刷新OAuth并首先检查代理/模型的可用性。
- 文本有效，但最小的非流图像失败：可能的帐户，OAuth后端、模型或图像工具功能。
- 非流图像有效，但流图像失败：可能是流解析或传输。
- 搜索关闭生成有效，但正常生成失败：可能是网络搜索/工具选择交互。
- 已读取字节但未解析任何事件：可能SSE分隔符或`data:`解析。

### 在代理或 VPN 后面反复出现 `fetch failed` 怎么办？

GPT OAuth 请求由 `ima2 serve` 进程直接发往 `chatgpt.com`，所以关键是这个进程的网络路径。

如果你的网络需要代理，请开启代理客户端的 TUN/TURN 类模式，让终端进程也能走代理。在 Windows 上，还可以暂时关闭开机自启的 DNS 或分片绕过工具（例如 SecretDNS）后重试。如果仍然不行，请在启动 `ima2 serve` 的终端里设置代理。只有同时设置 `NODE_USE_ENV_PROXY=1`，Node.js 才会读取 `HTTPS_PROXY`：

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
export NODE_USE_ENV_PROXY=1
ima2 serve
```

请使用你的代理客户端的主机和端口。如果 `ima2-gen` 仍然失败，请在提交新 issue 前收集确切的命令、操作系统、代理设置和终端错误。

### 我应该在公司计算机上检查什么？

GPT OAuth可能需要访问OpenAI和ChatGPT/Codex相关主机。公司防火墙、TLS 检查、VPN 或代理可能会中断流量。如果登录并尝试不同的网络`failed to fetch`错误不断重复。

## SSE多路复用

### 为什么网络UI使用单个SSE联系？

浏览器限制并发数HTTP到同一源的连接（通常是 6 个）。一次生成多个图像时，每个生成请求都用于保持服务器发送事件连接打开。当多模式、节点和视频同时运行时，浏览器将耗尽连接，图库缩略图将挂起。

网络UI现在打开一个持久的`GET /api/events` SSE连接和所有生成进度都通过它进行复用。生成请求使用`async: true`并立即收到`202 { requestId }`响应，立即释放连接。这CLI不受影响——它仍然使用每个请求SSE什么时候`async`未设置。

### 如果发生什么情况SSE连接掉线？

事件通道客户端以指数退避自动重新连接。重新连接时，它发送`Last-Event-ID`因此服务器可以从其环形缓冲区重播错过的事件（最多 2000 个条目）。如果事件已从缓冲区中逐出，服务器会发送一个`replay-gap`事件，以便客户端知道某些更新可能已丢失。

### 最大并发作业数是多少？

服务器将并发生成作业限制在配置的值`limits.maxParallel`值（默认`24`，可覆盖`IMA2_MAX_PARALLEL`）。收到额外请求`429`和`Retry-After: 5`。这SSE端点本身的并发连接数上限为 512 个。

## CLI故障排除清单

按顺序运行这些：

```bash
ima2 doctor
ima2 status
ima2 ping
ima2 ps
ima2 setup
npm install -g ima2-gen@latest
```

如果您在非默认端口上运行服务器：

```bash
IMA2_SERVER=http://localhost:3333 ima2 ping
```
