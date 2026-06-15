---
name: image2
description: Use Pixel Ark Image2 for GPT Image compatible generation, editing, async generation, and element extraction. Always show generated or edited local image outputs as inline Markdown previews, and never show file paths unless the user explicitly asks for them.
---

# Pixel Ark Image2

Use this skill when the user asks to generate, edit, modify, split, extract, preview, or create images with Image2, GPT Image, Pixel Ark, or this plugin.

## Tool Choice

- Use the bundled MCP tools for image work:
  - `image2_generate`
  - `image2_edit`
  - `image2_extract_elements`
  - `image2_start_generation`
  - `image2_get_job`
  - `image2_cancel_job`
- Prefer `image2_start_generation` for slow or multi-image generation, then poll `image2_get_job` until completion before reporting results.
- Use `image2_generate` directly for simple single-image requests.
- Use `image2_edit` when the user provides one or more source images.
- Use `image2_extract_elements` when the user wants reusable transparent assets from a flattened design.
- Keep all image generation and image editing work inside Pixel Ark Image2. Do not route subject isolation, image-to-image edits, or transparent asset creation through external image skills or background-removal tools.

## Waiting And Retry

- Image generation commonly takes 2-3 minutes, and 5-10 minutes can still be normal. Treat waiting as normal, not as a problem to explain.
- While a job is running, keep user-facing updates minimal. Say at most: `正在生成，完成后直接给你预览。`
- Do not repeatedly narrate polling, latency, backend slowness, network state, queue state, or why a job is still running.
- Do not launch backup jobs, fallback jobs, lower-quality jobs, lower-complexity prompts, or rewritten prompts unless the user explicitly asks for that.
- If a generation request fails during a busy period, retry the same request once.
- If the retry also fails, stop and report the error briefly. Do not keep retrying.
- Do not apologize at length or provide a long failure analysis. Use one short sentence plus the concrete error when available.

## Preview Contract

After every successful generation, edit, extraction, or async job:

1. Parse the tool result JSON.
2. Find every returned local image path under fields such as `images[].path`, `partial_images[].path`, `elements[].images[].path`, and `background.images[].path`.
3. Show each final image inline with Markdown image syntax using the absolute local path:

```md
![Preview](/absolute/path/to/image.png)
```

4. For multiple images, label them briefly before each preview, for example `Preview 1`.
5. Do not only tell the user to open a file. Inline preview is required whenever a local image path exists.
6. Do not write a visible file path, output directory, filename, save location, or `文件路径` label in the response unless the user explicitly asks for the path or save location.
7. It is okay to use the local path inside Markdown image syntax because that is required for inline preview, but do not repeat that path as visible text.
8. If only URLs are returned, show the URLs as Markdown links only when needed, and avoid adding extra storage/path commentary.
9. If a tool fails because the API key is missing, tell the user to configure the Image2 environment file; do not ask them to put keys in prompts.

## Output Defaults

- Do not hard-code API keys.
- The MCP server reads `IMAGE2_API_KEY`, `OPENAI_API_KEY`, `IMAGE2_BASE_URL`, `IMAGE2_MODEL`, and `IMAGE2_DEFAULT_OUTPUT_DIR` from the environment or `~/.codex/image2-mcp.env`.
- Use `png` for PPT, transparent assets, and design work unless the user asks for another format.
- Keep prompt text out of generated images when the image will be used in editable PPT or UI layouts.
- For subject isolation, describe the target subject precisely and ask Image2 for a transparent PNG. Treat it as Image2 image-to-image generation, not as external layer extraction or local matting.

## Response Style

- Be concise.
- Show the image previews first when the user mainly wants to see the result.
- Do not append file paths after previews by default.
- Mention failed previews only when there is no usable local preview target or the image file does not exist.
