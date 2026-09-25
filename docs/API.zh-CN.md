# API参考

本文档列出了本地HTTP API暴露于`ima2 serve`.

根据URL:

```text
http://localhost:3333
```

## 供应商政策

图像生成支持OAuth, API-钥匙，Grok， 和Gemini (`agy`和`gemini-api`) 提供商。

- `provider: "oauth"`使用本地的Codex OAuth代理人。
- `provider: "api"`使用OpenAI回应API与托管的`image_generation`工具。
- `provider: "grok"`使用保存在`~/.progrok/auth.json`的xAI OAuth会话直接调用`https://api.x.ai`，不再有本地代理进程。经典、节点和代理生成强制运行xAI网页搜索通过`/v1/responses`，然后运行`grok-4.5`计划员与强制本地人通话`generate_image`函数，那么ima2执行xAI `/v1/images/generations`. `grok-4.3`仍然可以作为显式兼容性覆盖使用。如果附加了参考图像、节点父图像或代理当前图像，则最后一步将切换到xAI `/v1/images/edits`因此图像到图像的上下文被保留。
- `provider: "agy"`产生Antigravity CLI (`agy -p`）通过Google生成图像Gemini's `default_api:generate_image`工具。型号是`nano-banana-2`。输出固定为1024×1024JPEG。最多 3 个参考图像 (i2i)。没有网络搜索、质量、尺寸或遮罩控制。多模式返回单个图像。不支持视频（`AGY_VIDEO_UNSUPPORTED`).
- `provider: "grok-api"`使用直接xAI API密钥而不是OAuth会话；缺少或为空的图像凭证会在准入前以`GROK_API_KEY_MISSING`拒绝，绝不改走OAuth通道。与相同的管道`grok`（网页搜索 → 策划 →`/v1/images/generations`），相同的宽高比和分辨率选项。需要一个xAI API通过网络配置的密钥UI密钥管理或`XAI_API_KEY`环境变量。还支持视频生成。
- `provider: "gemini-api"`调用 Google 生成语言API直接（或Vertex AI使用服务帐户JSON）。支持型号`nano-banana-2` (Gemini3.1 Flash 图像）和`nano-banana-pro` (Gemini3 专业图像）。在两个身份验证路径上支持可变宽高比（1:1 到 21:9）和四个分辨率层（512px、1K、2K、4K）——直接API路径发送`generation_config.response_format.image`（蛇_情况）而Vertex AI端点（`aiplatform.googleapis.com`) 发送`generationConfig.imageConfig`（驼峰式）。和`size: "auto"`图像配置被完全省略，模型决定比率/大小。授权：`GEMINI_API_KEY`环境变量、网络UI密钥管理（`/api/keys/gemini`），或一个Vertex AI服务帐户JSON (`VERTEX_SERVICE_ACCOUNT_JSON`或者`/api/keys/vertex`）。当 Vertex 凭证和APIkey 已配置，Vertex 优先。选择的身份验证模式（`apikey`或者`vertex`）坚持`~/.ima2/config.json`作为`geminiAuthMode`并在服务器启动时恢复。每个模型的成本：`nano-banana-2`（闪存）：512=0.001 美元、1K=0.003 美元、2K=0.004 美元、4K=0.006 美元；`nano-banana-pro`：1K=0.007 美元，2K=0.007 美元，4K=0.013 美元。没有网络搜索或掩码控制。
- API-密钥生成涵盖经典生成、编辑、掩模引导编辑、多模式和节点生成。
- 如果`provider: "api"`请求时没有API关键，路由在上游之前失败`401`和`API_KEY_REQUIRED`.
- Grok生成图`size`到xAI `aspect_ratio`和`resolution`;它不发送OpenAI-风格`size`上游田地。Grok编辑用途xAI `/v1/images/edits`; Grok蒙版编辑仍然不受支持并返回`GROK_MASK_UNSUPPORTED`.
- 蒙版编辑是蒙版/选择引导编辑，而不是像素完美的修复保证。

Grok视频生成用途`POST /api/video/generate` (SSE）。看视频
下面的生成部分提供了完整的端点规范。

## 健康状况

|方法|小路|笔记|
|---|---|---|
| `GET` | `/api/health` |服务器健康状况、版本、路径、提供商策略；包含`grok: { auth: "oauth" \| "none" }`，同样写入`~/.ima2/server.json`|
| `GET` | `/api/providers` |提供者可用性和运行时端口|
| `GET` | `/api/oauth/status` | OAuth代理状态和可见模型|
| `GET` | `/api/grok/status` | xAI OAuth会话状态和可见xAI图像模型。返回`ready`、`no_image_model`、`error`或`offline`；没有会话时原因是`login_required`|
| `GET` | `/api/billing` |计费/状态探测，包括API配置时的密钥源|
| `GET` | `/api/quota` |供应商配额：回报`{ codex, grok }`。有资格的Grok建造xAIOIDC/外部身份验证返回`weekly`百分比/重置窗口`GET /v1/billing?format=credits`。如果不可用，旧端点可能会返回`monthly`窗口加`billing: { usedUsd, limitUsd }`. |

## 账户切换

|方法|小路|笔记|
|---|---|---|
| `POST` | `/api/auth/switch` |启动设备代码OAuth流动。身体：`{ "provider": "grok" \| "codex" }`。退货`{ sessionId, userCode, verificationUrl }`. |
| `GET` | `/api/auth/switch/:sessionId` |轮询切换帐户会话状态。退货`{ status }`状态是`pending`, `complete`, `error`， 或者`expired`. |

切换帐户流程会打开浏览器验证URL。用户完成设备代码步骤后，服务器将保存新凭据（Grok: `~/.progrok/auth.json`; Codex： 通过`codex login --device-auth`）并且会话转换为`complete`。该端点显示为**切换账户**设置配额卡中的按钮Grok和Codex提供商。

## 贮存

|方法|小路|笔记|
|---|---|---|
| `GET` | `/api/storage/status` |汇总图库存储状态以提供支持UI |
| `POST` | `/api/storage/open-generated-dir` |要求服务器进程打开生成的图像文件夹|

`GET /api/storage/status`默认情况下返回支持安全摘要，而不是原始遗留路径数组。

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

贮存`state`价值观：

|状态|意义|
|---|---|
| `ok` |当前图库有文件或无需恢复通知|
| `recoverable` |旧文件夹/文件仍然存在并且可以恢复|
| `not_found` |当前图库为空，未找到旧文件夹|
| `unknown` |存储状态检查失败或不完整|

`POST /api/storage/open-generated-dir`在运行的机器上打开生成的图像文件夹`ima2 serve`。如果浏览器连接到远程服务器、VM、容器、WSL 实例或网络上的另一台计算机，则此操作针对的是该服务器计算机，而不一定是浏览器设备。

## 飞行中的工作

|方法|小路|笔记|
|---|---|---|
| `GET` | `/api/inflight` |默认情况下仅活动作业|
| `GET` | `/api/inflight?includeTerminal=1` |包括最近用于调试的终端作业|
| `DELETE` | `/api/inflight/:requestId` |取消或忘记正在进行的工作|
| `GET` | `/api/events` |执着的SSE所有异步生成进度的多路复用通道（见下文）|

飞行日志和响应使用`requestId`用于相关性。日志不应包含原始提示、参考数据 URL、生成的 base64、令牌、cookie、身份验证标头或原始上游主体。

## 活动（SSE复用）

### `GET /api/events` (SSE复用）

单个持久服务器发送事件通道，用于承载所有异步生成作业的进度。浏览器UI打开一个`EventSource`在这里而不是保存每个请求SSE每个作业的连接，避免浏览器每个源的连接限制。

|询问|笔记|
|---|---|
| `lastEventId` |选修的。重新连接光标；也通过`Last-Event-ID`请求头|

**回复**: `text/event-stream`（执着的）。每个框架均采用标准SSE领域`id`, `event`， 和`data` (JSON).

**连接限制**：当活跃监听数达到512时，服务器返回`503`和`SSE_CAPACITY`在打开流之前。

**心跳**：服务器每15秒写入一个评论框：

```text
: ping
```

**重播**：重新连接时，服务器会重播内存中环形缓冲区（大小 2000）中的事件，以查找更新于`lastEventId`。重播时会省略大图像有效负载（>1000 个字符）`_imageOmitted: true`在`data`有效负载。如果请求的 ID 早于最旧的缓冲事件，则服务器会发出`replay-gap`直播扇出前的事件：

|事件|数据|描述|
|---|---|---|
| `replay-gap` | `{ lastEventId, oldestAvailableId }` |客户端应该协调飞行状态（例如通过`GET /api/inflight`) |

**作业路由**： 每一个`data`有效负载包括`jobId`（与工作的价值相同`requestId`）。活动机构还携带`requestId`适用时。客户端通过匹配来过滤事件`data.jobId`或者`data.requestId`到他们开始的工作。

**事件类型**（扇出到所有连接的客户端）：

|事件|发射者|描述|
|---|---|---|
| `phase` |节点、多模、视频|生命周期阶段变化|
| `partial` |节点，多模|渐进式预览图像（base64 数据URL) |
| `image` |多模|最终保存`GenerateItem`对于一幅序列图像|
| `done` |节点、多模、视频|终端成功有效负载（特定于路线的形状）|
| `error` |所有生成路线|终端故障|
| `submitted` |视频|作业提交至xAI |
| `progress` |视频|进度分数 0.0–1.0|
| `planning` |视频|视频规划器运行|

例子SSE框架：

```text
id: 42
event: phase
data: {"requestId":"req_abc","jobId":"req_abc","phase":"streaming"}
```

### 异步生成模式

`POST /api/node/generate`, `POST /api/generate/multimode`， 和`POST /api/video/generate`支持已持有的客户端的异步 POST 模式`GET /api/events`:

```json
{
  "async": true,
  "requestId": "req_xxx",
  "...": "other route fields"
}
```

|结果| HTTP |身体|
|---|---|---|
|公认| `202` | `{ "requestId": "req_xxx" }` |
|重复活动`requestId` | `409` | `REQUEST_ID_IN_USE` |
|超过配置的并发活动作业限制| `429` | `TOO_MANY_JOBS`和`Retry-After: 5`;默认限制是`24`通过`IMA2_MAX_PARALLEL` |

进展事件发布于`GET /api/events`。 POST响应立即返回；客户一定不要期望SSE在 POST 连接上时`async: true`.

CLI和遗留客户省略`async`并保持原始行为：每个请求SSE在同一个 POST 响应上（`Accept: text/event-stream`适用时）。服务器在该模式下双发射——它写道SSE到 POST 响应，并在上发布相同的事件`GET /api/events`.

## 一代

## 雪碧阿特拉斯

精灵图集导入需要精灵生成兼容的清单和PNG阿特拉斯。在读/写往返过程中会保留未知的清单字段。

|方法|小路|笔记|
|---|---|---|
| `POST` | `/api/sprite-atlas/import` | JSON `{ manifest, atlasBase64, runId?, name? }`;验证显式矩形并创建精灵运行以及代表性图像资源。|
| `GET` | `/api/sprite-atlas/:runId` |返回清单、可选管理和图集URL. |
| `PUT` | `/api/sprite-atlas/:runId/curation` |以原子方式存储 sprite-gen curation v1，而不更改源帧。|
| `POST` | `/api/sprite-atlas/:runId/unpack` |使用清单矩形提取帧。|
| `POST` | `/api/sprite-atlas/:runId/bake` |应用管理并重建图集、清单和报告。|
| `POST` | `/api/sprite-atlas/:runId/export/contact-sheet` |身体`{ state, columns? }`;创建一个PNG联系表。|
| `POST` | `/api/sprite-atlas/:runId/export/gif` |身体`{ state, fps?, loop? }`;通过 ffmpeg 创建并解码验证透明 GIF。|

导入时不返回清单`SPRITE_MANIFEST_REQUIRED`。 GIF 导出退货`FFMPEG_UNAVAILABLE`和HTTP503 当 ffmpeg 不可用时。

### `POST /api/generate`

文本到图像和参考引导的根生成。

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

支持的质量值：`low`, `medium`, `high`.

支持的审核值：`auto`, `low`.

什么时候`storyboard`是`true`，服务器预先添加情节提要关键帧指令，以便图像
几代人保持多镜头视频制作的角色和场景连续性。

当前应用程序默认值：`gpt-5.6-luna`. `gpt-5.5`和其他支持的GPT image当调用者明确选择模型时，模型仍然可用。

什么时候`provider`是`"grok"`，支持的型号有`grok-imagine-image`和
`grok-imagine-image-quality`。服务器使用`grok-4.5`作为搜索/规划者
默认型号（`IMA2_GROK_PLANNER_MODEL`）和强制搜索的时间和
规划器步骤与图像调用分开（`IMA2_GROK_PLANNER_TIMEOUT_MS`).
为了`n > 1`，搜索和计划运行一次，计划的提示将重复用于
图像请求。成功的Grok经典世代报告一强制
元数据中的网络搜索调用。

如果`references`存在于Grok经典请求，ima2仍然执行
强制搜索和`grok-4.5`规划阶段。规划者收到
多模态参考图像`image_url`输入及其强制
`generate_image.prompt`参数被指示为仅限英语，除了
用户请求的精确可见文本。最终的图像调用然后使用xAI
`/v1/images/edits`使用相同的参考图像而不是
`/v1/images/generations`。这可以保持图像到图像/参考上下文的活力
通过三相管道。xAI目前最多记录三个来源
用于图像编辑的图像，所以Grok超过三个的经典请求
参考文献返回`GROK_REF_TOO_MANY`.

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

定制尺寸缩小到最接近的尺寸xAI- 支持的宽高比和使用
`2k`当请求的最长边缘或像素预算更接近 2K 图像时。

### `POST /api/edit`

图像编辑/图像到图像生成。

该请求包括提示和图像负载。`provider: "api"`通过共享响应图像适配器发送提示和图像。可选蒙版作为蒙版指导转发，而不是像素完美的编辑保证。

和`provider: "grok"`，编辑请求发送至xAI `/v1/images/edits`
使用OAuth会话直接发送。蒙面Grok之前编辑被拒绝
上游与`GROK_MASK_UNSUPPORTED`.

Grokmultimode 目前将每个图像请求直接发送到xAI图片API
与映射的`aspect_ratio`/`resolution`;强制搜索+规划器
管道仅限于经典`/api/generate`.

### `POST /api/node/generate`

节点模式生成和子编辑。

身体领域：

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

什么时候`parentNodeId`如果存在，服务器加载存储的父节点图像并使用编辑路径。根节点和子/编辑节点都允许节点本地引用；对于子/编辑节点，首先发送父图像，然后发送引用，然后发送文本提示。

和`provider: "grok"`，Node模式使用相同xAI搜索+`grok-4.5`规划师+图像API管道作为经典一代。父节点图像，`externalSrc`，或者额外的参考传递给规划者，然后传递给xAI `/v1/images/edits`;否则最终调用使用`/v1/images/generations`. Grok节点请求的上限为三个输入图像，计算父/当前图像加上引用，然后返回`GROK_REF_TOO_MANY`当超过该限制时，在上游之前。`quality: "high"`将最终的图像模型提升为`grok-imagine-image-quality`.

当客户端发送时，路由可以流式传输服务器发送的事件`Accept: text/event-stream`。可能发生的事件包括`phase`, `partial`, `done`， 和`error`。或者，发送`{ "async": true, "requestId": "req_xxx" }`在体内接收`202 { requestId }`立即并跟踪进展`GET /api/events`（参见“活动”部分）。

Grok节点SSE回复不包括回复API `partial`图像事件是因为xAI图片API调用是同步的JSON。他们仍然散发着`phase`和`done`/`error`事件所以节点UI可以使用相同的飞行生命周期。

### `POST /api/generate/multimode` (SSE)

多图像序列生成。SSE-仅在 POST 响应上，除非使用异步模式。

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

发送`Accept: text/event-stream`对于每个请求SSE在 POST 连接上。或设置`"async": true`与客户`requestId`要得到`202 { requestId }`并接收事件`GET /api/events`.

**SSE事件**:

|事件|数据|描述|
|---|---|---|
| `phase` | `{ requestId, phase, sequenceId?, maxImages? }` |生命周期阶段|
| `partial` | `{ requestId, image, index }` |渐进式预览|
| `image` |满的`GenerateItem` |一张保存的序列图像|
| `done` |特定路线的摘要；可能包括`status: "partial"`超时后如果至少保存了一张图像|序列完成|
| `error` | `{ requestId, error, code?, status? }` |生成失败|

### `GET /api/node/:nodeId`

获取存储的节点元数据和资产URL.

## 参考图片

参考上传的上限为 5 项。前端压缩量大JPEG/PNG发送文件之前。 HEIC/HEIF 文件被拒绝并带有面向用户的转换提示。

服务器端验证可能会返回这些参考代码：

|代码|意义|
|---|---|
| `REF_NOT_ARRAY` | `references`不是一个数组|
| `REF_TOO_MANY` |超过配置的引用计数|
| `REF_NOT_STRING` |参考项不是字符串|
| `REF_EMPTY` |参考项目为空|
| `REF_TOO_LARGE` |引用超出了配置的 base64 大小|
| `REF_NOT_BASE64` |引用的 base64 无效|
| `GROK_REF_TOO_MANY` | Grok经典一代收到三张以上参考图|
| `GROK_MASK_UNSUPPORTED` | Grok请求编辑时带有掩码；xAI此版本中未连接蒙版编辑|

## 视频生成

### `POST /api/video/generate` (SSE)

通过生成视频Grok视频提供商。在 POST 连接上返回服务器发送的事件，或接受异步模式（`{ "async": true, "requestId": "req_xxx" }`） 为了`202 { requestId }`取得进展`GET /api/events`（参见“活动”部分）。

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

**型号**: `grok-imagine-video-1.5`（默认），`grok-imagine-video`。遗产`grok-imagine-video-1.5-preview`string 被接受为兼容性别名并在上游请求之前进行规范化。

**模式**从参考输入自动检测：

|输入|模式|期限上限|
|---|---|---|
|没有图片|文本转视频| 1–15s |
|1 张图片（`sourceImage`或者`sourceFilename`) |图像到视频| 1–15s |
|2–14 张图像 (`referenceImages` / `referenceFilenames`) |参考视频| 1.5: 1–15s / base: 1–10s |

