# Pixel Ark Image2

Pixel Ark Image2 是一个 Codex 插件，同时也可以作为普通 MCP server 使用。它基于 GPT Image 兼容接口提供生图、改图、元素拆分、透明素材导出和异步任务能力。

仓库结构：

```text
.agents/plugins/marketplace.json     # Codex marketplace
plugins/pixel-ark-image2/            # 实际插件包
plugins/pixel-ark-image2/dist/server.js
```

## 功能

- `image2_register_asset`：把本地图片登记为轻量资产，后续编辑可用 `image_asset_ids` 引用，减少历史图片上下文重复传递。
- `image2_generate`：生成一张或多张图片并保存到本地。
- `image2_edit`：基于一张或多张输入图进行图片编辑。
- `image2_extract_elements`：从扁平设计图中拆分指定元素，导出透明 PNG/WebP 素材。
- `image2_start_generation`：启动后台生图任务。
- `image2_get_job`：查询后台任务状态和输出路径。
- `image2_cancel_job`：取消仍在运行的后台任务。

## 环境要求

- Node.js 20 或更高版本
- Codex App 或 Codex CLI
- 一个可用的 GPT Image 兼容 API Key
- 支持 macOS、Linux 和 Windows

## 给 Codex 的最短安装路径

如果你是 Codex 或其他 AI 编程助手，优先按这个顺序安装：

1. 安装这个仓库作为 Codex 插件。
2. 配置 `~/.codex/image2-mcp.env`。
3. 重启 Codex 或开启新线程。
4. 验证插件工具是否出现。

不要把真实 API Key 写进仓库、README、聊天记录或 git commit。

## 安装为 Codex 插件

### 方式一：通过 marketplace 安装

这个仓库内置了 repo marketplace 文件：`.agents/plugins/marketplace.json`。在 Codex CLI 中执行：

```bash
codex plugin marketplace add https://gitee.com/codeTrees/pixel-ark-image2.git
codex plugin marketplace list
codex plugin add pixel-ark-image2@pixel-ark
```

安装后重启 Codex，或至少开启一个新线程再使用插件。

在 Codex App 中，也可以打开 **Plugins**，切换到 `Pixel Ark` marketplace，找到 **Pixel Ark Image2**，然后选择 **Add to Codex**。

### 方式二：本地克隆后安装

如果你的 Codex 环境不能直接从 Gitee marketplace 安装，先克隆到本地：

```bash
git clone https://gitee.com/codeTrees/pixel-ark-image2.git
cd pixel-ark-image2
codex plugin marketplace add .
codex plugin add pixel-ark-image2@pixel-ark
```

如果已经安装过旧版本，更新后重新执行：

```bash
git pull
codex plugin marketplace upgrade pixel-ark
codex plugin add pixel-ark-image2@pixel-ark
```

## 配置 API Key

插件会优先读取环境变量，也会自动读取用户目录下的 `~/.codex/image2-mcp.env`。

macOS / Linux:

```bash
mkdir -p ~/.codex
cp plugins/pixel-ark-image2/.env.example ~/.codex/image2-mcp.env
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex"
Copy-Item plugins\pixel-ark-image2\.env.example "$env:USERPROFILE\.codex\image2-mcp.env"
```

然后编辑 `image2-mcp.env`：

```env
IMAGE2_API_KEY=你的 API Key
IMAGE2_BASE_URL=https://model.zhengshuyun.net
IMAGE2_MODEL=gpt-image-2
```

也可以使用 `OPENAI_API_KEY` 作为兼容环境变量。`IMAGE2_BASE_URL` 默认使用 `https://model.zhengshuyun.net`，也可填写官方 OpenAI 地址或其他兼容 OpenAI Images API 的代理/私有服务地址。

## 验证安装

安装并配置 Key 后，开启一个新的 Codex 线程，输入：

```text
@pixel-ark-image2 生成一张小猫图片
```

正常情况下，Codex 会调用 Image2 插件，并返回图片预览。你也可以在 Codex CLI 中用 `/plugins` 查看插件是否已安装，在 `/mcp` 中查看 MCP server 是否正常启动。

插件安装成功后应包含这些工具：

```text
image2_register_asset
image2_generate
image2_edit
image2_extract_elements
image2_start_generation
image2_get_job
image2_cancel_job
```

## 作为普通 MCP Server 使用

如果不想安装 Codex 插件，也可以手动注册 MCP server。

先安装依赖：

```bash
git clone https://gitee.com/codeTrees/pixel-ark-image2.git
cd pixel-ark-image2
cd plugins/pixel-ark-image2
npm install
npm run build
```

把下面配置加入 `~/.codex/config.toml`，并把路径改成你本机 clone 后的 `dist/server.js` 绝对路径。

macOS / Linux 示例：

```toml
[mcp_servers.image2]
command = "node"
args = ["/absolute/path/to/pixel-ark-image2/plugins/pixel-ark-image2/dist/server.js"]
```

Windows 示例：

```toml
[mcp_servers.image2]
command = "node"
args = ["C:\\Users\\你的用户名\\path\\to\\pixel-ark-image2\\plugins\\pixel-ark-image2\\dist\\server.js"]
```

如果不想使用 `~/.codex/image2-mcp.env`，也可以直接在 MCP 配置里放环境变量：

```toml
[mcp_servers.image2.env]
IMAGE2_API_KEY = "你的 API Key"
IMAGE2_BASE_URL = "https://model.zhengshuyun.net"
IMAGE2_MODEL = "gpt-image-2"
```

重启 Codex 后，应该能看到 `image2_generate`、`image2_edit` 等工具。

## 输出目录

默认输出到服务目录下的 `assets/`。也可以通过环境变量指定：

```env
IMAGE2_DEFAULT_OUTPUT_DIR=~/Pictures/pixel-ark
```

调用工具时也可以传入 `output_dir` 覆盖默认目录。

## 常见问题

### 安装后没有工具

先确认已经开启新线程或重启 Codex。插件和 MCP 工具通常不会自动注入已经打开的旧线程。

### 提示没有配置 Key

确认 `~/.codex/image2-mcp.env` 存在，并且里面有：

```env
IMAGE2_API_KEY=你的 API Key
```

Windows 对应路径通常是：

```text
%USERPROFILE%\.codex\image2-mcp.env
```

### 生成很慢

图片生成可能需要 2-3 分钟。复杂图片、异步任务或服务排队时，等待 5-10 分钟也可能是正常情况。
