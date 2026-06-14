# Pixel Ark Image2

一个基于 GPT Image2 的本地 MCP 生图服务，支持图片生成、图片编辑、元素拆分与透明素材导出，可在 Codex 等 MCP 客户端中直接调用。

## 功能

- `image2_generate`：生成一张或多张图片并保存到本地。
- `image2_edit`：基于一张或多张输入图进行图片编辑。
- `image2_extract_elements`：从扁平设计图中拆分指定元素，导出透明 PNG/WebP 素材。
- `image2_start_generation`：启动后台生图任务。
- `image2_get_job`：查询后台任务状态和输出路径。
- `image2_cancel_job`：取消仍在运行的后台任务。

## 环境要求

- Node.js 20 或更高版本
- 一个可用的 GPT Image 兼容 API Key
- 支持 macOS、Linux 和 Windows

## AI Agent 最小安装路径

当 Codex、Claude Code 或其他支持 MCP 的 AI 编程助手读取本 README 时，优先按本节完成安装。

1. 在仓库根目录执行：

```bash
npm install
```

2. 确认用户已配置 `IMAGE2_API_KEY` 或 `OPENAI_API_KEY`。如果没有，只提示用户配置 Key，不要写入占位 Key。

3. 将本服务注册为 MCP server：

```json
{
  "command": "node",
  "args": ["/absolute/path/to/pixel-ark-image2/server.js"],
  "env": {
    "IMAGE2_MODEL": "gpt-image-2"
  }
}
```

4. 刷新 MCP 客户端，并确认工具列表包含：

```text
image2_generate
image2_edit
image2_extract_elements
image2_start_generation
image2_get_job
image2_cancel_job
```

## 安装

```bash
git clone https://gitee.com/codeTrees/pixel-ark-image2.git
cd pixel-ark-image2
npm install
```

## 配置 Key

服务会优先读取环境变量，也会自动读取用户目录下的 `~/.codex/image2-mcp.env`。

macOS / Linux:

```bash
mkdir -p ~/.codex
cp .env.example ~/.codex/image2-mcp.env
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex"
Copy-Item .env.example "$env:USERPROFILE\.codex\image2-mcp.env"
```

然后编辑 `image2-mcp.env`：

```env
IMAGE2_API_KEY=你的 API Key
IMAGE2_BASE_URL=https://api.openai.com/v1
IMAGE2_MODEL=gpt-image-2
```

也可以使用 `OPENAI_API_KEY` 作为兼容环境变量。`IMAGE2_BASE_URL` 可填写官方 OpenAI 地址，也可填写兼容 OpenAI Images API 的代理或私有服务地址。

## 在 Codex 中注册 MCP

把下面配置加入 `~/.codex/config.toml`，并把路径改成你本机 clone 后的 `server.js` 绝对路径。

macOS / Linux 示例：

```toml
[mcp_servers.image2]
command = "node"
args = ["/absolute/path/to/pixel-ark-image2/server.js"]
```

Windows 示例：

```toml
[mcp_servers.image2]
command = "node"
args = ["C:\\Users\\你的用户名\\path\\to\\pixel-ark-image2\\server.js"]
```

如果不想使用 `~/.codex/image2-mcp.env`，也可以直接在 MCP 配置里放环境变量：

```toml
[mcp_servers.image2.env]
IMAGE2_API_KEY = "你的 API Key"
IMAGE2_BASE_URL = "https://api.openai.com/v1"
IMAGE2_MODEL = "gpt-image-2"
```

重启 Codex 后，应该能看到 `image2_generate`、`image2_edit` 等工具。

## 输出目录

默认输出到服务目录下的 `assets/`。也可以通过环境变量指定：

```env
IMAGE2_DEFAULT_OUTPUT_DIR=~/Pictures/pixel-ark
```

调用工具时也可以传入 `output_dir` 覆盖默认目录。