1080p 可接受`grok-imagine-video-1.5`仅提示文本到视频和图像到视频，具有一个图像/帧源，包括`continueFromVideo`服务器提取父视频的最后一帧后。仅提示 1.5 文本到视频在上游请求之前使用内部白色画布图像到视频 shim。 1.5 不添加 Ref2V、V2V 编辑或扩展支持。

**参数**:

|场地|类型|默认|笔记|
|---|---|---|---|
| `prompt` |细绳| — |必需的|
| `provider` |细绳| `"grok"` | `"grok"`或者`"grok-api"` |
| `model` |细绳| `grok-imagine-video-1.5` |视频模型|
| `duration` |整数| `5` |1–15 秒（为了参考视频，限制为 10 秒）|
| `resolution` |细绳| `"480p"` | `480p`, `720p`， 或者`1080p` (`1080p`使用 1.5 T2V 帆布垫片或 I2V）|
| `aspectRatio` |细绳| `"auto"` |1:1、16:9、9:16、4:3、3:4、3:2、2:3、自动|
| `sourceImage` |细绳| — |用于图像转视频的 Base64 图像|
| `sourceFilename` |细绳| — |用于图像到视频的现有生成文件|
| `referenceImages` |细绳[] | — |用于视频参考的 Base64 图像|
| `referenceFilenames` |细绳[] | — |现有生成的视频参考文件|
| `continueFromVideo` |细绳| — |生成`.mp4`父母；服务器提取最后一帧并从 sidecar 重建谱系|
| `continuityLineage` |目的| — |可选的客户端提示；仅当`continueFromVideo`缺席|
| `plannerModel` |细绳| `grok-4.5` | Grok视频规划器模型覆盖；`grok-4.3`保持兼容（也可以通过设置UI或者`IMA2_GROK_PLANNER_MODEL`) |
| `storyboard` |布尔值| `false` |启用故事板模式 - 保持连续剪辑中的角色/场景连续性|

返回空白提示`PROMPT_REQUIRED`与一个`guidance`细绳。活跃的
提示应描述视觉流、运动流、声音/音乐/无音乐，
对话/无对话、结束帧和持续时间节奏。视频策划者使用
将选定的持续时间作为完整剪辑的运行时间，并将短请求扩展为
具有开场构图、关联动作/情感的制作级序列
变化，以及适合延续的稳定的结束框架。对于多字符
场景中，策划者通过视觉外观（服装、体格、
位置、道具）而不是名称，并相应地为每个对话行赋予属性。

什么时候`continueFromVideo`存在，服务器处理生成的`.mp4`
sidecar 具有权威性。客户`continuityLineage`无法覆盖它。这
保存的子 sidecar 包括`videoContinuity`，一个分支本地 max-4 堆栈，使用
`keep-start-plus-latest-3`保留。

`videoContinuity`形状：

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

入口`role`是`start`, `ancestor`, `parent`， 或者`current`。第一个剪辑是
保留为起始锚点；后人只保留最近的三个条目。
`lineageId`使用生成的视频基本名称，不带`.mp4`扩大。
该元数据存储在生成的`.mp4.json`边车并返回
历史行和视频`done`事件；`/generated/*.json`仍然是私有的。

Grok视频 API 使用的提示界面：

|表面|模型|责任|
|---|---|---|
|视频策划师| `grok-4.5`（通过覆盖`plannerModel`) |将用户提示、搜索上下文、参考和可选的连续性沿袭转换为最终的英语视频提示。它必须构建核心主题、动作/运动、摄像机/构图、环境/风格、对话/音频、结束帧切换和约束。多字符对话使用基于外观的说话人识别。|
|视频生成| xAI视频模型|收到计划员提示加上`sourceImage`或者`referenceImages`当存在时。|
|视频分析| `grok-4.5` |读取第一帧/最后一帧图像`/api/video/analyze`并返回娱乐/继续指导。|

**SSE事件**:

|事件|数据|描述|
|---|---|---|
| `planning` | `{ requestId }` |准备视频生成|
| `submitted` | `{ requestId, xaiVideoRequestId, requestedModel, effectiveModel, modelFallback }` |提交至xAI |
| `progress` | `{ requestId, progress, stalled }` |进度 0.0–1.0|
| `done` | `{ requestId, filename, url, mediaType, revisedPrompt, elapsed, usage, requestedModel, effectiveModel, modelFallback, video, videoContinuity }` |视频准备就绪|
| `error` | `{ error, code, status, requestId, guidance? }` |生成失败|

**视频错误代码**:

|代码|意义|
|---|---|
| `VIDEO_PROVIDER_UNSUPPORTED` |提供商不是`"grok"` |
| `PROMPT_REQUIRED` |提示为空或缺失|
| `INVALID_GROK_VIDEO_MODEL` |模型不在有效集中|
| `INVALID_VIDEO_RESOLUTION` |分辨率不是 480p/720p/1080p，或者外部请求 1080p`grok-imagine-video-1.5`仅提示 T2V / I2V|
| `INVALID_VIDEO_ASPECT_RATIO` |宽高比不在有效集中|
| `INVALID_VIDEO_DURATION` |持续时间不是 1–15 整数|
| `GROK_VIDEO_REF_TOO_MANY` |超过 7 张参考图片|
| `GROK_VIDEO_FAILED` |上游xAI视频生成失败|
| `GROK_VIDEO_FRAME_FAILED` |服务器无法提取父视频的最后一帧|

### `POST /api/video/edit`

通过编辑现有视频GrokV2V。这是一个阻塞JSON启动的端点xAI编辑作业，轮询它，下载最终的 MP4，并将其保存为生成的视频工件。

```json
{
  "prompt": "make it sunset",
  "videoUrl": "https://vidgen.x.ai/.../clip.mp4",
  "model": "grok-imagine-video"
}
```

`videoUrl`可能是一个HTTPS视频URL, xAI `file_id`, `data:video/*` URL，或生成`.mp4`文件名。生成的文件输入仅限于真实的`.mp4`生成的目录下的文件。

### `POST /api/video/extend`

从最后一帧开始扩展视频（最后一帧→I2V 编排）。这是一个异步作业端点：它返回HTTP202 立即并流式传输生命周期事件（`queued → extracting-frame → planning → submitted/progress → persisting → done`或者`error`） 超过`GET /api/events`。服务器提取父视频的最后一帧，将其作为图像到视频源注入，并在子工件上记录持久的沿袭。

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

立即响应：

```json
{ "ok": true, "requestId": "vext_...", "sourceVideoId": "1780226256355_50252101.mp4", "workflow": "last-frame-i2v" }
```

航站楼`done`有效载荷携带`video.operation: "extend"`, `video.sourceFrame: "last"`， 和`videoLineage` (`id`, `parentId`, `rootId`, `seriesId`, `sequenceIndex`）。复制`requestId`返回 409。帧提取失败映射到`VIDEO_FRAME_EXTRACT_UNAVAILABLE` (503), `VIDEO_FRAME_EXTRACT_TIMEOUT`（504，可重试），或`VIDEO_FRAME_EXTRACT_FAILED` (500).

### `POST /api/video/extend/native`

旧的提供程序本机扩展（阻止JSON）。开始xAI扩展作业，轮询它，下载组合输出 MP4，并将其保存为生成的视频工件。更喜欢`/api/video/extend`用于新的集成。

```json
{
  "prompt": "camera pulls back",
  "videoUrl": "1780226256355_50252101.mp4",
  "duration": 6,
  "model": "grok-imagine-video"
}
```

`duration`必须是 2 到 10 秒之间的整数。编辑和本机扩展支持`grok-imagine-video`仅有的;`grok-imagine-video-1.5`这些端点不接受其预览别名。

### `GET /api/video/frame`

提取一个PNG生成的帧`.mp4`文件。

|询问|笔记|
|---|---|
| `file` |所需生成`.mp4`文件名或生成的目录绝对路径|
| `position` | `last`（默认）或非负秒|

### `POST /api/video/analyze`

分析生成的第一帧和最后一帧`.mp4`使用配置的规划器模型（`grok-4.5`默认情况下）。这不会将视频作为时间视频上传；它提取两个PNG框架并要求视觉模型推断可能的运动。

```json
{
  "videoUrl": "1780226256355_50252101.mp4"
}
```

远程 URL 和`data:`故意拒绝输入以避免服务器端URL获取通过`ffmpeg`.

## 生成请求日志

|方法|小路|笔记|
|---|---|---|
| `GET` | `/api/generation-requests` |退货`{ items: GenerationRequestLogEntry[] }`— 最近 200 次生成尝试（提示、请求/成功标志、错误）。出现在网络上UI开发面板（`GenerationRequestLogPanel`）；不CLI包装器（#95）。|

## 历史

|方法|小路|笔记|
|---|---|---|
| `GET` | `/api/history` |列出生成的资产|
| `GET` | `/api/history?groupBy=session` |按会话标题对资产进行分组|
| `DELETE` | `/api/history/:filename` |墓碑是生成的资产|
| `POST` | `/api/history/:filename/restore` |恢复最近删除的资产|

历史行可以包含节点元数据，例如`sessionId`, `nodeId`, `clientNodeId`, `requestId`， 和`refsCount`.

## 资产库

生成文件上的持久库目录（阶段 050）。记录参考
里面的文件`generated/`;删除资产永远不会删除文件。

|方法|小路|笔记|
|---|---|---|
| `GET` | `/api/assets` |列出/搜索资产（`kind`, `folderId`, `tag`, `q`, `cursor`, `limit`) |
| `GET` | `/api/assets/:id` |通过ID获取一项资产；回报`404 ASSET_NOT_FOUND`当缺席时|
| `POST` | `/api/assets` |推广/创建资产（`filePath`, `kind`, `name?`, `folderId?`, `tags?`, `metadata?`) |
| `POST` | `/api/assets/promote-element` |将图库结果推广到`element`资产 （`result.path`或者`filePath`, `elementKind`, `name?`, `notes?`, `folderId?`, `tags?`) |
| `POST` | `/api/assets/derived` |保存派生资产（原始资产`image/png`身体;询问`source`, `kind=keyed-png`, `projectId?`, `name?`, `meta?` JSON）——写道`<src>-keyed-<ts>.png`+ 边车与`derivedFrom`并登记资产记录 `kind=vector-svg` 不发送请求体：服务器直接读取已校验的 `source` 并通过 `lib/vectorizeImage.ts` 转换，写出 `<src>-vector-<ts>.svg`（查询参数 `preset?`、`colorPrecision?`、`filterSpeckle?`、`cornerThreshold?`；非栅格源以 `DERIVED_SOURCE_NOT_RASTER` 拒绝）。生成的 SVG 附带严格 CSP 与 `nosniff`。 |
| `POST` | `/api/video/keying` |从生成的绿屏 mp4 导出 alpha WebM (`source`, `keyParams{tolerance,softness,keyColor?}`, `projectId?`, `name?`) — 回应`202 {requestId, filePath}`，发布`keying-start/progress/done/error`在事件总线上，写入 sidecar`derivedFrom`并注册视频资产|
| `PATCH` | `/api/assets/:id` |更新名称/文件夹/注释/标签/元数据|
| `POST` | `/api/assets/:id/test-sheet` |运行元素测试表；目前返回`501 TEST_SHEET_NOT_IMPLEMENTED`验证元素资产后|
| `DELETE` | `/api/assets/:id` |仅删除目录行（文件不变）|
| `DELETE` | `/api/assets/all` |删除所有资产记录（文件不变）|
| `GET` | `/api/assets/folders` |列出文件夹（平面；树形组装客户端）|
| `POST` | `/api/assets/folders` |创建文件夹（`name`, `parentId?`) |
| `PATCH` | `/api/assets/folders/:id` |重命名/移动文件夹（循环安全）|
| `DELETE` | `/api/assets/folders/:id` |删除一个空文件夹|
| `GET` | `/api/assets/tags` |不同的标签|

`kind`是其中之一`image | video | element | preset | template`. `filePath`是
需要用于`image`/`video`，必须呆在里面`generated/`，并且被存储
相对于它。光标分页顺序`created_at DESC, id DESC`;错误
使用带有代码的标准信封，例如`INVALID_ASSET_KIND`,
`INVALID_FILENAME`, `INVALID_PARENT`, `FOLDER_CYCLE`, `FOLDER_NOT_EMPTY`.

## 会话和图表

|方法|小路|笔记|
|---|---|---|
| `GET` | `/api/sessions` |列出图表会话|
| `POST` | `/api/sessions` |创建会话|
| `GET` | `/api/sessions/:id` |加载会话和图表|
| `PATCH` | `/api/sessions/:id` |重命名会话|
| `DELETE` | `/api/sessions/:id` |删除会话|
| `PUT` | `/api/sessions/:id/graph` |保存图表快照|

`PUT /api/sessions/:id/graph`需要一个`If-Match`包含当前图形版本的标头。

版本不匹配返回`GRAPH_VERSION_CONFLICT`和当前版本。这仅意味着客户端保存的是陈旧的图形版本；这并不能证明另一个浏览器选项卡更改了图表。

## 节点模板

节点图模板（higgsfield120）。种子模板随应用程序一起提供，并且是只读的；用户模板是从画布创建的。

|方法|小路|笔记|
|---|---|---|
| `GET` | `/api/node-templates` |列表模板摘要（种子+用户）|
| `POST` | `/api/node-templates` |创建用户模板（`201 { template }`) |
| `POST` | `/api/node-templates/:id/instantiate` |返回具有新节点 ID 的图形副本（从不自动运行）|
| `PATCH` | `/api/node-templates/:id` |重命名用户模板（种子→`403`) |
| `DELETE` | `/api/node-templates/:id` |删除用户模板（种子 →`403`) |

图形保存请求可能包含可观察性标头：

```text
X-Ima2-Graph-Save-Id
X-Ima2-Graph-Save-Reason
X-Ima2-Tab-Id
```

## 样式表

|方法|小路|笔记|
|---|---|---|
| `GET` | `/api/sessions/:id/style-sheet` |加载会话样式表|
| `PUT` | `/api/sessions/:id/style-sheet` |保存样式表|
| `PATCH` | `/api/sessions/:id/style-sheet/enabled` |切换样式表的使用|
| `POST` | `/api/sessions/:id/style-sheet/extract` |从提示/参考中提取样式字段|

样式表提取可能需要API钥匙/openai客户。图像生成还支持`provider: "api"`通过共享响应API图像适配器时API密钥已配置。

## 提示库

支持者`routes/prompts.ts`和 SQLite 提示表`lib/db.ts`.

|方法|小路|笔记|
|---|---|---|
| `GET` | `/api/prompts` |列出提示（`folderId`, `q`, `favoritesOnly`、分页）|
| `POST` | `/api/prompts` |创建提示|
| `GET` | `/api/prompts/:id` |获取一个提示|
| `PATCH` | `/api/prompts/:id` |更新提示字段|
| `DELETE` | `/api/prompts/:id` |删除提示|
| `POST` | `/api/prompts/:id/favorite` |切换收藏夹|
| `POST` | `/api/prompts/import` |旧版批量导入 (JSON身体）|
| `GET` | `/api/prompts/export` |导出提示库JSON |
| `GET` | `/api/prompts/folders` |列出文件夹|
| `POST` | `/api/prompts/folders` |创建文件夹|
| `PATCH` | `/api/prompts/folders/:id` |重命名文件夹|
| `DELETE` | `/api/prompts/folders/:id` |删除文件夹|

## 即时导入

预览/提交本地文件的导入流程，GitHub文件夹、精选资源和发现审查。实施于`routes/promptImport.ts`.

|方法|小路|笔记|
|---|---|---|
| `GET` | `/api/prompts/import/curated-sources` |列出精选的源注册表项|
| `GET` | `/api/prompts/import/discovery` |列出发现审核队列|
| `POST` | `/api/prompts/import/discovery-search` |搜索GitHub对于即时包候选人|
| `POST` | `/api/prompts/import/discovery-review` |批准/拒绝发现候选者|
| `POST` | `/api/prompts/import/curated-search` |搜索索引精选源|
| `POST` | `/api/prompts/import/curated-refresh` |刷新策划索引缓存|
| `POST` | `/api/prompts/import/folder-files` |列出 a 中的文件GitHub文件夹|
| `POST` | `/api/prompts/import/folder-preview` |预览已选择GitHub文件夹文件|
| `POST` | `/api/prompts/import/preview` |预览本地/GitHub导入候选人|
| `POST` | `/api/prompts/import/commit` |将选定的候选提交到提示库中|

## 卡新闻（开发门控）

仅当注册时`config.features.cardNews`是真的（`routes/cardNews.ts`）。网络UI需要`VITE_IMA2_CARD_NEWS=1`或者`VITE_IMA2_DEV=1`; CLI用途`ima2 cardnews …`.

|方法|小路|笔记|
|---|---|---|
| `GET` | `/api/cardnews/image-templates` |列出图像模板|
| `GET` | `/api/cardnews/image-templates/:templateId/preview` |模板预览图像|
| `GET` | `/api/cardnews/role-templates` |内置角色模板|
| `GET` | `/api/cardnews/sets` |列出卡片新闻集|
| `GET` | `/api/cardnews/sets/:setId` |取一套|
| `GET` | `/api/cardnews/sets/:setId/manifest` |设置清单JSON |
| `POST` | `/api/cardnews/draft` |创建规划草稿|
| `POST` | `/api/cardnews/generate` |开始卡片生成工作|
| `POST` | `/api/cardnews/jobs` |创建工作记录|
| `GET` | `/api/cardnews/jobs/:jobId` |投票工作状态|
| `POST` | `/api/cardnews/jobs/:jobId/retry` |重试失败的作业|
| `POST` | `/api/cardnews/cards/:cardId/regenerate` |重新生成一张卡|
| `POST` | `/api/cardnews/export` |导出已完成的设定资产|

## GitHub Star

工作室的一次性 Star 提示通过用户自己的 `gh` 登录为仓库加星；ima2 不保存任何 GitHub 令牌。这些路由只响应本机（回环地址）请求，局域网客户端会收到 `403 LOCAL_ONLY`。提示状态文件与 CLI 提示共用（`<configDir>/state/star-prompt.json`）。

| 方法 | 路径 | 结果 |
|---|---|---|
| `GET` | `/api/github/star` | `{ state: "starred" \| "not-starred" \| "unauthenticated" \| null, prompted, repo, url }`，未安装或未登录 `gh` 时为 `unauthenticated`；已提示后为 `null`（不再调用 gh） |
| `POST` | `/api/github/star` | 通过 `gh api -X PUT /user/starred/lidge-jun/ima2-gen` 加星并标记已提示；`409 GH_UNAUTHENTICATED`、`502 GH_FAILED` |
| `POST` | `/api/github/star/dismiss` | 不加星，仅标记已提示 |


## 常见错误代码

|代码|意义|
|---|---|
| `API_KEY_REQUIRED` | `provider: "api"`请求时未配置API钥匙|
| `APIKEY_DISABLED` |旧版本中的遗留/已弃用的硬块代码|
| `INVALID_IMAGE_MODEL` |型号名称未知或不受支持|
| `IMAGE_MODEL_UNSUPPORTED` |模型存在但无法使用图像生成|
| `INVALID_REQUEST` |上游请求参数无效；原始提供商详细信息可能包含为`upstreamCode`, `upstreamType`， 和`upstreamParam` |
| `INVALID_MODERATION` |审核值不是`auto`或者`low` |
| `SAFETY_REFUSAL` |上游安全拒绝|
| `MODERATION_REFUSED` |内容生成被审核拒绝|
| `AUTH_CHATGPT_EXPIRED` | Codex/ChatGPT OAuth会话已过期|
| `AUTH_API_KEY_INVALID` | API密钥无效、已撤销、超出配额或组织错误|
| `NETWORK_FAILED` |网络、代理、VPN 或防火墙故障|
| `OAUTH_UNAVAILABLE` |当地的OAuth代理不可用|
| `OPEN_GENERATED_DIR_FAILED` |服务器无法打开生成的图像文件夹|
| `GRAPH_VERSION_REQUIRED` |缺少图表`If-Match`标头|
| `GRAPH_VERSION_CONFLICT` |过时的图表版本|
| `GRAPH_TOO_LARGE` |图超出节点/边限制|
| `NODE_NOT_FOUND` |未找到节点元数据|
| `INVALID_GROK_IMAGE_MODEL` | A Grok请求使用外部模型`grok-imagine-image`或者`grok-imagine-image-quality` |
| `GROK_RATE_LIMITED` | xAI返回了速率限制响应|
| `GROK_AUTH_FAILED` | xAI请求鉴权失败（OAuth会话无效或已过期，需要重新`ima2 grok login`）|
| `GROK_SEARCH_TIMEOUT` / `GROK_PLANNER_TIMEOUT` / `GROK_IMAGE_TIMEOUT` |这Grok搜索、规划器或图像API步骤超出了其超时预算|
| `AGY_GENERATION_FAILED` | Gemini(agy) 图像生成失败|
| `AGY_TIMEOUT` |阿吉CLI进程超过 360 秒超时|
| `AGY_PROCESS_ERROR` |阿吉CLI二进制文件无法启动或崩溃|
| `AGY_QUOTA_EXHAUSTED` | Gemini API配额已用完（速率限制）|
| `AGY_PARSE_FAILED` |无法从 agy 输出解析工件路径|
| `AGY_ARTIFACT_NOT_FOUND` |Agy 报告了不存在的工件路径|
| `AGY_PATH_REJECTED` |Agy 工件路径位于允许的目录之外|
| `AGY_VIDEO_UNSUPPORTED` |不支持视频生成Gemini（agy）提供者|
| `AGY_MASK_UNSUPPORTED` |不支持基于蒙版的编辑Gemini（agy）提供者|
| `AGY_REF_TOO_MANY` |agy 的参考图像太多（最多 3 个）|
| `GEMINI_API_KEY_MISSING` | Gemini API键或Vertex AI未配置凭据|
| `GEMINI_API_RATE_LIMITED` | Gemini API速率有限 (429)|
| `GEMINI_API_BAD_REQUEST` | Gemini API错误请求 (400/403)|
| `GEMINI_API_SAFETY_BLOCKED` | Gemini API安全过滤器阻止发电|
| `GEMINI_API_NO_IMAGE` | Gemini API没有返回任何图像作为响应|
| `VIDEO_PROVIDER_UNSUPPORTED` |视频生成需要提供商`"grok"`或者`"grok-api"` |
| `SSE_CAPACITY` |并发数超过512`GET /api/events`听众|
| `REQUEST_ID_IN_USE` |异步 POST 使用了`requestId`已经有一份活跃的工作|
| `TOO_MANY_JOBS` |超过配置的并发活动生成作业限制（`Retry-After: 5`;默认`24`) |

## 密钥管理

API用于在运行时通过 Web 配置提供商凭据的关键管理端点UI或者HTTP API.

|端点|方法|描述|
|---|---|---|
| `/api/keys/status` |得到|返回所有提供者的配置/有效/屏蔽密钥状态（openai, xai, gemini, 顶点) 加`geminiAuthMode` (`"apikey"`或者`"vertex"`) |
| `/api/keys/:provider` |放|保存一个API钥匙。身体：`{ "apiKey": "..." }`。在保存之前验证密钥格式和上游config.json。提供商：`openai`, `xai`， 或者`gemini`. |
| `/api/keys/:provider` |删除|删除配置源API钥匙。无法删除源自环境的密钥（`ENV_KEY_IMMUTABLE`). |
| `/api/keys/vertex` |放|保存一个Vertex AI服务帐户JSON。身体：`{ "serviceAccountJson": "..." }`。验证JSON结构 （`type: "service_account"`, `project_id`必需的）。|
| `/api/keys/vertex` |删除|删除配置源Vertex AI服务帐户。|
| `/api/keys/gemini-auth-mode` |放|坚持Gemini在设置下拉列表中选择身份验证模式。身体：`{ "mode": "apikey" \| "vertex" }`。保存至`config.json`并热更新。|

通过 PUT 保存的密钥存储在`config.json`并在运行时上下文中进行热更新（无需重新启动服务器）。从环境变量加载的密钥（`OPENAI_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY`, `VERTEX_SERVICE_ACCOUNT_JSON`）优先并且通过以下方式不可变API.

## 缩略图回填

|端点|方法|描述|
|---|---|---|
| `/api/history/backfill-thumbnails` |邮政|生成缺失`.thumb.jpg`生成目录中所有图像和视频的缩略图。退货`{ ok, total, created, skipped, failed }`。也可通过以下方式离线使用`ima2 backfill-thumbs`. |

缩略图还会在服务器启动时自动为任何缺少缩略图的媒体文件生成。

## 代理模式

代理模式是一个对话式图像工作区（网络UI仅有——没有CLI）。所有路线均在`/api/agent/*`并得到以下支持`routes/agent.ts` + `lib/agent*.ts`.

|方法|小路|笔记|
|---|---|---|
| `GET` | `/api/agent/tools` |斜杠命令和工具元数据|
| `GET` | `/api/agent/sessions` |列出会话 (`?limit=`) |
| `POST` | `/api/agent/sessions` |创建会话（`title`, `currentImage`, `webSearchEnabled`) → `201` |
| `GET` | `/api/agent/sessions/:sessionId` |获取一个会话|
| `PATCH` | `/api/agent/sessions/:sessionId` |更新标题，`webSearchEnabled`, `generationSettings`, `currentImage`, 锁|
| `DELETE` | `/api/agent/sessions/:sessionId` |删除会话|
| `POST` | `/api/agent/sessions/:sessionId/compact` |会话压缩|
| `GET` | `/api/agent/sessions/:sessionId/manifest` |XML 清单导出|
| `POST` | `/api/agent/sessions/:sessionId/turns` |同步转动（`prompt`、提供商、质量、尺寸、型号……）|
| `GET` | `/api/agent/sessions/:sessionId/errors` |最近的错误（`?limit=`，默认10)|
| `GET` | `/api/agent/sessions/:sessionId/queue` |每个会话队列项目|
| `POST` | `/api/agent/sessions/:sessionId/queue` |将异步转动/斜线命令入队 →`202` |
| `GET` | `/api/agent/queue` |全局队列列表|
| `POST` | `/api/agent/queue/:itemId/cancel` |取消排队项目|
| `POST` | `/api/agent/queue/:itemId/retry` |重试失败的项目|

## 端点 →CLI测绘

大多数服务器路由`/api/*`有一个CLI包装纸。例外的是**代理模式** (`/api/agent/*`），即服务器+网络-UI-只有并且没有`ima2`子命令。提示生成器HTTP路线 （`POST /api/prompt-builder/chat`) 被包裹着`ima2 prompt build`。使用此表查找调用给定端点的命令。 （看README.md完整标志列表的“客户端”部分。）

|端点| CLI |
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
| `…/api/cardnews/…`（选通于`features.cardNews`) | `ima2 cardnews …` |
| `POST /api/comfy/export-image` | `ima2 comfy export` |
| `GET /api/inflight` / `DELETE /api/inflight/:id` | `ima2 inflight ls`（别名`ps`) / `ima2 inflight rm`（别名`cancel`) |
| `GET /api/events` (SSE复用）|网络UI仅（持续`EventSource`;不CLI包装纸）|
| `GET /api/storage/status` / `POST /api/storage/open-generated-dir` | `ima2 storage status` / `ima2 storage open` |
| `GET /api/billing` / `GET /api/providers` / `GET /api/oauth/status` / `GET /api/grok/status` | `ima2 billing` / `ima2 providers` / `ima2 oauth status` / `ima2 grok status` |
| `GET /api/quota` |网络UI仅有的 （Grok设置中的配额栏）|
| `POST /api/auth/switch` / `GET /api/auth/switch/:sessionId` |网络UI仅（设置 > QuotaCard > 切换帐户）|
| `GET /api/health` | `ima2 ping` |
| `GET /api/capabilities` | `ima2 capabilities` |
| `GET /api/config/grok-planner` | — (Grok规划器模型查询）|
| `PATCH /api/config/grok-planner` | — (Grok规划器模型更新）|
| `GET /api/agy/status` | — (Antigravity CLI安装状态）|
| `POST /api/history/backfill-thumbnails` | `ima2 backfill-thumbs` |
| `GET /api/keys/status`, `PUT/DELETE /api/keys/:provider`, `PUT/DELETE /api/keys/vertex` |网络UI仅（设置 >API按键）|
| `GET/POST/PATCH/DELETE /api/agent/*`（会话、轮流、队列）|—（代理模式；网络UI仅有、没有CLI) |
| `POST /api/prompt-builder/chat` | `ima2 prompt build` |

笔记：
- `ima2 history favorite`和`ima2 annotate …`发送`X-Ima2-Browser-Id: cli-<sha1prefix>`从配置目录派生，所以CLI活动不会与浏览器会话发生冲突。
- `ima2 session graph save`执行 GET-then-PUT 操作`If-Match: "<version>"`防范`GRAPH_VERSION_CONFLICT`.
- `ima2 history import`和`ima2 canvas-versions save/update`发送原始字节`Content-Type: image/<png|jpeg|webp>`;这SSE端点（`multimode`, `node generate`, `video`） 使用`Accept: text/event-stream`。网络UI相反使用`GET /api/events`加`async: true`在 POST 路线上。
- `ima2 cardnews …`检查`runtimeConfig.features.cardNews`在调用门控端点之前；当禁用时CLI退出 2 并带有明确的消息，而不是生成 404。

## CLI发现

服务器在以下位置写入广告文件：

```text
~/.ima2/server.json
```

CLI命令如`ima2 ping`, `ima2 gen`， 和`ima2 ls`使用此文件，除非`--server`或者`IMA2_SERVER`提供。

当前形状：

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

顶级`port`和`url`为老年人保留CLI客户。新代码应该更喜欢`backend.url`.

---

## 雪碧配方路线

### `GET /api/sprite-recipes`

列出所有精灵配方。退货`{ recipes: SpriteRecipeRecord[] }`.

### `POST /api/sprite-recipes`

创建一个新的精灵配方。身体：`SpriteRecipeDefinition`。退货`201 { recipe }`.

### `GET /api/sprite-recipes/:id`

获取单一食谱。退货`{ recipe }`或者`404 { error }`.

### `PATCH /api/sprite-recipes/:id`

更新配方字段。退货`{ recipe }`.

### `DELETE /api/sprite-recipes/:id`

删除食谱。退货`{ ok: true }`.

### `POST /api/sprite-recipes/:id/anchor/approve`

批准一名闲置候选人作为身份锚。身体：`{ assetId }`。退货`{ recipe }`.

### `POST /api/sprite-recipes/:id/anchor/generate`

生成一个空闲的候选锚点。异步：返回`202 { requestId }`, 进展通过`/api/events`.

### `POST /api/sprite-recipes/:id/generate`

为批准的食谱生成精灵行。身体：`{ states?, async, requestId }`。异步：`202 { requestId }`.

## MCP提供商连接

远程订阅MCP提供商（Runway, Higgsfield）通过编译连接
注册表——任意端点都会被拒绝。所有响应都是无秘密的：令牌
仅存在于版本化中`${configDir}/mcp/<provider>.json`记录 (0600)，绑定到
提供者端点和实时回调源。

服务器选择并发布其实际端口后，会自动恢复
每个启用的提供者都有一个完整的相同绑定令牌包。这条路径不
打开浏览器。丢失、损坏、仅待处理、禁用或绑定不匹配的记录
不发送承载请求并且不会被静默删除。不匹配报告为
`auth_required`;再次启动 Connect 以授权新的端点/源。OAuth状态
和 PKCE 是仅内存的，因此因重新启动而中断的浏览器流程必须重新启动。

### `GET /api/mcp/providers`

列出注册表提供商以及每个提供商的连接状态。

### `POST /api/mcp/temp-references`

将本地参考源（数据 URL）暂存为临时图库批次，以便MCP
一代可以通过文件名上传它们。退货`{ ok, batchId, files[] }`.

### `DELETE /api/mcp/temp-references/:batchId`

删除分阶段临时参考批次后MCP工作完成。

### `GET /api/models`

规范车道目录CLI/代理路由。退货
`{ ok, lanes: { [lane]: { status, reason?, defaults: { image?, video? }, models: { image[], video[] } } } }`
对于六个核心通道（`oauth|api|grok|grok-api|agy|gemini-api`) 加MCP车道
(`runway|higgsfield`）。状态是其中之一`ready|locked|disconnected|key-missing`
优先`locked > key-missing|disconnected > ready`. MCP静态快照
型号始终列出；动态的 （`models_explore`）模型仅在以下情况下出现
连接。消耗于`ima2 models`, `ima2 defaults set image|video`，以及
CLI模型解析器。

### `GET /api/mcp/providers/:id/status`

连接状态：`disconnected | connecting | auth_required | connected | offline | error`.
可选的`detail`是一个稳定、无秘密的诊断代码。`connected`意味着
当前发电/运输可用；`offline`表示终端传输故障
已观察到并且最多安排一次重新连接；`error`是一个无法恢复的故障。

### `POST /api/mcp/providers/:id/connect`

启动或恢复连接。退货`202 { status: { state: "auth_required", authorizationUrl } }`
当用户必须批准时OAuth在浏览器中；`202`连接时；`200`一次
连接。终端响应保留状态：`409 disconnected`, `503 offline`， 或者
`502 error`. `ok`仅适用于`connected`.

### `GET /api/mcp/oauth/callback`

OAuth重定向目标（`?state=&code=`）。免除 LAN 令牌保护；受保护
一次性使用的OAuth `state`+ PKCE。无效状态 →`400`没有代币交换。
完成HTML仅在经理到达后才返回`connected`;否则
回调返回状态的映射 202/409/503/502 响应和失败页面。

### `POST /api/mcp/providers/:id/refresh`

关闭并重新使用存储的令牌（刷新令牌路径）重新建立会话。它使用
相同的状态到HTTP映射为连接并且无法覆盖较新的断开连接或
连接生成。

### `DELETE /api/mcp/providers/:id/connection`

清除本地令牌并关闭会话。回复说明明确指出这是
仅限本地；它不会撤销提供者方的授予。墓碑可以防止老人变老
通过重新创建凭据进行连接、回调、恢复或刷新工作。

传输恢复从不重播主机`callTool`要求。特别是，突变或
连接管理器不会自动重试计费媒体操作。

### `POST /api/mcp/generate`

通过连接生成媒体MCP提供者。身体：
`{ provider: "runway", kind: "image"|"video", prompt, model?, ratio?, startFrameUrl?, requestId? }`.
异步：返回`202 { requestId }`;进步 （`submitted`, `provider-queued`,
`provider-running`, `downloading`）和终端`done`/`error`到达`/api/events`.
该路由是单一持久性所有者：结果被提交给生成的
之前的库（文件+严格sidecar+缩略图）`done`被发射。仅限目录
提供商（例如Higgsfield免费计划）返回`409 MCP_EXECUTION_LOCKED`.
`startFrameFilename`接受现有的生成库图像：将其上传到
提供者并用作图像到视频的起始帧，录制
`parent: { filename, mediaType, role: "start-frame" }`边车中的血统。

### `POST /api/mcp/media-action`

运行媒体工作流程操作。身体：`{ action: "stitch"|"upscale-video"|"upscale-image"|"edit-video"|"extend"|"reframe", files: [generated filenames], prompt?, provider? }`.
工作流路由器决定每个工具：`native`（提供者工具实时显示
匹配模式），`fallback` (`stitch`→本地ffmpeg连接；`extend`→ 最后一帧
I2V），或`unavailable` (`409 MEDIA_ACTION_UNAVAILABLE`，例如重新构建，同时
提供商仅提供目录）。异步：`202 { requestId, mode, plan }`;结果提交
通过同一个持久性所有者`parent`/`inputs`血统。

### `POST /api/mcp/tasks/:taskId/recover`

### `POST /api/mcp/multishot`

通过生成多镜头（多场景）视频Runway MCP。身体：
`{ prompt?: string, shots?: string[] (3-5), duration?: 5|10|15, resolution?: "720p"|"1080p", aspectRatio?, sound?: boolean, firstSceneFilename?, requestId? }`.
`prompt`映射到自动模式（storyPrompt）；`shots[]`映射到自定义模式。
之一`prompt`或者`shots`是必须的 （`400 INVALID_MULTISHOT`否则）。
异步：`202 { requestId, provider }`;生命周期事件`/api/events`.
结果提交`workflow: "video.multishot"`和`mcpParameters`.

重新下载远程成功MCP任务到生成的库中。身体：
`{ provider?: "runway", kind?: "video"|"image" }`。一代人后使用
下载/提交步骤暂时失败 - 提供者资产仍可获取
〜24-48小时。重新投票`get_task`，需要`SUCCEEDED`有输出URL
(`error` SSE事件与`MCP_TASK_NOT_SUCCEEDED`否则），然后运行相同的
下载（重试 + IPv4 回退）→ 单持久性提交路径作为
正常一代。异步：`202 { requestId, taskId }`; `done`携带
`recovered: true`.
仅目录提供程序（例如Higgsfield免费计划）返回
`409 MCP_EXECUTION_LOCKED`，与`/api/mcp/generate`.

## 合同发现

人工智能代理的机器可读工具合约（`ima2 tools` CLI回到这些）。

### `GET /api/contracts`

完整目录摘要：`{ ok, data: { tools: [{ id, namespace, availability, executable, description }] }, catalogVersion, schemaVersion, cliVersion, requestId, generatedAt }`.
可用性从实时连接状态提升：`callable`需要连接
会话加上连接后摄取证据；捆绑快照单独留下`documented`.

### `GET /api/contracts/:id`

一种工具的完整合同，包括`execution`绑定块：绑定工具携带
`{ binding, endpoint, inputContract }`— 标准化模式`ima2 tools call`
接受（原始上游`inputSchema`仅供参考）。
